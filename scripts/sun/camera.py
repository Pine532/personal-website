"""From the surface map to the disk as a camera sees it: a sphere carrying a forest of upright
columns (spicules and fibril bushes), so the texture leans outwards, thickens, and softens toward the
limb, its dark lanes partly fill with the forest's glow there, and it continues past the limb as a
ragged fringe."""
import numpy as np

from turbulence import blur

HALF = 1.46                        # the map covers [-HALF, HALF]^2, as in surface.py
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
# The forest's own glow near the limb: it starts where mu falls below HAZE_FROM, grows over HAZE_SPAN of mu
# from the first to the second of HAZE_LEVELS (index), and is laid in at HAZE_WEIGHT of its full effect.
HAZE_FROM, HAZE_SPAN, HAZE_LEVELS, HAZE_WEIGHT = 0.30, 0.22, (104.0, 140.0), 0.7


def _lookup2(a, b, x, y):
    """Bilinear samples of two maps at the same places."""
    limit = a.shape[0] - 1.001
    x = np.clip(x, 0, limit)
    y = np.clip(y, 0, limit)
    x0 = x.astype(np.int32)
    y0 = y.astype(np.int32)
    fx = (x - x0).astype(np.float32)
    fy = (y - y0).astype(np.float32)
    w00, w01, w10, w11 = (1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy
    first = a[y0, x0] * w00 + a[y0, x0 + 1] * w01 + a[y0 + 1, x0] * w10 + a[y0 + 1, x0 + 1] * w11
    if b is None:
        return first, None
    return first, b[y0, x0] * w00 + b[y0, x0 + 1] * w01 + b[y0 + 1, x0] * w10 + b[y0 + 1, x0 + 1] * w11


class Camera:
    """Geometry that does not change from frame to frame."""

    def __init__(self, size, map_size, layers=7, tallest=0.016):
        self.size = size
        self.map_px = 2 * HALF / map_size
        half = size / 2
        self.pixel = 1 / (half * LIMB)                                # one output pixel, in solar radii
        yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
        sx = (xx - half + 0.5) * self.pixel
        sz = -(yy - half + 0.5) * self.pixel
        r = np.hypot(sx, sz)
        self.mu = np.sqrt(np.clip(1 - r * r, 0, 1))
        self.soften = np.clip(SOFTEN_RATE * (r - SOFTEN_FROM), 0, SOFTEN_MOST).astype(np.float32)
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

    def render(self, broad, detail, column_height, displacement, detail_displacement, gain, swell, flash, dim=26.0, fine=1):
        """broad + detail: the index map, split into its broad structure and its fine detail;
        column_height: how tall the forest stands at each point (solar radii).
        displacement, detail_displacement: (ux, uy) in map pixels, by which every point of the broad
        structure, and of the fine detail, has moved.
        gain, swell: how strong the bright fine detail is at each point just now, and what is added to
        the broad structure (motion.py); both on the nominal map.
        flash: two rows, the brightness of bright detail times its gain, and what that is shown as
        (render.flash_curve).
        fine: how many times finer than the nominal map the maps are sampled (see motion.oversample).
        Returns the index image of the disk and its fringe; 0 where nothing is seen."""
        nominal = broad.shape[0] // fine
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
                    scale = r0 * np.sqrt(2 / (1 + mu0)) / self.map_px
                    mx = ux * scale + HALF / self.map_px - 0.5
                    my = uz * scale + HALF / self.map_px - 0.5
                    # The material now at this point came from a little way off.
                    ix = np.clip(np.rint(mx), 0, nominal - 1).astype(np.int32)
                    iy = np.clip(np.rint(my), 0, nominal - 1).astype(np.int32)
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
        # Toward the limb foreshortening squeezes the surface's detail together, and the forest, seen more and
        # more from the side, smears it: the real frame's finest detail weakens there. The picture is softened
        # by a growing amount (only among the pixels that show the Sun, so its edge is not darkened).
        picture = out.reshape(self.size, self.size)
        seen = (picture > 0).astype(np.float32)
        sigma = SOFTEN_SIGMA * self.size / 2048
        smooth = blur(picture, sigma) / np.maximum(blur(seen, sigma), 1e-3)
        out = np.where(seen > 0, picture + self.soften * (smooth - picture), 0).ravel()
        # Near the limb the forest also fills the dark lanes with its own glow: the darks lift, the brights stay.
        mu = self.mu.ravel()
        toward_limb = np.clip((HAZE_FROM - mu) / HAZE_SPAN, 0, 1)
        haze = HAZE_LEVELS[0] + (HAZE_LEVELS[1] - HAZE_LEVELS[0]) * toward_limb
        lifted = SOFT * np.log(np.exp(out / SOFT) + np.exp(haze / SOFT))
        # It fades in over the first part of the way, so that no ring shows where it starts.
        weight = HAZE_WEIGHT * np.clip(toward_limb / 0.15, 0, 1)
        out = np.where((out > 0) & (mu > 0), out + weight * (lifted - out), out)
        return out.reshape(self.size, self.size).astype(np.float32)


def column_heights(surface, rng, typical=0.0045, spread=0.5, grain=2.2, clump=7.0, clump_spread=0.55):
    """How tall the forest stands: taller over bright network and plage, with a random lognormal spread
    from column to column and from clump to clump (the clumps make the edge of the disk ragged)."""
    size = surface.shape[0]
    noise = blur(rng.normal(size=(size, size)), grain)
    noise /= noise.std()
    clumps = blur(rng.normal(size=(size, size)), clump)
    clumps /= clumps.std()
    bright = np.clip((blur(surface, 2.0) - 120) / 60, 0.15, 1.6)
    return (typical * bright * np.exp(spread * noise + clump_spread * clumps)).astype(np.float32)


def undo_sampling_blur(surface, limit=2.5):
    """Give the map back the fine detail that sampling takes away. The real frame was measured on the map
    by bilinear interpolation, and the camera reads the map (at twice its resolution) the same way; each
    step dims detail of wavelength L pixels by a known amount, on average over where the samples fall:
    by 1 - (1 - cos(2 pi / L)) / 3 in power, per axis. This multiplies that back in, so that a rendered
    frame holds as much fine detail as the frame the map was matched to."""
    size = surface.shape[0]
    w = 2 * np.pi * np.fft.fftfreq(size)
    axis = ((1 - (1 - np.cos(w)) / 3) * (1 - (1 - np.cos(w / 2)) / 3)) ** -0.5
    gain = np.minimum(axis[:, None] * axis[None, :], limit)
    return np.fft.ifft2(np.fft.fft2(surface) * gain).real.astype(np.float32)
