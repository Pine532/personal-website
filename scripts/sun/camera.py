"""From the surface map to the disk as a camera sees it: a sphere carrying a forest of upright
columns (spicules and fibril bushes), so the texture leans outwards, thickens, and softens toward the
limb, its dark lanes partly fill with the forest's glow there, and it continues past the limb as a
ragged fringe.

The map is the whole sphere (globe.py) and the sphere turns about the vertical axis through its
middle, north up, once per loop: the point of the sphere under each pixel of the picture is found as
longitude and latitude, and the map is read at that longitude less the turn so far. Longitude grows
to the right, so the surface crosses the disk from left to right, as SDO shows the Sun.

The map's pixels narrow east-west toward the poles (by the cosine of the latitude), so the texture
there would be seen squeezed that way, into streaks that fan into each pole on the top and bottom limb.
Above 38 degrees of latitude render.py rewrites the map so that its texture is even on the sphere
(globe.even_caps); below that the squeeze is at most the cosine of 38 degrees, 0.79. Toward the limb
the texture is drawn out along the radius and sharpened across it (Camera.reshape), as the real
frame's is. At the disk center the picture reproduces the map's texture statistics exactly."""
import numpy as np

import globe
from turbulence import blur

TAU = 2 * np.pi
# The edge of the sphere in the picture, as a fraction of the half-width. The columns standing on it
# bring the visible edge of the disk to where it is in the real frame (812 of 1024 px).
LIMB = 0.996 * 812 / 1024
# Toward the limb one output pixel covers more and more of the map along the radius: sample it more often.
ZONES = ((0.70, 1), (0.45, 2), (0.25, 4), (-1.0, 8))            # (mu above which this zone starts, samples)
SOFT = 10.0                       # index units per e-fold when two emissions are added (as in corona.py)
# Toward the limb the picture loses fine detail (see Camera.render): a Gaussian of this many pixels (at 2048)
# is blended in with a weight that grows from nothing at SOFTEN_FROM of the radius by SOFTEN_RATE per unit of
# radius, up to SOFTEN_MOST.
SOFTEN_SIGMA, SOFTEN_FROM, SOFTEN_RATE, SOFTEN_MOST = 0.7, 0.55, 1.6, 0.7
# Toward the limb the texture is reshaped (see Camera.reshape): drawn out along the radius by a Gaussian of up to
# DRAW_OUT pixels (at 2048), and sharpened across it by SHARPEN times its difference from a Gaussian of
# SHARPEN_SIGMA pixels along the limb. Both grow from nothing at RESHAPE_FROM of the radius with the power
# RESHAPE_POWER, to their full strength at the limb.
DRAW_OUT, SHARPEN, SHARPEN_SIGMA = 1.2, 2.0, 1.0
RESHAPE_FROM, RESHAPE_POWER = 0.55, 1.5
# The forest's own glow near the limb: it starts where mu falls below HAZE_FROM, grows over HAZE_SPAN of mu
# from the first to the second of HAZE_LEVELS (index), and is laid in at HAZE_WEIGHT of its full effect.
HAZE_FROM, HAZE_SPAN, HAZE_LEVELS, HAZE_WEIGHT = 0.30, 0.22, (104.0, 140.0), 0.7


def _lookup2(a, b, x, y):
    """Bilinear samples of two maps at the same places: periodic in x (longitude), clamped in y."""
    rows, cols = a.shape
    y = np.clip(y, 0, rows - 1.001)
    x0 = np.floor(x).astype(np.int32)
    y0 = y.astype(np.int32)
    fx = (x - x0).astype(np.float32)
    fy = (y - y0).astype(np.float32)
    x0 %= cols
    x1 = x0 + 1
    x1[x1 == cols] = 0
    y1 = y0 + 1
    w00, w01, w10, w11 = (1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy
    first = a[y0, x0] * w00 + a[y0, x1] * w01 + a[y1, x0] * w10 + a[y1, x1] * w11
    if b is None:
        return first, None
    return first, b[y0, x0] * w00 + b[y0, x1] * w01 + b[y1, x0] * w10 + b[y1, x1] * w11


class Camera:
    """Geometry that does not change from frame to frame."""

    def __init__(self, size, map_shape, layers=7, tallest=0.016):
        self.size = size
        self.map_shape = tuple(map_shape)
        self.map_px = globe.pixel(self.map_shape[1])
        half = size / 2
        self.pixel = 1 / (half * LIMB)                                # one output pixel, in solar radii
        yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
        sx = (xx - half + 0.5) * self.pixel
        sz = -(yy - half + 0.5) * self.pixel
        r = np.hypot(sx, sz)
        self.mu = np.sqrt(np.clip(1 - r * r, 0, 1))
        self.soften = np.clip(SOFTEN_RATE * (r - SOFTEN_FROM), 0, SOFTEN_MOST).astype(np.float32)
        self.radius = r
        self.heights = tallest * (np.arange(layers) / (layers - 1)) ** 1.6
        seen = r < 1 + tallest + self.pixel
        self.zones = []
        upper = 2.0
        for lower, samples in ZONES:
            pick = seen & (self.mu <= upper) & (self.mu > lower) if lower > -1 else seen & (self.mu <= upper)
            flat = np.nonzero(pick.ravel())[0]
            rr = r.ravel()[flat]
            safe = np.maximum(rr, 1e-6)
            self.zones.append((flat, (sx.ravel()[flat] / safe).astype(np.float32), (sz.ravel()[flat] / safe).astype(np.float32),
                               rr.astype(np.float32), samples))
            upper = lower

    def render(self, broad, detail, column_height, displacement, detail_displacement, gain, swell, flash, phase, dim=26.0, fine=1):
        """broad + detail: the index map, split into its broad structure and its fine detail;
        column_height: how tall the forest stands at each point (solar radii).
        displacement, detail_displacement: (ux, uy) in map pixels, by which every point of the broad
        structure, and of the fine detail, has moved.
        gain, swell: how strong the bright fine detail is at each point just now, and what is added to
        the broad structure (motion.py); both on the nominal map.
        flash: two rows, the brightness of bright detail times its gain, and what that is shown as
        (render.flash_curve).
        phase: how far the sphere has turned, 0..1 of a turn (one loop); it has turned by 360 degrees times this.
        fine: how many times finer than the nominal map the maps are sampled (see motion.oversample).
        Returns the index image of the disk and its fringe; 0 where nothing is seen."""
        rows, cols = self.map_shape
        turn = TAU * phase
        out = np.zeros(self.size * self.size, dtype=np.float32)
        tallest = self.heights[-1]
        for flat, ux, uz, r, samples in self.zones:
            best = np.zeros(len(flat), dtype=np.float32)
            for z in self.heights:
                total = np.zeros(len(flat), dtype=np.float32)
                for sub in range(samples):
                    r0 = (r + ((sub + 0.5) / samples - 0.5) * self.pixel) / (1 + z)
                    inside = r0 < 1
                    mu0 = np.sqrt(np.clip(1 - r0 * r0, 0, 1))
                    # The point of the sphere under this sample: longitude (0 at the disk center, growing to the
                    # right) and latitude. What is seen there now lay `turn` further west on the map at phase 0.
                    lon = np.arctan2(ux * r0, mu0)
                    lat = np.arcsin(np.clip(uz * r0, -1, 1))
                    mx = np.mod(lon - turn + np.pi, TAU) / self.map_px - 0.5
                    my = (np.pi / 2 - lat) / self.map_px - 0.5
                    # The material now at this point came from a little way off.
                    ix = np.rint(mx).astype(np.int32) % cols
                    iy = np.clip(np.rint(my), 0, rows - 1).astype(np.int32)
                    at = lambda moved: ((mx - moved[0][iy, ix]) * fine, (my - moved[1][iy, ix]) * fine)
                    value, tall = _lookup2(broad, column_height if z > 0 else None, *at(displacement))
                    fine_part = _lookup2(detail, None, *at(detail_displacement))[0]
                    # Only what is brighter than its surroundings flickers: small features flash, they do not blink dark.
                    lit = np.interp(gain[iy, ix] * fine_part, flash[0], flash[1]).astype(np.float32)
                    value = value + swell[iy, ix] + np.where(fine_part > 0, lit, fine_part)
                    if z > 0:
                        # Parts of columns that reach this height are seen, dimmer the higher.
                        value = (value - dim * z / tallest) * np.clip((tall - z) / (0.6 * tall + 1e-6), 0, 1)
                    total += np.where(inside, value, 0)
                np.maximum(best, total / samples, out=best)
            out[flat] = best
        return self.finish(out.reshape(self.size, self.size))

    def finish(self, picture):
        """What becomes of the picture of the surface toward the limb: softened, reshaped, and hazed."""
        # Toward the limb foreshortening squeezes the surface's detail together, and the forest, seen more and
        # more from the side, smears it: the real frame's finest detail weakens there. The picture is softened
        # by a growing amount (only among the pixels that show the Sun, so its edge is not darkened).
        seen = (picture > 0).astype(np.float32)
        sigma = SOFTEN_SIGMA * self.size / 2048
        smooth = blur(picture, sigma) / np.maximum(blur(seen, sigma), 1e-3)
        picture = np.where(seen > 0, picture + self.soften * (smooth - picture), 0)
        out = self.reshape(picture, seen).ravel()
        # Near the limb the forest also fills the dark lanes with its own glow: the darks lift, the brights stay.
        mu = self.mu.ravel()
        toward_limb = np.clip((HAZE_FROM - mu) / HAZE_SPAN, 0, 1)
        haze = HAZE_LEVELS[0] + (HAZE_LEVELS[1] - HAZE_LEVELS[0]) * toward_limb
        lifted = SOFT * np.log(np.exp(out / SOFT) + np.exp(haze / SOFT))
        # It fades in over the first part of the way, so that no ring shows where it starts.
        weight = HAZE_WEIGHT * np.clip(toward_limb / 0.15, 0, 1)
        out = np.where((out > 0) & (mu > 0), out + weight * (lifted - out), out)
        return out.reshape(self.size, self.size).astype(np.float32)


    def reshape(self, picture, seen):
        """Gives the texture near the limb the shape the real frame's has there. Foreshortening alone squeezes
        it along the radius by 1/mu, far more than the real frame shows (about half as much again at 0.9 of
        the radius, measured as gradient energy along the radius against along the limb): the emitting
        layer is not a thin skin. Seen at a slant it is looked through along the radius, which draws each
        feature out that way, and its columns stand there as threads along the radius, sharp across.
        Like the softening, it averages only pixels that show the Sun, so the edge is not darkened."""
        strength = np.clip((self.radius - RESHAPE_FROM) / (1 - RESHAPE_FROM), 0, 1) ** RESHAPE_POWER
        flat = np.nonzero((strength.ravel() > 0.01) & (seen.ravel() > 0))[0]
        if not len(flat):
            return picture
        size = self.size
        scale = size / 2048
        rows, cols = np.divmod(flat, size)
        dx = (cols - size / 2 + 0.5).astype(np.float32)
        dy = (rows - size / 2 + 0.5).astype(np.float32)
        length = np.maximum(np.hypot(dx, dy), 1e-3)
        ux, uy = dx / length, dy / length
        share = strength.ravel()[flat].astype(np.float32)

        def along(image, vx, vy, sigma):
            """Gaussian average of `image` along (vx, vy) at every chosen pixel, over the pixels that show the Sun."""
            both = np.stack([image * seen, seen]).astype(np.float32)
            total = np.zeros((2, len(flat)), dtype=np.float32)
            reach = int(np.ceil(2.5 * sigma.max()))
            for t in range(-reach, reach + 1):
                weight = np.exp(-0.5 * (t / sigma) ** 2)
                x = np.clip(cols + t * vx, 0, size - 1.001)
                y = np.clip(rows + t * vy, 0, size - 1.001)
                x0, y0 = x.astype(np.int32), y.astype(np.int32)
                fx, fy = x - x0, y - y0
                total += weight * ((both[:, y0, x0] * (1 - fx) + both[:, y0, x0 + 1] * fx) * (1 - fy)
                                   + (both[:, y0 + 1, x0] * (1 - fx) + both[:, y0 + 1, x0 + 1] * fx) * fy)
            return total[0] / np.maximum(total[1], 1e-6)

        out = picture.copy().ravel()
        out[flat] = along(picture, ux, uy, np.maximum(DRAW_OUT * scale * share, 0.05))
        drawn = out.reshape(size, size)
        across = along(drawn, -uy, ux, np.full(len(flat), SHARPEN_SIGMA * scale, dtype=np.float32))
        out[flat] = out[flat] + SHARPEN * share * (out[flat] - across)
        return out.reshape(size, size)


def column_heights(surface, rng, typical=0.0045, spread=0.5, grain=2.2, clump=7.0, clump_spread=0.55):
    """How tall the forest stands: taller over bright network and plage, with a random lognormal spread
    from column to column and from clump to clump (the clumps make the edge of the disk ragged)."""
    noise = blur(rng.normal(size=surface.shape), grain)
    noise /= noise.std()
    clumps = blur(rng.normal(size=surface.shape), clump)
    clumps /= clumps.std()
    bright = np.clip((blur(surface, 2.0) - 120) / 60, 0.15, 1.6)
    return (typical * bright * np.exp(spread * noise + clump_spread * clumps)).astype(np.float32)


def undo_sampling_blur(surface, limit=2.5):
    """Give the map back the fine detail that sampling takes away. The real frame was measured on the map
    by bilinear interpolation, and the camera reads the map (at twice its resolution) the same way; each
    step dims detail of wavelength L pixels by a known amount, on average over where the samples fall:
    by 1 - (1 - cos(2 pi / L)) / 3 in power, per axis. This multiplies that back in, so that a rendered
    frame holds as much fine detail as the frame the map was matched to."""
    rows, cols = surface.shape
    axis = lambda n: ((1 - (1 - np.cos(2 * np.pi * np.fft.fftfreq(n))) / 3) * (1 - (1 - np.cos(np.pi * np.fft.fftfreq(n))) / 3)) ** -0.5
    gain = np.minimum(axis(rows)[:, None] * axis(cols)[None, :], limit)
    return np.fft.ifft2(np.fft.fft2(surface) * gain).real.astype(np.float32)
