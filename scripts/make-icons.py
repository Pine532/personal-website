"""Derive the favicon and the app icons from the hero's first frame.

Run from the project root:  .venv/bin/python scripts/make-icons.py

Source: the large still of whichever Sun src/sun-source.json selects (see ASSET_MANIFEST.md).
The frame is cropped square around the disk's center and downsampled with Lanczos. Nothing is
recolored or sharpened. Where an icon needs a transparent background, the black sky is
converted to transparency from the image's own brightness; the disk itself is left untouched.
"""
import math

from PIL import Image

from sun_media import ACTIVE, ROOT, SUNS, record_made, sha256, still_of

SUN = SUNS[ACTIVE]
SOURCE = still_of(SUN['videos'][0])
PUBLIC = ROOT / 'public'

# In the 2048 px frame: disk center and limb radius, in pixels.
CENTER_X, CENTER_Y, LIMB_RADIUS = SUN['disk']
# Half-width of the square crop: nearly the whole frame. Prominences reach about 940 px from the
# center and their glow further still, so a tighter crop would end that glow in a straight edge.
HALF = 1010


def crop(source, half):
    return source.crop((CENTER_X - half, CENTER_Y - half, CENTER_X + half, CENTER_Y + half))


def key_out_sky(image, opaque_radius=None):
    """Turn the black sky transparent: alpha is each pixel's brightest channel, and the color is
    divided back out, so the result over black equals the source. Inside opaque_radius the disk
    stays fully opaque, which keeps it legible on light browser chrome."""
    image = image.convert('RGB')
    width, height = image.size
    keyed = Image.new('RGBA', image.size)
    source, target = image.load(), keyed.load()
    for y in range(height):
        for x in range(width):
            red, green, blue = source[x, y]
            if opaque_radius is not None and math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) <= opaque_radius:
                target[x, y] = (red, green, blue, 255)
                continue
            alpha = max(red, green, blue)
            target[x, y] = (0, 0, 0, 0) if alpha == 0 else tuple(min(255, c * 255 // alpha) for c in (red, green, blue)) + (alpha,)
    return keyed


def favicon(frame, size):
    # Key at four times the size, then reduce, so the limb stays smooth at 16 to 32 px.
    large = frame.resize((size * 4, size * 4), Image.LANCZOS)
    keyed = key_out_sky(large, opaque_radius=LIMB_RADIUS / HALF * (size * 2) - 2)
    return keyed.resize((size, size), Image.LANCZOS)


def main():
    source = Image.open(SOURCE).convert('RGB')
    frame = crop(source, HALF)

    # Browser tabs and bookmarks: transparent sky, so the Sun sits on light or dark chrome.
    favicon(frame, 32).save(PUBLIC / 'favicon-32.png', optimize=True)
    favicon(frame, 48).save(PUBLIC / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

    # Home-screen icons for iOS and Android: opaque black tiles. Rounded or circular masks
    # never reach the corona (the 512 tile keeps the Sun inside Android's 80% safe circle).
    frame.resize((180, 180), Image.LANCZOS).save(PUBLIC / 'apple-touch-icon.png', optimize=True)
    for size, inset in ((192, 8), (512, 56)):
        tile = Image.new('RGB', (size, size), (0, 0, 0))
        tile.paste(source.resize((size - 2 * inset, size - 2 * inset), Image.LANCZOS), (inset, inset))
        tile.save(PUBLIC / f'icon-{size}.png', optimize=True)

    record_made('icons', {'sun': ACTIVE, 'still': sha256(SOURCE)})
    print(f'icons made from {SOURCE.name} ({ACTIVE})')

    for name in ('favicon.ico', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'):
        print(f'{name:24s} {(PUBLIC / name).stat().st_size:>7,} bytes')


if __name__ == '__main__':
    main()
