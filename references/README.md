# References

Source media downloaded or extracted while the hero was being developed, and the simulated Sun's
intermediate files. Nothing here is served to visitors, and the folder is kept out of version
control because of its size. Credits and usage terms for each source are in
`../ASSET_MANIFEST.md` and `../archive/ASSET_HISTORY.md`.

| Files | Used by |
| --- | --- |
| `sun-globe-4992/` | **The current hero, the simulated Sun.** The map of the whole sphere the shipped videos were rendered from (`surface.npy`, 4,992 × 2,496), the map it started as (`surface-start.npy`), and the model's direction fields (`fields.npz`), with the prepared maps and the 480 frames beside them (about 5.4 GB in all). `scripts/sun/render.py all` turns the three files back into the 480 frames in about 45 minutes; without them, `scripts/sun/surface.py` and `scripts/sun/texture_match.py` have to be run again (about 2.5 hours), which on another machine gives a slightly different Sun. See `../scripts/sun/README.md`. |
| `sun-simulation/` | The simulated Sun of October 2, 2026: a square map of one hemisphere that did not turn. The present scripts no longer read it; it is kept for comparison. |
| `aia304/` | **The alternative hero, the NASA footage.** High-quality intermediates cut from NASA's 4K AIA 304 Å master, the assembled delivery files (`final-*.mp4`, identical to `public/media/sun-aia304-*.mp4`), the frame inspection evidence, and the VMAF quality logs of the two delivery files. `scripts/footage/` reads and writes here. |
| `full-sun-source.mp4`, `full-sun-preview*`, `full-sun-highres.jpg`, `full-sun-samples/` | Hero v3 (AIA 171 Å whole Sun), now in `archive/hero-v3-aia171-full-sun/`. |
| `solar-orbiter-12544.jpg` | Hero v2 (Solar Orbiter still with a WebGL shader), now in `archive/hero-v2-solar-orbiter-webgl/`. |
| `nasa-coronal-rain-*`, `solar-crop.mp4`, `crop-frame.jpg`, `footage-contact.jpg`, `desktop-poster.png`, `mobile-poster.png`, `nasa-304-original.jpg`, `nasa-171-original.jpg`, `nasa-golden-arches.jpg` | Hero v1 (cropped coronal-rain video) and the candidates inspected for it, now in `archive/hero-v1-coronal-rain-video/`. |
