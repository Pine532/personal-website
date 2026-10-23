"""Build the simulated Sun's surface: the starting map that texture_match.py then refines.

    python surface.py <workdir>            the whole map: writes surface-start.npy and fields.npz
    python surface.py <workdir> --size W   the whole map at W columns instead of 4992, for quick runs
    python surface.py <workdir> --bench    only a central 1152 px patch, for quick checks: writes surface-start.npy

It will not write into a folder that already holds a matched surface (surface.npy): the new start map
and direction fields would not belong to it. Use a new folder, or --force.

Everything lives on an equirectangular map of the whole sphere (globe.py): columns are longitude,
rows are latitude, and the map wraps around in longitude so that the Sun can turn seamlessly. A
magnetic network, active regions and filaments bias a rough turbulence that is combed along a
direction field; a soft threshold turns that into clumps and lanes; the contrast at every scale is
then calibrated against curves measured from one real SDO frame (reference/texture-curves.npz, see
reference.py).

The map holds brightness as the index 0..255 (see palette.py). fields.npz holds what the renderer's
motion follows: the direction of the fine structure (dx, dy) and where it is combed (comb), with the
plage for reference. A bench map covers only a patch of the sphere, so it cannot be rendered.
"""
import argparse
import time
from pathlib import Path

import numpy as np

import calibration
import globe
from network import lumps, network_points, splat, stamp, wander
from turbulence import band_noise, blur, stretch

# The sizes in pixels quoted in PARAMETERS and below are for a pixel of this many solar radii (the map
# the model was tuned on); Sun.scale converts them to the map being built.
QUOTED_PIXEL = 2 * 1.46 / 2304

PARAMETERS = dict(
    # The map (columns = longitude over 360 degrees, rows = latitude over 180), the random seed, and the
    # rounds of calibration. 4992 columns make a pixel of 0.00126 solar radii at the equator, 0.7% finer
    # than the real frame's map (0.001267, reference.py). A coarser map cannot hold all the fine detail
    # the real frame has: at 4608 columns (7.6% coarser) the realism test (realism.py) told a rendered
    # frame from the real one far more easily (0.92 against 0.68 for a map with the real frame's pixel).
    W=4992, H=2496, seed=3, rounds=4,
    # The quiet network: cell size (solar radii), the share of cell boundaries that carry flux, and the reach (px)
    # and weight of its pull on where clumps form.
    cell=0.045, fill=0.55, env_sigma=3.0, env_w=0.8,
    # From turbulence to brightness: the weight of the coarse octaves, the soft threshold, and the mix of
    # thresholded structure, linear field and fine detail.
    rough=0.5, gain=1.5, level=0.0, s_w=1.0, lin_w=0.3, fine_w=0.3,
    # Fine structure: how much of it is combed along the direction field and how far (in units of each octave's
    # scale), how unevenly its strength varies (burst), and what sets the direction.
    mix=0.2, ratio=1.5, long_ratio=3.0, burst=0.2, dir_sigma=60.0, arcade=0.5, canopy_comb=0.5, wind=1.0, stretch_max=4,
    # Provinces: broad brighter and darker areas, activity belts, darker poles.
    prov_w=0.5, belt_w=0.3, pole_w=0.25,
    # Active regions, filaments and network cores: the _b terms bias where clumps form, the _add terms add or
    # remove brightness directly.
    plage_b=1.6, plage_add=1.6, canopy_b=0.9, ribbon_b=2.0, ribbon_add=4.5, fil_b=2.2, fil_add=0.5, core_add=0.15,
)
# The bench: a square patch around longitude 0, latitude 0 at the whole map's pixel size, where the real
# frame is hardly foreshortened.
BENCH = dict(W=1152, H=1152, bench=True)

# Active regions: where (longitude and latitude in degrees; longitude 0 faces the camera at phase 0
# and grows to the right), how big (map units: radians of arc), the heading of the polarity inversion
# line (radians, anticlockwise from east), how strong, how bright its ribbons, and how many inversion
# lines (one unless given). They are placed by hand along two activity belts, north and south of the
# equator, ten on the side that faces the camera at phase 0 and ten on the far side, so that the
# turning Sun shows something different at every phase; the arrangement is this model's own and
# follows no observation.
REGIONS = [
    # The near side.
    dict(at=(11.9, -13.9), size=0.26, heading=1.25, power=1.0, ribbons=1.0, lines=3),
    dict(at=(-21.7, 12.7), size=0.17, heading=0.5, power=0.95, ribbons=0.6, lines=2),
    dict(at=(39.0, 17.5), size=0.10, heading=2.2, power=0.8, ribbons=0.5),
    dict(at=(-43.9, -11.5), size=0.09, heading=0.9, power=0.75, ribbons=0.4),
    dict(at=(-9.4, -31.3), size=0.07, heading=0.2, power=0.6, ribbons=0.3),
    dict(at=(55.1, -12.7), size=0.08, heading=1.5, power=0.75, ribbons=0.4),
    dict(at=(-68.8, 15.1), size=0.08, heading=1.6, power=0.8, ribbons=0.4),
    dict(at=(23.5, 31.3), size=0.06, heading=2.8, power=0.55, ribbons=0.2),
    dict(at=(73.1, 6.9), size=0.06, heading=1.4, power=0.7, ribbons=0.3),
    dict(at=(-35.3, 30.0), size=0.06, heading=0.4, power=0.5, ribbons=0.2),
    # The far side.
    dict(at=(168.0, 14.0), size=0.22, heading=2.0, power=1.0, ribbons=0.9, lines=2),
    dict(at=(-155.0, -17.0), size=0.15, heading=0.8, power=0.9, ribbons=0.6, lines=2),
    dict(at=(126.0, -21.0), size=0.11, heading=2.6, power=0.8, ribbons=0.5),
    dict(at=(-124.0, 20.0), size=0.09, heading=1.1, power=0.75, ribbons=0.4),
    dict(at=(105.0, 24.0), size=0.07, heading=0.3, power=0.6, ribbons=0.3),
    dict(at=(152.0, -33.0), size=0.07, heading=1.8, power=0.6, ribbons=0.3),
    dict(at=(-106.0, -9.0), size=0.08, heading=2.4, power=0.7, ribbons=0.4),
    dict(at=(-171.0, 33.0), size=0.06, heading=0.7, power=0.55, ribbons=0.2),
    dict(at=(143.0, 7.0), size=0.06, heading=1.3, power=0.65, ribbons=0.3),
    dict(at=(-138.0, -31.0), size=0.06, heading=2.9, power=0.5, ribbons=0.2),
]
# Quiet-Sun filaments: start (longitude, latitude in degrees), heading (radians), length (map units).
FILAMENTS = [
    # The near side.
    dict(at=(-48.4, -34.1), heading=0.35, length=0.75),
    dict(at=(4.5, 39.8), heading=-0.25, length=0.60),
    dict(at=(-6.9, 1.1), heading=1.9, length=0.40),
    dict(at=(41.5, -38.3), heading=0.6, length=0.36),
    dict(at=(-63.3, 34.1), heading=-0.9, length=0.30),
    # The far side.
    dict(at=(118.0, -36.0), heading=0.6, length=0.65),
    dict(at=(-164.0, 38.0), heading=-0.4, length=0.55),
    dict(at=(160.0, -4.0), heading=2.2, length=0.42),
    dict(at=(-119.0, 36.0), heading=0.9, length=0.34),
    dict(at=(-148.0, -40.0), heading=-0.7, length=0.30),
]


def place(degrees):
    """A hand-placed position (longitude, latitude in degrees) as map units (radians)."""
    return np.radians(np.asarray(degrees, dtype=np.float64))


class Sun:
    def __init__(self, **overrides):
        self.p = dict(PARAMETERS)
        self.p.update(overrides)
        self.bench = self.p.get('bench', False)
        self.shape = (self.p['H'], self.p['W'])
        # A bench is a patch of the whole map, so it keeps the whole map's pixel size.
        self.px = globe.pixel(PARAMETERS['W'] if self.bench else self.p['W'])
        self.scale = QUOTED_PIXEL / self.px        # pixel lengths quoted for QUOTED_PIXEL, in this map's pixels

    def log(self, text):
        print(f'  [{time.time() - self.t0:5.1f}s] {text}', flush=True)

    def build(self):
        p, shape, sc = self.p, self.shape, self.scale
        rows, cols = shape
        self.t0 = time.time()

        def rng(name):
            # Every random stream has its own seed, made from the sum of its name's character codes (the names
            # in use all give different sums), so no stream depends on how much another one drew.
            return np.random.default_rng([p['seed'], sum(map(ord, name))])

        u, v = globe.grid(shape, self.px)
        latitude = v
        # How much of the sphere each pixel stands for: the weight of every pixel in the map's statistics.
        self.weights = np.cos(latitude)

        # 1. The quiet network.
        points, weights = network_points(rng('network'), cols * self.px, rows * self.px, cell=p['cell'], fill=p['fill'])
        density = blur(splat(points, weights, shape, self.px), p['env_sigma'] * sc)
        env = np.log1p(density / density.mean())
        self.env = (env - env.mean()) / env.std()
        cores = blur(splat(points, weights ** 2, shape, self.px), 1.3 * sc)
        self.cores = np.clip(cores / np.percentile(cores, 99.5), 0, 3)
        self.log(f'network: {len(points)} flux elements')

        # 2. Active regions and filaments.
        plage = np.zeros(shape)
        fields = {name: np.zeros(shape) for name in ('ribbon', 'filament', 'steer_x', 'steer_y', 'comb')}
        r_ar = rng('regions')
        for region in REGIONS:
            center = place(region['at'])
            size, heading, power = region['size'], region['heading'], region['power']
            # Plage: a main patch elongated across the inversion line, plus satellites.
            blobs = [(center, size * 1.2, size * 0.75, heading + np.pi / 2, 1.0)]
            for _ in range(4):
                offset = r_ar.normal(0, size * 0.8, 2)
                blobs.append((center + offset, size * r_ar.uniform(0.3, 0.6), size * r_ar.uniform(0.25, 0.5),
                              r_ar.uniform(0, np.pi), r_ar.uniform(0.5, 0.9)))
            for c, a, b, angle, amount in blobs:
                # Longitude differences are taken the short way around, and shrunk by cos(latitude) so that
                # the patch keeps its shape on the sphere, where the map's pixels narrow toward the poles.
                du = ((u - c[0] + np.pi) % (2 * np.pi) - np.pi) * np.cos(c[1])
                dv = v - c[1]
                along = du * np.cos(angle) + dv * np.sin(angle)
                across = -du * np.sin(angle) + dv * np.cos(angle)
                plage += power * amount * np.exp(-((along / a) ** 2 + (across / b) ** 2))
            # The polarity inversion lines, each with its two ribbons and the filament lying along it.
            for line_number in range(region.get('lines', 1)):
                self._inversion_line(region, line_number, center, r_ar, fields)
        ribbon, filament, steer_x, steer_y, comb = (fields[name] for name in ('ribbon', 'filament', 'steer_x', 'steer_y', 'comb'))
        r_f = rng('filaments')
        for item in FILAMENTS:
            line = wander(r_f, place(item['at']), item['heading'], item['length'], turn=0.5, scale=0.07)
            dist, tx, ty, along = stamp(line, shape, self.px, 40 * sc)
            near = np.isfinite(dist)
            d = np.where(near, dist, 0.0)
            count = len(line)
            taper = np.sin(np.pi * np.clip(along, 0, 1)) ** 0.4
            profile = lumps(r_f, count, count / 7, floor=0.0)
            amount = profile[np.clip((along * (count - 1)).astype(int), 0, count - 1)]
            width = (2.4 + 1.8 * lumps(r_f, count, count / 4)[np.clip((along * (count - 1)).astype(int), 0, count - 1)]) * sc
            filament += near * taper * amount * np.exp(-d * d / (2 * width ** 2))
            weight = near * np.exp(-(d / (16 * sc)) ** 2) * 3.0
            angle_t = np.arctan2(ty, tx)
            steer_x += weight * np.cos(2 * angle_t)
            steer_y += weight * np.sin(2 * angle_t)
            comb = np.maximum(comb, near * np.exp(-(d / (22 * sc)) ** 2) * 0.9)
        shape_noise = band_noise(rng('plage-shape'), shape, 24 * sc)[0] * 0.35 + band_noise(rng('plage-shape-2'), shape, 8 * sc)[0] * 0.2
        self.plage = np.clip(plage * (1 + shape_noise), 0, 1.6)
        self.ribbon = ribbon
        self.filament = np.clip(filament, 0, 1.5)
        halo = blur(self.plage, 45 * sc)
        self.canopy = np.clip(halo * 2.2 - self.plage, 0, 1) * (1 - np.clip(self.plage, 0, 1))
        self.log('active regions and filaments')

        # 2b. Provinces: broad brighter and darker areas, activity belts, darker poles (by true latitude).
        large = sum(band_noise(rng(f'large{s}'), shape, s * sc)[0] for s in (32, 64, 128, 256))
        large /= large.std()
        belts = np.exp(-((np.abs(latitude) - 0.33) / 0.24) ** 2)
        poles = np.clip((np.abs(latitude) - 0.95) / 0.3, 0, 1)
        self.provinces = p['prov_w'] * large + p['belt_w'] * belts - p['pole_w'] * poles

        # 3. Turbulence, plain: every octave of noise (two sets: one shapes the clumps, one adds detail).
        sigmas = (16, 8, 4, 2, 1)
        plain = {sigma: band_noise(rng(f'noise{sigma}'), shape, sigma * sc, count=2) for sigma in sigmas}
        self.log('plain turbulence')

        # 4. The direction the fine structure is combed in: a large-scale wind, and along filaments
        # and inversion lines where those are near.
        potential = blur(rng('wind').normal(size=shape), p['dir_sigma'] * sc)
        wy, wx = np.gradient(potential)
        angle = np.arctan2(wy, wx)
        # Doubled-angle sums, so opposite directions do not cancel.
        cx = p['wind'] * np.cos(2 * angle) + steer_x
        cy = p['wind'] * np.sin(2 * angle) + steer_y
        direction = 0.5 * np.arctan2(cy, cx)
        self.dx, self.dy = np.cos(direction).astype(np.float32), np.sin(direction).astype(np.float32)
        self.comb = np.clip(np.maximum(comb, self.canopy * p['canopy_comb']), 0, 1)
        self.log('direction field')

        # 5. Turbulence, combed.
        self.layers = {}
        r_b = rng('bursts')
        log_amp = np.zeros(shape)
        for sigma in sigmas:
            s = sigma * sc
            noise = plain[sigma]
            if sigma <= p['stretch_max']:
                short = stretch(noise, self.dx, self.dy, max(1, int(round(p['ratio'] * s))))
                long = stretch(noise, self.dx, self.dy, max(2, int(round(p['long_ratio'] * s))))
                short /= short.std(axis=(1, 2), keepdims=True)
                long /= long.std(axis=(1, 2), keepdims=True)
                mix = p['mix'] + (1 - p['mix']) * self.comb
                layer = (1 - mix) * noise + mix * ((1 - self.comb) * short + self.comb * long)
            else:
                layer = noise
            if sigma <= 8:
                g = blur(r_b.normal(size=shape), 3 * s)
                log_amp = 0.6 * log_amp + 0.8 * g / g.std()
                layer = layer * np.exp(p['burst'] * log_amp)
            self.layers[sigma] = (layer / layer.std(axis=(1, 2), keepdims=True)).astype(np.float32)
            self.log(f'turbulence at {sigma} px')
        return self

    def _inversion_line(self, region, line_number, center, r_ar, fields):
        p, shape, sc = self.p, self.shape, self.scale
        size, heading, power = region['size'], region['heading'], region['power']
        length = size * 1.9 * (1.0 if line_number == 0 else 0.7)
        across = np.array([-np.sin(heading), np.cos(heading)]) * size * 0.55 * line_number
        turn = heading + 0.35 * line_number
        start = center + across - 0.5 * length * np.array([np.cos(turn), np.sin(turn)])
        line = wander(r_ar, start, turn, length, turn=0.55, scale=0.05)
        dist, tx, ty, along = stamp(line, shape, self.px, 70 * sc)
        near = np.isfinite(dist)
        d = np.where(near, dist, 0.0)
        count = len(line)
        taper = np.sin(np.pi * np.clip(along, 0, 1)) ** 0.5
        for side in (+1, -1):
            offset = r_ar.uniform(16, 30) * sc * (size / 0.2) ** 0.5
            width = r_ar.uniform(8, 12) * sc * (size / 0.2) ** 0.5
            profile = lumps(r_ar, count, count / 9, floor=0.25, power=1.0)
            gap = lumps(r_ar, count, count / 5)
            wobble = offset * (0.6 + 0.4 * gap[np.clip((along * (count - 1)).astype(int), 0, count - 1)])
            amount = profile[np.clip((along * (count - 1)).astype(int), 0, count - 1)]
            fields['ribbon'] += near * region['ribbons'] * power * taper * amount * np.exp(-((side * d - wobble) ** 2) / (2 * width ** 2))
        profile = lumps(r_ar, count, count / 6, floor=0.0)
        amount = profile[np.clip((along * (count - 1)).astype(int), 0, count - 1)]
        fields['filament'] += near * 0.7 * taper * amount * np.exp(-d * d / (2 * (7 * sc) ** 2))
        # Fibril directions: along the line close to it (sheared field), across it further out (arcade).
        shear = near * np.exp(-(d / (18 * sc)) ** 2) * 3.0
        arcade = near * np.exp(-(d / (45 * sc)) ** 2) * p['arcade']
        # Doubled-angle sums, so opposite directions do not cancel.
        angle_t = np.arctan2(ty, tx)
        fields['steer_x'] += shear * np.cos(2 * angle_t) + arcade * np.cos(2 * angle_t + np.pi)
        fields['steer_y'] += shear * np.sin(2 * angle_t) + arcade * np.sin(2 * angle_t + np.pi)
        fields['comb'] = np.maximum(fields['comb'], near * np.exp(-(d / (24 * sc)) ** 2))

    def bias(self):
        """Where clumps are more likely (positive) or less likely (negative) to form."""
        p = self.p
        return (p['env_w'] * self.env + self.provinces + p['plage_b'] * self.plage + p['ribbon_b'] * self.ribbon
                - p['fil_b'] * self.filament - p['canopy_b'] * self.canopy)

    def start(self):
        """The map before calibration (arbitrary units): clumps and lanes, with linear and fine detail."""
        p = self.p
        rough = sum(self.layers[s][0] * s ** p['rough'] for s in (16, 8, 4, 2, 1))
        rough /= rough.std()
        fine = sum(self.layers[s][1] for s in (4, 2, 1))
        fine /= fine.std()
        # The octaves are float32; everything from here on is computed in float64.
        rough = rough.astype(np.float64)
        fine = fine.astype(np.float64)
        q = self.bias() + rough
        # The threshold sits at the median over the sphere (each pixel by its weight), not over the map.
        q_mid = calibration.quantile(q, 0.5, self.weights)
        q_std = np.sqrt(np.average((q - np.average(q, weights=self.weights)) ** 2, weights=self.weights))
        qn = (q - q_mid) / q_std
        structure = np.tanh(p['gain'] * (qn - p['level']))
        s_std = np.sqrt(np.average((structure - np.average(structure, weights=self.weights)) ** 2, weights=self.weights))
        extra = (p['plage_add'] * self.plage * (1 + 0.25 * rough) + p['ribbon_add'] * self.ribbon * (1 + 0.3 * rough)
                 + p['core_add'] * self.cores - p['fil_add'] * self.filament)
        return p['s_w'] * structure / s_std + p['lin_w'] * qn + p['fine_w'] * fine + extra


def make(bench=False, width=None):
    """Build the surface and calibrate it against the stored curves. Returns the map (index 0..255,
    float64) and the Sun it came from. `width`: columns of a whole map other than the standard one."""
    if bench:
        sun = Sun(**BENCH)
    elif width:
        sun = Sun(W=width, H=width // 2)
    else:
        sun = Sun()
    sun.build()
    out = calibration.match(sun.start(), sun.weights, calibration.filters(sun.shape), calibration.stored_curves(bench), rounds=sun.p['rounds'])
    sun.log('calibrated')
    return np.clip(out, 0, 255), sun


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('workdir')
    parser.add_argument('--bench', action='store_true', help='build only a central 1152 px patch of the map, for quick checks')
    parser.add_argument('--size', type=int, default=None, help=f'columns of the whole map (default {PARAMETERS["W"]}; a multiple of 64)')
    parser.add_argument('--force', action='store_true', help='write even though the folder holds a surface.npy')
    args = parser.parse_args()
    if args.size and args.size % 64:
        raise SystemExit('--size must be a multiple of 64: the texture statistics live on grids down to 1/32 of the map')
    workdir = Path(args.workdir)
    if (workdir / 'surface.npy').exists() and not args.force:
        raise SystemExit(f'{workdir} already holds a matched surface (surface.npy). Use a new folder, or --force.')
    workdir.mkdir(parents=True, exist_ok=True)
    out, sun = make(args.bench, args.size)
    np.save(workdir / 'surface-start.npy', out.astype(np.float32))
    if not args.bench:
        np.savez(workdir / 'fields.npz', dx=sun.dx, dy=sun.dy, comb=sun.comb.astype(np.float32), plage=sun.plage.astype(np.float32))
    print(f'{workdir / "surface-start.npy"}: {sun.shape[0]} rows x {sun.shape[1]} columns')


if __name__ == '__main__':
    main()
