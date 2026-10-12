"""Encode rendered frames as the looping H.264 file the site plays.

    python encode.py <frames dir> <out.mp4> [--crf N] [--size PIXELS] [--ffmpeg PATH]

The frames are sRGB pictures. They are converted with the BT.709 matrix, which scripts/make-stills.py
uses to take the still back out, and the file says what it holds: BT.709 primaries and matrix, the
sRGB transfer curve, limited range. Without the transfer tag a browser that decodes video in hardware
assumes a slightly different curve and shows the video brighter than its still.

The rendered frames loop exactly. A compressed file cannot quite: it starts on its one keyframe,
which is a little crisper than the frames before it. The settings below keep the quality even
along the loop so that this refresh stays small, and the script reports how large it is.

The frames are full of fine, flickering detail and fresh grain. With x264's usual settings the
frames between keyframes lose much of it and the texture changes character; its grain tuning keeps
it, and at CRF 26 the files are no larger than the usual settings give at CRF 23. A file of 1280 px
or less is for screens that show it at no more than its own size, and gets CRF 28: about 5 MB.
"""
import argparse
import subprocess
from pathlib import Path

FRAMES = 240
NOTE = ('Simulated Sun: a computer-generated model, not an observation. Magnetic-network model with texture '
        'statistics calibrated against one NASA SDO AIA 304 frame; 240 frames at 30 fps; the frames loop without a cut.')
# Keep the texture (-tune grain), and keep the quality even along the loop: no frame borrows bits from the
# frames after it (mbtree), which would leave the last frames before the loop point the softest.
TUNE = ['-tune', 'grain']
EVEN_QUALITY = 'mbtree=0'
TAGS = 'setparams=color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709:range=tv'


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return 'ffmpeg'


def encode(frames, output, crf, tool, size=None):
    frames = Path(frames)
    count = len(list(frames.glob('[0-9][0-9][0-9].png')))
    if count != FRAMES:
        raise SystemExit(f'{frames}: expected {FRAMES} frames, found {count}')
    resize = f'scale={size}:{size}:flags=lanczos,' if size else ''
    command = [tool, '-hide_banner', '-loglevel', 'warning', '-framerate', '30', '-i', str(frames / '%03d.png'),
               '-vf', resize + 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,' + TAGS,
               '-an', '-c:v', 'libx264', '-crf', str(crf), '-preset', 'slow', *TUNE, '-x264-params', EVEN_QUALITY,
               '-r', '30', '-fps_mode', 'cfr', '-movflags', '+faststart', '-metadata', f'comment={NOTE}', '-y', str(output)]
    subprocess.run(command, check=True)
    # Decode every frame; -xerror turns any decode problem into a failure.
    checked = subprocess.run([tool, '-v', 'error', '-xerror', '-i', str(output), '-map', '0:v', '-f', 'framemd5', '-'],
                             check=True, capture_output=True, text=True)
    decoded = [line for line in checked.stdout.splitlines() if line and not line.startswith('#')]
    assert len(decoded) == FRAMES, len(decoded)
    print(f'{output}: {len(decoded)} decoded frames, {Path(output).stat().st_size:,} bytes')
    seam = loop_seam(output, tool, size or picture_size(frames / '000.png'))
    if seam:
        print(f'  loop point: the last frame to the first changes {seam:.1f} times as much as one frame to the next')


def picture_size(png):
    """The width of a PNG, from its header."""
    with open(png, 'rb') as handle:
        return int.from_bytes(handle.read(24)[16:20], 'big')


def loop_seam(output, tool, side):
    """How much the picture changes from the last frame to the first, as a multiple of the usual change
    from one frame to the next: brightness, at the file's own size, on the disk. None without NumPy."""
    try:
        import numpy as np
    except ImportError:
        return None
    y, x = np.mgrid[0:side, 0:side]
    disk = np.hypot(x - (side - 1) / 2, y - (side - 1) / 2) < 0.95 * (812 / 1024) * side / 2
    decoder = subprocess.Popen([tool, '-v', 'error', '-i', str(output), '-vf', 'format=gray', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    first = previous = None
    steps = []
    while True:
        raw = decoder.stdout.read(side * side)
        if len(raw) < side * side:
            break
        frame = np.frombuffer(raw, dtype=np.uint8).reshape(side, side)[disk].astype(np.float32)
        if previous is None:
            first = frame
        else:
            steps.append(np.abs(frame - previous).mean())
        previous = frame
    decoder.wait()
    return float(np.abs(first - previous).mean() / np.median(steps))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('frames')
    parser.add_argument('output')
    parser.add_argument('--crf', type=int, default=None, help='x264 quality: lower is better and larger (default 26, or 28 at 1280 px or less)')
    parser.add_argument('--ffmpeg', default=None, help="the ffmpeg to use (default: imageio-ffmpeg's, else the one on the PATH)")
    parser.add_argument('--size', type=int, default=None, help='resize the frames to this many pixels square (Lanczos)')
    args = parser.parse_args()
    crf = args.crf if args.crf is not None else (28 if args.size and args.size <= 1280 else 26)
    encode(args.frames, args.output, crf, args.ffmpeg or ffmpeg(), args.size)
