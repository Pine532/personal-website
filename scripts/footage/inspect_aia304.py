"""Step 4: inspect every delivered frame for clipping, gaps, and abrupt jumps.

    .venv/bin/python scripts/footage/inspect_aia304.py [--out DIR]

Reads references/aia304/final-desktop.mp4 at 256 x 256 and asserts that the visible Sun never
touches the frame edge, that no frame is dark or missing, and that no adjacent pair jumps.
Writes frame-inspection.json, a contact sheet (chosen-interval.jpg) and the two loop
end-point frames to DIR (default references/aia304).
"""
import argparse
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

from common import FFMPEG, WORK

SIZE = 256
RED_THRESHOLD = 32   # a pixel this red or redder counts as visible Sun
DARK_FRAME = 40      # mean brightness below this means an incomplete frame
ABRUPT_STEP = 5      # mean change between neighbors above this means a jump
EXPECTED_FRAMES = 240
SOURCE_START_SECONDS = 10
FPS = 30

parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument('--out', type=Path, default=WORK, help='directory for the inspection outputs')
out = parser.parse_args().out
out.mkdir(parents=True, exist_ok=True)
video = WORK / 'final-desktop.mp4'


def mean_brightness(image):
    return sum(ImageStat.Stat(image).mean) / 3


decoder = subprocess.Popen([FFMPEG, '-v', 'error', '-xerror', '-i', str(video), '-vf', f'scale={SIZE}:{SIZE}',
                            '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
frames, bounds, steps, means = [], [], [], []
while True:
    data = decoder.stdout.read(SIZE * SIZE * 3)
    if not data:
        break
    assert len(data) == SIZE * SIZE * 3
    frame = Image.frombytes('RGB', (SIZE, SIZE), data)
    box = frame.getchannel('R').point(lambda value: 255 if value >= RED_THRESHOLD else 0).getbbox()
    # The whole Sun, prominences included, must sit inside the frame with black on every side.
    assert box and box[0] > 0 and box[1] > 0 and box[2] < SIZE and box[3] < SIZE, (len(frames), box)
    means.append(mean_brightness(frame))
    if frames:
        steps.append(mean_brightness(ImageChops.difference(frames[-1], frame)))
    frames.append(frame)
    bounds.append(box)
assert decoder.wait() == 0
assert len(frames) == EXPECTED_FRAMES, len(frames)
assert min(means) > DARK_FRAME, 'Incomplete or dark observation frame'
assert max(steps) < ABRUPT_STEP, 'Abrupt in-sequence image jump'

report = {
    'frames': len(frames),
    'seconds': len(frames) / FPS,
    'sampleResolution': SIZE,
    'redThreshold': RED_THRESHOLD,
    'visibleFeatureUnion': [min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)],
    'frameMeanRange': [min(means), max(means)],
    'anomalousFrames': [{'frame': index, 'sourceSecond': SOURCE_START_SECONDS + index / FPS, 'mean': mean}
                        for index, mean in enumerate(means) if mean < DARK_FRAME],
    'largeSteps': [{'frame': index + 1, 'meanChange': step} for index, step in enumerate(steps) if step > ABRUPT_STEP],
    'adjacentMeanRGBChangeRange': [min(steps), max(steps)],
    'returnCutMeanRGBChange': mean_brightness(ImageChops.difference(frames[-1], frames[0])),
    'note': 'Threshold bounds support visual inspection, not a claim about invisible coronal emissions. '
            'The direct loop return is an edit, not a seamless physical event.',
}
(out / 'frame-inspection.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))

quiet = [FFMPEG, '-hide_banner', '-loglevel', 'warning', '-i', str(video)]
subprocess.run(quiet + ['-vf', 'fps=2,scale=320:320,tile=4x4', '-frames:v', '1', '-y', str(out / 'chosen-interval.jpg')], check=True)
subprocess.run(quiet + ['-vf', r'select=eq(n\,0)+eq(n\,239),scale=720:720', '-fps_mode', 'vfr', '-y', str(out / 'endpoint-%02d.png')], check=True)
