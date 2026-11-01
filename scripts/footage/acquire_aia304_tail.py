"""Step 2 (one-off): fetch source seconds 16-22 in three two-second requests.

    .venv/bin/python scripts/footage/acquire_aia304_tail.py --force

Short requests avoid the truncated response that cut prepare_aia304.py short. Only the
16-18 s part is used; the 18-20 s part contains the master's damaged frame.
"""
import subprocess
import sys

from common import FFMPEG, MASTER, SPLIT_AND_SCALE, WORK, require_force

QUALITY = {'desktop': 19, 'mobile': 20}

require_force(sys.argv, 'acquire_aia304_tail.py fetches seconds 16-22 of the master.')
for start in (16, 18, 20):
    command = [FFMPEG, '-hide_banner', '-loglevel', 'warning', '-ss', str(start), '-t', '2', '-i', MASTER,
               '-filter_complex', SPLIT_AND_SCALE]
    for variant, crf in QUALITY.items():
        command += ['-map', f'[{variant}]', '-an', '-c:v', 'libx264', '-crf', str(crf), '-preset', 'fast',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', str(WORK / f'part-{start}-{variant}.mp4')]
    subprocess.run(command, check=True)
    print(f'Acquired source seconds {start} to {start + 2}', flush=True)
