# Hero footage pipeline

How `public/media/sun-aia304-desktop.mp4` and `sun-aia304-mobile.mp4` were made. Run each script
from the project root with the project's Python environment
(`python3 -m venv .venv && .venv/bin/pip install -r scripts/requirements.txt`).

| Step | Script | What it does |
| --- | --- | --- |
| 1 | `prepare_aia304.py --force` | One-off. Fetches source seconds 10-22 of NASA's 4K master as high-quality intermediates. |
| 2 | `acquire_aia304_tail.py --force` | One-off. Fetches seconds 16-22 in short requests after step 1 was cut off by the server. |
| 3 | `finish_aia304.py` | Joins the clean frames for seconds 10-18 (240 frames), encodes the delivery files, and checks that every frame decodes. |
| 4 | `inspect_aia304.py` | Checks every frame: the whole Sun inside the frame, no dark frames, no jumps. |

Steps 1 and 2 download from NASA and replace the retained intermediates in `references/aia304/`,
which is why they refuse to run without `--force`. Steps 3 and 4 only read those intermediates.

Verified on 2026-10-01: step 3 reproduced both shipped videos byte for byte, and step 4
reproduces the stored `references/aia304/frame-inspection.json`. On 2026-10-02 step 3 gained
color tags (BT.709 primaries and matrix, sRGB transfer, limited range), so that a browser shows
the video in the same colors as its still, and the shipped videos were written again by it: 19
bytes longer each, with decoded frames identical to the earlier files' (the frame checksums in
`references/aia304/*-framemd5.txt` did not change).

After checking new footage, copy `references/aia304/final-{desktop,mobile}.mp4` to
`public/media/sun-aia304-{desktop,mobile}.mp4`, then run `npm run assets`: it takes each video's
first frame as its still (`scripts/make-stills.py`) and, when `src/sun-source.json` selects the
footage, remakes the icons and the link-preview image from it. (With the simulated Sun
selected, those two come from the simulation.)
