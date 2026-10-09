"""Calibrate the contrast of a map, scale by scale, against curves measured from the real frame.

A map is split in the Fourier domain into bands: differences of Gaussians (they sum back to the
map exactly); the fine and middle bands are further split into four orientations with cos^2 windows
(which also sum to one). `match` pulls the brightness distribution of every band toward the real
frame's; `final_tone` does the same for the smoothed map alone, over the whole disk.

The real frame's curves are stored in reference/texture-curves.npz (reference.py makes that file),
so nothing here needs the frame itself.
"""
from pathlib import Path

import numpy as np

from turbulence import blur

REFERENCE = Path(__file__).resolve().parent / 'reference'
SIGMAS = (1.0, 2.0, 4.0, 8.0, 16.0, 32.0, 64.0)
ORIENTED = 5                      # how many of the finest bands are split by orientation
ANGLES = 4
TONE_SIGMA = 3.0
# A distribution is kept as its percentiles at these points: every half percent, and closer still in both tails.
PROBS = np.concatenate([[0, 0.01, 0.05, 0.1, 0.25, 0.5], np.linspace(1, 99, 197), [99.5, 99.75, 99.9, 99.95, 99.99, 100]])
WINDOW_MU = 0.8                   # the bands' curves are measured where mu exceeds this: within 0.6 solar radii of disk center
DISK_MU = 0.3                     # the tone is matched where mu exceeds this: the disk without its outermost rim


def _frequency(size):
    f = np.fft.fftfreq(size)
    fy, fx = np.meshgrid(f, f, indexing='ij')
    return fx, fy


def filters(size):
    """List of (name, transfer function); the transfer functions sum to one."""
    fx, fy = _frequency(size)
    k2 = fx * fx + fy * fy
    low = [np.ones((size, size))] + [np.exp(-k2 * (2 * np.pi * s) ** 2 / 2) for s in SIGMAS]
    theta = np.arctan2(fy, fx)
    out = []
    for k in range(len(SIGMAS)):
        radial = low[k] - low[k + 1]
        if k < ORIENTED:
            for j in range(ANGLES):
                window = np.cos(theta - j * np.pi / ANGLES) ** 2 * (2 / ANGLES)
                window[0, 0] = 1 / ANGLES
                out.append((f's{k}o{j}', radial * window))
        else:
            out.append((f's{k}', radial))
    out.append(('rest', low[-1]))
    return out


def decompose(field, bank):
    spectrum = np.fft.fft2(field)
    return [np.fft.ifft2(spectrum * transfer).real for _, transfer in bank]


def curve(values):
    return np.percentile(values, PROBS)


def remap(field, have, want):
    """Monotone map taking the distribution `have` to `want` (both from curve()), linear beyond the ends."""
    out = np.interp(field, have, want)
    lo = field < have[0]
    hi = field > have[-1]
    if lo.any():
        slope = (want[1] - want[0]) / max(have[1] - have[0], 1e-9)
        out[lo] = want[0] + (field[lo] - have[0]) * slope
    if hi.any():
        slope = (want[-1] - want[-2]) / max(have[-1] - have[-2], 1e-9)
        out[hi] = want[-1] + (field[hi] - have[-1]) * slope
    return out


def reference_statistics(real, window, bank):
    """Per-subband curves, the pixel curve and the curve of the smoothed field, all inside the window."""
    return {'bands': [curve(band[window]) for band in decompose(real, bank)], 'pixels': curve(real[window]),
            'smooth': curve(blur(real, TONE_SIGMA)[window])}


def tone_target(real, disk):
    """What final_tone aims at: the curve of the real frame's smoothed map over its disk."""
    return curve(blur(real, TONE_SIGMA)[disk])


def stored_curves(bench=False):
    """The real frame's curves from reference/texture-curves.npz: those of the whole map (bands,
    pixels, smooth, smooth_disk), or those of its central part (the bench, see surface.py)."""
    with np.load(REFERENCE / 'texture-curves.npz') as table:
        if bench:
            return {name[len('bench_'):]: table[name] for name in table.files if name.startswith('bench_')}
        return {name: table[name] for name in table.files if not name.startswith('bench_')}


def match(field, window, bank, stats, rounds=3, strength=1.0):
    """Heeger-Bergen style: pull every subband's distribution, then the tone, to the real frame's."""
    for _ in range(rounds):
        parts = decompose(field, bank)
        out = np.zeros_like(field)
        for part, want in zip(parts[:-1], stats['bands'][:-1]):
            have = curve(part[window])
            mapped = remap(part, have, want)
            out += part + strength * (mapped - part)
        rest = parts[-1]
        centered = rest - rest[window].mean()
        gain = stats['bands'][-1].std() / max(curve(rest[window]).std(), 1e-9)
        out += centered * gain ** strength + stats['pixels'].mean()
        # Match the tone of the smoothed field only, so fine contrast does not depend on brightness.
        low = blur(out, TONE_SIGMA)
        have = curve(low[window])
        field = remap(low, have, stats['smooth']) + (out - low)
    return field


def final_tone(field, disk, target):
    """Final tone of a finished surface map: the smoothed map takes the real frame's brightness
    distribution over the whole disk (fine detail rides along unchanged).
    field: the surface map; disk: boolean mask of the map's disk; target: curve of the real frame's
    smoothed map over its own disk (tone_target)."""
    low = blur(field, TONE_SIGMA)
    out = remap(low, curve(low[disk]), target) + (field - low)
    # Roll off the extremes softly: the real frame hardly goes below about 95 or above about 250.
    out = np.where(out > 232, 232 + 20 * np.tanh((out - 232) / 20), out)
    out = np.where(out < 108, 108 - 14 * np.tanh((108 - out) / 14), out)
    return np.clip(out, 0, 255)
