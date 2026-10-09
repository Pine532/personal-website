"""Texture building blocks: a Gaussian blur, noise at one scale, and noise stretched along a direction field."""
import numpy as np


def blur(field, sigma):
    """Gaussian blur of the last two axes, wrapping around; sigma in pixels."""
    f = np.fft.rfftfreq(field.shape[-1])
    g = np.fft.fftfreq(field.shape[-2])
    k2 = g[:, None] ** 2 + f[None, :] ** 2
    return np.fft.irfft2(np.fft.rfft2(field) * np.exp(-k2 * (2 * np.pi * sigma) ** 2 / 2), s=field.shape[-2:])


def band_noise(rng, size, sigma, count=1):
    """White noise limited to the octave around `sigma` (difference of Gaussians), unit variance."""
    white = rng.normal(size=(count, size, size))
    out = blur(white, sigma * 0.7) - blur(white, sigma * 1.4)
    return (out / out.std(axis=(1, 2), keepdims=True)).astype(np.float32)


def _gather(fields, x, y):
    """Bilinear samples of every field in a stack (n, size, size) at (x, y), wrapping around."""
    size = fields.shape[-1]
    x0 = np.floor(x).astype(np.int32)
    y0 = np.floor(y).astype(np.int32)
    fx = (x - x0).astype(np.float32)
    fy = (y - y0).astype(np.float32)
    x0 %= size
    y0 %= size
    x1 = (x0 + 1) % size
    y1 = (y0 + 1) % size
    return (fields[:, y0, x0] * (1 - fx) + fields[:, y0, x1] * fx) * (1 - fy) + (fields[:, y1, x0] * (1 - fx) + fields[:, y1, x1] * fx) * fy


def stretch(fields, dir_x, dir_y, half_length, step=1.0):
    """Line integral convolution of a stack of fields (n, size, size) along the direction field:
    every pixel becomes a raised-cosine average of the samples met on the line through it,
    `half_length` steps each way.

    The direction field is followed as arrows. Where it stores one line with two opposite arrows on either
    side (surface.py keeps dx positive, so this happens where fibrils run vertically), a path stalls
    instead of crossing. Over the whole map that leaves 0.4 to 4% of pixels combed less than they should
    be, more for longer paths; where fibrils run within about 17 degrees of vertical, 8 to 19%.
    """
    count = 2 * half_length + 1
    s = np.arange(count) - half_length
    weights = 0.5 * (1 + np.cos(np.pi * s / (half_length + 1)))
    weights = (weights / weights.sum()).astype(np.float32)
    size = fields.shape[-1]
    direction = np.stack([dir_x, dir_y]).astype(np.float32)
    gx, gy = np.meshgrid(np.arange(size, dtype=np.float32), np.arange(size, dtype=np.float32))
    out = weights[half_length] * fields
    for sign in (+1, -1):
        x, y = gx.copy(), gy.copy()
        for k in range(1, half_length + 1):
            # Midpoint step, so curved lines are followed faithfully.
            d = _gather(direction, x, y)
            mid = _gather(direction, x + 0.5 * sign * step * d[0], y + 0.5 * sign * step * d[1])
            x += sign * step * mid[0]
            y += sign * step * mid[1]
            out += weights[half_length + sign * k] * _gather(fields, x, y)
    return out
