"""How the surface changes over the loop, apart from turning.

Mostly it changes in place, as the real chromosphere does at this cadence: small features brighten
and fade where they are (`flicker`, a gain on the fine detail), clumps swell and dim more slowly
(`swell`, added to the broad structure), and the fine detail shimmers by a fraction of a pixel (`detail`).
Only a little of the change is sideways drift (`drift`), slightly more along fibrils near active
regions and filaments. The Sun's turn is not here: the camera turns the whole map (camera.py).

Every change is a sum of a few harmonics of one cycle of 240 frames, eight seconds at 30 fps, so frame
240 would equal frame 0 exactly. The loop is one turn, 480 frames (render.py), two such cycles.
The fields live on the same map as the surface (globe.py) and are read at the same wrapped places.
"""
import numpy as np

from turbulence import blur

# (cycles per cycle, strength, how many of the drift's octaves take part, finest first): the quick
# harmonics only stir the fine structure. Strengths are in map pixels (rms per octave).
DRIFT = ((1, 0.2, 3), (2, 0.1, 3), (3, 0.05, 3), (5, 0.025, 2), (8, 0.015, 1))
DRIFT_OCTAVES = ((7.0, 1.1), (18.0, 1.7), (46.0, 2.2))          # (sigma in map pixels, amplitude)
FLOW = 3.0                                                      # extra drift along fibrils, where they are combed
# The fine detail's own quick shimmer: (cycles per cycle, strength), over two octaves.
DETAIL = ((3, 0.25), (5, 0.25), (8, 0.225), (13, 0.175), (21, 0.125))
DETAIL_OCTAVES = ((8.0, 0.5), (16.0, 0.7))
# Flicker: the gain on the bright fine detail is the exponential of a sum of these, scaled by FLASH
# in render.py, so that features flash rather than breathe. (cycles per cycle, rms of each part).
FLICKER = ((3, 0.17), (5, 0.17), (8, 0.19), (13, 0.22), (21, 0.23), (34, 0.21), (55, 0.14))
FLICKER_SIGMA = 3.0                                             # map pixels: the size of what flickers together
# Swell: added to the broad structure, in index units.
SWELL = ((1, 3.9), (2, 3.3), (3, 2.7), (5, 1.8), (8, 1.2))
SWELL_SIGMA = 9.0


def _smooth(rng, shape, sigma):
    field = blur(rng.normal(size=shape), sigma)
    return (field / field.std()).astype(np.float32)


class Motion:
    def __init__(self, shape, seed=21, along=None):
        """shape: the map's (rows, cols). along: optional (dx, dy, weight) fields: unit direction of the
        fibrils and where (0..1) drift should follow them.

        The results are four lists of harmonics, each entry (cycles, cosine part, sine part); at loop
        phase 0..1 of the cycle a change is the sum over its harmonics of
        cosine part * cos(2 pi cycles phase) + sine part * sin(2 pi cycles phase).
        `drift` and `detail` are displacement fields (2, rows, cols) in map pixels; `flicker` and
        `swell` are scalar fields (rows, cols)."""
        shape = tuple(shape)
        rng = np.random.default_rng(seed)
        self.drift = []
        for cycles, strength, reach in DRIFT:
            pair = []
            for _ in range(2):                                   # cosine and sine parts
                u = np.zeros((2, *shape), dtype=np.float32)
                for sigma, amplitude in DRIFT_OCTAVES[:reach]:
                    for axis in range(2):
                        u[axis] += strength * amplitude * _smooth(rng, shape, sigma)
                if along is not None:
                    # The part of a smooth random drift that lies along the fibrils. Written this way it does not
                    # depend on which of its two senses the fibril direction was stored with, so it has no tears.
                    dx, dy, weight = along
                    slide = strength * FLOW * (_smooth(rng, shape, 9.0) * dx + _smooth(rng, shape, 9.0) * dy)
                    u[0] = u[0] * (1 - 0.6 * weight) + slide * dx * weight
                    u[1] = u[1] * (1 - 0.6 * weight) + slide * dy * weight
                pair.append(u)
            self.drift.append((cycles, pair[0], pair[1]))
        self.detail = []
        for cycles, strength in DETAIL:
            pair = []
            for _ in range(2):
                u = np.zeros((2, *shape), dtype=np.float32)
                for sigma, amplitude in DETAIL_OCTAVES:
                    for axis in range(2):
                        u[axis] += strength * amplitude * _smooth(rng, shape, sigma)
                pair.append(u)
            self.detail.append((cycles, pair[0], pair[1]))
        self.flicker = [(cycles, rms * _smooth(rng, shape, FLICKER_SIGMA), rms * _smooth(rng, shape, FLICKER_SIGMA)) for cycles, rms in FLICKER]
        self.swell = [(cycles, rms * _smooth(rng, shape, SWELL_SIGMA), rms * _smooth(rng, shape, SWELL_SIGMA)) for cycles, rms in SWELL]


def oversample(field, factor=2):
    """The field on a grid `factor` times finer, by padding its spectrum (exact for a periodic field)."""
    rows, cols = field.shape
    spectrum = np.fft.fftshift(np.fft.fft2(field))
    padded = np.zeros((rows * factor, cols * factor), dtype=complex)
    r0, c0 = (rows * factor - rows) // 2, (cols * factor - cols) // 2
    padded[r0:r0 + rows, c0:c0 + cols] = spectrum
    return (np.fft.ifft2(np.fft.ifftshift(padded)).real * factor * factor).astype(np.float32)
