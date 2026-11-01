"""Step 3: assemble the verified 10-18 s interval and encode the delivery files.

    .venv/bin/python scripts/footage/finish_aia304.py [--out DIR]

Joins the first 180 frames of sun-aia304-{variant}.mp4 (seconds 10-16) with the 60 frames of
part-16-{variant}.mp4 (seconds 16-18), encodes H.264 for the web, and confirms that all 240
frames decode. Writes final-{variant}.mp4 and {variant}-framemd5.txt to DIR
(default references/aia304).
"""
import argparse
import subprocess
from pathlib import Path

from common import FFMPEG, WORK

CREDIT = ('NASA Goddard Space Flight Center/SDO; SVS 11379; standalone AIA 304 false-color EUV time-lapse; '
          'source 10-18s; 30fps; original palette; no crop, synthetic motion or interpolation; edited loop.')
# Delivery CRF per variant.
QUALITY = {'desktop': 26, 'mobile': 25}
# What the file says it holds: BT.709 primaries and matrix, the sRGB transfer curve, limited range. The picture
# data is the same with or without these tags; without the transfer tag a browser that decodes video in
# hardware assumes a slightly different curve and shows the video brighter than its still.
TAGS = 'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv'
# Frames taken from each input, in order.
PARTS = [('sun-aia304-{variant}.mp4', 180), ('part-16-{variant}.mp4', 60)]
EXPECTED_FRAMES = 240

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--out', type=Path, default=WORK, help='directory for the encoded files')
out = parser.parse_args().out
out.mkdir(parents=True, exist_ok=True)

for variant, crf in QUALITY.items():
    inputs = [WORK / name.format(variant=variant) for name, _ in PARTS]
    for path in inputs:
        if not path.is_file():
            raise FileNotFoundError(path)
    trims = ';'.join(f'[{index}:v]trim=end_frame={frames},setpts=PTS-STARTPTS[v{index}]'
                     for index, (_, frames) in enumerate(PARTS))
    filters = f'{trims};[v0][v1]concat=n=2:v=1:a=0,{TAGS}[v]'
    output = out / f'final-{variant}.mp4'
    command = [FFMPEG, '-hide_banner', '-loglevel', 'warning']
    for path in inputs:
        command += ['-i', str(path)]
    command += ['-filter_complex', filters, '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', str(crf),
                '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', '30', '-fps_mode', 'cfr',
                '-movflags', '+faststart', '-metadata', f'comment={CREDIT}', '-y', str(output)]
    subprocess.run(command, check=True)

    # Decode every frame; -xerror turns any decode problem into a failure.
    checked = subprocess.run([FFMPEG, '-v', 'error', '-xerror', '-i', str(output), '-map', '0:v', '-f', 'framemd5', '-'],
                             check=True, capture_output=True, text=True)
    frames = [line for line in checked.stdout.splitlines() if line and not line.startswith('#')]
    assert len(frames) == EXPECTED_FRAMES, (variant, len(frames))
    (out / f'{variant}-framemd5.txt').write_text(checked.stdout)
    print(f'{output}: {len(frames)} decoded frames, {output.stat().st_size:,} bytes', flush=True)
