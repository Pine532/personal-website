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

The map is the whole sphere (globe.py): every statistic is taken over all of it, each pixel
weighted by how much of the sphere it stands for. Each band is computed on the coarsest grid that
still holds it, which is what makes this affordable. The work runs on the GPU when there is one
(Apple's MPS, else CUDA) and on the CPU otherwise; --device chooses. Afterwards the smoothed map
takes the real frame's brightness distribution over the disk (calibration.final_tone); a bench map
(surface.py --bench) is matched but not toned.
"""
import argparse
import math
import time
from pathlib import Path

import numpy as np
import torch

import calibration
import globe

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


def _frequencies(shape):
    """Frequency grids (fy, fx) of a (rows, cols) map."""
    rows, cols = shape
    return torch.meshgrid(torch.fft.fftfreq(rows), torch.fft.fftfreq(cols), indexing='ij')


def _bank(shape, sigma, device):
    """Four analytic oriented band filters for a grid of `shape` (rows, cols), band centered on `sigma` grid pixels."""
    fy, fx = _frequencies(shape)
    k2 = fx * fx + fy * fy
    radial = torch.exp(-k2 * (2 * math.pi * sigma * 0.7) ** 2 / 2) - torch.exp(-k2 * (2 * math.pi * sigma * 1.4) ** 2 / 2)
    theta = torch.atan2(fy, fx)
    out = []
    for j in range(ANGLES):
        delta = torch.remainder(theta - j * math.pi / ANGLES + math.pi, 2 * math.pi) - math.pi
        out.append(radial * torch.where(delta.abs() < math.pi / 2, torch.cos(delta) ** 2, torch.zeros_like(delta)) * 2)
    return torch.stack(out).to(device)


def _crop(spectrum, shape):
    """Keep the lowest frequencies of an (.., rows, cols) spectrum, as many as a grid of `shape` holds,
    scaled so that an inverse transform at `shape` gives the band-limited field sampled on the coarser grid."""
    rows, cols = spectrum.shape[-2:]
    h, w = shape
    if (h, w) == (rows, cols):
        return spectrum
    hh, hw = h // 2, w // 2
    top = torch.cat([spectrum[..., :hh, :hw], spectrum[..., :hh, cols - hw:]], dim=-1)
    bottom = torch.cat([spectrum[..., rows - hh:, :hw], spectrum[..., rows - hh:, cols - hw:]], dim=-1)
    return torch.cat([top, bottom], dim=-2) * (h * w / (rows * cols))


def _modulus(z, eps=EPS):
    return torch.sqrt(z.real ** 2 + z.imag ** 2 + eps * eps)


class Statistics:
    def __init__(self, shape, device):
        self.shape = tuple(shape)
        self.device = device
        rows, cols = self.shape
        # The grid (rows, cols) on which band k lives: band k is held by a grid 2^(k-1) times coarser.
        self.grid = [(rows >> max(k - 1, 0), cols >> max(k - 1, 0)) for k in range(len(SCALES_PX))]
        sizes = sorted(set(self.grid))
        self.bank1 = _bank(self.shape, 1.0, device)
        self.bank2 = {m: _bank(m, 2.0, device) for m in sizes}
        self.bank4 = {m: _bank(m, 4.0, device) for m in sizes}
        fy, fx = _frequencies(self.shape)
        self.low = torch.exp(-(fx * fx + fy * fy) * (2 * math.pi * 3.0) ** 2 / 2).to(device)

    def masks(self, weights):
        """weights: (classes, rows, cols) array, non-negative. Returns {grid: normalized masks}."""
        w = torch.tensor(weights, dtype=torch.float32, device=self.device)
        out = {}
        for m in sorted(set(self.grid)):
            wm = torch.nn.functional.avg_pool2d(w[None], self.shape[0] // m[0])[0] if m != self.shape else w
            out[m] = wm / wm.sum(dim=(1, 2), keepdim=True)
        return out

    def _band(self, X, k, m=None, only=None):
        """Band k of the field with spectrum X, on the grid m (default: the band's own grid);
        all orientations, or just orientation `only` (kept as a stack of one)."""
        m = m or self.grid[k]
        if k == 0:
            bank = self.bank1
        else:
            ratio = SCALES_PX[k] * m[1] / self.shape[1]                        # sigma in pixels of this grid
            assert abs(ratio - 2.0) < 1e-6 or abs(ratio - 4.0) < 1e-6, (k, m, ratio)
            bank = self.bank2[m] if abs(ratio - 2.0) < 1e-6 else self.bank4[m]
        if only is not None:
            bank = bank[only:only + 1]
        return torch.fft.ifft2(_crop(X, m)[None] * bank)

    def chunks(self, x, masks):
        """The statistics of field x (rows, cols) under the class masks, a few at a time: yields dicts of
        tensors (classes, ...). Each dict has its own computation graph, so a caller can back-propagate
        and free one before asking for the next; that keeps a full-size field within memory.

        A statistic with an orientation axis is given one orientation at a time, under the key
        'name@column' (column: the index on that last axis): a whole band in all its orientations at
        once would need several gigabytes on the whole-sphere map. loss_of and measure put the pieces
        together again, so the loss and the stored reference are the same as if they were whole."""
        def mean(field, m):
            return torch.einsum('cyx,...yx->c...', masks[m], field)

        n = self.shape
        for name in ('pixel', 'low'):
            out = {}
            field = x if name == 'pixel' else torch.fft.ifft2(torch.fft.fft2(x) * self.low).real
            m1 = mean(field, n)
            centered = field[None] - m1[:, None, None]
            v = torch.einsum('cyx,cyx->c', masks[n], centered ** 2)
            if name == 'pixel':
                out['pixel.mean'] = m1
            out[f'{name}.logvar'] = torch.log(v)
            out[f'{name}.skew'] = torch.einsum('cyx,cyx->c', masks[n], centered ** 3) / v ** 1.5
            out[f'{name}.kurt'] = torch.einsum('cyx,cyx->c', masks[n], centered ** 4) / v ** 2
            yield out
            del out, field, centered
        pairs = [(a, c) for a in range(ANGLES) for c in range(a + 1, ANGLES)]
        for k in range(FIRST):
            m = self.grid[k]
            # A. Each orientation of this band: how much, how skewed, how heavy-tailed.
            for j in range(ANGLES):
                out = {}
                b = self._band(torch.fft.fft2(x), k, only=j)                   # (1, rows, cols), complex
                mod = _modulus(b)
                re = b.real
                s1 = mean(mod, m)[:, 0]                                        # (classes,)
                var = mean(re ** 2, m)[:, 0]
                out[f's1.{k}@{j}'] = torch.log(s1)
                out[f'var.{k}@{j}'] = torch.log(var)
                out[f'skew.{k}@{j}'] = mean(re ** 3, m)[:, 0] / var ** 1.5
                out[f'kurt.{k}@{j}'] = mean(re ** 4, m)[:, 0] / var ** 2
                yield out
                del out, b, mod, re, s1, var
            # Which orientations occur together.
            for index, (a, c) in enumerate(pairs):
                out = {}
                X = torch.fft.fft2(x)
                mod_a = _modulus(self._band(X, k, only=a))
                mod_c = _modulus(self._band(X, k, only=c))
                out[f'co.{k}@{index}'] = mean(mod_a[0] * mod_c[0], m) / (mean(mod_a, m)[:, 0] * mean(mod_c, m)[:, 0])
                yield out
                del out, X, mod_a, mod_c
            for j in range(ANGLES):
                # B. Second layer: how the amplitude of this band is arranged at each coarser scale.
                out = {}
                X = torch.fft.fft2(x)
                bj = self._band(X, k, only=j)                                  # (1, rows, cols)
                modj = _modulus(bj)
                s1j = mean(modj, m)[:, 0]                                      # (classes,)
                spectrum = torch.fft.fft2(modj[0])
                for k2 in range(k + 1, len(SCALES_PX)):
                    m2 = self.grid[k2]
                    s = _modulus(torch.fft.ifft2(_crop(spectrum, m2)[None] * self.bank2[m2]), EPS * 0.1)
                    value = mean(s, m2) / s1j[:, None]                           # (classes, angles2)
                    out[f's2.{k}.{j}.{k2}'] = torch.log(torch.roll(value, -j, dims=1))
                yield out
                del out, X, bj, modj, spectrum
                # C. The next coarser band on this band's grid, one orientation of it at a time: do the two
                # occur together, are they in step?
                if k + 1 < FIRST:
                    for c in range(ANGLES):
                        out = {}
                        X = torch.fft.fft2(x)
                        bj = self._band(X, k, only=j)
                        modj = _modulus(bj)
                        s1j = mean(modj, m)[:, 0]
                        coarse = self._band(X, k + 1, m, only=c)                 # (1, rows, cols)
                        cmod = _modulus(coarse)
                        norm = s1j * mean(cmod, m)[:, 0]                       # (classes,)
                        doubled = coarse * coarse / cmod
                        product = bj * torch.conj(doubled)
                        out[f'cross.{k}.{j}@{c}'] = mean(modj * cmod, m)[:, 0] / norm
                        out[f'phase.{k}.{j}@{c}'] = mean(product.real, m)[:, 0] / norm
                        out[f'phasei.{k}.{j}@{c}'] = mean(product.imag, m)[:, 0] / norm
                        yield out
                        del out, X, bj, modj, coarse, cmod, doubled, product

    def measure(self, x, masks):
        """All statistics at once, whole (for fields small enough, or without gradients)."""
        out = {}
        pieces = {}
        for part in self.chunks(x, masks):
            for key, value in part.items():
                value = value.detach() if not x.requires_grad else value
                name, _, column = key.partition('@')
                if column:
                    pieces.setdefault(name, {})[int(column)] = value
                else:
                    out[name] = value
        for name, columns in pieces.items():
            out[name] = torch.stack([columns[c] for c in sorted(columns)], dim=-1)
        return out


# How far each kind of statistic may sit from the real frame's before it costs one unit of loss.
TOLERANCE = {'pixel.mean': 0.05, 'pixel.logvar': 0.05, 'pixel.skew': 0.1, 'pixel.kurt': 0.3, 'low.logvar': 0.05, 'low.skew': 0.1, 'low.kurt': 0.3,
             's1': 0.03, 'var': 0.05, 'skew': 0.1, 'kurt': 0.5, 'co': 0.03, 's2': 0.03, 'cross': 0.03, 'phase': 0.02, 'phasei': 0.02}
# The class means are held by the anchor, so they get little say here; the final tone step sets them.
EMPHASIS = {'pixel.mean': 0.2}


def loss_of(stats, target, emphasis=None):
    """The loss of a chunk of statistics against the target. A piece 'name@column' is compared with
    that column of the target and weighted as its share of the whole statistic, so the total over all
    chunks is the mean squared (tolerance-scaled) error of every statistic, as if measured whole."""
    total = 0.0
    parts = {}
    for key, value in stats.items():
        name, _, column = key.partition('@')
        group = name if name.startswith(('pixel', 'low')) else name.split('.')[0]
        want = target[name]
        if column:
            want = want[..., int(column)]
        part = (((value - want) / TOLERANCE[group]) ** 2).sum() / target[name].numel()
        if emphasis:
            part = part * emphasis.get(group, 1.0)
        parts[group] = parts.get(group, 0.0) + float(part.detach())
        total = total + part
    return total, parts


def class_weights(index_field, window, threshold=172.0, soft=6.0, sigma=14.0):
    """Soft masks (quiet, active) from the smoothed brightness, times `window`: how much each pixel
    counts (an array of weights, a boolean mask, or None for all alike)."""
    rows, cols = index_field.shape
    fy, fx = np.meshgrid(np.fft.fftfreq(rows), np.fft.fftfreq(cols), indexing='ij')
    k2 = fx * fx + fy * fy
    smooth = np.fft.ifft2(np.fft.fft2(index_field) * np.exp(-k2 * (2 * np.pi * sigma) ** 2 / 2)).real
    active = 1 / (1 + np.exp(-(smooth - threshold) / soft))
    w = np.stack([1 - active, active])
    if window is not None:
        w = w * window[None]
    return w.astype(np.float32)


def real_target(real_index, real_window, device):
    """The statistics of the real frame's map inside its window: what reference.py stores."""
    st = Statistics(real_index.shape, device)
    real = torch.tensor(to_unit(real_index), dtype=torch.float32, device=device)
    with torch.no_grad():
        return {k: v.clone() for k, v in st.measure(real, st.masks(class_weights(real_index, real_window))).items()}


def stored_target(device):
    with np.load(calibration.REFERENCE / 'texture-statistics.npz') as table:
        return {key: torch.tensor(table[key], device=device) for key in table.files}


def match_texture(start_index, target, device, steps, weights=None, anchor=0.02, anchor_sigma=12.0, log=print, emphasis=None):
    """Gradient descent (L-BFGS) on the field itself. `weights` says how much each pixel counts in the
    statistics (globe.weights for a whole map). `anchor` holds the broad layout (everything coarser
    than anchor_sigma pixels) where the model put it."""
    shape = start_index.shape
    st = Statistics(shape, device)
    masks = st.masks(class_weights(start_index, weights))
    x0 = torch.tensor(to_unit(start_index), dtype=torch.float32, device=device)
    x = x0.clone().requires_grad_(True)
    fy, fx = _frequencies(shape)
    hold = torch.exp(-(fx * fx + fy * fy) * (2 * math.pi * anchor_sigma) ** 2 / 2).to(device)
    low0 = torch.fft.ifft2(torch.fft.fft2(x0) * hold).real
    optimizer = torch.optim.LBFGS([x], lr=1.0, max_iter=steps, max_eval=int(steps * 1.3), history_size=20, line_search_fn='strong_wolfe',
                                  tolerance_grad=1e-10, tolerance_change=1e-14)
    state = {'calls': 0, 't0': time.time()}
    large = start_index.size > 1500 * 1500

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
            if large and device.type == 'mps':
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
    distribution over the disk, every pixel counting by its share of the sphere. Takes and returns float32."""
    out = calibration.final_tone(matched.astype(np.float64), globe.weights(matched.shape), calibration.stored_curves()['smooth_disk'])
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
    rows, cols = start.shape
    whole = cols == 2 * rows
    if not whole and rows != cols:
        raise SystemExit(f'surface-start.npy is {rows} x {cols}: expected the whole map (twice as wide as high) or the bench (square), as surface.py writes them')
    if rows % 32 or cols % 32:
        raise SystemExit(f'surface-start.npy is {rows} x {cols}: both sides must be multiples of 32')

    target = stored_target(device)
    print(f'{rows} x {cols} px map on {device}; target statistics: {sum(v.numel() for v in target.values())} numbers', flush=True)
    # On the whole map every pixel counts by its share of the sphere; a bench patch at the equator counts alike.
    weights = globe.weights(start.shape) if whole else None
    matched = match_texture(start, target, device, args.steps, weights=weights, emphasis=EMPHASIS, log=lambda text: print(text, flush=True))
    # float32 from here on: the precision the map is stored in, and what the tone step starts from.
    # (Toning the float64 result directly would change the last digits of the surface.)
    matched = matched.astype(np.float32)
    if whole:
        np.save(workdir / 'surface.npy', tone(matched))
        print(f'{workdir / "surface.npy"}: matched, and toned over the whole sphere')
    else:
        # The tone is set over the whole disk, which a bench map does not have.
        np.save(workdir / 'surface.npy', matched)
        print(f'{workdir / "surface.npy"}: matched (a bench map gets no tone step)')


if __name__ == '__main__':
    main()
