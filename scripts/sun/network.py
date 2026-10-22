"""Where the magnetic field gathers on the map: points along the quiet network, and curved lines.

network_points and splat make the network: flux concentrations strung along the boundaries of
supergranular cells. wander, stamp and lumps make curved paths (polarity inversion lines, filaments)
and the fields measured from them.

Points and paths are (longitude, latitude) in map units (radians, see globe.py). The map wraps in
longitude: cells straddle the seam at 180 degrees, a path may run across it, and what is drawn
wraps with it. Nothing wraps in latitude.
"""
import numpy as np

import globe


def network_points(rng, width, height, cell=0.045, fill=0.55, per_edge=4.0, spread=0.45, jitter=0.06):
    """Points (map units) and weights of network flux elements over a domain `width` wide (periodic)
    and `height` high, centered on the origin."""
    count = int(width * height / (cell * cell * 0.9))
    seeds = rng.uniform(-0.5, 0.5, size=(count, 2)) * np.array([width, height])
    # The five nearest other cell centers of each one, with distances taken the short way around.
    # A block at a time: all pairs at once would take gigabytes on the whole sphere.
    neighbors = np.empty((count, 5), dtype=int)
    for start in range(0, count, 1024):
        block = seeds[start:start + 1024]
        dx = (block[:, None, 0] - seeds[None, :, 0] + width / 2) % width - width / 2
        dy = block[:, None, 1] - seeds[None, :, 1]
        d2 = dx * dx + dy * dy
        d2[np.arange(len(block)), np.arange(start, start + len(block))] = np.inf
        neighbors[start:start + len(block)] = np.argsort(d2, axis=1)[:, :5]
    a = np.repeat(np.arange(count), 5)
    b = neighbors.ravel()
    # A link between two cell centers is taken from its lower-numbered end only, so none is counted twice.
    keep = a < b
    a, b = a[keep], b[keep]
    use = rng.random(len(a)) < fill
    a, b = a[use], b[use]
    across = seeds[b] - seeds[a]
    across[:, 0] = (across[:, 0] + width / 2) % width - width / 2
    mid = seeds[a] + across / 2
    length = np.linalg.norm(across, axis=1, keepdims=True)
    along = np.stack([-across[:, 1], across[:, 0]], axis=1) / length
    n = rng.poisson(per_edge, len(a)) + 1
    edge = np.repeat(np.arange(len(a)), n)
    s = rng.uniform(-0.5, 0.5, len(edge))[:, None] * spread * length[edge]
    points = mid[edge] + s * along[edge] + rng.normal(0, cell * jitter, size=(len(edge), 2))
    edge_weight = rng.lognormal(0, 0.5, len(a))
    weights = edge_weight[edge] * rng.lognormal(0, 0.6, len(edge))
    return points, weights


def splat(points, weights, shape, px):
    """The points drawn onto a map of `shape` (rows, cols) with pixels `px` wide, each point shared
    between the four pixels around it. Wraps in x; a point above the top row or below the bottom one
    is dropped."""
    rows, cols = shape
    x, y = globe.to_pixels(points, shape, px)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    out = np.zeros(shape)
    for dx in (0, 1):
        for dy in (0, 1):
            w = (fx if dx else 1 - fx) * (fy if dy else 1 - fy)
            yy = y0 + dy
            ok = (yy >= 0) & (yy < rows)
            np.add.at(out, (yy[ok], (x0[ok] + dx) % cols), (weights * w)[ok])
    return out


def wander(rng, start, heading, length, turn=0.25, scale=0.08, step=0.0015):
    """A path of about `length` (map units) from `start`, whose heading wanders about its initial value
    by `turn` radians (one standard deviation) over distances of about `scale`. Returns points (n, 2)."""
    count = max(2, int(length / step))
    noise = rng.normal(size=count + 400)
    kernel = np.exp(-0.5 * (np.arange(-200, 201) * step / scale) ** 2)
    smooth = np.convolve(noise, kernel / np.sqrt((kernel ** 2).sum()), mode='valid')[:count]
    angle = heading + turn * smooth
    steps = np.stack([np.cos(angle), np.sin(angle)], axis=1) * step
    return np.asarray(start)[None, :] + np.cumsum(steps, axis=0)


def stamp(points, shape, px, radius_px):
    """For every pixel within radius_px of the path: distance (px, signed: + on the left of travel),
    unit tangent, and position along the path (0..1). Pixels further away get distance = inf.
    The window around each point of the path wraps in x and is cut off at the top and bottom rows."""
    rows, cols = shape
    xy = np.stack(globe.to_pixels(points, shape, px), axis=1)
    tangent = np.gradient(xy, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True) + 1e-12
    dist = np.full(shape, np.inf)
    tx = np.zeros(shape)
    ty = np.zeros(shape)
    along = np.zeros(shape)
    r = int(np.ceil(radius_px))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    for k in range(len(xy)):
        cx, cy = xy[k]
        ix, iy = int(round(cx)), int(round(cy))
        y0, y1 = max(iy - r, 0), min(iy + r + 1, rows)
        if y0 >= y1:
            continue
        window = np.ix_(np.arange(y0, y1), np.arange(ix - r, ix + r + 1) % cols)
        sx = xx[y0 - iy + r:y1 - iy + r] + ix - cx
        sy = yy[y0 - iy + r:y1 - iy + r] + iy - cy
        d = np.hypot(sx, sy)
        view = dist[window]
        closer = d < np.abs(view)
        if not closer.any():
            continue
        side = np.sign(tangent[k, 0] * sy - tangent[k, 1] * sx)
        view[closer] = (d * np.where(side == 0, 1, side))[closer]
        dist[window] = view
        for field, value in ((tx, tangent[k, 0]), (ty, tangent[k, 1]), (along, k / (len(xy) - 1))):
            part = field[window]
            part[closer] = value
            field[window] = part
    dist[np.abs(dist) > radius_px] = np.inf
    return dist, tx, ty, along


def lumps(rng, count, scale, floor=0.0, power=1.0):
    """A 1-D profile, nowhere below zero, with lumps about `scale` samples long; mean about 1."""
    noise = rng.normal(size=count + 6 * int(scale) + 1)
    k = np.arange(-3 * int(scale), 3 * int(scale) + 1)
    kernel = np.exp(-0.5 * (k / scale) ** 2)
    smooth = np.convolve(noise, kernel / np.sqrt((kernel ** 2).sum()), mode='valid')[:count]
    out = np.clip(1 + smooth, floor, None) ** power
    return out / max(out.mean(), 1e-9)
