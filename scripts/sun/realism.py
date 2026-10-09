"""Can a classifier tell the simulated surface from the real frame? A two-sample test on texture.

    python realism.py <frame.png> <workdir>
    python realism.py <frame.png> <other frame.png>

Scores <workdir>/surface.npy (its central 1152 px) against the real frame, given as the same RGB
image reference.py takes. Given a second frame instead of a folder, it scores that frame against the
first: two real frames taken at different times show how far apart the real Sun is from itself.

Each field is described patch by patch with second-order wavelet scattering coefficients (how much
structure there is at each scale and orientation, and how that structure is itself arranged), and a
logistic regression is trained to separate real patches from model patches. The score is its accuracy
on patches it has not seen (as AUC): 0.5 means indistinguishable, 1.0 means trivially told apart.
"""
import argparse
import time
from pathlib import Path

import numpy as np

import reference

SIGMAS = (1.0, 2.0, 4.0, 8.0, 16.0, 32.0)
ANGLES = 4
PATCH = 48
STRIDE = 24
_FILTERS = {}


def _filters(size):
    if size in _FILTERS:
        return _FILTERS[size]
    f = np.fft.fftfreq(size)
    fy, fx = np.meshgrid(f, f, indexing='ij')
    k2 = fx * fx + fy * fy
    radial = [np.exp(-k2 * (2 * np.pi * s * 0.7) ** 2 / 2) - np.exp(-k2 * (2 * np.pi * s * 1.4) ** 2 / 2) for s in SIGMAS]
    theta = np.arctan2(fy, fx)
    bank = []
    for band in radial:
        row = []
        for j in range(ANGLES):
            delta = np.angle(np.exp(1j * (theta - j * np.pi / ANGLES)))
            window = np.where(np.abs(delta) < np.pi / 2, np.cos(delta) ** 2, 0.0) * 2
            row.append((band * window).astype(np.float32))
        bank.append(row)
    _FILTERS[size] = (bank, [band.astype(np.float32) for band in radial])
    return _FILTERS[size]


def _pool(field, centers):
    """Mean of the field over PATCH x PATCH windows centered on each (y, x)."""
    integral = np.pad(np.cumsum(np.cumsum(field, axis=0, dtype=np.float64), axis=1), ((1, 0), (1, 0)))
    y0, x0 = centers[:, 0] - PATCH // 2, centers[:, 1] - PATCH // 2
    y1, x1 = y0 + PATCH, x0 + PATCH
    return (integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]) / (PATCH * PATCH)


def centers(mask):
    """Centers (y, x) of the patches that lie wholly inside the mask."""
    size = mask.shape[0]
    grid = np.arange(PATCH, size - PATCH, STRIDE)
    yy, xx = np.meshgrid(grid, grid, indexing='ij')
    pts = np.stack([yy.ravel(), xx.ravel()], axis=1)
    inside = _pool(mask.astype(np.float64), pts) > 0.999
    return pts[inside]


def describe(field, pts):
    """Feature matrix (patches, features) and feature names."""
    size = field.shape[0]
    bank, radial = _filters(size)
    x = (field - 150.0) / 25.0
    spectrum = np.fft.fft2(x)
    names, columns = ['mean', 'std'], []
    mean = _pool(x, pts)
    columns.append(mean)
    columns.append(np.sqrt(np.clip(_pool(x * x, pts) - mean ** 2, 1e-9, None)))
    first = {}
    for k in range(len(SIGMAS) - 1):
        band = np.fft.ifft2(spectrum * radial[k]).real
        m2 = _pool(band ** 2, pts)
        columns.append(_pool(band ** 3, pts) / (m2 + 1e-9) ** 1.5)
        names.append(f'skew{k}')
        columns.append(_pool(band ** 4, pts) / (m2 + 1e-9) ** 2)
        names.append(f'kurt{k}')
        for j in range(ANGLES):
            modulus = np.abs(np.fft.ifft2(spectrum * bank[k][j])).astype(np.float32)
            first[(k, j)] = modulus
            columns.append(np.log(_pool(modulus, pts) + 1e-6))
            names.append(f'S1.{k}.{j}')
    for (k, j), modulus in first.items():
        s1 = _pool(modulus, pts) + 1e-6
        spec = np.fft.fft2(modulus)
        for k2 in range(k + 1, len(SIGMAS)):
            for j2 in range(ANGLES):
                second = np.abs(np.fft.ifft2(spec * bank[k2][j2]))
                # Named by the second filter's orientation relative to the first's; each feature is one fixed pair.
                columns.append(np.log(_pool(second, pts) / s1 + 1e-6))
                names.append(f'S2.{k}.{j}>{k2}.{(j2 - j) % ANGLES}')
    return np.stack(columns, axis=1), names


def _logistic(x, y, l2=1.0, steps=400):
    w = np.zeros(x.shape[1])
    b = 0.0
    lr = 0.5
    for _ in range(steps):
        z = np.clip(x @ w + b, -30, 30)
        p = 1 / (1 + np.exp(-z))
        g = x.T @ (p - y) / len(y) + l2 * w / len(y)
        w -= lr * g
        b -= lr * (p - y).mean()
    return w, b


def _auc(scores, labels):
    order = np.argsort(scores)
    ranks = np.empty(len(scores))
    ranks[order] = np.arange(1, len(scores) + 1)
    pos = labels == 1
    return (ranks[pos].sum() - pos.sum() * (pos.sum() + 1) / 2) / (pos.sum() * (~pos).sum())


def separate(real_features, real_pts, model_features, model_pts, block=192, select=None):
    """Two-fold test over a checkerboard of blocks. Returns (AUC, weights by feature)."""
    x = np.concatenate([real_features, model_features])
    y = np.concatenate([np.ones(len(real_features)), np.zeros(len(model_features))])
    pts = np.concatenate([real_pts, model_pts])
    if select is not None:
        x = x[:, select]
    fold = ((pts[:, 0] // block) + (pts[:, 1] // block)) % 2
    aucs, weights = [], []
    for held in (0, 1):
        train, test = fold != held, fold == held
        m, s = x[train].mean(axis=0), x[train].std(axis=0) + 1e-9
        w, b = _logistic((x[train] - m) / s, y[train])
        aucs.append(_auc((x[test] - m) / s @ w + b, y[test]))
        weights.append(w)
    return float(np.mean(aucs)), np.mean(weights, axis=0)


def score(model, real, mask, quiet_below=None, top=0):
    """AUC over all patches inside the mask; over quiet patches only (mean brightness below
    `quiet_below`, in units of 25 index steps above 150); and with first-order features only.
    `top`: also list that many of the features the classifier leaned on most."""
    pts = centers(mask)
    rf, names = describe(real, pts)
    mf, _ = describe(model, pts)
    auc, w = separate(rf, pts, mf, pts)
    out = {'auc': auc}
    if quiet_below is not None:
        rq, mq = rf[:, 0] < quiet_below, mf[:, 0] < quiet_below
        out['auc_quiet'], _ = separate(rf[rq], pts[rq], mf[mq], pts[mq])
    first = np.array([not n.startswith('S2') for n in names])
    out['auc_first'], _ = separate(rf, pts, mf, pts, select=first)
    if top:
        order = np.argsort(-np.abs(w))[:top]
        out['top'] = [(names[i], round(float(w[i]), 2), round(float(mf[:, i].mean() - rf[:, i].mean()), 3)) for i in order]
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('frame', help='the real frame as an RGB image')
    parser.add_argument('candidate', help='a work folder holding surface.npy, or another frame as an RGB image')
    args = parser.parse_args()
    t0 = time.time()
    real, mask, _ = reference.bench_reference(reference.unproject(reference.frame_index(args.frame)))
    path = Path(args.candidate)
    if path.is_dir():
        path = path / 'surface.npy'
        model = np.load(path).astype(np.float64)
        n = real.shape[0]
        if model.shape[0] != n:
            lo = (model.shape[0] - n) // 2
            model = model[lo:lo + n, lo:lo + n]
    else:
        model = reference.bench_reference(reference.unproject(reference.frame_index(path)))[0]
    result = score(model, real, mask, quiet_below=0.6, top=6)
    print(f'{path}: AUC {result["auc"]:.3f}  quiet {result["auc_quiet"]:.3f}  first-order only {result["auc_first"]:.3f}   ({time.time() - t0:.0f}s)')
    # What the classifier leaned on most: the feature, its weight, and in brackets its mean in the model minus its mean in the real frame.
    print('      ' + '  '.join(f'{name}:{weight:+.2f}({shift:+.2f})' for name, weight, shift in result['top']))


if __name__ == '__main__':
    main()
