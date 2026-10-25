import selection from './sun-source.json' with { type: 'json' };

// The Sun on this page exists in two versions: a simulation (scripts/sun/) and NASA's observation
// (scripts/footage/). sun-source.json chooses one; `npm run assets` then remakes the icons and the
// link-preview image from it, and the build publishes that version's files only. Each version comes
// in two sizes; the page shows the Sun in the window's corner, at most 200 CSS px across
// (styles/sun.css), so it uses the small one everywhere and only that one is published.

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
/** The Sun's files: the video and its still, the loop's first frame. */
export const SUN_MEDIA = SUN_VARIANTS.small;

/** Every file of a version: its videos, their stills, the stills' sidecars, and its note. */
const filesOf = ({ large, small, note }: (typeof MEDIA)[SunSource]) =>
  [large.source, small.source, large.still, small.still, `${large.still}.json`, `${small.still}.json`, note];
/** The files the page does not use: the other version's, and the shown version's large size (its still
    stays in public/, where `npm run assets` makes the icons from it). config/site-metadata.ts keeps them
    out of the build. */
export const UNUSED_SUN_FILES = [
  ...filesOf(MEDIA[SUN_SOURCE === 'simulated' ? 'observed' : 'simulated']),
  SUN_VARIANTS.large.source, SUN_VARIANTS.large.still, `${SUN_VARIANTS.large.still}.json`,
];

// The public note on how the Sun was made, or where it came from and how it may be used.
export const SOURCE_NOTE = MEDIA[SUN_SOURCE].note;
// The NASA record of the observation: the footage itself, or what the simulation is modeled on.
export const NASA_RECORD = 'https://svs.gsfc.nasa.gov/11379/';

/** Where the Sun sits in its pictures, as shares of half a picture's width: the disc's edge is 812 px
    from the center of the 2048 px frame (scripts/sun_media.py), and all but the faintest of its fringe
    has gone by 96%. styles/sun.css sizes the picture from the disc by the first figure. */
export const SUN_FRAMING = { disc: 812 / 1024, fringe: 0.96 } as const;
