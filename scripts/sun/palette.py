"""The color table of the Sun's pictures, and its inverse.

NASA's SDO shows its AIA 304 images in one fixed color table, so every color stands for a scalar
intensity: the "index", 0..255. The simulation works in that index throughout. render.py turns it
into color with to_rgb; reference.py reads the real frame back into it with to_index.
"""
import numpy as np

INDEX = np.arange(256, dtype=np.float64)
# IDL "Red Temperature", the table SDO uses for AIA 304: red ramps first, then green, then blue.
TABLE = np.stack([np.clip(INDEX * 255 / 176, 0, 255), np.clip((INDEX - 120) * 255 / 135, 0, 255),
                  np.clip((INDEX - 190) * 255 / 65, 0, 255)], -1)


def to_index(rgb):
    """Nearest point on the color table for every pixel: the scalar intensity the image encodes.
    to_rgb rounds the ideal table to whole levels, and every level reads back exactly."""
    rgb = np.asarray(rgb, dtype=np.uint8)
    # A picture holds far fewer colors than pixels: each color is looked up once.
    packed = (rgb[..., 0].astype(np.uint32) << 16) | (rgb[..., 1].astype(np.uint32) << 8) | rgb[..., 2]
    colors, where = np.unique(packed, return_inverse=True)
    channels = np.stack([colors >> 16, (colors >> 8) & 255, colors & 255], -1).astype(np.float64)
    nearest = np.empty(len(colors), dtype=np.float32)
    for start in range(0, len(colors), 1 << 18):
        distance = ((channels[start:start + (1 << 18), None, :] - TABLE[None, :, :]) ** 2).sum(-1)
        nearest[start:start + (1 << 18)] = distance.argmin(1)
    return nearest[where.reshape(-1)].reshape(rgb.shape[:2])


def to_rgb(index):
    i = np.clip(index, 0, 255)
    return np.rint(np.stack([np.clip(i * 255 / 176, 0, 255), np.clip((i - 120) * 255 / 135, 0, 255),
                             np.clip((i - 190) * 255 / 65, 0, 255)], -1)).astype(np.uint8)
