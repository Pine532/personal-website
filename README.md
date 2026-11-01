# Owen Sun Zhang — personal website

A single-page portfolio built around the Sun, because Sun is Owen's middle name. The page is
dark and laid out on four columns across the whole window, with small labels in Geist Mono and
large statements in Manrope. It opens on a short statement and, beneath it, a terminal: a shell
whose files are the portfolio, so `ls`, `cd projects` and `cat about.txt` read the same facts as
the page. In the window's upper-right corner, the whole way down, stands the whole Sun: a
simulation made for this site and labeled as one (real footage from NASA's Solar Dynamics
Observatory is the alternative; see *Which Sun*). It turns about the axis through its middle,
once every sixteen seconds, so its features cross the disk from left to right. Below the opening
are Selected work, About, and Contact. Selected work starts with an index of the projects, their
names set very large, and then gives each project's case, with a line diagram that holds the
middle of the window while scrolling draws its story. About is the page's one light section, and
the footer ends on the name, set across the whole window.

React 19, TypeScript, and Vite. The only runtime dependencies are React and Lenis, which smooths
the scrolling.

## Run it

```sh
npm install
npm run dev
npm run build
npm run preview
npm run check
```

| Command | What it does |
| --- | --- |
| `npm run dev` | serves the site for development at http://127.0.0.1:5173 |
| `npm run build` | type-checks, then writes the static site to `dist/` |
| `npm run preview` | serves `dist/` at http://127.0.0.1:4173 |
| `npm run check` | builds, then runs the 44 browser checks (needs Google Chrome; about two minutes) |

Node 20.19+ or 22.12+ (see `.nvmrc`).

## Change the content

Everything a visitor reads is in **`src/content.ts`**: the introduction, biography, education,
certifications, skills, and each project with its headline figures, facts, and case notes. Edit
that file and the page, the terminal's files, the search-engine metadata, and the no-JavaScript
fallback all follow. The terminal's files are built from it when the page starts
(`src/terminal/fs.ts`); only the terminal's own replies, such as `help` and `neofetch`, are
written in `src/terminal/commands.ts`.

Two rules the copy keeps to:

- Facts come from the résumé, LinkedIn, and GitHub. Qualifiers that keep a claim honest stay in
  the sentence (offline evaluation, projected savings, canary deployment, availability target).
- A link that does not exist is `null`, and the page shows nothing for it.

The page title and description are in `index.html`. The link-preview image is
`public/og-image.jpg`; its wording lives in `scripts/share-card.html` (see *Images and footage*).

## The résumé

The Résumé link in Contact downloads `public/owen-sun-zhang-resume.pdf`: the résumé **without the
phone number**. `Owen_Sun_Zhang_Resume.pdf` in the project folder is the private copy with the
phone number; `.gitignore` keeps it, and `private/`, out of version control.

Both copies were corrected on October 2, 2026 (degree name, AWS certification date) by editing
the PDF itself, because the LaTeX source is not in this folder. Make the same two corrections in
the LaTeX source, or the next export will bring the old wording back. To replace the public copy,
export a version without the phone number and save it over the file in `public/`.
`npm run check` fails if the public copy contains a phone number.

## Putting it online

The built site is a folder of static files (`dist/`), so any static host can serve it: GitHub
Pages, Netlify, Cloudflare Pages, and the like. Two things matter.

1. **Its address.** Once you know where the site will live (for example
   `https://pine532.github.io`, or a domain you buy), put that address in a file named `.env`:
   `SITE_URL=https://your-address.example`. The build then adds the canonical URL, an absolute
   address for the link-preview image, and `sitemap.xml`. Without it the site still builds and
   works; previews on LinkedIn or in messages just will not show the image.
2. **It must sit at the root of that address**: `https://example.com/`, not
   `https://example.com/portfolio/`, because the page refers to `/media/…` and `/assets/…`. On
   GitHub Pages that means a repository named `<username>.github.io`.

Then run `npm run check` and upload `dist/`.

## How it is organized

```
index.html              page shell: title, description, link-preview tags, icons
config/site-metadata.ts build step: structured data, the plain fallback page, preloads,
                        robots.txt, sitemap, 404 page; leaves out of the build the Sun files
                        the page does not use
config/story-lengths.ts build step: stops the build if a project drawing's story is not as long
                        as src/components/visuals/scenes.ts says it is
src/
  content.ts            all copy and facts, the terminal's files included
  sun-source.json       which Sun the site shows: "simulated" or "observed"
  sun-assets.json       what the stills, the icons, and the link preview were last made from
                        (written by `npm run assets`; the build checks it)
  media.ts              that Sun's files: the 1280-pixel video and its still, the only ones the
                        page uses
  terminal/
    fs.ts               the terminal's read-only filesystem, built from content.ts
    commands.ts         the terminal's commands: each line parsed and run, with what to print
                        and what the page should do
  smoothScroll.ts       smooth scrolling (Lenis), left off under reduced motion, and the glide
                        to a link's target
  scroll.ts             the scroll position, read once a frame for everything that follows it
  layout.ts             the header height, read from the CSS
  App.tsx               page skeleton; starts smooth scrolling and the switch for the Sun's
                        motion, and does what the terminal asks of the page
  components/           Hero, Terminal, CornerSun, SiteHeader, Work, WorkIndex, ProjectStage,
                        ProjectVisual, About, Contact, SiteFooter, InlineList, ErrorBoundary,
                        icons
    visuals/            the five project drawings, the lengths of their stories (scenes.ts),
                        and the frame that loads and plays them
  hooks/
    useSunMotion.ts     the visitor's say over the Sun's motion, which is its footage: one
                        switch, worked by the control under the Sun and by the terminal's `sun`
    usePageState.ts     whether the page has scrolled (the header draws in), and whether the
                        Sun stands over the light About section (its sky is drawn tighter)
    useScrollSpy.ts     current section in the navigation
    useHashNavigation.ts  links into sections and case notes, gliding where scrolling is smoothed
    usePinnedStage.ts   whether a project drawing pins in the window, and how far the page
                        has scrolled through its story
    useVisualClock.ts   a project drawing's time: the scroll's while it is pinned, its own
                        clock after
    usePrefersReducedMotion.ts, usePrintExpansion.ts
  styles/               fonts, base (tokens, the grid, the label), header, sun, hero, terminal,
                        work, about, contact, print
public/                 icons, link-preview image, the public résumé, and media/ (both Suns'
                        videos, stills, and notes, and the two fonts' licenses)
scripts/                browser checks and the scripts that made the images and both videos
  sun/                  the generator of the simulated Sun (Python; see its README)
  footage/              how the NASA footage was cut and encoded
references/             source media the footage was cut from, and the simulation's intermediate
                        files (large; not in version control)
archive/                earlier versions and notes (not in version control)
private/                the résumé as first supplied, with the phone number; never commit or deploy
```

`ASSET_MANIFEST.md` records where every image and video came from and what was done to it.

## The terminal and the Sun in the corner, briefly

The opening is a statement set large and, beneath it, a terminal (`src/components/Terminal.tsx`):
a zsh-style shell, `owen@sun ~ %`, over a read-only filesystem that `src/terminal/fs.ts` builds
once from `src/content.ts`, so every file says what the page says. Each project is a directory,
`~/projects/<id>/`, with `README.md` (the case in brief), `facts.txt`, and, where the project has
them, `tools.txt`, `notes.md` (its case notes), and `links.txt`. Beside `projects/` are
`about.txt`, `education.txt`, `certifications.txt`, `earlier.txt`, `contact.txt`, `skills/` (one
file for each area of the toolkit), and `resume.pdf`, which `cat` does not print. Nothing can be
changed: `rm`, `mv`, `touch`, and `mkdir` say the file system is read-only.

The commands are in `src/terminal/commands.ts`: `help`, `ls` (`-l` adds what each thing is),
`cd`, `cat`, `open`, `tree`, `pwd`, `whoami` (the name in block letters), `neofetch`, `history`,
`clear`, `echo`, `date`, and `sun pause` and `sun play`. A few more (`sudo`, `vim`, `exit`, and the
like) have an answer but are not in `help`. Commands joined by `&&` stop at the first that fails;
joined by `;` they carry on. Tab completes names, ↑ and ↓ recall earlier commands, Ctrl+L clears
the screen, Ctrl+C abandons the line, and Ctrl+U erases it.

When the page opens, the terminal prints a "Last login" line and types `ls` by itself, a letter
at a time (a key pressed meanwhile cuts the typing short); with reduced motion it runs `ls` at
once. Then it waits. While it is in view and nothing else has the keyboard, typing anywhere on
the page goes into it. Under it, a row of buttons runs commands suited to where the shell is, for
a phone or anyone without a keyboard. The commands only answer; what the page does with them is
up to `App.tsx`. `open` with a project (by its id, its short name, or its organization), a section
(`work`, `about`, `contact`, `top`), or a file that stands for a place on the page (a project's
`README.md` or `notes.md`, `about.txt`, `contact.txt`) scrolls the page there, opens the case
notes if it leads to them, and records the place in the address. `open resume.pdf`, `open github`,
and `open linkedin` open them in a new tab. `sun pause` and `sun play` work the same switch as the
control under the Sun. The index of work borrows the terminal's look: beside the names, a preview
prints the README of the row under the pointer, or, with no pointer over the list, of the row
nearest the middle of the window. A phone has no room for the preview.

The Sun stands fixed in the window's upper-right corner (`src/components/CornerSun.tsx`, sized in
`src/styles/base.css` and `src/styles/sun.css`), above the page and beneath the header: 200 pixels
across on a window 1440 pixels wide or more (down to 153 at 1100), 96 on a tablet (and on a wide
window under 600 pixels tall), and 84 on a phone. It stays there; the page scrolls beneath it.
Its still appears only once all of it has arrived, and resolves from coarse blocks to the full
picture in a few steps (at once, with reduced motion). Under it are its credit and a Pause/Play
control. The footage plays wherever the disc is 96 pixels or more, in windows at least 701
pixels wide and 500 tall; a phone shows the still, downloads no video, and has neither caption
nor control. The video is fetched only once motion is wanted, it pauses in a hidden tab, and
Pause puts the still back. With reduced motion, or in a browser that asks to save data (Chrome's
Data Saver, or a 2G connection), the Sun is the still until Play is pressed
(`src/hooks/useSunMotion.ts`).

The simulated Sun turns about the upright axis through its middle, once every sixteen seconds,
so its features come in at the left edge, cross the disk, and go out at the right. The turn is in
the video itself, rendered ahead of time by `scripts/sun/`; the page turns nothing. It is the
page's own motion, chosen for the look of it: far faster than the real Sun's, which takes about
27 days, and not taken from any data. The footage is the Sun's only motion, and the still, the
loop's first frame, does not move.

Scrolling is smoothed by Lenis (`src/smoothScroll.ts`): the wheel's steps are eased, and in-page
links, the navigation's and the terminal's, glide to their targets. The window is still what
scrolls, so `position: sticky` and the pinned project stages work as they do without it, and the
terminal's own screen takes the wheel while it has somewhere to go. With reduced motion Lenis is
not started, and it stops if that preference is turned on while the page is open.

About is the page's one light section: paper-colored ground, near-black type. When any of the
Sun's fringe would lie over it (`src/hooks/usePageState.ts`), the sky the Sun is shown through, a
soft round mask, is drawn in tight to the disc, because on the light ground the dark of the
fringe would show as a halo. Once the page has scrolled, the header's name and links and the
Sun's caption stand in dark pills, so they read over the light section too.

Until October 23, 2026 the Sun opened the page beside the name, rode up into this corner, lit
every letter in relief, and came down again to close the page. That version is kept in
`archive/site-before-terminal-2026-10-23/`. `npm run check` drives Chrome only; the new design
has not yet been tried in a real Safari or Firefox, or on a real phone.

## The project diagrams, briefly

Each project in Selected work has one line diagram (`src/components/visuals/`), captioned as an
illustration. It stands on a stage (`src/components/ProjectStage.tsx`): a track taller than the
diagram, in which the diagram is sticky. The diagram comes to rest in the middle of the window
and stays there while the page scrolls on. That scrolling draws its story, forwards and back;
then the finished picture waits while the project's text comes up to meet it, and the two leave
with the page. After that the diagram runs a quiet loop, which its Pause button stops. Where
both fit in the window, the headline figures of the first and third projects stay with their
diagrams, and the first project's four come up from a quieter tone as its diagram reaches what
each one measures.

The stylesheet does the pinning (`src/styles/work.css`). `usePinnedStage` decides whether a
stage pins and works out how far through its story the page is, and `useVisualClock` turns that
into the drawing's time. The stages never take over the scroll, and they are measured ahead of
time, not while the page scrolls. A stage pins only where it can. With reduced motion, in
windows under 600 pixels tall, where a diagram would not fit below the header, or in a browser
without the `svh` unit, the diagram scrolls with the page and plays by its own clock (or shows a
still, with Play), and the page is no longer than it would be without stages; print leaves the
diagrams out. Each story's length is written in its drawing and again in
`src/components/visuals/scenes.ts`, so that the page can make room before the drawing's code has
loaded; the build stops if the two disagree (`config/story-lengths.ts`). The stages have been
checked in Chrome only; Safari, Firefox, and real phones have not been tested yet.

## Which Sun

`src/sun-source.json` holds `"simulated"` (the default) or `"observed"`. Everything that names
the Sun follows that one setting: the credit under the Sun in the corner, the terminal's `sun` and
`neofetch` replies, the published note, the stills, the icons, and the link-preview image and its
description. After changing it, run `npm run assets` and `npm run check`.

The setting cannot be half applied. The build publishes only the selected Sun's 1280-pixel video,
its still, and its note. It refuses to run while a video has changed since its still was taken,
or while the icons or the link-preview image were made from the other Sun or from an earlier
still (`npm run assets` records what it used in `src/sun-assets.json`). And the check fails if the
build lacks the shown Sun's video or still, or carries files of the other one.

- **Simulated**: a computer model of the Sun as NASA's SDO sees it at 304 Å, made by
  `scripts/sun/` (its README explains the model, its limits, and how to regenerate it; about
  three and a half hours on an Apple-silicon laptop). The page never calls it an observation.
  The model is a map of the whole sphere, and the picture turns through it once in each
  sixteen-second loop: a turn far faster than the real Sun's, chosen for the look of it, and not
  taken from any data. No observation is used for its pixels.
- **Observed**: NASA Goddard Space Flight Center/SDO, AIA 304 Å, false-color extreme-ultraviolet
  time-lapse (not live, not visible light). It does not turn: what moves in it is the real Sun's
  own motion. `scripts/footage/` rebuilds its two videos from the files in `references/aia304/`.

Details, credits, and usage terms for both are in `ASSET_MANIFEST.md`.

## Images and footage

- `scripts/make-stills.py` takes each video's first frame as its still.
  `scripts/make-icons.py` derives the favicon and the app icons from the 2048-pixel still of the
  Sun the site shows, and `scripts/make-share-image.mjs` renders the link-preview image from the
  same still. The page itself uses only the 1280-pixel files; the 2048-pixel ones stay in
  `public/media/` for these scripts, and the build leaves them out of `dist/`.
- The Sun in the window's corner has no image of its own: it is the 1280-pixel still and video,
  scaled down by the browser.

Once, to set up the Python the asset scripts use:

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
```

Then, whenever a video or the selected Sun changes (it needs Google Chrome for the link preview):

```sh
npm run assets
```
