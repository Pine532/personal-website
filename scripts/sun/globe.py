"""The map of the whole Sun, and the geometry the other scripts share.

The surface is an equirectangular picture of the sphere: columns are longitude and rows are
latitude. Column 0 is longitude -180 degrees and the column after the last is column 0 again, so
the map wraps around in x; rows run from +90 degrees at the top to -90 at the bottom and nothing
wraps in y, because the poles are points. The map is W x H pixels with W = 2 H, so one pixel spans
the same angle both ways, 2 pi / W radians. Map units are radians of arc, which at the equator are
solar radii of arc. Longitude 0 is the middle of the map: the point that faces the camera at loop
phase 0 (camera.py turns the map by 360 degrees over one loop, so features cross the disk from
left to right).

A square patch at the same pixel size, centered on longitude 0 and latitude 0, is the bench
(surface.py --bench): the same functions describe it when given its pixel size.
"""
import numpy as np

TAU = 2 * np.pi


def pixel(width):
    """The angle one pixel spans (radians) on a map `width` columns wide: the columns cover 360 degrees."""
    return TAU / width


def grid(shape, px=None):
    """Longitude and latitude (radians) at the center of every pixel of a map of `shape` (rows, cols):
    two arrays. Without `px` the map is the whole sphere; with it, a patch of that pixel size centered
    on longitude 0, latitude 0."""
    rows, cols = shape
    px = px or pixel(cols)
    lon = (np.arange(cols) + 0.5 - cols / 2) * px
    lat = (rows / 2 - 0.5 - np.arange(rows)) * px
    return np.meshgrid(lon, lat)


def weights(shape, px=None):
    """How much of the sphere each pixel of the map stands for, relative to a pixel at the equator:
    cos(latitude). Statistics of the map are weighted by this, so that every point of the sphere
    counts the same; an unweighted map would count the poles far too often."""
    return np.cos(grid(shape, px)[1])


def to_pixels(points, shape, px=None):
    """Pixel coordinates (x, y) of points (n, 2) given as (longitude, latitude) in radians. x grows
    with longitude and may run past the edges (the callers wrap it); y grows southward."""
    rows, cols = shape
    px = px or pixel(cols)
    points = np.asarray(points)
    return points[..., 0] / px + cols / 2 - 0.5, rows / 2 - 0.5 - points[..., 1] / px



# The polar caps (see even_caps): above CAP_FROM degrees of latitude the map's texture is replaced, fully
# from CAP_FULL degrees up; CAP_TONE (pixels) is the scale above which the cap keeps its own brightness.
CAP_FROM, CAP_FULL, CAP_TONE = 38.0, 52.0, 30.0


def _cubic(field, x, y):
    """Bicubic samples (Keys, a = -0.5) of a 2-D field at (x, y), clamped at the edges. Finer than
    bilinear sampling, which would soften the texture it carries."""
    rows, cols = field.shape
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx, fy = x - x0, y - y0

    def kernel(t):
        t = np.abs(t)
        return np.where(t <= 1, 1.5 * t ** 3 - 2.5 * t ** 2 + 1, np.where(t < 2, -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2, 0.0))

    out = np.zeros(x.shape, dtype=np.float64)
    for j in range(-1, 3):
        wy = kernel(fy - j)
        yy = np.clip(y0 + j, 0, rows - 1)
        for i in range(-1, 3):
            out += wy * kernel(fx - i) * field[yy, np.clip(x0 + i, 0, cols - 1)]
    return out


def even_caps(surface, heights, blur):
    """Give the polar caps texture that is even on the sphere. The map's texture is the same in every
    direction in its own pixels, and toward the poles those pixels narrow east-west, so on the sphere the
    texture there is squeezed into streaks that fan into each pole: a crown at the top and bottom of the
    disk. Above CAP_FROM degrees this rewrites the cap from a patch of the map near the equator (where a
    pixel is square on the sphere), laid around the pole by the azimuthal equal-area projection: every
    point of the cap reads the patch at its own distance and bearing from the pole, in map pixels, so
    the texture there has the shape and the statistics it has everywhere else. The cap keeps its own
    brightness above CAP_TONE pixels and takes only the finer structure from the patch; the heights of
    the columns (camera.column_heights) come from the same patch, so the tall columns stand over the
    bright network there as elsewhere. Between CAP_FROM and CAP_FULL degrees old and new are blended,
    with the fine structure's contrast kept. The quietest patches are used, a different one for each pole.
    `blur` is turbulence.blur. Returns new surface and heights maps; the inputs are left as they are."""
    rows, cols = surface.shape
    px = pixel(cols)
    lat = (rows / 2 - 0.5 - np.arange(rows)) * px
    lon = (np.arange(cols) + 0.5 - cols / 2) * px
    cap = int(np.ceil(rows / 2 - 0.5 - np.radians(CAP_FROM) / px)) + 1          # rows from each pole
    reach = 2 * np.sin((np.pi / 2 - (rows / 2 - 0.5 - (cap - 1)) * px) / 2) / px  # the cap's radius, pixels
    half = int(np.ceil(reach + 4 * CAP_TONE))
    # The quietest patches: least spread of brightness above the tone's scale, centered on the equator.
    tone = blur(surface, CAP_TONE)
    middle = slice(rows // 2 - half, rows // 2 + half)
    starts = np.arange(0, cols, 32)
    spread = [np.take(tone[middle], np.arange(c - half, c + half) % cols, axis=1).std() for c in starts]
    order = np.argsort(spread)
    first = starts[order[0]]
    second = next(c for c in starts[order] if min(abs(c - first), cols - abs(c - first)) > 2 * half)
    surface, heights = surface.astype(np.float64), heights.astype(np.float64)
    new_surface, new_heights = surface.copy(), heights.copy()
    offsets = np.arange(-half, half, dtype=np.float64)
    for north, centre in ((True, first), (False, second)):
        take = np.arange(centre - half, centre + half) % cols
        patch = surface[middle][:, take]
        patch_heights = heights[middle][:, take]
        fine = patch - blur(patch, CAP_TONE)
        # The cap's own brightness, laid out the same way around the pole (bilinear is enough for the tone).
        dy, dx = np.meshgrid(offsets, offsets, indexing='ij')
        rho = np.hypot(dx, dy) * px
        colat = 2 * np.arcsin(np.clip(rho / 2, 0, 1))
        at_lat = (np.pi / 2 - colat) * (1 if north else -1)
        at_lon = np.arctan2(dx, dy)
        mx = np.mod(at_lon + np.pi, TAU) / px - 0.5
        my = np.clip(rows / 2 - 0.5 - at_lat / px, 0, rows - 1.001)
        x0, y0 = np.floor(mx).astype(np.int64), np.floor(my).astype(np.int64)
        fx, fy = mx - x0, my - y0
        x1 = (x0 + 1) % cols
        x0 %= cols
        laid = (surface[y0, x0] * (1 - fx) + surface[y0, x1] * fx) * (1 - fy) + (surface[y0 + 1, x0] * (1 - fx) + surface[y0 + 1, x1] * fx) * fy
        own_tone = blur(laid, CAP_TONE)
        # Every point of the cap: where it falls on the patch.
        band = slice(0, cap) if north else slice(rows - cap, rows)
        cap_lat = np.abs(lat[band])[:, None] * np.ones((1, cols))
        cap_lon = np.ones((cap, 1)) * lon[None, :]
        rho = 2 * np.sin((np.pi / 2 - cap_lat) / 2) / px
        x = rho * np.sin(cap_lon) + half
        y = rho * np.cos(cap_lon) + half
        weight = np.clip((np.degrees(cap_lat) - CAP_FROM) / (CAP_FULL - CAP_FROM), 0, 1)
        weight = weight * weight * (3 - 2 * weight)
        old = surface[band]
        base = _cubic(own_tone, x, y)
        mixed = (weight * _cubic(fine, x, y) + (1 - weight) * (old - base)) / np.sqrt(weight ** 2 + (1 - weight) ** 2)
        new_surface[band] = np.where(weight > 0, base + mixed, old)
        new_heights[band] = np.where(weight > 0, weight * np.maximum(_cubic(patch_heights, x, y), 0) + (1 - weight) * heights[band], heights[band])
    return new_surface.astype(np.float32), new_heights.astype(np.float32)
