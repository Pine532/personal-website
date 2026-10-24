"""The limb and everything beyond it: the fringe of spicules, the glow, and a few plumes.

Work happens on a STRIP: angle around the limb (anticlockwise from the right) by height above it
(solar radii; negative heights are the last few percent of the disk). The camera's picture of the disk
is unwrapped onto the strip, the off-limb scene is added, the brightness distribution at every height
is calibrated against the real frame's (reference/limb-quantiles.npz, which reference.py makes), and
the strip is wrapped back into the picture.

The Sun turns once per loop, so what stands at the limb changes. Whatever depends on how active the limb
is (the glow's height and brightness, its lumps, the spicules' heights) is worked out again in every frame
from the rim the camera shows then, and the calibration is redone in every frame. Only the field lines'
clusters, which are traced once, stay where they were put; they are spread evenly over both sides.
The fringe and the glow also change in place. That change runs on the cycle of the surface's own change,
eight seconds, twice per turn (render.py): the `phase` given to scene and frame is the phase of that cycle.

Brightness is the "index" 0..255, which behaves like log intensity; emissions add as
index = S * log(sum(exp(index_k / S))).
"""
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
LIMB = 812 / 1024
TAU = 2 * np.pi
H0, H1 = -0.06, 0.26
S = 10.0
QUANTILES = np.array([1, 3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 93])
# The fringe's layers of spicules: (how many, mean height in solar radii, log-spread of height, least and greatest width).
SPICULES = ((3200, 0.0085, 0.35, 0.0012, 0.0030), (2600, 0.0055, 0.40, 0.0010, 0.0028))
TALLEST_SPICULE = 0.016           # solar radii: taller ones would stand out as single blades
FRINGE_BLUR = 1.4                 # strip pixels
# (cycles per cycle, strength) of the glow's changing lumps: slow, so that no patch of the glow pulses.
LUMP_HARMONICS = ((1, 0.12), (2, 0.14), (3, 0.08))
FINE_CYCLES, COARSE_CYCLES = 3, 2                              # how many times per cycle the threads' brightness travels one ripple
SMOOTH_DEGREES = 2.0              # brightness is calibrated on structure broader than this; finer structure is the model's own
EDGE_ZONE = (-0.024, -0.012)      # heights between which the camera's own fine detail gives way to the strip's (see frame)
RIM_ZONE = (-0.016, -0.006)       # heights over which the disk's brightness just inside its edge is taken
FRINGE_STEP, FRINGE_FALL = 2.0, 44.0     # a spicule starts this much dimmer than the rim under it and fades by this much to its tip (index)
FRINGE_FOOT = (-0.013, -0.008)    # heights over which the fringe comes in, inside the disk's edge
CALIBRATION_ROWS = 1.5            # the calibration's correction is smoothed over this many strip rows
# Stretches of the fringe a degree or so wide rise and sink together: (cycles per cycle) of each part, and how much
# of its height the fringe gains or loses with them (rms).
SURGE_CYCLES, SURGE = (4, 7, 11, 16), 0.5
# How much of the limb's activity comes from the frame's own rim; the rest is the same amount spread evenly over
# the low latitudes of both sides. With all of it, a side that holds an active region would take every one of
# the real frame's brightest values in the calibration and leave the opposite side dark.
OWN_SHARE = 0.4
# Stretches of the glow a little brighter or fainter than the rim under them: how much (rms share of the activity)
# and how wide (degrees). Which stretches changes over the cycle (see activity).
WANDER, WANDER_DEGREES = 0.12, 6.0
# The right and the left half of the limb are calibrated apart; their two maps blend over a band this wide (in
# the cosine of the angle, here +-15 degrees) around the poles, where the glow is faint.
HALF_BLEND = 0.26


# ------------------------------------------------------------------ small tools
def blur_rect(field, sigma_y, sigma_x):
    """Gaussian blur of a (rows, cols) field; periodic along the columns, mirrored along the rows."""
    rows = field.shape[0]
    padded = np.concatenate([field, field[::-1]], axis=0)
    fy = np.fft.fftfreq(2 * rows)[:, None]
    fx = np.fft.rfftfreq(field.shape[1])[None, :]
    gain = np.exp(-((fy * sigma_y) ** 2 + (fx * sigma_x) ** 2) * (TAU ** 2) / 2)
    return np.fft.irfft2(np.fft.rfft2(padded) * gain, s=padded.shape)[:rows].astype(np.float32)


def noise1d(n, sigma, rng):
    f = np.fft.rfftfreq(n)
    out = np.fft.irfft(np.fft.rfft(rng.normal(size=n)) * np.exp(-(f * sigma * TAU) ** 2 / 2), n)
    return (out / out.std()).astype(np.float32)


def bil_wrap(field, x, y):
    """Bilinear sample of a (rows, cols) field; periodic in x, clamped in y."""
    rows, cols = field.shape
    y = np.clip(y, 0, rows - 1.001)
    x0 = np.floor(x).astype(np.int32)
    y0 = y.astype(np.int32)
    fx = (x - x0).astype(np.float32)
    fy = (y - y0).astype(np.float32)
    x0 %= cols
    x1 = x0 + 1
    x1[x1 == cols] = 0
    return (field[y0, x0] * (1 - fx) + field[y0, x1] * fx) * (1 - fy) + (field[y0 + 1, x0] * (1 - fx) + field[y0 + 1, x1] * fx) * fy


def lerp1d(profile, position):
    """Periodic linear lookup of a 1-D profile at fractional positions."""
    n = len(profile)
    i0 = np.floor(position).astype(np.int32)
    f = (position - i0).astype(np.float32)
    i0 %= n
    i1 = i0 + 1
    i1[i1 == n] = 0
    return profile[i0] * (1 - f) + profile[i1] * f


def raster_jets(theta, width, height, n):
    """A skyline around the limb: at each of n angles, the tallest of many pointed teeth."""
    d = TAU / n
    span = int(np.ceil(width.max() / d)) + 1
    offsets = np.arange(-span, span + 1)
    center = np.floor(theta / d).astype(int)
    cell = center[:, None] + offsets[None, :]
    distance = np.abs((cell + 0.5) * d - theta[:, None])
    value = height[:, None] * np.sqrt(np.clip(1 - distance / width[:, None], 0, 1))
    profile = np.zeros(n, dtype=np.float32)
    np.maximum.at(profile, cell % n, value.astype(np.float32))
    return profile


def smooth_angle(values, degrees, d):
    """Gaussian blur of a profile around the limb (d radians per entry), `degrees` the sigma; periodic."""
    f = np.fft.rfftfreq(len(values))
    return np.fft.irfft(np.fft.rfft(values) * np.exp(-(f * (np.radians(degrees) / d) * TAU) ** 2 / 2), len(values))


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def angle_gap(theta, center):
    return (theta - center + np.pi) % TAU - np.pi


def lic_abc(noise, ux, uy, half_length, ripples=2.0):
    """Line integral convolution along (ux, uy) with a kernel that travels along the line as the loop
    phase advances: lic(phase) = A + B cos(2 pi phase) + C sin(2 pi phase). Returns (A, B, C)."""
    rows, cols = noise.shape
    count = 2 * half_length + 1
    s = np.arange(count) - half_length
    window = 0.5 * (1 + np.cos(np.pi * s / (half_length + 1)))
    wa = window / window.sum()
    wb = wa * np.cos(TAU * ripples * s / count)
    wc = wa * np.sin(TAU * ripples * s / count)
    a, b, c = noise * wa[half_length], noise * wb[half_length], noise * wc[half_length]
    gy, gx = np.mgrid[0:rows, 0:cols].astype(np.float32)
    for direction in (1, -1):
        x, y = gx.copy(), gy.copy()
        for step in range(1, half_length + 1):
            x += direction * bil_wrap(ux, x, y)
            y += direction * bil_wrap(uy, x, y)
            value = bil_wrap(noise, x, y)
            k = half_length + direction * step
            a += wa[k] * value
            b += wb[k] * value
            c += wc[k] * value
    scale = 1 / a.std()
    return (a * scale).astype(np.float32), (b * scale).astype(np.float32), (c * scale).astype(np.float32)


def strip_field(cols, rows, d, charges, uniform, soften):
    """Field in the plane of the sky above line charges (theta, h, strength), plus a uniform radial part."""
    padded = 2 * rows
    rho = np.zeros((padded, cols))
    gx = charges[:, 0] / d - 0.5
    gy = (charges[:, 1] - H0) / d - 0.5
    x0 = np.floor(gx).astype(int)
    y0 = np.floor(gy).astype(int)
    for dx in (0, 1):
        for dy in (0, 1):
            w = (gx - x0 if dx else 1 - gx + x0) * (gy - y0 if dy else 1 - gy + y0)
            np.add.at(rho, (np.clip(y0 + dy, 0, rows - 1), (x0 + dx) % cols), charges[:, 2] * w)
    x = ((np.arange(cols) - cols // 2) * d)[None, :]
    y = ((np.arange(padded) - padded // 2) * d)[:, None]
    den = x * x + y * y + soften * soften
    spectrum = np.fft.rfft2(rho)
    conv = lambda kernel: np.fft.irfft2(spectrum * np.fft.rfft2(np.fft.ifftshift(kernel)), s=rho.shape)[:rows]
    return conv(x / den).astype(np.float32), (conv(y / den) + uniform).astype(np.float32)


def real_quantiles(h):
    """The real frame's brightness quantiles at each height in h: array (len(h), len(QUANTILES))."""
    table = np.load(os.path.join(HERE, 'reference', 'limb-quantiles.npz'))
    out = np.empty((len(h), len(QUANTILES)))
    for k in range(len(QUANTILES)):
        out[:, k] = np.interp(h, table['h'], table['q'][:, k])
    return out


# ------------------------------------------------------------------ the scene
class Corona:
    def __init__(self, size, seed=11, plumes=()):
        self.size = size
        self.cols = cols = int(round(3 * size / 64)) * 64
        self.d = d = TAU / cols
        self.rows = rows = int(round((H1 - H0) / d))
        self.theta = (np.arange(cols) + 0.5) * d
        self.h = (H0 + (np.arange(rows) + 0.5) * d).astype(np.float32)
        self.seed = seed
        self.plume_spec = list(plumes)
        # Where the strip lands in the frame, and where frame pixels land on the strip.
        half = size / 2
        yy, xx = np.mgrid[0:size, 0:size]
        sx = (xx - half + 0.5) / (half * LIMB)
        sz = -(yy - half + 0.5) / (half * LIMB)
        r = np.hypot(sx, sz)
        ring = (r > 1 + H0 + 2 * d) & (r < 1 + H1 - 2 * d)
        self.ring = np.nonzero(ring.ravel())[0]
        angle = np.arctan2(sz[ring], sx[ring]) % TAU
        self.ring_x = (angle / d - 0.5).astype(np.float32)
        self.ring_y = ((r[ring] - 1 - H0) / d - 0.5).astype(np.float32)
        # How much of the camera's own fine detail a pixel keeps (see frame): all of it well inside the disk,
        # none from just inside the edge outward.
        self.ring_keeps = (1 - smoothstep((r[ring] - 1 - EDGE_ZONE[0]) / (EDGE_ZONE[1] - EDGE_ZONE[0]))).astype(np.float32)
        radius = 1 + self.h[:, None]
        self.from_x = (half - 0.5 + radius * np.cos(self.theta)[None, :] * half * LIMB).astype(np.float32)
        self.from_y = (half - 0.5 - radius * np.sin(self.theta)[None, :] * half * LIMB).astype(np.float32)
        self.outside = r >= 1 + H1 - 2 * d
        self.real = real_quantiles(self.h)
        right = np.cos(self.theta)
        self.halves = (right > 0, right <= 0)
        weight = smoothstep((right + HALF_BLEND) / (2 * HALF_BLEND)).astype(np.float32)
        self.shares = (weight, 1 - weight)      # how much of each half's map every angle takes
        self.model = None                       # set by calibrate()
        self.static = None

    def unwrap(self, image):
        size = self.size
        x = np.clip(self.from_x, 0, size - 1.001)
        y = np.clip(self.from_y, 0, size - 1.001)
        x0 = x.astype(np.int32)
        y0 = y.astype(np.int32)
        fx = x - x0
        fy = y - y0
        return (image[y0, x0] * (1 - fx) + image[y0, x0 + 1] * fx) * (1 - fy) + (image[y0 + 1, x0] * (1 - fx) + image[y0 + 1, x0 + 1] * fx) * fy

    # -------------------------------------------------------------- the limb's activity
    def local_activity(self, disk_strip):
        """How active each stretch of the limb is in one frame, 0 (quiet) and up: where the surface is bright
        just inside the limb in that frame's picture."""
        h, d = self.h, self.d
        brightness = disk_strip[(h > -0.055) & (h < -0.008)].mean(axis=0)
        local = np.clip((smooth_angle(brightness, 6.0, d) - 150) / 34, 0, 1.2)
        return 0.35 * smooth_angle(local, 6.0, d) + 1.0 * smooth_angle(local, 24.0, d)

    def activity(self, disk_strip, phase):
        """Activity around the limb at this phase, 0 .. 1.1. It follows the Sun's turn: the glow rises over an
        active region as the region comes to the limb and subsides as it leaves."""
        st = self.static
        local = OWN_SHARE * self.local_activity(disk_strip) + (1 - OWN_SHARE) * st['typical']
        # The glow swells gently and widely over active longitudes and is thin over the poles.
        low_latitude = np.cos(self.theta) ** 2
        activity = local + 0.22 * low_latitude ** 1.5 + 0.03
        # Once per cycle, so that no stretch stays brighter than the rest for long.
        first, second = st['wander']
        wander = first * np.float32(np.cos(TAU * phase)) + second * np.float32(np.sin(TAU * phase))
        return np.clip(activity * (1 + WANDER * wander), 0, 1.1).astype(np.float32)

    # -------------------------------------------------------------- static parts
    def build(self, disk_strip):
        """Everything that does not change during the loop. disk_strip: the unwrapped disk at phase 0."""
        rng = np.random.default_rng(self.seed)
        cols, rows, d, theta, h = self.cols, self.rows, self.d, self.theta, self.h
        st = {}
        self.static = st
        st['wander'] = (noise1d(cols, np.radians(WANDER_DEGREES) / d, rng),
                        noise1d(cols, np.radians(WANDER_DEGREES) / d, np.random.default_rng(self.seed + 3000)))
        # The even share of the activity: as much as the rim shows at phase 0, at low latitudes on both sides.
        even = (np.cos(theta) ** 2) ** 1.5 + 0.1
        st['typical'] = (even * self.local_activity(disk_strip).mean() / even.mean()).astype(np.float32)
        # The field lines are traced once and cannot follow the turn, so their strong clusters are put where the
        # even share is, as many as the activity at phase 0 calls for: no side keeps the loops of a region that
        # happened to stand there at phase 0.
        activity = even * np.sqrt(np.mean(self.activity(disk_strip, 0.0) ** 2) / np.mean(even ** 2))

        # Magnetic sources under the limb: network elements, and stronger clusters where the limb is active.
        count = 190
        net_theta = (np.arange(count) + rng.uniform(-0.4, 0.4, count)) * TAU / count
        sign = rng.choice([-1.0, 1.0], count)
        charges = [np.stack([net_theta, np.full(count, -0.012), sign * 0.03 * rng.lognormal(0, 0.6, count)], 1)]
        small = 900
        charges.append(np.stack([rng.uniform(0, TAU, small), rng.uniform(-0.012, -0.006, small),
                                 rng.choice([-1.0, 1.0], small) * 0.006 * rng.lognormal(0, 0.5, small)], 1))
        candidates = rng.uniform(0, TAU, 4000)
        keep = rng.random(len(candidates)) < activity[(candidates / d).astype(int) % cols] ** 2 * 0.2
        strong = candidates[keep]
        charges.append(np.stack([strong, np.full(len(strong), -0.014), rng.choice([-1.0, 1.0], len(strong)) * 0.07 * rng.lognormal(0, 0.5, len(strong))], 1))
        charges = np.concatenate(charges)
        charges[:, 0] %= TAU
        bx, by = strip_field(cols, rows, d, charges, uniform=0.5, soften=0.006)
        magnitude = np.hypot(bx, by) + 1e-9
        ux, uy = bx / magnitude, by / magnitude
        fine_noise = blur_rect(rng.normal(size=(rows, cols)), 0.8, 0.8)
        st['fine'] = lic_abc(fine_noise, ux, uy, 22)
        coarse_noise = blur_rect(rng.normal(size=(rows, cols)), 2.0, 2.0)
        st['coarse'] = lic_abc(coarse_noise, ux, uy, 40)
        lump = blur_rect(rng.normal(size=(rows, cols)), 0.03 / d, np.radians(5) / d)
        st['lump'] = lump / lump.std()
        # The same kind of lumps, but coming and going: a few harmonics of the cycle, so the loop still closes.
        drift_rng = np.random.default_rng(self.seed + 500)
        st['drift'] = []
        for cycles, strength in LUMP_HARMONICS:
            pair = [blur_rect(drift_rng.normal(size=(rows, cols)), 0.02 / d, np.radians(3) / d) for _ in range(2)]
            st['drift'].append((cycles, strength, pair[0] / pair[0].std(), pair[1] / pair[1].std()))
        blob = blur_rect(rng.normal(size=(rows, cols)), 0.006 / d, 0.006 / d)
        st['blob'] = blob / blob.std()

        # The fringe: a dense palisade of short spicules, nearly upright, clumped, taller over active stretches.
        # Each one rises and falls a whole number of times per cycle and is gone for part of each rise and fall,
        # so the fringe is renewed all the time instead of swaying.
        clump = np.exp(0.5 * noise1d(cols, 0.007 / d, rng) + 0.35 * noise1d(cols, 0.03 / d, rng))
        layers = []
        for count, mean_height, spread, w_lo, w_hi in SPICULES:
            where = rng.uniform(0, TAU, count)
            local = (where / d).astype(int) % cols
            # The height before the activity's share, which scene adds in every frame.
            layers.append(dict(theta=where, width=rng.uniform(w_lo, w_hi, count), cell=local,
                               height=(mean_height * rng.lognormal(0, spread, count) * clump[local]).astype(np.float32),
                               cycles=rng.integers(3, 13, count), start=rng.uniform(0, TAU, count), away=rng.uniform(-0.3, 0.6, count),
                               tilt=(0.22 * noise1d(cols, np.radians(6) / d, rng) + 0.12 * noise1d(cols, np.radians(1.5) / d, rng)).astype(np.float32)))
        st['spicules'] = layers
        surge_rng = np.random.default_rng(self.seed + 2000)
        st['surge'] = [(cycles, noise1d(cols, np.radians(1.2) / d, surge_rng), noise1d(cols, np.radians(1.2) / d, surge_rng)) for cycles in SURGE_CYCLES]
        st['fine_cols'] = 4 * cols

        # Plumes standing on the limb: where there may be material (envelopes); the threads come from the field lines.
        th = theta[None, :]
        hh = h[:, None]
        items = []
        prom_rng = np.random.default_rng(self.seed + 1000)
        warp = blur_rect(prom_rng.normal(size=(rows, cols)), 0.02 / d, 0.02 / d)
        warp = warp / warp.std()
        for item in self.plume_spec:
            # A curtain standing on the limb: it leans, narrows and fades toward its top, and its outline wavers with height.
            center = np.radians(item['at'])
            x = angle_gap(th, center) * (1 + np.maximum(hh, 0))
            anchor = smoothstep(hh / 0.025)
            x = x + 0.010 * warp * anchor
            lean, height, width = item.get('lean', 0.0), item['height'], item['width']
            core = np.exp(-np.abs((x - lean * hh) / (width * np.clip(1 - 0.5 * hh / height, 0.3, 1))) ** 2.0)
            mask = core * smoothstep((height - hh) / (0.5 * height)) * smoothstep((hh + 0.004) / 0.006)
            items.append(dict(mask=mask.astype(np.float32), index=float(item['index']), texture=float(item.get('texture', 6.0)),
                              threshold=float(item.get('threshold', 0.25)), sharp=float(item.get('sharp', 0.6))))
        st['items'] = items
        return st

    # -------------------------------------------------------------- per frame
    def scene(self, disk_strip, phase):
        """The strip before calibration: the disk and its fringe, plus the glow (no plumes yet)."""
        st, h = self.static, self.h
        a = self.activity(disk_strip, phase)[None, :]
        turn = lambda cycles: (np.float32(np.cos(TAU * cycles * phase)), np.float32(np.sin(TAU * cycles * phase)))
        co, si = turn(FINE_CYCLES)
        fine = st['fine'][0] + st['fine'][1] * co + st['fine'][2] * si
        co, si = turn(COARSE_CYCLES)
        coarse = st['coarse'][0] + st['coarse'][1] * co + st['coarse'][2] * si
        lump = 0.9 * st['lump']
        # The lumps that come and go are added after the calibration (see frame).
        moving = np.zeros_like(lump)
        for cycles, strength, cosine, sine in st['drift']:
            co, si = turn(cycles)
            moving += strength * (cosine * co + sine * si)
        hh = h[:, None]
        up = np.maximum(hh, 0)
        level = (82 + 80 * a) * (1 - up / (0.058 + 0.185 * a))
        ramp = np.minimum(1, up / 0.012)
        glow = level + lump * (3 + 5 * a) * ramp + (1.3 * coarse + 0.8 * fine) * np.clip(level / 80, 0, 1.3) + 2.0 * st['blob'] * (1 - ramp)
        toe = 12.0
        glow = toe * np.log1p(np.exp(np.minimum(glow / toe, 30)))
        # In front of the disk there is no separate glow: the camera's picture is the scene.
        behind = smoothstep((hh + 0.008) / 0.004)
        acc = np.exp(np.minimum(disk_strip, 255) / S) + behind * np.exp(glow / S)
        # The fringe of spicules: each layer is a ragged skyline; below it the material is bright, fading to its tip.
        low = int(np.searchsorted(h, 0.05))
        hl = hh[:low]
        position = (self.theta[None, :] / TAU) * st['fine_cols'] - 0.5
        # The fringe grows out of the disk: at its foot a spicule is about as bright as the rim it stands on.
        in_rim = (h > RIM_ZONE[0]) & (h < RIM_ZONE[1])
        f = np.fft.rfftfreq(self.cols)
        rim = np.fft.irfft(np.fft.rfft(disk_strip[in_rim].mean(axis=0)) * np.exp(-(f * (np.radians(1.0) / self.d) * TAU) ** 2 / 2), self.cols)[None, :]
        # Kept in double precision: the fringe spans ten decades, and a single-precision transform in the blur
        # below would leave ringing of thousands on the faint glow above it, where the strip holds tens.
        fringe = np.zeros((low, self.cols), dtype=np.float64)
        surge = np.zeros(self.cols, dtype=np.float32)
        for cycles, cosine, sine in st['surge']:
            co, si = turn(cycles)
            surge += cosine * co + sine * si
        surge = np.clip(1 + SURGE * surge / np.sqrt(len(st['surge'])), 0.3, 2.0)[None, :]
        for layer in st['spicules']:
            life = np.clip((np.sin(TAU * layer['cycles'] * phase + layer['start']) - layer['away']) / (1 - layer['away']), 0, 1)
            height = np.minimum(layer['height'] * (1 + 0.5 * a[0, layer['cell']]), TALLEST_SPICULE)
            skyline = raster_jets(layer['theta'], layer['width'], height * life ** 0.7, st['fine_cols'])
            top = lerp1d(skyline, position - layer['tilt'][None, :] * np.maximum(hl, 0) * (st['fine_cols'] / TAU)) * surge
            above = hl + 0.004
            inside = smoothstep((top + 0.004 - above) / (0.0015 + 0.25 * top) + 0.5) * smoothstep((hl - FRINGE_FOOT[0]) / (FRINGE_FOOT[1] - FRINGE_FOOT[0]))
            index = rim - FRINGE_STEP - FRINGE_FALL * np.clip(above / (top + 0.004), 0, 1.3)
            fringe += inside * np.exp(index / S)
        # Spicules are finer than the telescope can show: soften them by about a pixel of the picture.
        acc[:low] += blur_rect(fringe, FRINGE_BLUR, FRINGE_BLUR)
        total = S * np.log(acc)
        return total.astype(np.float32), fine, coarse, (moving * (3 + 5 * a) * ramp).astype(np.float32)

    def smooth(self, strip):
        """The strip without its fine structure around the limb (a few degrees and finer)."""
        f = np.fft.rfftfreq(self.cols)
        gain = np.exp(-(f * (np.radians(SMOOTH_DEGREES) / self.d) * TAU) ** 2 / 2)
        return np.fft.irfft(np.fft.rfft(strip, axis=1) * gain[None, :], self.cols, axis=1).astype(np.float32)

    def calibrate(self, scene_strip):
        """Remember this scene's brightness quantiles at every height, in the right and in the left half of
        the limb (done in every frame). They are taken from the smoothed strip, like the real frame's
        (reference.py). The calibration ranks brightness: taken over the whole limb, a side that holds an
        active region would take all of the real frame's brightest values. Each half gets the real frame's
        whole distribution instead, and so does the whole limb."""
        broad = self.smooth(scene_strip)
        model = np.stack([np.percentile(broad[:, half], QUANTILES, axis=1).T for half in self.halves])
        # Keep the tables strictly increasing so the maps are well defined.
        self.model = np.maximum.accumulate(model + np.arange(len(QUANTILES))[None, None, :] * 1e-3, axis=2)

    def apply_calibration(self, scene_strip):
        """Give the smoothed strip the real frame's brightness distribution at every height; the fine
        structure (spicules, threads, the disk's own texture) is carried over unchanged."""
        broad = self.smooth(scene_strip)
        out = np.zeros_like(scene_strip)
        real = self.real
        for model, share in zip(self.model, self.shares):
            for k in range(self.rows):
                have, want = model[k], real[k]
                row = broad[k]
                mapped = np.interp(row, have, want)
                hi = row > have[-1]
                if hi.any():
                    slope = np.clip((want[-1] - want[-3]) / max(have[-1] - have[-3], 1e-3), 0.3, 1.5)
                    mapped[hi] = want[-1] + (row[hi] - have[-1]) * slope
                lo = row < have[0]
                if lo.any():
                    slope = np.clip((want[2] - want[0]) / max(have[2] - have[0], 1e-3), 0.3, 1.5)
                    mapped[lo] = want[0] + (row[lo] - have[0]) * slope
                out[k] += share * mapped
        # Inside the disk the calibration fades in over the last few percent of the radius.
        weight = smoothstep((self.h[:, None] + 0.055) / 0.03)
        # The correction is smoothed across heights too, so one row's accidents do not show as rings.
        correction = out - broad
        kernel = np.exp(-0.5 * (np.arange(-8, 9) / CALIBRATION_ROWS) ** 2).astype(np.float32)
        kernel /= kernel.sum()
        padded = np.pad(correction, ((8, 8), (0, 0)), mode='edge')
        correction = sum(kernel[k] * padded[k:k + self.rows] for k in range(17))
        return np.clip(scene_strip + weight * correction, 0, 255)

    def frame(self, disk_image, phase):
        """The finished picture (index) from the camera's picture of the disk. The first frame it is
        given sets up the static parts, so that must be the frame of phase 0."""
        disk_strip = self.unwrap(disk_image)
        if self.static is None:
            self.build(disk_strip)
        scene, fine, coarse, lumps = self.scene(disk_strip, phase)
        # Calibrated in every frame: the limb's activity, and with it the scene, changes as the Sun turns.
        self.calibrate(scene)
        strip = self.apply_calibration(scene)
        # The glow's changing lumps go in after the calibration, which would stretch them severalfold over the
        # active limb and make whole patches of the glow pulse.
        strip = strip + lumps * np.clip(strip / 60, 0, 1)
        acc = np.exp(strip / S)
        for item in self.static['items']:
            # Half of a plume is haze, half threads of material along the field lines, where the traced noise is high.
            threads = smoothstep((0.8 * fine + 0.35 * coarse - item['threshold']) / item['sharp'] + 0.5)
            acc += item['mask'] * (0.5 + 0.5 * threads) * np.exp((item['index'] + item['texture'] * 0.5 * coarse) / S)
        strip = S * np.log(acc)
        strip *= np.clip((H1 - 0.03 - self.h[:, None]) / 0.04, 0, 1)
        # Wrapped back, the strip has been resampled twice and is a little soft. Inside the disk, where it
        # changed nothing but the broad brightness, the fine detail that this cost is put back from the
        # camera's picture. At the edge it is not: the camera's edge is hard and jagged, the fringe and the
        # glow are laid over it, and the difference between the two would show as beads along the limb.
        out = disk_image.astype(np.float32).ravel().copy()
        lost = out[self.ring] - bil_wrap(disk_strip, self.ring_x, self.ring_y)
        out[self.ring] = bil_wrap(strip, self.ring_x, self.ring_y) + self.ring_keeps * lost
        out = out.reshape(self.size, self.size)
        out[self.outside] = 0
        return np.clip(out, 0, 255)
