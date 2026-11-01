// Browser checks for the built site. Run `npm run check` (it builds first).
//
// The script serves dist/ itself, drives Google Chrome through Playwright, and exits non-zero
// if any check fails. This is Chrome emulation on one machine, not a physical-device test.
//
//   node scripts/check-site.mjs            check the production build in dist/
//   node scripts/check-site.mjs <url>      check a server that is already running
//   node scripts/check-site.mjs [url] <words>   run only the checks whose names contain <words>, e.g. terminal
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const OVERFLOW_WIDTHS = [320, 360, 390, 600, 768, 1024, 1440, 2560];
// The Sun stands whole in the window's upper-right corner at every size: a phone, a tablet, laptops and wide screens.
const SUN_VIEWPORTS = [[390, 844], [820, 1180], [1280, 720], [1440, 900], [1920, 1080], [2560, 1440]];
// How wide its disc is there (styles/base.css): 84px on a phone, 96px from 701px wide, and 13.9vw between 150 and
// 200px on a window at least 1100px wide and 600px tall, where it also stands lower. Kept here and not read from the
// stylesheet, so a wrong figure there shows up as a Sun of the wrong size.
const WIDE = ([width, height]) => width >= 1100 && height >= 600;
const cornerDisc = ([width, height]) => (WIDE([width, height]) ? Math.max(150, Math.min(200, width * 0.139)) : width >= 701 ? 96 : 84);
const cornerTop = viewport => (WIDE(viewport) ? 24 : 14);
// The disc is 79.3% of its picture's width (src/media.ts), and its fringe reaches 10.5% of the disc beyond it.
const DISC = 0.793;
const FRINGE = 0.105;
// Where the footage plays at all (components/CornerSun.tsx); a phone's corner shows the still and loads no video.
const playsFootage = ([width, height]) => width >= 701 && height >= 500;
// No text may read below this (WCAG 1.4.3).
const READABLE = 4.5;
const PRINT_PAGE_LIMIT = 7;
// The overrides WCAG 1.4.12 asks a page to survive.
const TEXT_SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
// Which Sun this build shows (src/sun-source.json): its still is preloaded, and the other one's files are not published.
const SUN = JSON.parse(readFileSync(new URL('../src/sun-source.json', import.meta.url), 'utf8')).source;
const SUN_FILES = {
  simulated: { still: '/media/sun-simulated-small.webp', video: '/media/sun-simulated-small.mp4', unpublished: ['media/sun-simulated-large.mp4', 'media/sun-simulated-large.webp', 'media/sun-aia304-desktop.mp4', 'media/sun-aia304-mobile.mp4', 'media/sun-aia304-desktop.webp', 'media/sun-aia304-mobile.webp', 'media/solar-footage-source.txt'] },
  observed: { still: '/media/sun-aia304-mobile.webp', video: '/media/sun-aia304-mobile.mp4', unpublished: ['media/sun-aia304-desktop.mp4', 'media/sun-aia304-desktop.webp', 'media/sun-simulated-large.mp4', 'media/sun-simulated-small.mp4', 'media/sun-simulated-large.webp', 'media/sun-simulated-small.webp', 'media/sun-simulation.txt'] },
}[SUN];
const DIST = new URL('../dist/', import.meta.url);

/**
 * What the page says, straight from src/content.ts, through a server of Vite's that never listens (it reads the
 * TypeScript and the JSON it imports as the build does). Read once, before the checks.
 */
const sourceLoader = () => createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
const content = await (async () => {
  const vite = await sourceLoader();
  try {
    return await vite.ssrLoadModule('/src/content.ts');
  } finally {
    await vite.close();
  }
})();
const { profile, projects } = content;
const PROJECT_IDS = projects.map(project => project.id);

let server;
const isUrl = arg => /^https?:\/\//.test(arg);
let url = process.argv.slice(2).find(isUrl);
const only = process.argv.slice(2).find(arg => !isUrl(arg)) ?? '';
if (!url) {
  server = await preview({ preview: { port: 4188, strictPort: false, host: '127.0.0.1' }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
}
// Use the installed Chrome when present (it can decode the H.264 footage); otherwise Playwright's own browser.
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) && { executablePath: CHROME }) });
const began = Date.now();

const failures = [];
let ran = 0;
async function check(name, run) {
  if (!name.includes(only)) return;
  ran += 1;
  const from = Date.now();
  try {
    await run();
    console.log(`  pass  ${name}  (${((Date.now() - from) / 1000).toFixed(1)} s)`);
  } catch (error) {
    failures.push(name);
    // An equality that fails says what it found, and what it wanted.
    const values = /Equal$/.test(error.operator ?? '') ? `\n        found ${JSON.stringify(error.actual)?.slice(0, 600)}; wanted ${JSON.stringify(error.expected)?.slice(0, 300)}` : '';
    console.log(`  FAIL  ${name}\n        ${String(error.message).split('\n')[0]}${values}`);
  }
}

/**
 * Opens the page and waits for fonts and the first layout. Collects page errors, console errors and failed
 * requests (`problems`), and the address of every request (`requests`). `prepare`, if given, is run in every
 * page of the context before the page's own scripts (context.addInitScript); it may be a list of such scripts.
 */
async function open(options = {}, path = '', prepare = null) {
  const context = await browser.newContext({ viewport: DESKTOP, ...options });
  // Uncaught errors that never reach the console (a ResizeObserver loop, for one) count too.
  await context.addInitScript(() => window.addEventListener('error', event => console.error(`window error: ${event.message}`)));
  for (const script of [prepare].flat().filter(Boolean)) await context.addInitScript(script);
  const page = await context.newPage();
  const problems = [];
  const requests = [];
  page.on('pageerror', error => problems.push(`page error: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console error: ${message.text()}`); });
  page.on('request', request => requests.push(request.url()));
  page.on('response', response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
  // A media request the browser gives up on by itself (the footage paused) is not a failure.
  page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`failed request: ${request.url()} (${request.failure()?.errorText})`); });
  await page.goto(url + path);
  await fontsLoaded(page);
  await settle(page);
  return { page, problems, requests, close: () => context.close() };
}

/** Waits for web fonts, with a time limit (awaiting document.fonts.ready could hang forever). */
const fontsLoaded = page => page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15000 });
/** Waits two frames: the page answers a scroll or a resize in the first, and the second shows its answer. */
const twoFrames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function settle(page) {
  await twoFrames(page);
  await page.waitForTimeout(120);
}
/** Jumps to a scroll position, as a link or a reload does, waits for the page's answer, and says where it got to. */
async function scrollTo(page, top) {
  await page.evaluate(top => window.scrollTo({ top, behavior: 'instant' }), top);
  await twoFrames(page);
  return page.evaluate(() => window.scrollY);
}
/** How far the page overflows its window sideways, in px (0 or less: not at all). */
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** What reaches past the window's right edge: text runs first, then boxes. Text clipped by an ancestor (screen-reader
    text, the footer's wordmark) cannot widen the page and is left out. For failure messages. */
const pastTheEdge = page => page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  const clipped = element => {
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || /hidden|clip/.test(style.overflowX)) return true;
    }
    return false;
  };
  const found = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node && found.length < 4; node = walker.nextNode()) {
    if (!node.textContent.trim() || clipped(node.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const right = Math.max(0, ...[...range.getClientRects()].map(box => box.right));
    if (right > width + 0.5) found.push(`"${node.textContent.trim().slice(0, 40)}" (${node.parentElement.tagName.toLowerCase()}.${node.parentElement.className}) to ${Math.round(right)}px`);
  }
  // Boxes laid out by CSS: the shapes inside an SVG drawing cannot widen the page.
  for (const element of document.querySelectorAll('body *')) {
    if (found.length >= 6) break;
    if (!(element instanceof HTMLElement)) continue;
    const right = element.getBoundingClientRect().right;
    if (right > width + 0.5 && !clipped(element)) found.push(`${element.tagName.toLowerCase()}.${element.className} to ${Math.round(right)}px`);
  }
  return found.join('; ') || 'nothing found';
});
const pageEnd = page => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

// Stand-ins for what a test browser cannot be asked for directly: a hidden tab, Data Saver, a new tab opened.
const tabHidden = (page, hidden) => page.evaluate(hidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
function savingData() {
  Object.defineProperty(Navigator.prototype, 'connection', { configurable: true, get: () => ({ saveData: true, effectiveType: '4g' }) });
}
function recordWindowOpen() {
  window.opened = [];
  window.open = (...args) => {
    window.opened.push(args);
    return null;
  };
}

// ---- The Sun ---------------------------------------------------------------------------------

/** The Sun in its corner: its disc's place and size as laid out, whether the still and the footage are shown. */
const sunOf = page => page.evaluate(([DISC, FRINGE]) => {
  const picture = document.querySelector('.corner-sun-disc').getBoundingClientRect();
  const disc = picture.width * DISC;
  const fringe = disc * FRINGE;
  const x = picture.left + picture.width / 2;
  const y = picture.top + picture.height / 2;
  const video = document.querySelector('video.corner-sun-video');
  const toggle = document.querySelector('.corner-sun-toggle');
  return {
    disc, top: y - disc / 2, reach: { top: y - disc / 2 - fringe, right: x + disc / 2 + fringe, left: x - disc / 2 - fringe, bottom: y + disc / 2 + fringe },
    window: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
    whole: document.querySelector('.corner-sun').dataset.whole, ready: document.querySelector('.corner-sun').dataset.ready,
    video: video ? { src: video.getAttribute('src'), current: video.currentSrc, paused: video.paused, time: video.currentTime } : null,
    toggle: toggle?.textContent.trim() ?? null,
  };
}, [DISC, FRINGE]);
const stillShown = page => page.waitForFunction(() => document.querySelector('.corner-sun')?.dataset.whole === 'true', null, { timeout: 3000 });
/** Waits until the footage is up and seen to move: playing, and its clock has left where it stood half a second before. */
async function footageMoves(page, timeout = 6000) {
  await page.waitForFunction(() => document.querySelector('.corner-sun')?.dataset.ready === 'true' && !document.querySelector('video.corner-sun-video').paused, null, { timeout });
  const from = await page.locator('video.corner-sun-video').evaluate(video => video.currentTime);
  await page.waitForTimeout(500);
  const to = await page.locator('video.corner-sun-video').evaluate(video => video.currentTime);
  assert.ok(to !== from, `the footage says it plays but its clock stands at ${from}s`);
}
const footagePaused = (page, paused) => page.waitForFunction(paused => document.querySelector('video.corner-sun-video').paused === paused, paused, { timeout: 5000 });

// ---- Color -----------------------------------------------------------------------------------

/** The contrast between two colors, each [red, green, blue], as WCAG counts it. */
function contrastOf(one, other) {
  const linear = level => (level <= 10 ? level / 3294.6 : ((level / 255 + 0.055) / 1.055) ** 2.4);
  const [a, b] = [one, other].map(([red, green, blue]) => 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Every rendered element matching `selector` with words in it: its color and what stands behind it. The ground is
 * the nearest opaque background among the element and its ancestors; for something in a fixed layer over the page
 * (the header, the Sun's caption) with no background of its own, it is what the page shows beneath it there.
 */
const tonesOf = (page, selector) => page.evaluate(selector => {
  const parse = color => {
    const parts = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    return { rgb: parts.slice(0, 3), alpha: parts[3] ?? 1 };
  };
  const overlays = '.site-header, .corner-sun, .corner-sun-caption, .skip-link';
  const name = node => `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.split(' ')[0]}` : ''}`;
  const opaque = from => {
    for (let node = from; node; node = node.parentElement) {
      const { rgb, alpha } = parse(getComputedStyle(node).backgroundColor);
      if (alpha >= 0.99) return { rgb, from: name(node) };
    }
    return null;
  };
  const groundOf = element => {
    const layer = element.closest(overlays);
    if (layer) {
      for (let node = element; node && node !== layer.parentElement; node = node.parentElement) {
        const { rgb, alpha } = parse(getComputedStyle(node).backgroundColor);
        if (alpha >= 0.99) return { rgb, from: name(node) };
      }
      const box = element.getBoundingClientRect();
      const under = document.elementsFromPoint(box.left + box.width / 2, box.top + box.height / 2).find(node => !node.closest(overlays));
      if (under) return opaque(under);
    }
    return opaque(element);
  };
  const shown = element => {
    if (element.getClientRects().length === 0 || !element.textContent.trim()) return false;
    if (getComputedStyle(element).visibility !== 'visible') return false;
    for (let node = element; node; node = node.parentElement) if (Number(getComputedStyle(node).opacity) === 0) return false;
    return true;
  };
  return [...document.querySelectorAll(selector)].filter(shown).map(element => {
    const ground = groundOf(element) ?? { rgb: parse(getComputedStyle(document.documentElement).backgroundColor).rgb, from: 'html' };
    const { rgb, alpha } = parse(getComputedStyle(element).color);
    const color = rgb.map((level, index) => level * alpha + ground.rgb[index] * (1 - alpha));
    return { text: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40), what: name(element), color, ground: ground.rgb, from: ground.from };
  });
}, selector);

/** Fails with every element matching `selector` that reads below `least` against its ground; says how many it read. */
async function assertReadable(page, selector, where, least = READABLE) {
  const tones = await tonesOf(page, selector);
  assert.ok(tones.length > 0, `${where}: nothing matching ${selector} is on show to measure`);
  const faint = tones.map(tone => ({ ...tone, ratio: contrastOf(tone.color, tone.ground) })).filter(tone => tone.ratio < least);
  assert.deepEqual(faint.map(tone => `"${tone.text}" (${tone.what}) rgb(${tone.color.map(Math.round)}) on rgb(${tone.ground}) from ${tone.from}: ${tone.ratio.toFixed(2)}:1`), [], `${where}: below ${least}:1`);
  return tones.length;
}

// ---- The terminal ----------------------------------------------------------------------------

/** Waits until the terminal has typed and run its first command by itself: an `ls` at a prompt, and its listing. */
const booted = (page, timeout = 3000) => page.waitForFunction(() => {
  const input = document.querySelector('.terminal-input');
  const echoes = [...document.querySelectorAll('.terminal-echo .t-cmd')].map(command => command.textContent);
  return !!input && !input.readOnly && echoes.includes('ls') && !!document.querySelector('.terminal-log .terminal-listing');
}, null, { timeout });
/** Opens the page with the terminal booted and the keyboard in it, as a click on its screen leaves it. */
async function openTerminal(options = {}, prepare = null) {
  const opened = await open(options, '', prepare);
  await booted(opened.page);
  await opened.page.locator('.terminal-screen').click();
  assert.ok(await opened.page.evaluate(() => document.activeElement?.classList.contains('terminal-input')), 'a click on the terminal leaves the keyboard elsewhere');
  return opened;
}
/** The terminal's newest entry: the command at its prompt, its words, its errors, its listing and its banner. */
const entryOf = page => page.evaluate(() => {
  const entry = [...document.querySelectorAll('.terminal-entry')].at(-1);
  if (!entry) return null;
  const listing = entry.querySelector('.terminal-listing');
  return {
    command: entry.querySelector('.terminal-echo .t-cmd')?.textContent ?? null,
    text: entry.textContent,
    /** What the command printed, without its prompt. */
    output: [...entry.children].filter(child => !child.classList.contains('terminal-echo')).map(child => child.textContent).join(''),
    errors: [...entry.querySelectorAll('.t-error')].map(line => line.textContent.trim()),
    items: [...entry.querySelectorAll('.terminal-listing li')].map(item => [...item.children].map(span => span.textContent)),
    long: listing?.dataset.long ?? null,
    banner: !!entry.querySelector('.terminal-banner'),
  };
});
const entries = page => page.locator('.terminal-entry').count();
const typed = page => page.locator('.terminal-input').inputValue();
/** Types a line into the focused command line, presses Enter, and answers with the entry it made. */
async function enter(page, line) {
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.terminal-input').value === '', null, { timeout: 2000 });
  await twoFrames(page);
  return entryOf(page);
}
const chips = page => page.locator('.terminal-chip').evaluateAll(buttons => buttons.map(button => button.textContent));

// ---- Project stages --------------------------------------------------------------------------
// Where it pins (hooks/usePinnedStage.ts, styles/work.css), a project's visual comes to rest below the header and
// stays there while the page scrolls through its scrub, which tells its story, and its hold; then it leaves with
// the page.

/**
 * The stage of project `id`, as laid out: data-pinned and data-lead; whether its block is sticky and where it is
 * held (rest, its top down the window); the scrub and the hold (the track's ::after); the scroll position at which
 * the block comes to rest (start; the track rides the page, so this is the same wherever the page is) and lets go
 * (release); --story in seconds; the block's top now; data-story-time on the visual's host; and the scroll position.
 */
const stageOf = (page, id) => page.evaluate(id => {
  const track = document.querySelector(`#${id} .project-stage`);
  const [pin, visual, figures, host] = ['.project-stage-pin', '.project-visual', '.figures', '.project-visual-host'].map(selector => track.querySelector(selector));
  const lead = track.dataset.lead ?? null;
  const block = lead === 'out' ? visual : pin;
  const sticky = getComputedStyle(block).position === 'sticky';
  const rest = sticky ? parseFloat(getComputedStyle(block).top) : null;
  const after = getComputedStyle(track, '::after');
  const made = after.content !== 'none';
  const scrub = made ? parseFloat(after.height) || 0 : 0;
  const hold = made ? parseFloat(after.paddingBottom) || 0 : 0;
  const outer = element => element.getBoundingClientRect().height + parseFloat(getComputedStyle(element).marginBottom);
  const start = track.getBoundingClientRect().top + window.scrollY + (lead === 'out' && figures ? outer(figures) : 0) - (rest ?? 0);
  return {
    pinned: track.dataset.pinned, lead, sticky, rest, scrub, hold, start, release: start + scrub + hold,
    story: Number(track.style.getPropertyValue('--story')), top: block.getBoundingClientRect().top,
    time: host?.dataset.storyTime === undefined ? null : Number(host.dataset.storyTime), drawn: !!host?.querySelector('svg, canvas'),
    y: window.scrollY,
  };
}, id);
/** The moment scrolling has a stage's story at, at scroll position `y`, in seconds. */
const storyAt = (stage, y) => Math.max(0, Math.min(1, (y - stage.start) / stage.scrub)) * stage.story;
/** Waits until the visual of project `id` is drawn and its story has come to where scrolling has it: the clock eases
    there over about a second. Answers with the stage as it then stands, or as it stood after three seconds. */
async function storySettled(page, id) {
  let now = null;
  for (let reading = 0; reading < 30; reading += 1) {
    now = await stageOf(page, id);
    if (now.drawn && now.time !== null && Math.abs(now.time - storyAt(now, now.y)) <= 0.002) return now;
    await page.waitForTimeout(100);
  }
  assert.ok(now.drawn && now.time !== null, `the ${id} visual is never drawn, or never told where its story is (drawn: ${now.drawn}, time: ${now.time})`);
  return now;
}

// ---- Focus and navigation --------------------------------------------------------------------

/** What holds keyboard focus, where it is, and how far down the window the fixed header reaches just now. */
const focused = page => page.evaluate(() => {
  const element = document.activeElement;
  const box = element.getBoundingClientRect();
  return {
    label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 50), tag: element.tagName, className: String(element.className),
    top: box.top, bottom: box.bottom, height: box.height,
    inHeader: !!element.closest('.site-header, .skip-link, .corner-sun-caption'),
    header: document.querySelector('.site-header').getBoundingClientRect().bottom,
    window: window.innerHeight,
  };
});
/** Waits until the element with id `id` stands at its scroll margin below the window's top (or the page can go no further). */
const landed = (page, id, timeout = 3000) => page.waitForFunction(id => {
  const target = document.getElementById(id);
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  const top = target.getBoundingClientRect().top;
  const end = window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1;
  return Math.abs(top - margin) <= 2 || (end && top >= margin - 2);
}, id, { timeout, polling: 'raf' }).then(() => true, () => false);
/** Waits until smooth scrolling has finished its glide (Lenis drops its class), and a few frames more: Lenis ignores
    the first native scroll in the frame its glide ends, so a jump made then would leave it believing the page had not moved. */
async function glideDone(page) {
  await page.waitForFunction(() => !document.documentElement.classList.contains('lenis-scrolling'), null, { timeout: 3000, polling: 'raf' }).catch(() => {});
  await twoFrames(page);
  await page.waitForTimeout(100);
}
const placeOf = (page, id) => page.evaluate(id => {
  const target = document.getElementById(id);
  return { top: target.getBoundingClientRect().top, margin: parseFloat(getComputedStyle(target).scrollMarginTop) || 0, y: window.scrollY, end: document.documentElement.scrollHeight - window.innerHeight };
}, id);

/** Prints the way a visitor does (no print emulation beforehand) and counts the pages. */
async function printedPages(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const pdf = await page.pdf({ format: 'Letter', preferCSSPageSize: true });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  return pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g).length;
}

console.log(`Checking ${url}`);

// ---- Loading and structure -------------------------------------------------------------------

await check('loads without errors or failed requests, and the terminal boots with ls (1440 and 390 px)', async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const at = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', error => problems.push(`page error: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`console error: ${message.text()}`); });
    page.on('response', response => { if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`failed request: ${request.url()}`); });
    const from = Date.now();
    await page.goto(url, { waitUntil: 'commit' });
    const up = await booted(page, 3000).then(() => true, () => false);
    assert.ok(up, `${at}: no ls and its listing in the terminal ${((Date.now() - from) / 1000).toFixed(1)} s after the page was asked for`);
    await fontsLoaded(page);
    await page.waitForTimeout(600);
    // Down the page and back, so every visual's scene loads.
    const end = await pageEnd(page);
    for (let top = 0; top <= end + 800; top += 800) await scrollTo(page, top);
    await page.waitForTimeout(600);
    await scrollTo(page, 0);
    assert.deepEqual(problems, [], `${at}: ${problems.join('; ')}`);
    await context.close();
  }
});

await check('one heading names the page; the landmarks, the navigation and the terminal’s log are exposed', async () => {
  const { page, close } = await open();
  assert.equal(await page.locator('h1').count(), 1, 'h1 elements');
  const name = await page.getByRole('heading', { level: 1 }).evaluate(heading => heading.textContent);
  assert.ok(name.includes(profile.name), `the h1 reads "${name}"`);
  for (const role of ['banner', 'main', 'contentinfo']) assert.equal(await page.getByRole(role).count(), 1, `${role} landmark`);
  assert.equal(await page.locator('header.site-header').count(), 1, 'header');
  assert.equal(await page.locator('footer.site-footer').count(), 1, 'footer');
  assert.equal(await page.locator('nav[aria-label="Main"]').count(), 1, 'nav[aria-label=Main]');
  assert.equal(await page.getByRole('navigation', { name: 'Main' }).getByRole('link').count(), 4, 'links in the navigation');
  assert.equal(await page.locator('[role="log"]').count(), 1, 'role=log');
  assert.equal(await page.getByRole('textbox', { name: 'Command line' }).count(), 1, 'the command line by its name');
  await close();
});

await check('no horizontal overflow at 320 to 2560 px, at the top, the middle and the bottom of the page', async () => {
  for (const width of OVERFLOW_WIDTHS) {
    const { page, close } = await open({ viewport: { width, height: 900 } });
    const end = await pageEnd(page);
    for (const [where, top] of [['top', 0], ['middle', Math.round(end / 2)], ['bottom', end]]) {
      await scrollTo(page, top);
      await page.waitForTimeout(250);
      const extra = await overflow(page);
      assert.ok(extra <= 0, `${width}px wide, at the ${where} (${top}px): the page is ${extra}px too wide: ${await pastTheEdge(page)}`);
    }
    // With every case note open too.
    await page.evaluate(() => { for (const details of document.querySelectorAll('details')) details.open = true; });
    await settle(page);
    assert.ok(await overflow(page) <= 0, `${width}px wide, case notes open: the page is ${await overflow(page)}px too wide: ${await pastTheEdge(page)}`);
    await close();
  }
});

// ---- The Sun ---------------------------------------------------------------------------------

await check('the Sun stands whole in the top-right corner at its size for each window, shows its still, and plays its footage only from 701 px wide', async () => {
  for (const viewport of SUN_VIEWPORTS) {
    const [width, height] = viewport;
    const at = `${width}x${height}`;
    const { page, requests, close } = await open({ viewport: { width, height } });
    await stillShown(page).catch(() => assert.fail(`${at}: the still is not shown within 3 s`));
    const sun = await sunOf(page);
    const disc = cornerDisc(viewport);
    assert.ok(Math.abs(sun.disc - disc) <= 1, `${at}: the disc is ${sun.disc.toFixed(1)}px across, not ${disc.toFixed(1)}px`);
    assert.ok(Math.abs(sun.top - cornerTop(viewport)) <= 1, `${at}: the disc's top is ${sun.top.toFixed(1)}px down the window, not ${cornerTop(viewport)}px`);
    assert.ok(sun.reach.top >= 0 && sun.reach.right <= sun.window.width && sun.reach.left >= 0, `${at}: the disc and its fringe reach from ${sun.reach.left.toFixed(1)} to ${sun.reach.right.toFixed(1)}px across and from ${sun.reach.top.toFixed(1)}px down, outside a window ${sun.window.width}px wide`);
    if (playsFootage(viewport)) {
      await footageMoves(page).catch(error => assert.fail(`${at}: the footage does not play within 6 s (${error.message.split('\n')[0]})`));
      assert.equal((await sunOf(page)).toggle, 'Pause', `${at}: the control under the Sun`);
    } else {
      await page.waitForTimeout(1500);
      assert.equal(sun.video, null, `${at}: a phone's corner has a video element`);
      assert.equal(sun.toggle, null, `${at}: a phone's corner offers a motion control`);
      const videos = requests.filter(request => /\.mp4(\?|$)/.test(request));
      assert.deepEqual(videos, [], `${at}: a phone downloads footage`);
    }
    await close();
  }
});

await check('the Pause and Play control under the Sun stops and starts the footage', async () => {
  const { page, close } = await open();
  await footageMoves(page);
  await page.locator('.corner-sun-toggle').click();
  await footagePaused(page, true).catch(() => assert.fail('Pause leaves the footage playing'));
  assert.equal((await sunOf(page)).toggle, 'Play', 'the control after Pause');
  assert.equal(await page.locator('.corner-sun-toggle').getAttribute('aria-label'), 'Play motion of the Sun');
  await page.locator('.corner-sun-toggle').click();
  await footageMoves(page).catch(() => assert.fail('Play does not start the footage again'));
  assert.equal((await sunOf(page)).toggle, 'Pause', 'the control after Play');
  await close();
});

await check('reduced motion and Data Saver keep the still and load no footage until Play is pressed', async () => {
  for (const [what, options, prepare] of [['reduced motion', { reducedMotion: 'reduce' }, null], ['Data Saver', {}, savingData]]) {
    const { page, requests, problems, close } = await open(options, '', prepare);
    await stillShown(page).catch(() => assert.fail(`${what}: the still is not shown`));
    await page.waitForTimeout(1500);
    const sun = await sunOf(page);
    assert.ok(sun.video && sun.video.src === null && sun.video.current === '', `${what}: the video has a source before Play (${JSON.stringify(sun.video)})`);
    assert.equal(sun.toggle, 'Play', `${what}: the control under the Sun`);
    assert.notEqual(sun.ready, 'true', `${what}: the footage is up`);
    assert.deepEqual(requests.filter(request => /\.mp4(\?|$)/.test(request)), [], `${what}: footage is downloaded before Play`);
    await page.locator('.corner-sun-toggle').click();
    await footageMoves(page).catch(() => assert.fail(`${what}: Play does not start the footage`));
    assert.equal((await sunOf(page)).toggle, 'Pause', `${what}: the control after Play`);
    assert.deepEqual(problems, [], `${what}: ${problems.join('; ')}`);
    await close();
  }
});

await check('the footage pauses in a hidden tab and resumes when the tab returns', async () => {
  const { page, close } = await open();
  await footageMoves(page);
  await tabHidden(page, true);
  await footagePaused(page, true).catch(() => assert.fail('the footage plays on in a hidden tab'));
  await tabHidden(page, false);
  await footageMoves(page).catch(() => assert.fail('the footage does not resume when the tab returns'));
  await close();
});

// ---- The header ------------------------------------------------------------------------------

await check('the header is plain type at the top, and draws in to dark pills without the tagline once the page has scrolled', async () => {
  const { page, close } = await open();
  const header = () => page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const alpha = color => Number(color.match(/[\d.]+/g)?.[3] ?? 1);
    return {
      scrolled: document.querySelector('.site').dataset.scrolled,
      tagline: { visibility: style('.site-tagline').visibility, opacity: Number(style('.site-tagline').opacity) },
      grounds: [...document.querySelectorAll('.site-name, .site-navigation a, .corner-sun-caption a, .corner-sun-toggle')].map(element => ({ label: element.textContent.trim().slice(0, 20), alpha: element.textContent && alpha(getComputedStyle(element).backgroundColor) })),
    };
  });
  const top = await header();
  assert.equal(top.scrolled, 'false', 'data-scrolled at the top');
  assert.deepEqual(top.tagline, { visibility: 'visible', opacity: 1 }, 'the tagline at the top');
  assert.deepEqual(top.grounds.filter(ground => ground.alpha !== 0).map(ground => ground.label), [], 'links with a ground at the top');
  await scrollTo(page, 300);
  await page.waitForTimeout(500);
  const down = await header();
  assert.equal(down.scrolled, 'true', 'data-scrolled 300px down');
  assert.equal(down.tagline.visibility, 'hidden', 'the tagline 300px down');
  assert.deepEqual(down.grounds.filter(ground => ground.alpha < 1).map(ground => `${ground.label} (${ground.alpha})`), [], 'links without an opaque pill 300px down');
  await close();
});

await check('the navigation marks the current section at the middle of Work, About and Contact', async () => {
  const { page, close } = await open();
  for (const id of ['work', 'about', 'contact']) {
    const y = await page.evaluate(id => {
      const box = document.getElementById(id).getBoundingClientRect();
      return Math.round(box.top + window.scrollY + box.height / 2 - window.innerHeight / 2);
    }, id);
    await scrollTo(page, y);
    await settle(page);
    const current = await page.locator('.site-navigation a[aria-current="true"]').evaluateAll(links => links.map(link => link.getAttribute('href')));
    assert.deepEqual(current, [`#${id}`], `at the middle of #${id} (${y}px) the navigation marks ${current.join(', ') || 'nothing'}`);
  }
  await scrollTo(page, 0);
  await settle(page);
  assert.equal(await page.locator('.site-navigation a[aria-current]').count(), 0, 'a section is marked at the top of the page');
  await close();
});

// ---- Contrast --------------------------------------------------------------------------------

await check('the header and the Sun’s caption read at 4.5:1 or more at the top and over the light About section', async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const at = `${viewport.width}px wide`;
    const { page, close } = await open({ viewport });
    const selector = '.site-name, .site-tagline, .site-navigation a, .corner-sun-caption a, .corner-sun-toggle';
    await assertReadable(page, selector, `${at}, at the top`);
    const about = await page.evaluate(() => document.getElementById('about').getBoundingClientRect().top + window.scrollY);
    for (const into of [40, 400]) {
      await scrollTo(page, Math.round(about + into));
      await page.waitForTimeout(400);
      assert.equal(await page.locator('.site').getAttribute('data-ground'), 'paper', `${at}, ${into}px into About: data-ground`);
      await assertReadable(page, selector, `${at}, ${into}px into About`);
    }
    await close();
  }
});

await check('About’s text reads at 4.5:1 or more on its light ground', async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const { page, close } = await open({ viewport });
    assert.equal(await page.locator('#about').evaluate(section => getComputedStyle(section).backgroundColor), 'rgb(241, 239, 232)', 'About’s ground is --paper');
    await assertReadable(page, '.about-lead, .about-more p, .about-column p, .about-column dd, .about-column li, #about .label.muted, .about-small', `${viewport.width}px wide`);
    await close();
  }
});

await check('the terminal’s tones read at 4.5:1 or more on its ground', async () => {
  const { page, close } = await openTerminal();
  assert.equal(await page.locator('.terminal').evaluate(terminal => getComputedStyle(terminal).backgroundColor), 'rgb(7, 7, 6)', 'the terminal’s ground');
  await enter(page, 'cd nope');
  await enter(page, 'neofetch');
  await enter(page, 'help');
  await enter(page, 'ls -l');
  for (const tone of ['.t-muted', '.t-dir', '.t-error', '.t-prompt', '.t-cmd', '.t-accent', '.t-heading', '.terminal-lines', '.terminal-chip', '.terminal-bar span']) {
    await assertReadable(page, `.terminal ${tone}`, tone);
  }
  await close();
});

await check('figures, project facts and visual captions read at 4.5:1 or more on the field', async () => {
  const { page, close } = await open();
  // Down the page once, so every visual is drawn and every figure has its tone.
  const end = await pageEnd(page);
  for (let top = 0; top <= end; top += 900) await scrollTo(page, top);
  await scrollTo(page, 0);
  await page.waitForTimeout(500);
  const count = await assertReadable(page, '.figure-value, .figure-label, .figure-detail, .project-facts dt, .project-facts dd, .project-visual-caption > span, .project-meta p, .project-index', 'Work');
  assert.ok(count >= 30, `only ${count} pieces of text were measured`);
  await close();
});

// ---- The terminal ----------------------------------------------------------------------------

await check('terminal: ls, cd, ls -l, cat and pwd walk the filesystem made from src/content.ts', async () => {
  const { page, close } = await openTerminal();
  const home = await enter(page, 'ls');
  const names = home.items.map(([name]) => name);
  for (const name of ['projects/', 'about.txt', 'contact.txt', 'resume.pdf']) assert.ok(names.includes(name), `ls lists ${names.join(' ')}, not ${name}`);
  const listed = await enter(page, 'cd projects && ls -l');
  assert.equal(listed.long, 'true', 'ls -l prints a long listing');
  assert.deepEqual(listed.items.map(([name]) => name), PROJECT_IDS.map(id => `${id}/`), 'ls -l in ~/projects');
  for (const project of projects) {
    const item = listed.items.find(([name]) => name === `${project.id}/`);
    assert.equal(item?.[1], `${project.role} · ${project.dates}`, `${project.id}'s description`);
  }
  const readme = await enter(page, 'cat freewheel/README.md');
  const freewheel = projects.find(project => project.id === 'freewheel');
  assert.ok(readme.output.includes(freewheel.title), `cat freewheel/README.md does not print "${freewheel.title}"`);
  assert.ok(readme.output.includes(freewheel.figures[0].value), `cat freewheel/README.md does not print ${freewheel.figures[0].value}`);
  assert.equal(await page.locator('.terminal-entry').last().locator('.t-heading').first().evaluate(line => line.textContent.trim()), freewheel.title, 'the README’s title is its heading');
  const binary = await enter(page, 'cat ../resume.pdf');
  assert.ok(/binary file/.test(binary.output) && /open resume\.pdf/.test(binary.output), `cat resume.pdf says "${binary.output}"`);
  const back = await enter(page, 'cd ..; pwd');
  assert.equal(back.output.trim(), '~', `cd ..; pwd prints "${back.output}"`);
  assert.ok((await page.locator('.terminal-line .t-prompt').textContent()).includes('~ %'), 'the prompt is back at ~');
  await close();
});

await check('terminal: a missing directory and an unknown command are errors, and && stops at the first failure', async () => {
  const { page, close } = await openTerminal();
  const missing = await enter(page, 'cd nope');
  assert.deepEqual(missing.errors, ['cd: no such file or directory: nope']);
  const unknown = await enter(page, 'nonsense');
  assert.ok(unknown.errors.some(error => /command not found: nonsense/.test(error)), `nonsense: ${unknown.errors}`);
  const chained = await enter(page, 'nonsense && ls');
  assert.equal(chained.errors.length, 1, `nonsense && ls: errors ${chained.errors}`);
  assert.deepEqual(chained.items, [], 'nonsense && ls goes on to ls');
  const carried = await enter(page, 'nonsense; pwd');
  assert.ok(/(^|\n)~\n?$/.test(carried.output), `nonsense; pwd stops before pwd ("${carried.output}")`);
  await close();
});

await check('terminal: Tab completes a name and lists the candidates when there are several; ↑ recalls and ↓ returns to the draft', async () => {
  const { page, close } = await openTerminal();
  await page.keyboard.type('cd pro');
  await page.keyboard.press('Tab');
  assert.equal(await typed(page), 'cd projects/', 'Tab after "cd pro"');
  await page.keyboard.press('Control+u');
  await page.keyboard.type('cat e');
  const before = await entries(page);
  await page.keyboard.press('Tab');
  await twoFrames(page);
  assert.equal(await entries(page), before + 1, 'an ambiguous Tab prints nothing');
  const listed = await entryOf(page);
  assert.deepEqual(listed.items.map(([name]) => name).sort(), ['earlier.txt', 'education.txt'], 'the candidates for "cat e"');
  assert.equal(await typed(page), 'cat e', 'the line after an ambiguous Tab');
  await page.keyboard.press('Control+u');
  await enter(page, 'pwd');
  await page.keyboard.type('ec');
  await page.keyboard.press('ArrowUp');
  assert.equal(await typed(page), 'pwd', '↑ recalls the last command');
  await page.keyboard.press('ArrowUp');
  assert.equal(await typed(page), 'ls', '↑ again recalls the one before');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  assert.equal(await typed(page), 'ec', '↓ returns to the draft');
  await close();
});

await check('terminal: Ctrl+L and clear empty the log; whoami prints the banner; help lists ls, cd, cat and open', async () => {
  const { page, close } = await openTerminal();
  assert.ok(await entries(page) >= 2, 'the greeting and the first ls are in the log');
  await page.keyboard.press('Control+l');
  await twoFrames(page);
  assert.equal(await entries(page), 0, 'entries after Ctrl+L');
  const banner = await enter(page, 'whoami');
  assert.ok(banner.banner, 'whoami prints no .terminal-banner');
  const help = await enter(page, 'help');
  for (const command of ['ls', 'cd', 'cat', 'open', 'sun']) assert.ok(new RegExp(`^\\s+${command}\\b`, 'm').test(help.output), `help does not list ${command}`);
  await enter(page, 'clear');
  assert.equal(await entries(page), 0, 'entries after clear');
  await close();
});

await check('terminal: open scrolls to a project and records it in the address; open resume.pdf and open github open new tabs', async () => {
  const { page, close } = await openTerminal({}, recordWindowOpen);
  await enter(page, 'open resume.pdf');
  await enter(page, 'open github');
  await enter(page, 'open linkedin');
  const opened = await page.evaluate(() => window.opened);
  assert.deepEqual(opened, [[profile.resumeUrl, '_blank', 'noopener'], [profile.github, '_blank', 'noopener'], [profile.linkedin, '_blank', 'noopener']], 'window.open calls');
  await enter(page, 'open comcast');
  assert.ok(await landed(page, 'comcast'), `open comcast leaves #comcast at ${JSON.stringify(await placeOf(page, 'comcast'))}`);
  assert.equal(await page.evaluate(() => window.location.hash), '#comcast');
  await glideDone(page);
  await close();
});

await check('terminal: sun pause and sun play stop and start the footage', async () => {
  const { page, close } = await openTerminal();
  await footageMoves(page);
  await enter(page, 'sun pause');
  await footagePaused(page, true).catch(() => assert.fail('sun pause leaves the footage playing'));
  assert.equal((await sunOf(page)).toggle, 'Play', 'the control under the Sun after sun pause');
  await enter(page, 'sun play');
  await footageMoves(page).catch(() => assert.fail('sun play does not start the footage'));
  assert.equal((await sunOf(page)).toggle, 'Pause', 'the control under the Sun after sun play');
  await close();
});

await check('terminal: the newest line stays in view after many commands', async () => {
  const { page, close } = await openTerminal();
  for (const line of ['help', 'ls -l', 'tree', 'neofetch', 'history', 'cat about.txt', 'help']) await enter(page, line);
  const screen = await page.locator('.terminal-screen').evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, full: element.scrollHeight }));
  assert.ok(screen.full > screen.height * 2, `the log is not long enough to scroll (${screen.full}px in ${screen.height}px)`);
  assert.ok(screen.top + screen.height >= screen.full - 2, `the screen is scrolled to ${screen.top}px of ${screen.full - screen.height}px`);
  assert.equal(await page.evaluate(() => window.scrollY <= 40), true, 'commands in the terminal scrolled the page');
  await close();
});

await check('terminal: a key typed with nothing focused and the terminal in view goes into the command line', async () => {
  const { page, close } = await open();
  await booted(page);
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'something holds focus');
  await page.keyboard.press('h');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('terminal-input')), true, 'the key leaves the keyboard elsewhere');
  assert.equal(await typed(page), 'h', 'the command line after typing h');
  const help = await enter(page, 'elp');
  assert.equal(help.command, 'help');
  // Away from the terminal, keys are left alone.
  await page.evaluate(() => document.activeElement?.blur());
  const y = await scrollTo(page, await page.evaluate(() => document.getElementById('about').getBoundingClientRect().top + window.scrollY));
  await page.keyboard.press('x');
  await twoFrames(page);
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true, 'a key typed over About took focus');
  assert.equal(await typed(page), '', 'a key typed over About went into the terminal');
  assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - y) <= 1, 'a key typed over About moved the page');
  await close();
});

await check('terminal: the buttons run their commands and change with the directory', async () => {
  const { page, close } = await open();
  await booted(page);
  const home = await chips(page);
  assert.ok(home.includes('help') && home.includes('cd projects'), `the buttons at ~: ${home.join(', ')}`);
  await page.locator('.terminal-chip', { hasText: /^help$/ }).click();
  await twoFrames(page);
  assert.equal((await entryOf(page)).command, 'help', 'the help button');
  await page.locator('.terminal-chip', { hasText: /^cd projects$/ }).click();
  await twoFrames(page);
  const inside = await chips(page);
  assert.ok(inside.includes('cd ..'), `the buttons in ~/projects: ${inside.join(', ')}`);
  assert.ok((await page.locator('.terminal-line .t-prompt').textContent()).includes('~/projects'), 'the prompt after cd projects');
  await page.locator('.terminal-chip', { hasText: /^cd \.\.$/ }).click();
  await twoFrames(page);
  assert.deepEqual(await chips(page), home, 'the buttons after cd ..');
  await close();
});

await check('terminal on a phone: its buttons are 32 px tall or more, and ls and ls -l fit its screen', async () => {
  const { page, close } = await open({ viewport: PHONE, hasTouch: true, isMobile: true });
  await booted(page);
  const buttons = await page.locator('.terminal-chip').evaluateAll(list => list.map(button => {
    const box = button.getBoundingClientRect();
    return { label: button.textContent, height: box.height, right: box.right, shown: getComputedStyle(button).visibility === 'visible' && box.width > 0 };
  }));
  assert.ok(buttons.length >= 4, `${buttons.length} buttons`);
  for (const button of buttons) {
    assert.ok(button.shown && button.height >= 32, `"${button.label}" is ${button.height}px tall`);
    assert.ok(button.right <= PHONE.width, `"${button.label}" ends ${button.right}px across`);
  }
  const fits = () => page.evaluate(() => {
    const screen = document.querySelector('.terminal-screen');
    return {
      screen: screen.scrollWidth - screen.clientWidth,
      listings: [...document.querySelectorAll('.terminal-listing')].map(listing => listing.scrollWidth - listing.clientWidth),
      rows: (() => {
        const items = [...document.querySelector('.terminal-listing').children].map(item => Math.round(item.getBoundingClientRect().top));
        return new Set(items).size;
      })(),
    };
  });
  const short = await fits();
  assert.ok(short.rows > 1, 'the ls listing does not wrap');
  assert.ok(short.screen <= 0 && short.listings.every(extra => extra <= 0), `ls overflows: ${JSON.stringify(short)}`);
  await page.locator('.terminal-chip', { hasText: /^ls -l$/ }).tap();
  await twoFrames(page);
  assert.equal((await entryOf(page)).long, 'true', 'the ls -l button');
  await page.locator('.terminal-chip', { hasText: /^cd projects$/ }).tap();
  await page.locator('.terminal-chip', { hasText: /^ls -l$/ }).tap();
  await twoFrames(page);
  const long = await fits();
  assert.ok(long.screen <= 0 && long.listings.every(extra => extra <= 0), `ls -l overflows: ${JSON.stringify(long)}`);
  assert.ok(await overflow(page) <= 0, 'the page scrolls sideways');
  await close();
});

await check('whoami’s banner fits the terminal at 1440 and 390 px, as the initials on a phone', async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const at = `${viewport.width}px wide`;
    const { page, close } = await openTerminal({ viewport });
    await enter(page, 'whoami');
    const banner = await page.locator('.terminal-banner').last().evaluate(pre => ({
      extra: pre.scrollWidth - pre.clientWidth,
      wide: getComputedStyle(pre.querySelector('.terminal-banner-wide')).display,
      narrow: getComputedStyle(pre.querySelector('.terminal-banner-narrow')).display,
      within: pre.getBoundingClientRect().right <= pre.closest('.terminal-screen').getBoundingClientRect().right,
    }));
    assert.ok(banner.extra <= 1 && banner.within, `${at}: the banner is ${banner.extra}px wider than its box`);
    assert.deepEqual([banner.wide, banner.narrow], viewport.width > 700 ? ['inline', 'none'] : ['none', 'inline'], `${at}: which banner shows (wide, narrow)`);
    await close();
  }
});

// ---- The index of work -----------------------------------------------------------------------

await check('the index of work: five rows lead to the five projects; hovering a row makes it current and previews its README', async () => {
  const { page, close } = await open();
  const rows = await page.locator('a.index-row').evaluateAll(links => links.map(link => ({ id: link.dataset.id, href: link.getAttribute('href'), target: !!document.querySelector(`article${link.getAttribute('href')}`) })));
  assert.deepEqual(rows.map(row => row.id), PROJECT_IDS, 'the rows');
  for (const row of rows) assert.ok(row.href === `#${row.id}` && row.target, `${row.id}'s row leads to ${row.href}`);
  for (const project of [...projects].reverse()) {
    await page.locator(`a.index-row[data-id="${project.id}"]`).hover();
    await page.waitForTimeout(350);
    const active = await page.locator('a.index-row[data-active="true"]').evaluateAll(links => links.map(link => link.dataset.id));
    assert.deepEqual(active, [project.id], `hovering ${project.id}`);
    const preview = await page.locator('.index-preview-screen').textContent();
    assert.ok(preview.includes(project.title), `hovering ${project.id}, the preview reads "${preview.slice(0, 80)}"`);
    await assertReadable(page, 'a.index-row[data-active="true"] .index-name', `hovering ${project.id}`);
  }
  await assertReadable(page, '.index-title, .index-number', 'the index');
  await close();
});

await check('the index of work: with no pointer over it, the row at the window’s middle is current', async () => {
  const { page, close } = await open();
  for (const project of projects) {
    const y = await page.locator(`a.index-row[data-id="${project.id}"]`).evaluate(row => {
      const box = row.getBoundingClientRect();
      return Math.round(box.top + window.scrollY + box.height / 2 - window.innerHeight / 2);
    });
    await scrollTo(page, y);
    await page.waitForTimeout(350);
    const active = await page.locator('a.index-row[data-active="true"]').evaluateAll(links => links.map(link => link.dataset.id));
    assert.deepEqual(active, [project.id], `with ${project.id}'s row at the middle (${y}px)`);
    await assertReadable(page, 'a.index-row[data-active="true"] .index-name', `${project.id} current`);
  }
  await close();
});

// ---- Pinned stages ---------------------------------------------------------------------------

await check('pinned stages: at 1440 px every visual pins below the header, holds still through its scrub, and its story follows the scroll', async () => {
  const { page, problems, close } = await open();
  const header = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height')));
  for (const id of PROJECT_IDS) {
    const stage = await stageOf(page, id);
    assert.ok(stage.pinned === 'on' && stage.sticky && stage.scrub > 0, `${id}: data-pinned ${stage.pinned}, sticky ${stage.sticky}, scrub ${stage.scrub}px`);
    assert.ok(stage.rest >= header + 24 - 0.5, `${id}: its block rests ${stage.rest}px down the window, under the header (${header}px)`);
    const tops = [];
    let last = -1;
    for (const share of [0.1, 0.5, 0.9]) {
      await scrollTo(page, Math.round(stage.start + stage.scrub * share));
      const now = await storySettled(page, id);
      tops.push(now.top);
      const wanted = storyAt(now, now.y);
      assert.ok(Math.abs(now.time - wanted) <= 0.02, `${id}, ${Math.round(share * 100)}% through its scrub: the story is at ${now.time}s, not ${wanted.toFixed(3)}s`);
      assert.ok(now.time > last, `${id}: the story goes back as the page goes on (${now.time}s after ${last}s)`);
      last = now.time;
    }
    assert.ok(tops.every(top => Math.abs(top - stage.rest) <= 1), `${id}: its block is at ${tops.map(top => top.toFixed(1)).join(', ')}px through its scrub, not held at ${stage.rest}px`);
    for (const [where, y] of [['before it comes to rest', Math.round(stage.start - 200)], ['after it lets go', Math.round(stage.release + 200)]]) {
      await scrollTo(page, y);
      const now = await stageOf(page, id);
      const expected = stage.rest + (now.y < stage.start ? stage.start - now.y : stage.release - now.y);
      assert.ok(Math.abs(now.top - expected) <= 1, `${id}, ${where} (${now.y}px): its block is at ${now.top.toFixed(1)}px, not ${expected.toFixed(1)}px`);
      assert.ok(Math.abs(now.top - stage.rest) > 100, `${id}, ${where}: its block is still held`);
    }
  }
  assert.deepEqual(problems, []);
  await close();
});

await check('pinned stages: with reduced motion nothing pins and the tracks make no room', async () => {
  const { page, close } = await open({ reducedMotion: 'reduce' });
  for (const id of PROJECT_IDS) {
    const stage = await stageOf(page, id);
    assert.deepEqual([stage.pinned, stage.sticky, stage.scrub], ['off', false, 0], `${id}: data-pinned, sticky, scrub`);
  }
  await close();
});

// ---- Navigation ------------------------------------------------------------------------------

await check('navigation: each link glides to its section, records it in the address, and moves focus to its heading', async () => {
  const { page, close } = await open();
  assert.ok(await page.evaluate(() => document.documentElement.classList.contains('lenis')), 'smooth scrolling is off');
  for (const [label, id] of [['Work', 'work'], ['About', 'about'], ['Contact', 'contact']]) {
    const from = await page.evaluate(() => window.scrollY);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true }).click();
    await twoFrames(page);
    const during = await page.evaluate(() => window.scrollY);
    assert.ok(await landed(page, id), `${label}: #${id} is not at its place 3 s after the click (${JSON.stringify(await placeOf(page, id))})`);
    const to = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(during - from) < Math.abs(to - from) - 2, `${label}: the page jumped from ${from}px to ${to}px instead of gliding (it was at ${during}px two frames in)`);
    assert.equal(await page.evaluate(() => window.location.hash), `#${id}`, `${label}: the address`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), `${id}-heading`, `${label}: focus`);
    await glideDone(page);
  }
  await close();
});

await check('navigation: the name in the header and Back to top return to the top and focus the opening heading', async () => {
  const { page, close } = await open();
  for (const selector of ['.site-name', '.back-to-top']) {
    await scrollTo(page, await pageEnd(page));
    await settle(page);
    await page.locator(selector).click();
    const top = await page.waitForFunction(() => window.scrollY <= 1, null, { timeout: 3000 }).then(() => true, () => false);
    assert.ok(top, `${selector}: the page is at ${await page.evaluate(() => window.scrollY)}px 3 s after the click`);
    assert.equal(await page.evaluate(() => window.location.hash), '#top', `${selector}: the address`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'hero-heading', `${selector}: focus`);
    await glideDone(page);
  }
  await close();
});

await check('navigation: a link opened fresh lands on its target, and opens case notes', async () => {
  for (const id of ['case-freewheel', 'about', 'terrier-motorsport']) {
    const { page, close } = await open({}, `#${id}`);
    await page.waitForTimeout(300);
    const place = await placeOf(page, id);
    assert.ok(Math.abs(place.top - place.margin) <= 2 || (place.y >= place.end - 1 && place.top >= place.margin - 2), `/#${id} opens with its target ${place.top.toFixed(1)}px down the window, not ${place.margin}px`);
    if (id.startsWith('case-')) assert.equal(await page.locator(`#${id}`).evaluate(details => details.open), true, `/#${id} opens with its notes closed`);
    await close();
  }
});

await check('navigation: a malformed fragment still shows the page', async () => {
  for (const fragment of ['#%', '#work%']) {
    const { page, problems, close } = await open({}, fragment);
    // The plain fallback page has a heading too, so look for the real one.
    assert.equal(await page.locator('h1#hero-heading').count(), 1, `/${fragment} renders the full page, not the plain fallback`);
    assert.deepEqual(problems, [], `/${fragment}: ${problems.join('; ')}`);
    await close();
  }
});

await check('navigation: reloading returns to the same place', async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const { page, close } = await open({ viewport });
    for (let attempt = 0; attempt < 2; attempt++) {
      const about = await page.evaluate(() => document.getElementById('about').getBoundingClientRect().top + window.scrollY);
      const before = Math.round(await scrollTo(page, Math.round(about + 300 + attempt * 500)));
      await settle(page);
      await page.reload();
      await fontsLoaded(page);
      await settle(page);
      const after = await page.evaluate(() => Math.round(window.scrollY));
      assert.ok(Math.abs(after - before) <= 2, `reload ${attempt + 1} at ${viewport.width}px: was at ${before}, came back at ${after}`);
    }
    await close();
  }
});

await check('navigation without smooth scrolling: with reduced motion each link jumps to its section at once', async () => {
  const { page, close } = await open({ reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lenis')), false, 'smooth scrolling is on under reduced motion');
  for (const [label, id] of [['Work', 'work'], ['About', 'about'], ['Contact', 'contact']]) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true }).click();
    await twoFrames(page);
    const place = await placeOf(page, id);
    assert.ok(Math.abs(place.top - place.margin) <= 2 || (place.y >= place.end - 1 && place.top >= place.margin - 2), `${label}: right after the click #${id} is ${place.top.toFixed(1)}px down the window, not ${place.margin}px`);
    assert.equal(await page.evaluate(() => window.location.hash), `#${id}`, `${label}: the address`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), `${id}-heading`, `${label}: focus`);
  }
  await close();
});

// ---- Keyboard --------------------------------------------------------------------------------

await check('keyboard: Tab from the top goes skip link, name, Work, About, Contact, Résumé, the Sun’s credit, Pause, the command line, then its buttons', async () => {
  const { page, close } = await open();
  await booted(page);
  const stops = [
    ['the skip link', '.skip-link'], ['the name', '.site-name'],
    ['Work', '.site-navigation a[href="#work"]'], ['About', '.site-navigation a[href="#about"]'], ['Contact', '.site-navigation a[href="#contact"]'], ['Résumé', '.site-navigation a[download]'],
    ['the Sun’s credit', '.corner-sun-caption a'], ['Pause', '.corner-sun-toggle'],
    ['the command line', '.terminal-input'], ['the first command button', '.terminal-chip'],
  ];
  for (const [what, selector] of stops) {
    await page.keyboard.press('Tab');
    await twoFrames(page);
    const now = await focused(page);
    const right = await page.evaluate(selector => document.activeElement === document.querySelector(selector), selector);
    // Tab pressed in the command line completes there; say what it did instead of moving on.
    const instead = !right && now.className.includes('terminal-input') ? ` (Tab there printed ${(await entryOf(page)).items.length} completions: ${(await entryOf(page)).items.map(([name]) => name).join(' ')})` : '';
    assert.ok(right, `the stop after the last should be ${what}; focus is on ${now.tag} "${now.label}"${instead}`);
  }
  await close();
});

await check('keyboard: focus is never hidden under the fixed header as Tab goes down the page (1440 and 390 px)', async () => {
  for (const viewport of [DESKTOP, PHONE]) {
    const at = `${viewport.width}px wide`;
    const { page, close } = await open({ viewport });
    await booted(page);
    // From the terminal's buttons on; the stops above them are in the header and the opening.
    await page.locator('.terminal-chip').first().focus();
    const seen = new Set();
    for (let stop = 0; stop < 60; stop++) {
      await page.keyboard.press('Tab');
      await twoFrames(page);
      await page.waitForTimeout(40);
      const now = await focused(page);
      if (now.tag === 'BODY') break;
      seen.add(now.label);
      if (now.inHeader) continue;
      assert.ok(now.top >= now.header - 1 && now.top < now.window, `${at}, stop ${stop + 1}: ${now.tag} "${now.label}" is focused ${now.top.toFixed(0)}px down the window; the header reaches ${now.header.toFixed(0)}px`);
    }
    assert.ok(seen.size >= 20, `${at}: only ${seen.size} stops were made`);
    await close();
  }
});

await check('keyboard: Escape and Enter in the terminal leave the page where it is', async () => {
  const { page, close } = await openTerminal();
  const y = await page.evaluate(() => window.scrollY);
  for (const key of ['Escape', 'Enter', 'Escape', 'Enter']) {
    await page.keyboard.press(key);
    await twoFrames(page);
  }
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.scrollY), y, 'the page moved');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('terminal-input')), true, 'the command line lost focus');
  await close();
});

// ---- Résumé, print and the build --------------------------------------------------------------

await check('the résumé links download a PDF with no phone number in it', async () => {
  const { page, close } = await open();
  const links = await page.locator('a[download]').evaluateAll(list => list.map(link => link.getAttribute('href')));
  assert.ok(links.length >= 2 && links.every(href => href === profile.resumeUrl), `résumé links: ${links.join(', ')}`);
  const response = await page.request.get(new URL(profile.resumeUrl, page.url()).href);
  assert.equal(response.status(), 200, 'the résumé is not there');
  assert.equal(response.headers()['content-type'], 'application/pdf');
  // The public copy must not carry a phone number in any formatting. The PDF's text sits in
  // compressed streams as short strings, so inflate every stream and join the strings a page shows.
  const pdf = await response.body();
  const streams = [...pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)].map(match => {
    try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { return match[1]; }
  });
  const shown = text => [...text.matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map(match => match[1]).join('');
  const pageText = streams.filter(text => /T[jJ]/.test(text)).map(shown).join('\n');
  assert.ok(pageText.includes('Owen'), 'the résumé text can be read (otherwise this check proves nothing)');
  const phone = /(?<!\d)\(?\d{3}\)?[^0-9A-Za-z]{0,3}\d{3}[^0-9A-Za-z]{0,3}\d{4}(?!\d)/;
  assert.ok(!phone.test(pageText), `a phone number in the public résumé: ${pageText.match(phone)?.[0]}`);
  assert.ok(![pdf.toString('latin1'), ...streams].some(text => /\/URI\s*\(\s*tel:/i.test(text)), 'a telephone link in the public résumé');
  await close();
});

await check('print leaves out the terminal, the Sun, the index and the header, and fits on 7 pages or fewer', async () => {
  const counts = [];
  for (const [viewport, place] of [[DESKTOP, 0], [DESKTOP, 0.4], [PHONE, 0]]) {
    const { page, close } = await open({ viewport });
    await scrollTo(page, Math.round((await pageEnd(page)) * place));
    await settle(page);
    counts.push(await printedPages(page));
    await close();
  }
  assert.ok(counts.every(count => count <= PRINT_PAGE_LIMIT), `prints on ${counts.join(', ')} pages; expected ${PRINT_PAGE_LIMIT} or fewer`);
  const { page, close } = await open();
  await page.emulateMedia({ media: 'print' });
  await twoFrames(page);
  for (const selector of ['.terminal', '.corner-sun', '.corner-sun-caption', '.index', '.site-header', '.skip-link']) {
    assert.equal(await page.locator(selector).first().evaluate(element => getComputedStyle(element).display), 'none', `${selector} is on paper`);
  }
  assert.ok(await page.locator('#freewheel h3').isVisible(), 'the projects are not on paper');
  await close();
});

await check('the built page carries its share tags, structured data and preloads', async () => {
  const html = readFileSync(new URL('index.html', DIST), 'utf8');
  const meta = property => html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1];
  assert.ok(meta('og:title')?.includes(profile.name), `og:title is "${meta('og:title')}"`);
  assert.ok(/\/og-image\.jpg$/.test(meta('og:image') ?? ''), `og:image is "${meta('og:image')}"`);
  assert.ok(existsSync(new URL('og-image.jpg', DIST)), 'og-image.jpg is not in dist');
  const schema = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(schema, 'no JSON-LD');
  const data = JSON.parse(schema);
  assert.equal(data['@type'], 'ProfilePage', 'the JSON-LD type');
  assert.equal(data.mainEntity?.name, profile.name, 'the JSON-LD person');
  const preloads = [...html.matchAll(/<link rel="preload"[^>]*>/g)].map(([tag]) => tag);
  const href = tag => tag.match(/href="([^"]*)"/)?.[1];
  assert.ok(preloads.some(tag => /as="image"/.test(tag) && href(tag) === SUN_FILES.still), `no preload for ${SUN_FILES.still}: ${preloads.join(' ')}`);
  for (const face of [/geist-mono-latin-wght-normal-[\w-]+\.woff2$/, /manrope-latin-wght-normal-[\w-]+\.woff2$/]) {
    const tag = preloads.find(tag => /as="font"/.test(tag) && face.test(href(tag) ?? ''));
    assert.ok(tag && /crossorigin/.test(tag), `no font preload matching ${face}`);
    assert.ok(existsSync(new URL(href(tag).slice(1), DIST)), `${href(tag)} is preloaded but not in dist`);
  }
});

await check('the build has its 404 page, robots.txt and the Sun it shows, and none of the files it does not use', async () => {
  for (const file of ['404.html', 'robots.txt', SUN_FILES.still.slice(1), SUN_FILES.video.slice(1), profile.resumeUrl.slice(1)]) assert.ok(existsSync(new URL(file, DIST)), `dist/${file} is missing`);
  assert.ok(/^User-agent: \*/m.test(readFileSync(new URL('robots.txt', DIST), 'utf8')), 'robots.txt names no user agent');
  assert.ok(/Page not found/.test(readFileSync(new URL('404.html', DIST), 'utf8')), '404.html does not say the page was not found');
  const published = SUN_FILES.unpublished.filter(file => existsSync(new URL(file, DIST)));
  assert.deepEqual(published, [], 'files the page does not use are published');
});

await check('the plain page built into #root names the five projects, for visitors and crawlers without JavaScript', async () => {
  const context = await browser.newContext({ viewport: DESKTOP, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(url);
  const plain = page.locator('#root > .plain-page');
  assert.equal(await plain.count(), 1, 'no #root > .plain-page');
  assert.ok(await plain.isVisible(), 'the plain page is hidden without JavaScript');
  const text = await plain.textContent();
  for (const project of projects) assert.ok(text.includes(project.title), `the plain page does not name "${project.title}"`);
  assert.ok(text.includes(profile.email), 'the plain page has no address');
  await context.close();
});

await check('fonts: the terminal and the labels are set in Geist Mono and the statement in Manrope, both loaded', async () => {
  const { page, close } = await open();
  const fonts = await page.evaluate(() => ({
    terminal: getComputedStyle(document.querySelector('.terminal')).fontFamily,
    label: getComputedStyle(document.querySelector('.label')).fontFamily,
    input: getComputedStyle(document.querySelector('.terminal-input')).fontFamily,
    headline: getComputedStyle(document.querySelector('.hero-headline')).fontFamily,
    mono: document.fonts.check('12px "Geist Mono Variable"'),
    sans: document.fonts.check('48px "Manrope Variable"'),
    loaded: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replace(/"/g, '')),
  }));
  for (const where of ['terminal', 'label', 'input']) assert.ok(/^"?Geist Mono Variable"?/.test(fonts[where]), `${where} is set in ${fonts[where]}`);
  assert.ok(/^"?Manrope Variable"?/.test(fonts.headline), `the statement is set in ${fonts.headline}`);
  assert.ok(fonts.mono && fonts.loaded.includes('Geist Mono Variable'), `Geist Mono is not loaded (${fonts.loaded.join(', ')})`);
  assert.ok(fonts.sans && fonts.loaded.includes('Manrope Variable'), `Manrope is not loaded (${fonts.loaded.join(', ')})`);
  await close();
});

await check('enlarged text spacing adds no sideways scrolling and keeps the header’s links clickable (1440 and 390 px)', async () => {
  // Every finding is gathered first, so one fault does not hide another.
  const faults = [];
  for (const viewport of [DESKTOP, PHONE]) {
    const at = `${viewport.width}px wide`;
    const { page, close } = await open({ viewport });
    await page.addStyleTag({ content: TEXT_SPACING });
    await page.waitForTimeout(500);
    const end = await pageEnd(page);
    for (const top of [0, Math.round(end / 2), end]) {
      await scrollTo(page, top);
      await page.waitForTimeout(200);
      const extra = await overflow(page);
      if (extra > 0) faults.push(`${at}, at ${top}px: the page is ${extra}px too wide: ${await pastTheEdge(page)}`);
    }
    for (const top of [0, 600]) {
      await scrollTo(page, top);
      await page.waitForTimeout(400);
      const links = await page.locator('.site-name, .site-navigation a').evaluateAll(list => list.map(link => {
        const box = link.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { label: link.textContent.trim(), reached: !!hit && link.contains(hit), inside: box.left >= 0 && box.right <= document.documentElement.clientWidth && box.top >= 0 };
      }));
      for (const link of links.filter(link => !link.reached || !link.inside)) faults.push(`${at}, at ${top}px: "${link.label}" ${link.reached ? 'is outside the window' : 'is covered'}`);
    }
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'About', exact: true }).click();
    if (!await landed(page, 'about')) faults.push(`${at}: About does not take the page to #about`);
    await close();
  }
  assert.deepEqual(faults, []);
});

await browser.close();
await server?.close();
const took = ((Date.now() - began) / 1000).toFixed(0);
console.log(failures.length ? `\n${failures.length} of ${ran} check(s) failed (${took} s):\n${failures.map(name => `  - ${name}`).join('\n')}` : `\nAll ${ran} checks passed (${took} s).`);
process.exit(failures.length ? 1 : 0);
