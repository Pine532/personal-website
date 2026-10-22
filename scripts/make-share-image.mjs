// Renders scripts/share-card.html to public/og-image.jpg, the 1200 x 630 image that link
// previews show. Run from the project root:  node scripts/make-share-image.mjs
// Edit the wording in share-card.html, then run this again. The Sun and its credit line are
// those of the version src/sun-source.json selects.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const STILLS = { simulated: 'sun-simulated-large.webp', observed: 'sun-aia304-desktop.webp' };
const { source } = JSON.parse(readFileSync(new URL('../src/sun-source.json', import.meta.url), 'utf8'));
const still = new URL(`../public/media/${STILLS[source]}`, import.meta.url);
const template = new URL('./share-card.html', import.meta.url);
const output = fileURLToPath(new URL('../public/og-image.jpg', import.meta.url));

// A browser that never starts or never answers must not hang `npm run assets`: give the whole job two minutes.
const watchdog = setTimeout(() => {
  console.error('make-share-image: the browser did not finish in two minutes; og-image.jpg was not written.');
  process.exit(1);
}, 120000);
const browser = await chromium.launch({ headless: true, ...(existsSync(CHROME) && { executablePath: CHROME }) });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(template.href);
await page.evaluate(({ source, still }) => {
  document.querySelector('.sun').src = still;
  for (const credit of document.querySelectorAll('.credit')) if (credit.dataset.source !== source) credit.remove();
}, { source, still: still.href });
// Wait for the typeface and the Sun; give up rather than hang if either never arrives.
await page.waitForFunction(() => document.fonts.check('62px "Manrope Variable"') && document.querySelector('.sun').naturalWidth > 0, null, { timeout: 30000 });
// Then for the Sun to be decoded and painted: a screenshot taken sooner can show it half-drawn.
await page.evaluate(async () => {
  await document.querySelector('.sun').decode();
  await new Promise(painted => requestAnimationFrame(() => requestAnimationFrame(painted)));
});
await page.screenshot({ path: output, type: 'jpeg', quality: 90 });
await browser.close();
clearTimeout(watchdog);
// Record which Sun the image shows and the still it was drawn from; the build refuses to run if
// either is no longer the selected Sun's.
const record = new URL('../src/sun-assets.json', import.meta.url);
const made = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : {};
const shareImage = { sun: source, still: createHash('sha256').update(readFileSync(still)).digest('hex') };
writeFileSync(record, `${JSON.stringify({ ...made, shareImage }, null, 2)}\n`);
console.log(`wrote ${output}`);
