"""Pull the surface map toward the real frame's texture statistics by gradient descent.

    python texture_match.py <workdir> [--steps 220] [--device cpu] [--force]

Reads <workdir>/surface-start.npy (from surface.py) and writes <workdir>/surface.npy. It will not
replace a surface.npy that is already there unless --force is given: a long run on another machine
gives a different surface, and the one a video was rendered from is worth keeping.

The statistics are of the Portilla-Simoncelli / wavelet-scattering kind, measured separately in quiet
and in active areas: how much structure each scale and orientation holds (and how skewed and how
heavy-tailed it is), how that structure is itself arranged at coarser scales, which scales and
orientations occur together, and whether fine structure lines up with coarse edges.
No pixel of the real frame is copied: only these numbers are taken from it. They are stored in
reference/texture-statistics.npz (reference.py makes that file).

Each band is computed on the coarsest grid that still holds it, which is what makes this affordable.
The work runs on the GPU when there is one (Apple's MPS, else CUDA) and on the CPU otherwise;
--device chooses. Afterwards the smoothed map takes the real frame's brightness distribution over
the whole disk (calibration.final_tone); a bench map (surface.py --bench) is matched but not toned.
"""
import argparse
import math
import time
from pathlib import Path

import numpy as np
import torch

import calibration
import surface

SCALES_PX = (1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0)      # band k has sigma 2^k pixels
FIRST = 6                                                # bands 0..5 are analyzed; band 6 only modulates them
ANGLES = 4
EPS = 1e-3


def best_device():
    if torch.backends.mps.is_available():
        return torch.device('mps')
    if torch.cuda.is_available():
        return torch.device('cuda')
    return torch.device('cpu')


def to_unit(index):
    return (index - 150.0) / 25.0


def from_unit(x):
    return x * 25.0 + 150.0


def _bank(m, sigma, device):
    """Four analytic oriented band filters for a grid of m x m, band centered on `sigma` grid pixels."""
    f = torch.fft.fftfreq(m)
    fy, fx = torch.meshgrid(f, f, indexing='ij')
    k2 = fx * fx + fy * fy
    radial = torch.exp(-k2 * (2 * math.pi * sigma * 0.7) ** 2 / 2) - torch.exp(-k2 * (2 * math.pi * sigma * 1.4) ** 2 / 2)
    theta = torch.atan2(fy, fx)
    out = []
    for j in range(ANGLES):
        delta = torch.remainder(theta - j * math.pi / ANGLES + math.pi, 2 * math.pi) - math.pi
        out.append(radial * torch.where(delta.abs() < math.pi / 2, torch.cos(delta) ** 2, torch.zeros_like(delta)) * 2)
    return torch.stack(out).to(device)


def _crop(spectrum, m):
    """Keep the lowest m x m frequencies of an (.., n, n) spectrum, scaled so that an inverse transform
    at m x m gives the band-limited field sampled on the coarser grid."""
    n = spectrum.shape[-1]
    if m == n:
        return spectrum
    h = m // 2
    top = torch.cat([spectrum[..., :h, :h], spectrum[..., :h, n - h:]], dim=-1)
    bottom = torch.cat([spectrum[..., n - h:, :h], spectrum[..., n - h:, n - h:]], dim=-1)
    return torch.cat([top, bottom], dim=-2) * (m * m / (n * n))


def _modulus(z, eps=EPS):
    return torch.sqrt(z.real ** 2 + z.imag ** 2 + eps * eps)


class Statistics:
    def __init__(self, n, device):
        self.n = n
        self.device = device
        self.grid = [n >> max(k - 1, 0) for k in range(len(SCALES_PX))]       # grid size on which band k lives
        sizes = sorted(set(self.grid))
        self.bank1 = _bank(n, 1.0, device)
        self.bank2 = {m: _bank(m, 2.0, device) for m in sizes}
        self.bank4 = {m: _bank(m, 4.0, device) for m in sizes}
        f = torch.fft.fftfreq(n)
        fy, fx = torch.meshgrid(f, f, indexing='ij')
        self.low = torch.exp(-(fx * fx + fy * fy) * (2 * math.pi * 3.0) ** 2 / 2).to(device)

    def masks(self, weights):
        """weights: (classes, n, n) array, non-negative. Returns {grid size: normalized masks}."""
        w = torch.tensor(weights, dtype=torch.float32, device=self.device)
        out = {}
        for m in sorted(set(self.grid)):
            wm = torch.nn.functional.avg_pool2d(w[None], self.n // m)[0] if m != self.n else w
            out[m] = wm / wm.sum(dim=(1, 2), keepdim=True)
        return out

    def _band(self, X, k, m=None, only=None):
        """Band k of the field with spectrum X, on the grid of size m (default: the band's own grid);
        all orientations, or just orientation `only` (kept as a stack of one)."""
        m = m or self.grid[k]
        if k == 0:
            bank = self.bank1
        else:
            ratio = SCALES_PX[k] * m / self.n                                  # sigma in pixels of this grid
            assert abs(ratio - 2.0) < 1e-6 or abs(ratio - 4.0) < 1e-6, (k, m, ratio)
            bank = self.bank2[m] if abs(ratio - 2.0) < 1e-6 else self.bank4[m]
        if only is not None:
            bank = bank[only:only + 1]
        return torch.fft.ifft2(_crop(X, m)[None] * bank)

    def chunks(self, x, masks):
        """The statistics of field x (n, n) under the class masks, a few at a time: yields dicts of
        tensors (classes, ...). Each dict has its own computation graph, so a caller can back-propagate
        and free one before asking for the next; that keeps a full-size field within memory."""
        def mean(field, m):
            return torch.einsum('cyx,...yx->c...', masks[m], field)

        n = self.n
        X = torch.fft.fft2(x)
        out = {}
        for name, field in (('pixel', x), ('low', torch.fft.ifft2(X * self.low).real)):
            m1 = mean(field, n)
            centered = field[None] - m1[:, None, None]
            v = torch.einsum('cyx,cyx->c', masks[n], centered ** 2)
            if name == 'pixel':
                out['pixel.mean'] = m1
            out[f'{name}.logvar'] = torch.log(v)
            out[f'{name}.skew'] = torch.einsum('cyx,cyx->c', masks[n], centered ** 3) / v ** 1.5
            out[f'{name}.kurt'] = torch.einsum('cyx,cyx->c', masks[n], centered ** 4) / v ** 2
        yield out
        del out, X
        pairs = [(a, c) for a in range(ANGLES) for c in range(a + 1, ANGLES)]
        for k in range(FIRST):
            m = self.grid[k]
            # A. Every orientation of this band: how much, how skewed, how heavy-tailed, which occur together.
            out = {}
            b = self._band(torch.fft.fft2(x), k)                               # (angles, m, m), complex
            mod = _modulus(b)
            re = b.real
            s1 = mean(mod, m)                                                  # (classes, angles)
            var = mean(re ** 2, m)
            out[f's1.{k}'] = torch.log(s1)
            out[f'var.{k}'] = torch.log(var)
            out[f'skew.{k}'] = mean(re ** 3, m) / var ** 1.5
            out[f'kurt.{k}'] = mean(re ** 4, m) / var ** 2
            out[f'co.{k}'] = torch.stack([mean(mod[a] * mod[c], m) / (s1[:, a] * s1[:, c]) for a, c in pairs], dim=1)
            yield out
            del out, b, mod, re, s1, var
            for j in range(ANGLES):
                # B. Second layer: how the amplitude of this band is arranged at each coarser scale.
                out = {}
                X = torch.fft.fft2(x)
                bj = self._band(X, k, only=j)                                  # (1, m, m)
                modj = _modulus(bj)
                s1j = mean(modj, m)[:, 0]                                      # (classes,)
                spectrum = torch.fft.fft2(modj[0])
                for k2 in range(k + 1, len(SCALES_PX)):
                    m2 = n >> (k2 - 1)
                    s = _modulus(torch.fft.ifft2(_crop(spectrum, m2)[None] * self.bank2[m2]), EPS * 0.1)
                    value = mean(s, m2) / s1j[:, None]                           # (classes, angles2)
                    out[f's2.{k}.{j}.{k2}'] = torch.log(torch.roll(value, -j, dims=1))
                # C. The next coarser band on this band's grid: do the two occur together, are they in step?
                if k + 1 < FIRST:
                    coarse = self._band(X, k + 1, m)
                    cmod = _modulus(coarse)
                    c1 = mean(cmod, m)                                         # (classes, angles)
                    doubled = coarse * coarse / cmod
                    norm = s1j[:, None] * c1
                    product = bj * torch.conj(doubled)                         # (angles, m, m)
                    out[f'cross.{k}.{j}'] = mean(modj * cmod, m) / norm
                    out[f'phase.{k}.{j}'] = mean(product.real, m) / norm
                    out[f'phasei.{k}.{j}'] = mean(product.imag, m) / norm
                yield out
                del out, X, bj, modj, spectrum

    def measure(self, x, masks):
        """All statistics at once (for fields small enough, or without gradients)."""
        out = {}
        for part in self.chunks(x, masks):
            out.update({key: value.detach() if not x.requires_grad else value for key, value in part.items()})
        return out


# How far each kind of statistic may sit from the real frame's before it costs one unit of loss.
TOLERANCE = {'pixel.mean': 0.05, 'pixel.logvar': 0.05, 'pixel.skew': 0.1, 'pixel.kurt': 0.3, 'low.logvar': 0.05, 'low.skew': 0.1, 'low.kurt': 0.3,
             's1': 0.03, 'var': 0.05, 'skew': 0.1, 'kurt': 0.5, 'co': 0.03, 's2': 0.03, 'cross': 0.03, 'phase': 0.02, 'phasei': 0.02}
# The class means are held by the anchor, so they get little say here; the final tone step sets them.
EMPHASIS = {'pixel.mean': 0.2}


def loss_of(stats, target, emphasis=None):
    total = 0.0
    parts = {}
    for key, value in stats.items():
        group = key if key.startswith(('pixel', 'low')) else key.split('.')[0]
        part = (((value - target[key]) / TOLERANCE[group]) ** 2).mean()
        if emphasis:
            part = part * emphasis.get(group, 1.0)
        parts[group] = parts.get(group, 0.0) + float(part.detach())
        total = total + part
    return total, parts


def class_weights(index_field, window, threshold=172.0, soft=6.0, sigma=14.0):
    """Soft masks (quiet, active) from the smoothed brightness, limited to `window` (array or None)."""
    f = np.fft.fftfreq(index_field.shape[0])
    k2 = f[:, None] ** 2 + f[None, :] ** 2
    smooth = np.fft.ifft2(np.fft.fft2(index_field) * np.exp(-k2 * (2 * np.pi * sigma) ** 2 / 2)).real
    active = 1 / (1 + np.exp(-(smooth - threshold) / soft))
    w = np.stack([1 - active, active])
    if window is not None:
        w = w * window[None]
    return w.astype(np.float32)


def real_target(real_index, real_window, device):
    """The statistics of the real frame's map inside its window: what reference.py stores."""
    st = Statistics(real_index.shape[0], device)
    real = torch.tensor(to_unit(real_index), dtype=torch.float32, device=device)
    with torch.no_grad():
        return {k: v.clone() for k, v in st.measure(real, st.masks(class_weights(real_index, real_window))).items()}


def stored_target(device):
    with np.load(calibration.REFERENCE / 'texture-statistics.npz') as table:
        return {key: torch.tensor(table[key], device=device) for key in table.files}


def match_texture(start_index, target, device, steps, anchor=0.02, anchor_sigma=12.0, log=print, emphasis=None):
    """Gradient descent (L-BFGS) on the field itself. `anchor` holds the broad layout (everything
    coarser than anchor_sigma pixels) where the model put it."""
    n = start_index.shape[0]
    st = Statistics(n, device)
    masks = st.masks(class_weights(start_index, None))
    x0 = torch.tensor(to_unit(start_index), dtype=torch.float32, device=device)
    x = x0.clone().requires_grad_(True)
    f = torch.fft.fftfreq(n)
    fy, fx = torch.meshgrid(f, f, indexing='ij')
    hold = torch.exp(-(fx * fx + fy * fy) * (2 * math.pi * anchor_sigma) ** 2 / 2).to(device)
    low0 = torch.fft.ifft2(torch.fft.fft2(x0) * hold).real
    optimizer = torch.optim.LBFGS([x], lr=1.0, max_iter=steps, max_eval=int(steps * 1.3), history_size=20, line_search_fn='strong_wolfe',
                                  tolerance_grad=1e-10, tolerance_change=1e-14)
    state = {'calls': 0, 't0': time.time()}

    def closure():
        optimizer.zero_grad()
        total = torch.zeros((), device=device)
        parts = {}
        for chunk in st.chunks(x, masks):
            loss, some = loss_of(chunk, target, emphasis)
            loss.backward()
            total = total + loss.detach()
            for key, value in some.items():
                parts[key] = parts.get(key, 0.0) + value
            del chunk, loss
            if n > 1500 and device.type == 'mps':
                torch.mps.empty_cache()
        if anchor:
            drift = torch.fft.ifft2(torch.fft.fft2(x) * hold).real - low0
            hold_loss = anchor * (drift ** 2).mean() / 0.01
            hold_loss.backward()
            total = total + hold_loss.detach()
            parts['anchor'] = float(hold_loss.detach())
        state['calls'] += 1
        state['loss'] = float(total)
        if state['calls'] % 10 == 1:
            top = sorted(parts.items(), key=lambda kv: -kv[1])[:5]
            log(f'  call {state["calls"]:4d}  loss {float(total):9.3f}   ' + ' '.join(f'{k}:{v:.2f}' for k, v in top)
                + f'   ({time.time() - state["t0"]:.0f}s)')
        return total

    optimizer.step(closure)
    log(f'  finished after {state["calls"]} calls: loss {state["loss"]:.3f}  ({time.time() - state["t0"]:.0f}s)')
    return from_unit(x.detach().cpu().numpy().astype(np.float64))


def tone(matched):
    """The final tone of a matched whole map: its smoothed brightness takes the real frame's
    distribution over the disk. Takes and returns float32."""
    layout = surface.PARAMETERS
    disk = surface.map_grid(layout['M'], layout['half'])[2] > calibration.DISK_MU
    out = calibration.final_tone(matched.astype(np.float64), disk, calibration.stored_curves()['smooth_disk'])
    return out.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('workdir')
    parser.add_argument('--steps', type=int, default=220, help='iterations of the optimizer (default 220)')
    parser.add_argument('--device', default=None, help='mps, cuda or cpu (default: the first of these that is available)')
    parser.add_argument('--force', action='store_true', help='replace a surface.npy that is already in the folder')
    args = parser.parse_args()
    workdir = Path(args.workdir)
    if (workdir / 'surface.npy').exists() and not args.force:
        raise SystemExit(f'{workdir / "surface.npy"} exists. Use another folder, or --force to replace it.')
    device = torch.device(args.device) if args.device else best_device()

    start = np.load(workdir / 'surface-start.npy').astype(np.float64)
    sizes = (surface.PARAMETERS['M'], surface.BENCH['M'])
    if start.shape[0] not in sizes or start.shape[0] != start.shape[1]:
        raise SystemExit(f'surface-start.npy is {start.shape[0]} x {start.shape[1]}: expected the whole map or the bench, as surface.py writes them')
    whole = start.shape[0] == surface.PARAMETERS['M']

    target = stored_target(device)
    print(f'{start.shape[0]} px map on {device}; target statistics: {sum(v.numel() for v in target.values())} numbers', flush=True)
    matched = match_texture(start, target, device, args.steps, emphasis=EMPHASIS, log=lambda text: print(text, flush=True))
    # float32 from here on: the precision the map is stored in, and what the tone step starts from.
    # (Toning the float64 result directly would change the last digits of the surface.)
    matched = matched.astype(np.float32)
    if whole:
        np.save(workdir / 'surface.npy', tone(matched))
        print(f'{workdir / "surface.npy"}: matched, and toned over the disk')
    else:
        # The tone is set over the whole disk, which a bench map does not have.
        np.save(workdir / 'surface.npy', matched)
        print(f'{workdir / "surface.npy"}: matched (a bench map gets no tone step)')


if __name__ == '__main__':
    main()
