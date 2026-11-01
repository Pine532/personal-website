"""Shared settings for the hero footage scripts. Run every script from the project root."""
from pathlib import Path

import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
# NASA Goddard Space Flight Center/SDO, "Filament Eruption Creates 'Canyon of Fire' on the Sun"
# (SVS 11379): the standalone AIA 304 Å sequence, a 4096 x 4096, 30 fps ProRes master.
MASTER = 'https://svs.gsfc.nasa.gov/vis/a010000/a011300/a011379/SDO_2013-09-29_304_4k.mov'
# Intermediates, delivery files, and inspection evidence all live here.
WORK = Path('references/aia304')
# One master decode, downsampled with Lanczos to both delivery sizes (2048 and 1280 square).
SPLIT_AND_SCALE = '[0:v]split=2[d][m];[d]scale=2048:2048:flags=lanczos[desktop];[m]scale=1280:1280:flags=lanczos[mobile]'


def require_force(argv, what):
    """The acquisition scripts replace irreplaceable local sources, so they need --force."""
    if '--force' not in argv:
        raise SystemExit(f'{what}\nThis is a one-off acquisition kept for provenance. It downloads from NASA and '
                         f'overwrites files in {WORK}/ that the shipped footage was built from. Re-run with --force '
                         'only if you mean to replace them.')
