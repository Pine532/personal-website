# Asset manifest

Where every image, video, and font on the site came from, and what was done to it.
Source and usage pages were last checked on September 16, 2026. The stills derived from the
NASA footage were remade on October 2, 2026. The simulated Sun was first made the same day, and
made again on October 17, 2026, as a whole sphere that turns; everything derived from it was
remade with it. Since the redesign of October 23, 2026 the page uses only the small (1280-pixel)
Sun files, and the build no longer publishes the large ones.

## The Sun the site shows: a simulation

Since October 2, 2026 the site shows a simulated Sun by default. It is a
computer model, not an observation. The whole
Sun is shown at every moment, as before. Since October 17, 2026 the model is a
map of the whole sphere, and the picture turns through it once in each loop.

- What it is: a model of the Sun as NASA's SDO shows it at 304 Å. A map of the whole sphere
  (4,992 × 2,496 pixels, wrapping around in longitude) holding a random magnetic network with
  twenty active regions and ten filaments, ten regions and five filaments on each half, placed
  by hand in an arrangement of the model's own; turbulence combed along a direction field (random
  over the quiet Sun, following the polarity lines and filaments near them); a sphere carrying a
  forest of short columns, a fringe of spicules that grows out of the rim, a glow, and a few small
  plumes; a turn of the sphere once per loop; and change that otherwise happens mostly in place.
  `scripts/sun/README.md` describes each step and its limits.
- What was taken from real data: measurements of one SDO frame, the first frame of the footage
  described in the next section (NASA's Goddard Space Flight Center/SDO, September 29, 2013). They
  are the brightness quantiles of each scale-and-orientation band of the frame, 1,430
  wavelet-scattering statistics for quiet and for active areas, and brightness quantiles at each
  height around the limb: 21,857 numbers in all, stored in `scripts/sun/reference/`. The model's
  map was adjusted toward them; on the finished map 84.5% of the statistics are within the
  tolerance the matching works to and 97.5% within twice it. **No pixel of any observation is in
  the picture**, the arrangement of its regions follows no observation, and the features on it
  do not exist on the Sun. The colors are SDO's 304 Å false-color table.
- What it is not: a physical simulation of plasma, a prediction, or a record of a real day.
- How close it is (`scripts/sun/realism.py`, a classifier that tells patches of two pictures
  apart by their wavelet-scattering statistics; 0.5 means it cannot, 1.0 that it always can;
  patches within 0.6 solar radii of disk center; measured October 17, 2026): the surface map
  scores 0.63 against the frame it was calibrated on, a rendered frame 0.84, and the far side,
  half a turn later, 0.82, where one picture in two forms scores 0.63 to 0.72. The finished video
  against the NASA video, decoded the same way: first frames (both keyframes) 0.87; frames from
  the middle of the loop 0.92 to 0.94, where the NASA video's own middle frames score 0.60 to
  0.63 against each other and the calibration frame 0.76 to 0.82 against them. Around the limb,
  the mean brightness at each height from 0.03 solar radii inside the edge to 0.18 outside it is
  within 2.2 units (of 255) of the calibration frame's in eight frames spread over the loop. All
  of this is about those statistics, not about what an expert eye would see; the README lists
  what such an eye would still notice.
- Motion: 480 frames at 30 fps, sixteen seconds, played at their own pace. Over the loop the
  sphere turns once about the upright axis through its middle, so its features cross the disk
  from left to right (see *The turn*, below). Besides that, bright fine detail flares and fades in
  place, clumps swell and dim, the detail shimmers by a fraction of a pixel, the fringe's
  spicules rise and vanish, and there is a little slow drift, on a cycle of eight seconds that
  repeats twice per turn. Every change is a whole number of cycles per loop, so the frames loop
  without a cut. Each frame carries fresh grain. The compressed files restart on their one
  keyframe: from the last frame to the first the picture changes 1.0 times as much as between
  neighbouring frames, so the restart does not show.
- Files: rendered at 2048 × 2048; the 1280 version is a Lanczos downsampling of the same frames.
  H.264/yuv420p from x264 with its grain tuning and mbtree off, CRF 28 (2048) and 30 (1280), slow
  preset; tagged BT.709 primaries and matrix with the sRGB transfer curve, limited range;
  fast-start; no audio. The MP4 comment says it is a simulation. Since October 23, 2026 the page
  shows only the 1280 files (`src/media.ts`), because the Sun in its corner is never more than
  about 252 CSS pixels across, picture and fringe included. The 2048 files stay in
  `public/media/`, where `npm run assets` makes the icons and the link-preview image from the
  2048 still, but the build leaves them out of `dist/` (`config/site-metadata.ts`).
- Stills: each video's own first frame, decoded with BT.709 and saved as WebP at quality 80 by
  `scripts/make-stills.py`, with a JSON sidecar that says it is a simulation and names NASA's
  record as what it was calibrated against (`calibratedAgainst`), not as its source.
- Reproducing it: `scripts/sun/README.md`. The surface and the frames are seeded and repeat
  exactly; the statistics-matching step runs on a GPU and gives the same layout and statistics
  but not the same pixels on another machine. The surface this build used is kept in
  `references/sun-globe-4992/` (not in version control).

| Shipping asset | Dimensions | Bytes | Role |
| --- | --- | --- | --- |
| `public/media/sun-simulated-large.mp4` | 2048 × 2048 | 18,912,381 | Kept, not published since October 23, 2026 (until then: large windows on screens denser than 2.25×) |
| `public/media/sun-simulated-small.mp4` | 1280 × 1280 | 5,876,744 | The simulation, on every screen where the footage plays (windows at least 701 CSS px wide and 500 tall) |
| `public/media/sun-simulated-large.webp` | 2048 × 2048 | 332,462 | First frame of the 2048 video: what the icons and the link-preview image are made from. Kept, not published since October 23, 2026 |
| `public/media/sun-simulated-small.webp` | 1280 × 1280 | 161,826 | First frame of the 1280 video: the still shown while the footage loads, on a phone, under reduced motion or data saving until Play, while the footage is paused, and where it fails |

The site publishes `public/media/sun-simulation.txt`, a plain-language version of this section,
and the credit under the Sun ("Rendered by me in Python · based on NASA SDO") links to NASA's
record of the footage the model was calibrated against. With the simulation
selected, the build publishes none of the NASA footage's files.

## The alternative: NASA SDO footage, AIA 304 Å

Set `src/sun-source.json` to `"observed"` (then `npm run assets`) and the site shows this footage
instead, with its own credit, note, stills, icons, and link-preview credit. Its files stay in
`public/media/` either way; the build publishes only the selected Sun's.

The complete Sun is shown at every moment, standing in the window's upper-right corner. (Until
October 23, 2026 it also opened the page beside the name, travelled to that corner as the page
scrolled, and came down at the end of the page to close it.) One native video owns observation
time; scrolling does not touch it. Nothing turns the picture: what moves in it is the real Sun's
own motion (see *The turn*, below).

- Source: [Filament Eruption Creates 'Canyon of Fire' on the Sun, NASA SVS 11379](https://svs.gsfc.nasa.gov/11379/), the standalone **SDO AIA 304 Frames and 4k ProRes**, not the narrated or composite movie.
- Credit: **NASA's Goddard Space Flight Center/SDO**. False-color AIA 304 Å extreme-ultraviolet observations from September 29–30, 2013; not live, real-time, or visible-light footage. No synthetic surface motion.
- Master: [SDO_2013-09-29_304_4k.mov](https://svs.gsfc.nasa.gov/vis/a010000/a011300/a011379/SDO_2013-09-29_304_4k.mov), decoded as **4096 × 4096, 30 fps, 32.8 seconds, ProRes 422 Standard, 10-bit**. The remote file is 4,681,123,327 bytes. It was sought remotely; the entire master was not downloaded.
- Selection preview: `references/aia304/preview.webm`, the [official streaming preview](https://svs.gsfc.nasa.gov/vis/a010000/a011300/a011379/SDO_2013-09-29_304_4k.webmhd.webm), 720 × 720 at 30 fps. It was inspected in full, together with a bounded high-resolution sample. The preview is neither upscaled nor shipped.
- Acquisition: the first bounded request (seconds 10–22) was cut off by the source connection at about 16.5 seconds. Only its first 180 clean frames (seconds 10–16) were kept. Separate two-second requests recovered seconds 16–18, 18–20, and 20–22. Source frame 548, at **18.2667 seconds**, has missing quadrants in both the official preview and the high-resolution source, so everything after 18 seconds was rejected rather than repaired or interpolated.
- Final interval: **source seconds 10–18**, frames **300–539 inclusive**: **240 frames, eight seconds, 30 fps**. Every delivered frame decodes with FFmpeg `-xerror`. Per-frame checks found no gaps or abrupt steps; a contact sheet of the whole interval and both loop end points were inspected by eye. At a 256-pixel inspection scale the visible red features span x = 6…247 and y = 19…236, leaving black at all four edges. That threshold supports visual inspection; it is not a claim about invisible emissions.
- Processing: native 4K source → Lanczos downsampling to 2048 and 1280 square with high-quality H.264 intermediates (CRF 19 and 20) → final H.264/yuv420p at CRF 26 and 25, slow preset, 30 fps, fast-start. Audio removed. On October 2, 2026 both final files were tagged as BT.709 primaries and matrix with the sRGB transfer curve, without re-encoding (every decoded frame is unchanged), so that browsers that decode in hardware show the video in the same colors as its still. Original palette retained. **No crop, rotation, recoloring, circular mask, edge feather, generated structure, sharpening, or frame interpolation.**
- Stills: each video's own first frame, decoded with the footage's BT.709 matrix and saved as WebP at quality 80 by `scripts/make-stills.py`. (The stills delivered in September were darker and redder than the footage, because the video's BT.709 values had been handed to the WebP encoder as BT.601; they are kept in `archive/site-before-2026-10-01/`.)
- Playback: the published source speed, so each loop takes **eight seconds**. The loop returns to its first frame with a direct cut: it is an **edited loop, not a seamless physical event**. No crossfade, reversal, or fabricated frames.
- Framing: `object-fit: contain`. The Sun stands in the window's upper-right corner, its disk 153 to 200 CSS pixels across on a window 1100 px wide or more (200 from 1440 px), 96 on a tablet, and 84 on a phone. The disk fills 79.3% of the picture's width, so the picture is at most about 252 CSS pixels across, which the 1280-pixel files fill without enlargement even on a 3× screen. Each picture is shown through a soft round mask applied by the page (`src/styles/sun.css`): whole out to 80% of the way from its center to the frame's edge, just past the disk's edge at 79.3%, then fading, and gone by 95%, so the frame's black corners never show. Over the light About section the mask is drawn in to the disk (gone by 82.5%), because there the dark of the faint outer fringe would show as a halo. The files themselves are not masked. The footage is shown wherever the Sun's disk is at least 96 CSS pixels across, in windows at least 701 CSS pixels wide and 500 tall; a phone's corner (84 pixels) shows the still and loads no video.
- Which files a visitor gets (either Sun): since October 23, 2026, the 1280-pixel pair everywhere (`src/media.ts`); the build leaves the 2048-pixel pair out of `dist/`. Until then the 2048-pixel pair went to windows at least 1281 CSS pixels wide and 880 tall on screens denser than 2.25×, when the Sun's square could be up to 640 CSS pixels wide in the opening.
- Lifecycle (either Sun): one video element and one source for the visit. The still stays invisible until all of it has loaded, then resolves from coarse blocks in four steps of 90 ms (the still itself drawn 6, 12, 24, and 48 pixels square into a canvas shown pixelated; no file), except under reduced motion, where it appears at once. The video is fetched only once motion is wanted, loads beneath the still, and is shown once it is playing, from its first frame. Playback pauses on request (the Pause control under the Sun, or the terminal's `sun pause`), which puts the still back, and when the tab is hidden. Reduced motion and a data-saving browser start on the still, which does not move, and load no video until Play is chosen. Blocked autoplay leaves the still and offers Play; a failed video leaves the still and offers Retry.

| Shipping asset | Dimensions | Bytes | Role |
| --- | --- | --- | --- |
| `public/media/sun-aia304-desktop.mp4` | 2048 × 2048 | 11,517,474 | Kept, not published since October 23, 2026 (until then: large windows on screens denser than 2.25×) |
| `public/media/sun-aia304-mobile.mp4` | 1280 × 1280 | 5,324,544 | The footage, on every screen where it plays (windows at least 701 CSS px wide and 500 tall) |
| `public/media/sun-aia304-desktop.webp` | 2048 × 2048 | 335,632 | First frame of the 2048 footage: what the icons and the link-preview image are made from when this Sun is selected. Kept, not published since October 23, 2026 |
| `public/media/sun-aia304-mobile.webp` | 1280 × 1280 | 176,496 | First frame of the 1280 footage: the still shown while the footage loads, on a phone, under reduced motion or data saving until Play, while the footage is paused, and where it fails |

The stills carry JSON sidecars naming their source; the MP4 comment metadata names the source,
interval, and treatment. With this Sun selected, the caption under the Sun reads "Edited loop ·
source & usage" and links to `public/media/solar-footage-source.txt`, a plain-language version of
this section. (The fuller on-page credit kept in `src/content.ts`, "NASA Goddard / SDO · AIA
304 Å", with its link to the NASA source record, is not shown by the page as redesigned on
October 23, 2026.)

**Reproducing the files.** `scripts/footage/` holds the four steps for the videos (see its README).
On October 1, 2026, `finish_aia304.py` reproduced both shipped videos byte for byte from the
intermediates in `references/aia304/`, and `inspect_aia304.py` reproduced the stored
`frame-inspection.json`. Since October 2 the script also writes the color tags; its output, the
shipped files, and `references/aia304/final-*.mp4` are the tagged versions, and their decoded
frames match the October 1 files' (`references/aia304/*-framemd5.txt`). `npm run assets` remakes
the stills and everything derived from them.

## The turn

The simulated Sun turns about the upright axis through its middle, once in each sixteen-second
loop, so its features come in at the left edge, cross the disk, and go out at the right. The turn
is in the frames themselves (`scripts/sun/`); the page turns nothing. It is the page's own motion,
chosen for the look of it, and it comes from no data: the real Sun turns the same way, about an
axis that lies across this view, once in about twenty-seven days, so this is about 150,000 times
as fast. No observation is used for any of its pixels. The NASA footage does not turn: what moves in it is
the real Sun's own motion, sped up by the time-lapse. Both published notes
(`public/media/sun-simulation.txt` and `public/media/solar-footage-source.txt`) say the same.
The Pause control under the Sun, or the terminal's `sun pause`, stops either. The still each Sun
shows under reduced motion is its loop's first frame, and it does not move.

## Images derived from the first frame

The icons and the link-preview image come from the 2048-pixel still of the Sun the site shows:
now `public/media/sun-simulated-large.webp` (with the NASA footage selected,
`public/media/sun-aia304-desktop.webp`), which stays in `public/media/` for them although the build
no longer publishes it. Each shows the whole Sun. Nothing is recolored or
sharpened; the sidecars and the link-preview image carry the credit of the Sun they were made from.

| Asset | Size | Role | Treatment |
| --- | --- | --- | --- |
| `public/favicon.ico`, `public/favicon-32.png` | 16–48 px | Browser tab and bookmark icons | Square crop of nearly the whole frame, Lanczos downsampling. Outside the limb, the black sky is converted to transparency from pixel brightness so the icon sits on light or dark browser chrome; the disk itself is untouched. |
| `public/apple-touch-icon.png`, `public/icon-192.png`, `public/icon-512.png` | 180, 192, 512 px | iOS and Android home-screen icons | Nearly the whole frame on black, Lanczos downsampling, with room so rounded or circular masks never cut the corona. |
| The Sun in the window's upper-right corner | — | The page's only Sun since October 23, 2026, fixed there: 153 to 200 CSS px across on a window 1100 px wide or more, 96 px on a tablet, 84 px on a phone | No file of its own: the 1280-pixel still and video, scaled down by the browser. While the still loads in, the still itself is drawn into a small canvas in coarse blocks (no file). (An 81 px picture of the Sun, `public/media/sun-mark.webp`, stood in the header until October 8, 2026. It and its sidecar have been removed, and `scripts/make-icons.py` no longer makes it.) |
| `public/og-image.jpg` | 1200 × 630 | Link-preview image | The whole frame beside the name set in Manrope, rendered from `scripts/share-card.html`. The credit is part of the image: "Simulated Sun, modeled on NASA SDO imagery" for the simulation, "Solar image: NASA Goddard / SDO" for the footage. |

Made by `scripts/make-icons.py` and `scripts/make-share-image.mjs` (`npm run assets`).

## Usage terms

[NASA Image and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/),
checked September 16, 2026, permit NASA content on informational and personal web pages with
acknowledgment, subject to their conditions and third-party rights, and prohibit implying
endorsement. The selected observation record credits NASA Goddard/SDO and identifies no
third-party rights. No music, NASA logo, identifiable person, or endorsement claim is included.
The simulated Sun is original work made for this site. It uses measurements of one NASA frame
and NASA's color table for this channel; it is not NASA imagery, carries no NASA credit as its
source, and is not presented as endorsed by or originating from NASA.
This manifest records the terms as checked; it does not claim an exclusive license to
government imagery.

## Font

Two typefaces, each from its package and served with the site. No remote font service is
contacted at runtime.

- **Manrope Variable**, the statements and the reading type: self-hosted from
  `@fontsource-variable/manrope` 5.3.0. Copyright 2019 The Manrope Project Authors. SIL Open Font
  License 1.1; the full license ships as `public/media/manrope-OFL.txt`. Repository:
  https://github.com/sharanda/manrope. Only the Latin and Latin Extended subsets are declared
  (`src/styles/fonts.css`).
- **Geist Mono Variable**, the labels, the terminal, and the small print (since October 23,
  2026): self-hosted from `@fontsource-variable/geist-mono` 5.3.0. Copyright 2024 The Geist
  Project Authors (https://github.com/vercel/geist-font). SIL Open Font License 1.1; the full
  license ships as `public/media/geist-mono-OFL.txt`. The Latin and Latin Extended subsets are
  declared, and the symbols subset for its box-drawing and block characters, which the
  terminal's `tree` and `whoami` print (`src/styles/fonts.css`, with the package's own ranges).

## Résumé

`public/owen-sun-zhang-resume.pdf` is the résumé without its phone number, derived from
the private `Owen_Sun_Zhang_Resume.pdf` on October 2, 2026. See the README.

## History

The current Sun, the simulation, is the fifth. The fourth, the NASA AIA 304 Å footage, is still
in the project as the alternative. The three before it (a cropped coronal-rain video, a Solar
Orbiter still with a WebGL shader, and whole-Sun AIA 171 Å footage) are documented in
`archive/ASSET_HISTORY.md`, with their media and scripts beside it. None of that is built or
deployed.

Until October 23, 2026 the Sun opened the page beside the name, rode up into the window's
corner, lit the letters, and came down again to close the page in Contact, where a second
picture of it, the closing box's own Sun, stood on narrower windows; the light's tone was drawn
through a 48 × 48 tile of random noise made by `scripts/make-grain.py`, from no image. The
journeys, the closing Sun, the light, and the tile are gone, and the script has been deleted; the
site as it was is kept in `archive/site-before-terminal-2026-10-23/`.
