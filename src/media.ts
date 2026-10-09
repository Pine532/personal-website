import selection from './sun-source.json' with { type: 'json' };

// The Sun on this page exists in two versions: a simulation (scripts/sun/) and NASA's observation
// (scripts/footage/). sun-source.json chooses one; `npm run assets` then remakes the icons and the
// link-preview image from it, and the build publishes that version's files only. Each version comes
// in two sizes. One page view uses one size, so the
// hero, the closing Sun, and the preloads that config/site-metadata.ts writes into the page all
// agree, and nothing is downloaded twice.

export type SunSource = 'simulated' | 'observed';
export const SUN_SOURCE: SunSource = selection.source === 'observed' ? 'observed' : 'simulated';

const MEDIA = {
  simulated: {
    large: { source: '/media/sun-simulated-large.mp4', still: '/media/sun-simulated-large.webp', pixels: 2048 },
    small: { source: '/media/sun-simulated-small.mp4', still: '/media/sun-simulated-small.webp', pixels: 1280 },
    note: '/media/sun-simulation.txt',
  },
  observed: {
    large: { source: '/media/sun-aia304-desktop.mp4', still: '/media/sun-aia304-desktop.webp', pixels: 2048 },
    small: { source: '/media/sun-aia304-mobile.mp4', still: '/media/sun-aia304-mobile.webp', pixels: 1280 },
    note: '/media/solar-footage-source.txt',
  },
} as const;

export const SUN_VARIANTS = MEDIA[SUN_SOURCE];

/** Every file of a version: its videos, their stills, the stills' sidecars, and its note. */
const filesOf = ({ large, small, note }: (typeof MEDIA)[SunSource]) =>
  [large.source, small.source, large.still, small.still, `${large.still}.json`, `${small.still}.json`, note];
/** The files of the version that is not shown. config/site-metadata.ts keeps them out of the build. */
export const UNUSED_SUN_FILES = filesOf(MEDIA[SUN_SOURCE === 'simulated' ? 'observed' : 'simulated']);

// The public note on how the Sun was made, or where it came from and how it may be used.
export const SOURCE_NOTE = MEDIA[SUN_SOURCE].note;
// The NASA record of the observation: the footage itself, or what the simulation is modeled on.
export const NASA_RECORD = 'https://svs.gsfc.nasa.gov/11379/';

// Where the Sun sits in its pictures, as shares of half a picture's width. The hero's Sun shrinks
// into the header mark as the page scrolls (hooks/useSunDock.ts), and the two are framed
// differently, so they are matched by their discs, not by their frames.
/** Every video and still, of either version: the disc's edge is 812 px from the center of the
    2048 px frame (scripts/sun_media.py), and all but the faintest of its fringe has gone by 96%. */
export const SUN_FRAMING = { disc: 812 / 1024, fringe: 0.96 } as const;
/** public/media/sun-mark.webp: scripts/make-icons.py crops the frame to 1010 px either side of the center. */
export const MARK_FRAMING = { disc: 812 / 1010 } as const;

// The Sun's square is never wider than 640 CSS px (styles/hero.css), which the 1280-pixel files
// fill pixel for pixel on a 2x screen. The 2048-pixel files, about 4.8 MB more video, are kept for
// where those would fall visibly short: a screen denser than 2.25x, in a window large enough to
// show the Sun near its full size. Everywhere else the Sun is smaller than its pixels, or within a
// tenth of them (hooks/useSunDock.ts never enlarges the footage: short of pixels, it shows the Sun
// that much smaller).
export const LARGE_SUN_QUERY = '(min-width: 1281px) and (min-height: 880px) and (-webkit-min-device-pixel-ratio: 2.25)';

let chosen: (typeof SUN_VARIANTS)['large' | 'small'] | undefined;

/** The files for this page view. Chosen once: resizing, rotating, and docking never swap them. */
export function sunVariant() {
  chosen ??= matchMedia(LARGE_SUN_QUERY).matches ? SUN_VARIANTS.large : SUN_VARIANTS.small;
  return chosen;
}
