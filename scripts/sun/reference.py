"""Measure the one real frame the simulation is calibrated against, and store the numbers it needs.

    python reference.py <frame.png>

<frame.png> is the NASA SDO AIA 304 frame as an RGB image: square, the disk centered, the limb at
812/1024 of the half-width. Three files are written to reference/, next to this script:

    texture-curves.npz       brightness distributions of the frame's map, band by band (calibration.py)
    texture-statistics.npz   its texture statistics in quiet and in active areas (texture_match.py)
    limb-quantiles.npz       its brightness quantiles at every height around the limb (corona.py)

Only these numbers are kept: no pixel of the frame is stored, and the steps that generate the Sun
(surface.py, texture_match.py, render.py) read the three files, never the frame.
"""
import argparse

import numpy as np
from PIL import Image

import calibration
import corona
import surface
from palette import to_index


def frame_index(path):
    """The frame as the scalar intensity its colors encode (index 0..255)."""
    index = to_index(np.asarray(Image.open(path).convert('RGB'))).astype(np.float64)
    if index.shape[0] != index.shape[1]:
        raise SystemExit(f'{path}: the frame must be square, with the disk centered')
    return index


def bilinear(field, x, y):
    limit = field.shape[0] - 1.001
    x = np.clip(x, 0, limit)
    y = np.clip(y, 0, limit)
    x0 = x.astype(np.int32)
    y0 = y.astype(np.int32)
    fx = x - x0
    fy = y - y0
    return (field[y0, x0] * (1 - fx) + field[y0, x0 + 1] * fx) * (1 - fy) + (field[y0 + 1, x0] * (1 - fx) + field[y0 + 1, x0 + 1] * fx) * fy


def unproject(index, size=surface.PARAMETERS['M']):
    """The real frame on the model's equal-area map, so statistics can be compared like for like.
    NaN where mu is below 0.05: the frame is too foreshortened there to say anything."""
    n = index.shape[0]
    u, v, mu = surface.map_grid(size, surface.HALF)
    inside = mu > 0.05
    k = np.sqrt(2 / (1 + np.clip(mu, 0, 1)))
    sx, sz = u / k, v / k
    half = n / 2
    x = sx * half * corona.LIMB + half - 0.5
    y = -sz * half * corona.LIMB + half - 0.5
    out = bilinear(index, x, y)
    # Kept at float32 precision: the stored numbers were measured from the map as a float32 file.
    return np.where(inside, out, np.nan).astype(np.float32).astype(np.float64)


def whole_reference(real_map):
    """The real frame's whole map, made fit for the band filters (which wrap around): toward the limb
    it fades into its own mean. Returns it and mu at every pixel."""
    mu = surface.map_grid(real_map.shape[0], surface.HALF)[2]
    edge = np.clip((mu - 0.05) / 0.1, 0, 1)
    mean = np.nanmean(real_map)
    return np.where(np.isnan(real_map), mean, real_map) * edge + mean * (1 - edge), mu


def bench_reference(real_map, n=surface.BENCH['M']):
    """The central n pixels of the real frame's map, where it is hardly foreshortened, and the window
    its statistics are taken in: with a sharp edge, and with a soft one."""
    lo = (real_map.shape[0] - n) // 2
    px = 2 * surface.HALF / real_map.shape[0]
    axis = (np.arange(n) + 0.5 - n / 2) * px
    u, v = np.meshgrid(axis, axis)
    mu = 1 - (u * u + v * v) / 2
    return real_map[lo:lo + n, lo:lo + n], mu > calibration.WINDOW_MU, np.clip((mu - calibration.WINDOW_MU) / 0.02, 0, 1)


def texture_statistics(real, window):
    """The statistics texture_match.py steers toward, as arrays keyed by name. Computed on the device
    texture_match.py itself would use. A GPU and a CPU differ in the last digits (by under one percent
    of the tolerance the match works to); the stored file is the one the shipped surface was matched
    to, made on an Apple GPU."""
    import texture_match
    target = texture_match.real_target(real, window, texture_match.best_device())
    return {key: value.cpu().numpy() for key, value in target.items()}


def limb_quantiles(index):
    """The real frame's brightness quantiles at every height around the limb: heights (solar radii)
    and a table (heights, quantiles)."""
    size = index.shape[0]
    cols = 8192
    d = 2 * np.pi / cols
    h = np.arange(-0.07, 0.27, d)
    theta = (np.arange(cols) + 0.5) * d
    r = 1 + h[:, None]
    x = size / 2 - 0.5 + r * np.cos(theta)[None, :] * size / 2 * corona.LIMB
    y = size / 2 - 0.5 - r * np.sin(theta)[None, :] * size / 2 * corona.LIMB
    strip = bilinear(index, x, y)
    # Quantiles of the strip smoothed around the limb: the broad distribution of brightness, not the fine structure.
    f = np.fft.rfftfreq(cols)
    gain = np.exp(-(f * (np.radians(corona.SMOOTH_DEGREES) / d) * 2 * np.pi) ** 2 / 2)
    strip = np.fft.irfft(np.fft.rfft(strip, axis=1) * gain[None, :], cols, axis=1)
    q = np.percentile(strip, corona.QUANTILES, axis=1).T
    # Smooth a little along height, so the tables carry the trend and not one row's accidents.
    kernel = np.exp(-0.5 * (np.arange(-4, 5) / 1.5) ** 2)
    kernel /= kernel.sum()
    padded = np.pad(q, ((4, 4), (0, 0)), mode='edge')
    q = np.stack([np.convolve(padded[:, k], kernel, mode='valid') for k in range(q.shape[1])], axis=1)
    return h, q.astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('frame', help='the real frame as an RGB image')
    args = parser.parse_args()
    index = frame_index(args.frame)
    real_map = unproject(index)
    folder = calibration.REFERENCE
    folder.mkdir(exist_ok=True)

    # The whole map: what surface.py calibrates against, and the tone texture_match.py finishes with.
    whole, mu = whole_reference(real_map)
    curves = calibration.reference_statistics(whole, mu > calibration.WINDOW_MU, calibration.filters(whole.shape[0]))
    curves['smooth_disk'] = calibration.tone_target(whole, mu > calibration.DISK_MU)
    # The bench: the same curves for the central part alone, which `surface.py --bench` calibrates against.
    bench, bench_window, soft_window = bench_reference(real_map)
    bench_curves = calibration.reference_statistics(bench, bench_window, calibration.filters(bench.shape[0]))
    np.savez(folder / 'texture-curves.npz', **{name: np.array(value) for name, value in curves.items()},
             **{'bench_' + name: np.array(value) for name, value in bench_curves.items()})
    print(f'texture-curves.npz       {len(curves["bands"])} bands, {len(calibration.PROBS)} points each, for the whole map and for the bench')

    statistics = texture_statistics(bench, soft_window)
    np.savez(folder / 'texture-statistics.npz', **statistics)
    print(f'texture-statistics.npz   {sum(value.size for value in statistics.values())} numbers')

    h, q = limb_quantiles(index)
    np.savez(folder / 'limb-quantiles.npz', h=h, q=q)
    print(f'limb-quantiles.npz       {q.shape[1]} quantiles at {q.shape[0]} heights')


if __name__ == '__main__':
    main()
