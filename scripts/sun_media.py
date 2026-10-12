"""Which Sun the site shows, and the media files of both versions (mirrors src/media.ts)."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MEDIA = ROOT / 'public/media'
ACTIVE = json.loads((ROOT / 'src/sun-source.json').read_text())['source']
NASA_RECORD = 'https://svs.gsfc.nasa.gov/11379/'

# For each Sun: its videos (large first), what the sidecars of its images say, and where the disk is.
SUNS = {
    'simulated': {
        'videos': ['sun-simulated-large.mp4', 'sun-simulated-small.mp4'],
        'kind': 'A simulation, not an observation.',
        'still': ("A simulation, not an observation: a model of the Sun's magnetic network whose texture statistics were "
                  'calibrated against one NASA SDO AIA 304 frame (see scripts/sun/). The first frame of the simulated video.'),
        # NASA's record is what the model was calibrated against, not where the picture came from.
        'record': {
            'origin': 'scripts/sun/',
            'calibratedAgainst': NASA_RECORD,
            'credit': 'Simulated for this site; calibrated against NASA Goddard Space Flight Center/SDO imagery',
        },
        'untouched': 'No crop, rotation, or recoloring.',
        # Disk center and limb radius in the 2048 px frame.
        'disk': (1024, 1024, 812),
    },
    'observed': {
        'videos': ['sun-aia304-desktop.mp4', 'sun-aia304-mobile.mp4'],
        'kind': 'Sourced observation, not generated imagery.',
        'still': ('Sourced observation, not generated imagery. NASA Goddard Space Flight Center/SDO, standalone AIA 304 '
                  'false-color EUV time-lapse, SVS 11379. The first frame of the delivered footage.'),
        'record': {
            'origin': 'https://svs.gsfc.nasa.gov/vis/a010000/a011300/a011379/SDO_2013-09-29_304_4k.mov',
            'sourceRecord': NASA_RECORD,
            'credit': 'NASA Goddard Space Flight Center/SDO',
        },
        'still_record': {'sourceIntervalSeconds': [10, 18]},
        'untouched': 'No crop, rotation, recoloring, or generated structure.',
        'disk': (1025, 1024, 812),
    },
}


def still_of(video_name):
    return MEDIA / (Path(video_name).stem + '.webp')


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def record_made(what, source):
    """Note in src/sun-assets.json what `what` was just made from. The build (config/site-metadata.ts)
    refuses to run while a still, the icons, or the link-preview image come from anything but the
    selected Sun's current files."""
    path = ROOT / 'src/sun-assets.json'
    made = json.loads(path.read_text()) if path.exists() else {}
    made[what] = source
    path.write_text(json.dumps(made, indent=2) + '\n')
