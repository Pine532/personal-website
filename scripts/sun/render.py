"""Render frames of the simulated Sun from a finished surface map.

    python render.py all <workdir> [--workers 4] [--resume]            the three steps below, at 2048 px
    python render.py prepare <workdir>                                 static parts, shared by every frame
    python render.py scene <workdir> <size>                            the limb and corona, built once
    python render.py frames <workdir> <size> <first> <stop> <step>     writes <workdir>/frames-<size>/NNN.png

<workdir> holds surface.npy (from texture_match.py) and fields.npz (from surface.py).
One loop is one full turn of the Sun: 480 frames, 16 seconds at 30 fps. Frame k shows the Sun turned
about its vertical axis by 360 degrees times k / 480 and seen by the camera (camera.py). The surface's
own change in place (motion.py), and the fringe and glow at the limb (corona.py), run on a cycle half
as long, 240 frames or eight seconds, so they repeat twice per turn: frame k shows them at phase
(k mod 240) / 240. A slower turn does not slow the flicker. Frame 480 would equal frame 0 on both
counts, so the loop closes. Each frame also gets a little grain that is fresh in every frame.

`all` starts afresh: it removes the frames and the scene an earlier run left in <workdir>, which may
belong to another surface. With --resume it keeps them and renders only the frames that are missing,
unless the maps of the current surface.npy have not been prepared yet; then it starts afresh too.
`prepare` removes the stored scenes too; `frames` skips frames that exist.
"""
import argparse
import os
import pickle
import subprocess
import sys
import time

import numpy as np
from PIL import Image

import camera
import corona
import globe
import motion
from palette import to_rgb
from turbulence import blur

FRAMES = 480                      # one turn of the Sun, and one loop of the files
CYCLE = 240                       # frames in one cycle of the change in place; FRAMES is a whole number of them
KINDS = ('drift', 'detail', 'flicker', 'swell')              # the four changes of motion.py
GRAIN = 1.3                       # rms of the grain on the disk, in index units
GRAIN_SEED = 7
FLASH = 1.3                       # how lopsided the flicker is (see Renderer.disk)
FLASH_SEED = 3
DETAIL_SIGMA = 5.0                # map pixels: structure finer than this also drifts on its own (motion.py)
SIZE = 2048                       # the size `all` renders at
# Plumes standing on the limb: where (degrees around the limb, anticlockwise from the right), how wide and
# how tall (solar radii), how bright (index), and how far they lean. Optional: texture, threshold and sharp,
# which shape the threads inside them (see corona.py). They stand at fixed angles while the Sun turns under
# them; the glow they stand in follows the turn (corona.py works out the limb's activity in every frame).
PLUMES = [
    dict(at=160.0, width=0.030, height=0.070, index=126, lean=-0.5),
    dict(at=348.0, width=0.016, height=0.045, index=120, lean=0.5),
    dict(at=12.0, width=0.010, height=0.030, index=114, lean=0.3),
    dict(at=250.0, width=0.012, height=0.034, index=114, lean=-0.3),
    dict(at=118.0, width=0.008, height=0.024, index=110, lean=0.2),
]


def flash_curve(detail):
    """What flickering detail is shown as. The flicker multiplies the bright fine detail by a gain that is
    mostly a little under one and now and then well above it (Renderer.disk). Left at that, the picture
    would hold several times too many very bright specks. This curve takes the multiplied detail back to
    the distribution the detail has on the still map: at any moment as many features are as bright as
    before, and only which ones changes. Two rows: the multiplied brightness, and what it is shown as."""
    lit = detail[detail > 0].astype(np.float64)
    sigma = FLASH * np.sqrt(sum(rms ** 2 for _, rms in motion.FLICKER))
    gain = np.exp(sigma * np.random.default_rng(FLASH_SEED).normal(size=lit.size) - sigma ** 2)
    # Quantiles at even steps, and at steps ever closer to the top, where the specks are.
    levels = np.unique(np.concatenate([np.linspace(0, 1, 201), 1 - 10 ** -np.linspace(0, 6, 241)]))
    return np.stack([np.concatenate([[0], np.quantile(lit * gain, levels)]),
                     np.concatenate([[0], np.quantile(lit, levels)])]).astype(np.float32)


def prepare(workdir):
    t0 = time.time()
    surface = np.clip(np.load(os.path.join(workdir, 'surface.npy')).astype(np.float32), 0, 255)
    fields = np.load(os.path.join(workdir, 'fields.npz'))
    heights = camera.column_heights(surface, np.random.default_rng(5))
    # The map's texture would fan into each pole on the sphere; the caps get texture that is even there.
    surface, heights = globe.even_caps(surface, heights, blur)
    surface = np.clip(camera.undo_sampling_blur(surface), 0, 255)
    # Broad structure and fine detail, kept apart because they move differently (motion.py).
    # The camera samples every map at twice its resolution (see motion.oversample).
    broad = blur(surface, DETAIL_SIGMA).astype(np.float32)
    np.save(os.path.join(workdir, 'broad2.npy'), motion.oversample(broad, 2))
    np.save(os.path.join(workdir, 'detail2.npy'), motion.oversample(surface - broad, 2))
    np.save(os.path.join(workdir, 'flash-curve.npy'), flash_curve(surface - broad))
    np.save(os.path.join(workdir, 'heights2.npy'), np.clip(motion.oversample(heights, 2), 0, None))
    moving = motion.Motion(surface.shape, along=(fields['dx'], fields['dy'], fields['comb']))
    for name in os.listdir(workdir):                             # parts an earlier run stored under other names
        if name.split('-')[0] in KINDS + ('motion',) and name.endswith(('-cos.npy', '-sin.npy')):
            os.remove(os.path.join(workdir, name))
    for kind in KINDS:
        for k, (cycles, cosine, sine) in enumerate(getattr(moving, kind)):
            np.save(os.path.join(workdir, f'{kind}-{k}-{cycles}-cos.npy'), cosine)
            np.save(os.path.join(workdir, f'{kind}-{k}-{cycles}-sin.npy'), sine)
    with open(os.path.join(workdir, 'map-size.txt'), 'w') as handle:
        handle.write(f'{surface.shape[0]} {surface.shape[1]}')
    # A scene stored by an earlier run was built for the maps just replaced.
    for name in os.listdir(workdir):
        if name.startswith('corona-') and name.endswith('.pickle'):
            os.remove(os.path.join(workdir, name))
    print(f'prepared maps and motion ({time.time() - t0:.0f}s)', flush=True)


class Renderer:
    def __init__(self, workdir, size):
        self.workdir, self.size = workdir, size
        with open(os.path.join(workdir, 'map-size.txt')) as handle:
            self.map_shape = tuple(int(n) for n in handle.read().split())    # rows, columns
        self.broad = np.load(os.path.join(workdir, 'broad2.npy'), mmap_mode='r')
        self.detail = np.load(os.path.join(workdir, 'detail2.npy'), mmap_mode='r')
        self.heights = np.load(os.path.join(workdir, 'heights2.npy'), mmap_mode='r')
        self.flash = np.load(os.path.join(workdir, 'flash-curve.npy'))
        self.terms = {kind: [] for kind in KINDS}
        for name in sorted(os.listdir(workdir)):
            kind = name.split('-')[0]
            if kind in self.terms and name.endswith('-cos.npy'):
                cycles = int(name.split('-')[2])
                cosine = np.load(os.path.join(workdir, name), mmap_mode='r')
                sine = np.load(os.path.join(workdir, name.replace('-cos', '-sin')), mmap_mode='r')
                self.terms[kind].append((cycles, cosine, sine))
        self.camera = camera.Camera(size, self.map_shape, layers=7, tallest=0.012)
        self.flicker_offset = np.float32(FLASH ** 2 * sum(rms ** 2 for _, rms in motion.FLICKER))
        self.corona = None

    def at(self, kind, phase):
        """One of the four changes of motion.py at loop phase 0..1: the sum of its harmonics."""
        total = None
        for cycles, cosine, sine in self.terms[kind]:
            c, s = np.float32(np.cos(2 * np.pi * cycles * phase)), np.float32(np.sin(2 * np.pi * cycles * phase))
            part = cosine * c + sine * s
            total = part if total is None else total + part
        return total

    def disk(self, phase, turn):
        """The camera's picture of the disk with the change in place at `phase` of its cycle and the Sun
        turned by `turn` of a full turn (both 0..1)."""
        drift = self.at('drift', phase)
        detail = drift + self.at('detail', phase)
        # The gain is lognormal: mostly a little under one, now and then well above it, so that small
        # features flash rather than breathe. Its mean square is one, and flash_curve keeps the flashes
        # from adding up to more bright specks than the map has.
        gain = np.exp(FLASH * self.at('flicker', phase) - self.flicker_offset)
        return self.camera.render(self.broad, self.detail, self.heights, drift, detail, gain, self.at('swell', phase), self.flash, turn, fine=2)

    def scene(self):
        """The limb and corona: the parts that do not change, built once at phase 0 and stored next to the
        maps. The rest, and the calibration, are worked out in every frame (corona.py)."""
        if self.corona is None:
            path = os.path.join(self.workdir, f'corona-{self.size}.pickle')
            if os.path.exists(path):
                with open(path, 'rb') as handle:
                    self.corona = pickle.load(handle)
            else:
                scene = corona.Corona(self.size, plumes=PLUMES)
                scene.frame(self.disk(0.0, 0.0), 0.0)
                with open(path + '.part', 'wb') as handle:
                    pickle.dump(scene, handle)
                os.replace(path + '.part', path)
                self.corona = scene
        return self.corona

    def frame(self, k):
        # The turn takes the whole loop; the change in place, the fringe and the glow take one cycle.
        turn, phase = k / FRAMES, (k % CYCLE) / CYCLE
        picture = self.scene().frame(self.disk(phase, turn), phase)
        # Grain: fresh in every frame, fainter where the picture is dark, none in the black sky.
        rng = np.random.default_rng([GRAIN_SEED, k % FRAMES])
        noise = rng.normal(size=picture.shape).astype(np.float32)
        for axis in (0, 1):                                      # a little softer than white noise, as a sensor's is
            noise = 0.25 * np.roll(noise, 1, axis) + 0.5 * noise + 0.25 * np.roll(noise, -1, axis)
        noise /= 0.375
        return np.clip(picture + GRAIN * np.clip(picture / 110, 0, 1) * noise, 0, 255)


def frames(workdir, size, first, stop, step):
    out = os.path.join(workdir, f'frames-{size}')
    os.makedirs(out, exist_ok=True)
    renderer = Renderer(workdir, size)
    for k in range(first, stop, step):
        path = os.path.join(out, f'{k:03d}.png')
        if os.path.exists(path):
            continue
        t0 = time.time()
        picture = renderer.frame(k)
        Image.fromarray(to_rgb(picture)).save(path + '.part.png')
        os.replace(path + '.part.png', path)
        print(f'frame {k:3d} at {size}: {time.time() - t0:.1f}s', flush=True)


def render_all(workdir, workers, resume=False):
    """From the finished surface to the last frame. Worker k renders frames k, k + workers, ...;
    every worker is a process of its own and loads the stored scene."""
    out = os.path.join(workdir, f'frames-{SIZE}')
    # Resuming needs the prepared maps of this surface. A folder that has only surface.npy, or maps
    # older than it, starts afresh: frames of another surface must not be kept.
    sized = os.path.join(workdir, 'map-size.txt')
    if resume and (not os.path.exists(sized) or os.path.getmtime(sized) < os.path.getmtime(os.path.join(workdir, 'surface.npy'))):
        print('the maps of this surface are not prepared yet: starting afresh', flush=True)
        resume = False
    if not resume:
        if os.path.isdir(out):
            for name in os.listdir(out):
                if name.endswith('.png'):
                    os.remove(os.path.join(out, name))
        prepare(workdir)
    Renderer(workdir, SIZE).scene()
    command = [sys.executable, os.path.abspath(__file__), 'frames', workdir, str(SIZE)]
    running = [subprocess.Popen(command + [str(k), str(FRAMES), str(workers)]) for k in range(workers)]
    failed = any([worker.wait() != 0 for worker in running])       # a list, so that every worker is waited for
    count = sum(os.path.exists(os.path.join(out, f'{k:03d}.png')) for k in range(FRAMES))
    if failed or count != FRAMES:
        raise SystemExit(f'{out}: a worker stopped early; {count} of {FRAMES} frames are written. Add --resume to render the missing ones.')
    print(f'{out}: {count} frames')


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest='command', required=True)
    command = commands.add_parser('all', help=f'prepare, scene and all {FRAMES} frames at {SIZE} px')
    command.add_argument('workdir')
    command.add_argument('--workers', type=int, default=4, help='processes rendering frames at the same time (default 4)')
    command.add_argument('--resume', action='store_true', help='keep the frames and scene already in the folder; render what is missing')
    command = commands.add_parser('prepare', help='static parts, shared by every frame')
    command.add_argument('workdir')
    command = commands.add_parser('scene', help='the limb and corona, built once')
    command.add_argument('workdir')
    command.add_argument('size', type=int)
    command = commands.add_parser('frames', help='frames first, first + step, ... below stop')
    command.add_argument('workdir')
    for name in ('size', 'first', 'stop', 'step'):
        command.add_argument(name, type=int)
    args = parser.parse_args()
    if args.command == 'all':
        render_all(args.workdir, args.workers, args.resume)
    elif args.command == 'prepare':
        prepare(args.workdir)
    elif args.command == 'scene':
        Renderer(args.workdir, args.size).scene()
    else:
        frames(args.workdir, args.size, args.first, args.stop, args.step)


if __name__ == '__main__':
    main()
