"""Step 1 (one-off): fetch source seconds 10-22 of the 4K master as two high-quality intermediates.

    .venv/bin/python scripts/footage/prepare_aia304.py --force

History: NASA's server closed the connection at about 16.5 s. The first 180 clean frames
(seconds 10-16) of the result are what finish_aia304.py uses; acquire_aia304_tail.py fetched
the rest. The master's frame at 18.2667 s is damaged, so nothing after 18 s is shipped.
"""
import subprocess
import sys

from common import FFMPEG, MASTER, SPLIT_AND_SCALE, WORK, require_force

CREDIT = ('NASA Goddard Space Flight Center/SDO; SVS 11379; AIA 304 angstrom false-color EUV observation time-lapse; '
          'source interval 10-22s; no crop, recoloring, interpolation, or synthetic motion; edited loop.')
# CRF per variant for the intermediates (visually lossless enough to re-encode from).
QUALITY = {'desktop': 19, 'mobile': 20}

require_force(sys.argv, 'prepare_aia304.py fetches seconds 10-22 of the master.')
WORK.mkdir(parents=True, exist_ok=True)
command = [FFMPEG, '-hide_banner', '-ss', '10', '-t', '12', '-i', MASTER, '-filter_complex', SPLIT_AND_SCALE]
for variant, crf in QUALITY.items():
    command += ['-map', f'[{variant}]', '-an', '-c:v', 'libx264', '-crf', str(crf), '-preset', 'fast',
                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-metadata', f'comment={CREDIT}',
                '-y', str(WORK / f'sun-aia304-{variant}.mp4')]
subprocess.run(command, check=True)
