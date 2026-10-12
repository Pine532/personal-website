"""Derive each video's still from its own first frame, for both versions of the Sun.

Run from the project root:  .venv/bin/python scripts/make-stills.py
`npm run assets` runs this and then refreshes everything drawn from the stills.

Each still is frame 0 of its own video, so the still and the motion match when one replaces
the other. The footage is BT.709 and WebP is BT.601, so the frame goes through RGB using the
footage's own matrix; handing the video's YUV straight to the WebP encoder shifts the colors.
"""
import io
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image

from sun_media import MEDIA, SUNS, record_made, sha256, still_of

QUALITY = 80


def first_frame(video):
    png = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-i', str(video), '-frames:v', '1',
         '-vf', 'scale=in_color_matrix=bt709:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=rgb24',
         '-f', 'image2pipe', '-c:v', 'png', '-'],
        check=True, capture_output=True).stdout
    return Image.open(io.BytesIO(png))


def write_provenance(still, video, pixels, sun):
    """Sidecar saying what the still is and where it came from."""
    record = {
        'description': sun['still'],
        **sun['record'],
        **sun.get('still_record', {}),
        'dimensions': [pixels, pixels],
        'transforms': f"First decoded frame of {video.name} (BT.709 to RGB), WebP quality {QUALITY}. {sun['untouched']}",
    }
    Path(str(still) + '.json').write_text(json.dumps(record, indent=2) + '\n')


def main():
    taken_from = {}
    for sun in SUNS.values():
        for name in sun['videos']:
            video, still = MEDIA / name, still_of(name)
            if not video.exists():
                print(f'{name:28s} missing; skipped')
                continue
            frame = first_frame(video)
            frame.save(still, quality=QUALITY, method=6)
            write_provenance(still, video, frame.width, sun)
            taken_from[name] = sha256(video)
            print(f'{still.name:28s} {still.stat().st_size:>8,} bytes')
    # Which version of each video its still shows: a video replaced later needs its still made again.
    record_made('stills', taken_from)


if __name__ == '__main__':
    main()
