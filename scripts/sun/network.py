"""Where the magnetic field gathers on the map: points along the quiet network, and curved lines.

network_points and splat make the network: flux concentrations strung along the boundaries of
supergranular cells. wander, stamp and lumps make curved paths (polarity inversion lines, filaments)
and the fields measured from them.
"""
import numpy as np


def network_points(rng, half_width, cell=0.045, fill=0.55, per_edge=4.0, spread=0.45, jitter=0.06):
    """Points (map units) and weights of network flux elements in [-half_width, half_width]^2."""
    count = int(4 * half_width * half_width / (cell * cell * 0.9))
    seeds = rng.uniform(-half_width, half_width, size=(count, 2))
    d2 = ((seeds[:, None, :] - seeds[None, :, :]) ** 2).sum(-1)
    np.fill_diagonal(d2, np.inf)
    neighbors = np.argsort(d2, axis=1)[:, :5]
    a = np.repeat(np.arange(count), 5)
    b = neighbors.ravel()
    # A link between two cell centers is taken from its lower-numbered end only, so none is counted twice.
    keep = a < b
    a, b = a[keep], b[keep]
    use = rng.random(len(a)) < fill
    a, b = a[use], b[use]
    mid = (seeds[a] + seeds[b]) / 2
    across = seeds[b] - seeds[a]
    length = np.linalg.norm(across, axis=1, keepdims=True)
    along = np.stack([-across[:, 1], across[:, 0]], axis=1) / length
    n = rng.poisson(per_edge, len(a)) + 1
    edge = np.repeat(np.arange(len(a)), n)
    s = rng.uniform(-0.5, 0.5, len(edge))[:, None] * spread * length[edge]
    points = mid[edge] + s * along[edge] + rng.normal(0, cell * jitter, size=(len(edge), 2))
    edge_weight = rng.lognormal(0, 0.5, len(a))
    weights = edge_weight[edge] * rng.lognormal(0, 0.6, len(edge))
    return points, weights


def splat(points, weights, size, half_width):
    """The points drawn onto the map, each shared between the four pixels around it."""
    px = 2 * half_width / size
    grid = (points + half_width) / px - 0.5
    base = np.floor(grid).astype(int)
    frac = grid - base
    out = np.zeros((size, size))
    for dx in (0, 1):
        for dy in (0, 1):
            w = (frac[:, 0] if dx else 1 - frac[:, 0]) * (frac[:, 1] if dy else 1 - frac[:, 1])
            ok = (base[:, 0] + dx >= 0) & (base[:, 0] + dx < size) & (base[:, 1] + dy >= 0) & (base[:, 1] + dy < size)
            np.add.at(out, (base[ok, 1] + dy, base[ok, 0] + dx), (weights * w)[ok])
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


def stamp(points, size, half_width, radius_px):
    """For every pixel within radius_px of the path: distance (px, signed: + on the left of travel),
    unit tangent, and position along the path (0..1). Pixels further away get distance = inf."""
    px = 2 * half_width / size
    xy = (points + half_width) / px - 0.5
    tangent = np.gradient(xy, axis=0)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True) + 1e-12
    dist = np.full((size, size), np.inf)
    tx = np.zeros((size, size))
    ty = np.zeros((size, size))
    along = np.zeros((size, size))
    r = int(np.ceil(radius_px))
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    for k in range(len(xy)):
        cx, cy = xy[k]
        ix, iy = int(round(cx)), int(round(cy))
        x0, x1 = max(ix - r, 0), min(ix + r + 1, size)
        y0, y1 = max(iy - r, 0), min(iy + r + 1, size)
        if x0 >= x1 or y0 >= y1:
            continue
        sx = xx[y0 - iy + r:y1 - iy + r, x0 - ix + r:x1 - ix + r] + ix - cx
        sy = yy[y0 - iy + r:y1 - iy + r, x0 - ix + r:x1 - ix + r] + iy - cy
        d = np.hypot(sx, sy)
        view = dist[y0:y1, x0:x1]
        closer = d < np.abs(view)
        side = np.sign(tangent[k, 0] * sy - tangent[k, 1] * sx)
        view[closer] = (d * np.where(side == 0, 1, side))[closer]
        tx[y0:y1, x0:x1][closer] = tangent[k, 0]
        ty[y0:y1, x0:x1][closer] = tangent[k, 1]
        along[y0:y1, x0:x1][closer] = k / (len(xy) - 1)
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
