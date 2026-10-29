// FreeWheel, "From backtesting to live predictions", drawn as one picture.
//
// A time ribbon splits the past into training, calibration and scoring windows, and a boundary marks
// where live serving begins. Under the calibration window sits a lens: per-event calibration pulls
// each point onto the amber ring where predicted equals observed, leaving a hollow ghost where it
// started and a trail, and the readout changes once, from the measured 6.07 to the measured 0.18.
// Right of the boundary, live canary auctions stream past, and a limited share of them bend into the
// calibrated model's lane. On a phone the lens and its readout sit side by side, an amber leader
// drops to the lens from the Calibrate window, and the lanes run full width beneath them, each
// labelled at its end.
//
// Times are seconds from the start of the story (hooks/useVisualClock.ts). While the story waits
// (t = 0) the ribbon's frame and names, the lens's rings and the live lanes are already drawn, the
// names and the live part quieter, so the panel is never an empty box. The story then goes in the
// order of the work: the Train and Calibrate windows come on, the points are calibrated and the
// readout changes, the Score window comes on a step after that has settled, and last the live part.
// It is complete at 5.8 s and holds still until 7.4 s; then the auction stream runs, repeating every
// 12 s (up to about 17 s on the narrowest phones, where it slows so that an auction takes more than
// 5 s to cross).

import { COLORS, clamp01, easeInOut, easeOut, el, fadeIn, phase, set, text } from './draw';
import type { SceneModule, Size } from './types';

/** Every word drawn in the art, exported so the site's checks can read them all without running the
    scene. The caption and the text alternative live in src/content.ts. A no-break space keeps a phrase
    on one line when its line wraps. Where there is a shorter form, the longer is drawn when it fits,
    so enlarged letter or word spacing gets the shorter one rather than an overflow. */
export const TEXT = {
  train: 'Train',
  trainDetail: 'on the past',
  calibrate: 'Calibrate',
  calibrateDetail: 'on held-out data',
  score: 'Score',
  scoreDetail: 'on a future-serving window',
  /** The live zone's title; a phone's ribbon has room for the short form only, unless it is wide. */
  liveTitle: 'Live canary auctions',
  live: 'Live',
  liveDetail: 'the calibrated model as a TensorFlow\u00A0SavedModel, 23\u00A0serving\u00A0inputs',
  ring: '1× · predicted = observed',
  ringShort: '1×',
  /** The readout's title on one line, or broken into the first of these whose lines all fit. */
  readoutTitle: 'Mean conversion-ratio error',
  readoutTitleLines: [['Mean conversion-', 'ratio error'], ['Mean', 'conversion-', 'ratio error']],
  before: '6.07',
  after: '0.18',
  readoutDetail: 'per-event calibration, from\u00A06.07',
  calibrated: 'Calibrated model',
  /** The calibrated lane on a phone whose ribbon says only 'Live', so that 'canary' is still said. */
  calibratedCanary: 'Calibrated model (canary)',
  production: 'Production model',
  /** One line, joined, when it fits; otherwise these two, each wrapped. */
  confirmed: ['Real-time predictions confirmed', 'a limited deployment, not a full rollout'],
  joiner: ' · ',
} as const;

/** The tones this scene gives a job, by contrast on the surface. */
const TONE = {
  /** Marks that must read (3.6:1): the ribbon's frame while it waits, the live boundary, the lanes,
      and where each point started. */
  ghost: COLORS.ghost,
  /** Where a trail recedes to once calibration is done: decoration (2.2:1). */
  recede: COLORS.firm,
  /** A window's name until it comes on, and the live part's words until it switches on: quieter than
      --muted, still 5.3:1. */
  waiting: '#8a887f',
  /** Amber at half strength over the surface (3.5:1): the calibrated lane. */
  amberHalf: '#817039',
} as const;

/**
 * The points in the lens, by angle (degrees clockwise from the right), with schematic ratios of
 * predicted to observed conversions before and after per-event calibration. There is one point for
 * each of the nine conversion events the means were measured over; the values are illustrative
 * (the caption says so), chosen so their mean distance from 1 is the
 * measured 6.07 before and 0.18 after, so the drawing agrees with the readout. Only the 1× ring is
 * labelled, so no single value can be read off. The gap on the right holds the ring's label.
 */
const POINTS = [
  { angle: 28, before: 6.4, after: 1.16 },
  { angle: 66, before: 10.6, after: 0.83 },
  { angle: 104, before: 4.2, after: 1.22 },
  { angle: 142, before: 7.3, after: 0.81 },
  { angle: 180, before: 8.1, after: 0.82 },
  { angle: 218, before: 3, after: 1.18 },
  { angle: 256, before: 9.4, after: 0.85 },
  { angle: 294, before: 6.84, after: 1.17 },
  { angle: 332, before: 7.79, after: 1.2 },
] as const;

/** The story, in seconds. */
const T = {
  // A ribbon window comes on: it fills its frame left to right (ease-out) as its name comes up to its
  // full tone, its detail just after. Train and Calibrate do at the start; Score waits (see `score`).
  grow: [0, 0.25],
  growFor: [0.55, 0.4, 0.5], // the long training window takes a little longer, and Score has the stage to itself
  leader: 0.45, // on a phone, the leader drops from the Calibrate window to the lens
  appear: 0.5, // the points fade in outside the ring, with the readout at 6.07
  appearStagger: 0.04,
  appearFor: 0.5,
  calibrate: 1.2, // each point is pulled onto the ring in turn
  calibrateStagger: 0.13,
  travel: 0.9,
  ring: 2.7, // the 1× ring brightens as the last points land
  swap: 2.9, // 6.07 gives way to 0.18 in one 300 ms crossfade
  detail: 3.2,
  settle: 2.9, // the trails recede
  score: 4, // the calibrated model is scored: the Score window comes on once all of that has settled
  boundary: 5, // the live boundary draws down
  liveOn: 5.2, // and the live part switches on
  done: 5.8, // the live part is on, and the picture complete
  stream: 7.4, // the quiet loop: live auctions start to flow
};

/** The auction stream. */
const SPAWN = 0.3; // seconds between auctions, on average, at full speed
const SPEED = 72; // px per second, at full speed
const GAP = SPAWN * SPEED; // px between auctions, on average, at any speed
/** On a phone the lanes span the art, so the stream slows until an auction takes this long to cross
    them, and auctions enter that much less often, so the spacing and the canary rhythm stay. */
const CROSS = 5.25;
const CYCLE = 40; // auctions before the pattern repeats: 12 s at full speed
/** Which auctions in a cycle the calibrated model serves: a limited share, schematic. */
const CANARY = new Set([2, 7, 17, 22, 31]);
/** The calibrated model's node lights as a canary auction reaches it: a 60 ms rise, a 300 ms fall.
    The production model's node stays still, so the loop has no metronome. */
const LIGHT = { rise: 0.06, fall: 0.3 };

/** The frame without motion: everything in place, and two or three canary auctions on the lanes. */
const STILL = T.stream + 14.3;
/** How many auctions have entered by the still, at full speed. The stream is counted from here, so the
    still is the same picture at every speed. */
const STILL_AUCTIONS = (STILL - T.stream) / SPAWN;

const hash = (seed: number) => {
  let n = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
const slot = (n: number) => ((n % CYCLE) + CYCLE) % CYCLE;
/** When auction n enters the lanes, counted in auctions: evenly on average, but not quite. */
const entry = (n: number) => n + (hash(slot(n) * 7919 + 5) - 0.5) * 0.7;
const smoothstep = (k: number) => k * k * (3 - 2 * k);
/** How brightly the calibrated model's node is lit, `since` seconds after a canary auction reached it. */
const glow = (since: number) => {
  if (since < 0) return 0;
  if (since < LIGHT.rise) return since / LIGHT.rise;
  const k = 1 - clamp01((since - LIGHT.rise) / LIGHT.fall);
  return k * k;
};

/** A color between two #rrggbb colors. */
function mixColor(from: string, to: string, k: number) {
  if (k <= 0) return from;
  if (k >= 1) return to;
  let out = '#';
  for (let i = 1; i < 7; i += 2) {
    const a = parseInt(from.slice(i, i + 2), 16);
    const b = parseInt(to.slice(i, i + 2), 16);
    out += Math.round(a + (b - a) * k).toString(16).padStart(2, '0');
  }
  return out;
}

type Measure = (content: string, size: number, weight?: number) => number;

/** Measures text as the art will draw it, letter and word spacing included (used while building
    only, never per frame). */
function measurer(svg: SVGSVGElement) {
  const probe = el('text', { x: -9999, y: -9999, opacity: 0 }, svg);
  const cache = new Map<string, number>();
  const measure: Measure = (content, size, weight = 400) => {
    const key = `${size}/${weight}/${content}`;
    let width = cache.get(key);
    if (width === undefined) {
      probe.setAttribute('font-size', String(size));
      probe.setAttribute('font-weight', String(weight));
      probe.textContent = content;
      width = probe.getComputedTextLength();
      cache.set(key, width);
    }
    return width;
  };
  return { measure, dispose: () => probe.remove() };
}

/** Greedy line breaks at spaces (no-break spaces hold). */
function wrap(content: string, size: number, room: number, measure: Measure, weight = 400) {
  const lines: string[] = [];
  let line = '';
  for (const word of content.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size, weight) > room) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

type TimeWindow = { bar: SVGRectElement; name: SVGTextElement; detail: SVGTextElement | null; start: number; duration: number; width: number };
type Point = {
  dx: number;
  dy: number;
  from: number; // log2 of predicted ÷ observed, before
  to: number; // and after
  appear: number;
  move: number;
  ghost: SVGCircleElement;
  trail: SVGLineElement;
  dot: SVGCircleElement;
};
/** A word of the live part, drawn in TONE.waiting until the part switches on, then in `tone`. */
type Word = { node: SVGTextElement; tone: string };

function build(host: HTMLElement, { width: W, height: H, layout }: Size) {
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, host);
  const { measure, dispose } = measurer(svg);
  const narrow = layout === 'narrow';
  const wide = layout === 'wide';
  const edge = 4; // nothing but lanes and the boundary comes closer to the art's edges

  /* ---------- the time ribbon ---------- */
  const labelSize = 13;
  const labelY = narrow ? 14 : 16;
  const detailY = 32;
  const barTop = narrow ? 21 : 41;
  const barHeight = narrow ? 10 : 12;
  const liveGap = narrow ? 8 : 14; // from the boundary to the live zone's words
  const labelWidth = (content: string) => measure(content, labelSize, 450);

  // Train ≈34% of the width, Calibrate and Score ≈13% each, the boundary at ≈62%; a window widens
  // just enough to hold its name. On a phone the live zone's title follows the boundary in the ribbon:
  // its long form where it fits as it is, otherwise 'Live', for which Train, the longest window, gives
  // up width, and then every window some of its spare room. Under the widest text spacing at the
  // narrowest width the title is left out rather than run off the art.
  const stops = (pad: number, title: string, squeeze: boolean) => {
    const room = (content: string) => labelWidth(content) + pad;
    const least = edge + room(TEXT.train);
    let calX = Math.max(0.34 * W, least);
    let scoreX = Math.max(0.47 * W, calX + room(TEXT.calibrate));
    let scoreEnd = Math.max(0.6 * W, scoreX + room(TEXT.score));
    let boundaryX = Math.max(0.62 * W, scoreEnd + 0.02 * W);
    let over = title ? boundaryX + 0.5 + liveGap + labelWidth(title) - (W - edge) : 0;
    if (over > 0 && squeeze) {
      const give = Math.min(over, calX - least);
      calX -= give;
      scoreX -= give;
      scoreEnd -= give;
      boundaryX -= give;
      over -= give;
    }
    return { calX: Math.round(calX), scoreX: Math.round(scoreX), scoreEnd: Math.round(scoreEnd), boundaryX: Math.floor(boundaryX) + 0.5, title, fits: over <= 0 };
  };
  const options = narrow ? [stops(14, TEXT.liveTitle, false), stops(14, TEXT.live, true), stops(8, TEXT.live, true)] : [];
  const { calX, scoreX, scoreEnd, boundaryX, title: ribbonTitle } = options.find(option => option.fits) ?? stops(narrow ? 8 : 12, '', false);

  const ribbon = el('g', {}, svg);
  // The ribbon's frame is there from the start, with the windows' names in the waiting tone, so the
  // waiting panel shows its structure; each window then fills over it, in its turn.
  const frameTop = barTop + 0.5;
  const frameBottom = barTop + barHeight - 0.5;
  el('path', {
    d: `M${edge + 0.5} ${frameTop}H${scoreEnd - 0.5}V${frameBottom}H${edge + 0.5}Z` +
      `M${calX + 0.5} ${frameTop}V${frameBottom}M${scoreX + 0.5} ${frameTop}V${frameBottom}`,
    fill: 'none', stroke: TONE.ghost, 'stroke-width': 1,
  }, ribbon);
  const windowSpecs = [
    { x0: edge, x1: calX, label: TEXT.train, detail: TEXT.trainDetail, stroke: TONE.ghost, fill: COLORS.muted, fillOpacity: 0.08 },
    { x0: calX, x1: scoreX, label: TEXT.calibrate, detail: TEXT.calibrateDetail, stroke: COLORS.amber, fill: COLORS.amber, fillOpacity: 0.16 },
    { x0: scoreX, x1: scoreEnd, label: TEXT.score, detail: TEXT.scoreDetail, stroke: COLORS.reading, fill: COLORS.text, fillOpacity: 0.1 },
  ];
  // The windows' second lines appear on all three or on none: each must end 8 px before the next
  // window's name, the last before the boundary. A phone has no room for them.
  const limits = [calX, scoreX, boundaryX - 0.5];
  const details = !narrow && windowSpecs.every((spec, i) => measure(spec.detail, 12) + 8 <= (limits[i] ?? 0) - spec.x0);
  const windows: TimeWindow[] = windowSpecs.map((spec, i) => {
    const bar = el('rect', {
      x: spec.x0 + 0.75, y: barTop + 0.75, width: 0, height: barHeight - 1.5,
      fill: spec.fill, 'fill-opacity': spec.fillOpacity, stroke: spec.stroke, 'stroke-width': 1.5, opacity: 0,
    }, ribbon);
    const name = text(ribbon, spec.label, { x: spec.x0, y: labelY, 'font-size': labelSize, 'font-weight': 450, fill: TONE.waiting });
    const detail = details ? text(ribbon, spec.detail, { x: spec.x0, y: detailY, 'font-size': 12, fill: COLORS.muted, opacity: 0 }) : null;
    return { bar, name, detail, start: [...T.grow, T.score][i] ?? 0, duration: T.growFor[i] ?? 0.4, width: spec.x1 - spec.x0 };
  });

  // Where the backtests end and live serving begins. On a phone it divides the ribbon only.
  const boundaryTop = edge;
  const boundaryBottom = narrow ? barTop + barHeight + 3 : H;
  const boundary = el('line', {
    x1: boundaryX, x2: boundaryX, y1: boundaryTop, y2: boundaryTop,
    stroke: TONE.ghost, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0,
  }, svg);

  /* ---------- the lens ---------- */
  // The 1× ring's radius and the spacing per doubling: r1 32 and 20 px wide; a little smaller on a
  // phone narrower than 342 px, so the readout beside it keeps its lines.
  const small = narrow ? clamp01((W - 272) / 70) : 1;
  const r1 = wide ? 32 : narrow ? 22 + 2 * small : 24;
  const perDoubling = wide ? 20 : narrow ? 13 + 2 * small : 14;
  const dotRadius = 3.5;
  const ghostRadius = 2.5;
  const radius = (ratio: number) => r1 + perDoubling * Math.log2(ratio);
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  // How far the lens reaches from its centre on each side: its outermost ring, and the points where
  // they start (each with its knockout stroke), which is where their ghosts stay.
  const outerRing = radius(8);
  const outer = outerRing + 0.5;
  const pointReach = dotRadius + 0.75;
  const reach = { left: outer, right: outer, top: outer, bottom: outer };
  for (const p of POINTS) {
    const r = radius(p.before);
    const x = Math.cos(rad(p.angle)) * r;
    const y = Math.sin(rad(p.angle)) * r;
    reach.left = Math.max(reach.left, -x + pointReach);
    reach.right = Math.max(reach.right, x + pointReach);
    reach.top = Math.max(reach.top, -y + pointReach);
    reach.bottom = Math.max(reach.bottom, y + pointReach);
  }

  // The ring's contour label runs right from the ring, through the gap the points leave.
  const ringLabelSize = 12;
  const oneX = measure(TEXT.ringShort, ringLabelSize);
  const ringLabelWidth = measure(TEXT.ring, ringLabelSize);

  // The readout: what the points add up to, a step smaller than the figure strip above the panel.
  const valueSize = 24;
  const titleSize = 13;

  let cx: number;
  let cy: number;
  let readoutX: number;
  let readoutAnchor: 'start' | 'middle' | 'end';
  let readoutRoom: number;
  let ringLabel: string = TEXT.ring;
  if (wide) {
    // Centred under Calibrate; the readout sits against its left side. The ring's label runs to the
    // right, short of the boundary (under wide text spacing it is just '1×').
    cx = Math.round((calX + scoreX) / 2) + 0.5;
    cy = Math.round(56 + (H - 56) / 2);
    if (cx + r1 - oneX / 2 + ringLabelWidth + 12 > boundaryX) ringLabel = TEXT.ringShort;
    readoutAnchor = 'end';
    readoutX = Math.round(cx - reach.left - 24);
    readoutRoom = readoutX - edge;
  } else if (!narrow) {
    // Centred under Calibrate, unless its label needs more room before the boundary; the readout below.
    const labelReach = r1 - oneX / 2 + ringLabelWidth + 16;
    cx = Math.floor(Math.max(edge + reach.left, Math.min((calX + scoreX) / 2, boundaryX - labelReach)) - 0.5) + 0.5;
    if (cx + labelReach > boundaryX + 0.01) ringLabel = TEXT.ringShort;
    cy = 136;
    readoutAnchor = 'middle';
    readoutX = cx;
    readoutRoom = 2 * Math.min(cx - edge, W - edge - cx);
  } else {
    // At the left, with the readout to its right; on a wider column it moves toward the centre of
    // Calibrate, as long as the readout keeps its single lines beside it.
    const readoutWidth = Math.max(measure(TEXT.readoutTitle, titleSize, 450), measure(TEXT.readoutDetail, 12));
    const roomiest = W - edge - readoutWidth - 12 - reach.right;
    cx = Math.max(Math.ceil(edge + reach.left - 0.5), Math.floor(Math.min((calX + scoreX) / 2, roomiest) - 0.5)) + 0.5;
    cy = 125;
    ringLabel = TEXT.ringShort;
    readoutAnchor = 'start';
    readoutX = Math.floor(cx + reach.right + 12);
    readoutRoom = W - edge - readoutX;
  }

  const lens = el('g', {}, svg);
  for (const m of [2, 4, 8]) el('circle', { cx, cy, r: radius(m), fill: 'none', stroke: COLORS.line, 'stroke-width': 1 }, lens);
  el('path', { d: `M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`, stroke: COLORS.line, 'stroke-width': 1 }, lens);
  // At half strength (3.5:1) until the points land on it.
  const ring = el('circle', { cx, cy, r: r1, fill: 'none', stroke: COLORS.amber, 'stroke-width': 1.5, 'stroke-opacity': 0.5 }, lens);

  // On a phone the lens often sits beside the Calibrate window rather than under it, so a 1 px amber
  // leader ties the two: it drops from the window's lower edge to the lens's outer ring, through the
  // gap the points leave at the top right (or at the top left, if that is what falls inside the window).
  let leader: SVGLineElement | null = null;
  let leaderTop = 0;
  let leaderEnd = 0;
  if (narrow) {
    const inside = (x: number) => x >= calX + 6 && x <= scoreX - 6;
    const candidates = [305, 255].map(degrees => cx + Math.cos(rad(degrees)) * outerRing);
    const x = Math.round(candidates.find(inside) ?? Math.min(Math.max(candidates[0] ?? cx, calX + 6), scoreX - 6)) + 0.5;
    const dx = x - cx;
    if (Math.abs(dx) < outerRing - 4) {
      leaderTop = barTop + barHeight;
      leaderEnd = cy - Math.sqrt(outerRing * outerRing - dx * dx);
      leader = el('line', { x1: x, x2: x, y1: leaderTop, y2: leaderTop, stroke: COLORS.amber, 'stroke-width': 1, opacity: 0 }, svg);
    }
  }

  // A masked contour label: "1×" sits on the ring, which breaks behind it.
  const contour = el('g', { opacity: 0 }, svg);
  const contourX = cx + r1 - oneX / 2;
  const contourWidth = measure(ringLabel, ringLabelSize);
  el('rect', { x: contourX - 3, y: cy - 7, width: contourWidth + 6, height: 14, fill: COLORS.surface }, contour);
  text(contour, ringLabel, { x: contourX, y: cy + 4, 'font-size': ringLabelSize, fill: COLORS.muted });

  // Ghosts and trails under the points.
  const trails = el('g', {}, svg);
  const ghosts = el('g', {}, svg);
  const dots = el('g', {}, svg);
  const points: Point[] = POINTS.map((p, i) => {
    const dx = Math.cos(rad(p.angle));
    const dy = Math.sin(rad(p.angle));
    const r = radius(p.before);
    const x = cx + dx * r;
    const y = cy + dy * r;
    return {
      dx, dy,
      from: Math.log2(p.before),
      to: Math.log2(p.after),
      appear: T.appear + i * T.appearStagger,
      move: T.calibrate + i * T.calibrateStagger,
      trail: el('line', { x1: x, y1: y, x2: x, y2: y, stroke: TONE.ghost, 'stroke-width': 1, opacity: 0 }, trails),
      ghost: el('circle', { cx: x, cy: y, r: ghostRadius, fill: COLORS.surface, stroke: TONE.ghost, 'stroke-width': 1, opacity: 0 }, ghosts),
      dot: el('circle', { cx: x, cy: y, r: dotRadius, fill: COLORS.text, stroke: COLORS.surface, 'stroke-width': 1.5, opacity: 0 }, dots),
    };
  });

  /* ---------- the readout ---------- */
  const titleForms: readonly (readonly string[])[] = [[TEXT.readoutTitle], ...TEXT.readoutTitleLines];
  const titleLines = titleForms.find(lines => lines.every(line => measure(line, titleSize, 450) <= readoutRoom)) ?? TEXT.readoutTitleLines[1];
  const detailLines = wrap(TEXT.readoutDetail, 12, readoutRoom, measure);
  const lineGap = 16;
  const valueCap = 0.73 * valueSize;
  const blockHeight = 10 + (titleLines.length - 1) * lineGap + 11 + valueCap + 20 + (detailLines.length - 1) * lineGap + 3;
  const blockTop = wide || narrow ? cy - blockHeight / 2 : cy + reach.bottom + 13;
  const titleY = Math.round(blockTop + 10);
  const valueY = Math.round(titleY + (titleLines.length - 1) * lineGap + 11 + valueCap);
  const detailLineY = valueY + 20;

  const readout = el('g', { opacity: 0 }, svg);
  titleLines.forEach((line, i) => {
    text(readout, line, { x: readoutX, y: titleY + i * lineGap, 'font-size': titleSize, 'font-weight': 450, fill: COLORS.text, 'text-anchor': readoutAnchor });
  });
  const valueAttributes = { x: readoutX, y: valueY, 'font-size': valueSize, 'font-weight': 300, 'letter-spacing': '-0.035em', fill: COLORS.text, 'text-anchor': readoutAnchor };
  const before = text(readout, TEXT.before, valueAttributes);
  const after = text(readout, TEXT.after, { ...valueAttributes, opacity: 0 });
  const readoutDetail = el('g', { opacity: 0 }, svg);
  detailLines.forEach((line, i) => {
    text(readoutDetail, line, { x: readoutX, y: detailLineY + i * lineGap, 'font-size': 12, fill: COLORS.muted, 'text-anchor': readoutAnchor });
  });

  /* ---------- live canary auctions ---------- */
  // Drawn from the start, quieter: its words in TONE.waiting and its lanes and nodes in the ghost
  // tone. It switches on once calibration is done.
  const live = el('g', {}, svg);
  const words: Word[] = [];
  const word = (content: string, tone: string, attributes: Record<string, string | number>) => {
    words.push({ node: text(live, content, { ...attributes, fill: TONE.waiting }), tone });
  };
  const liveX = boundaryX - 0.5 + liveGap;
  let x0: number;
  let xe: number;
  let canY: number;
  let prodY: number;
  if (narrow) {
    if (ribbonTitle) word(ribbonTitle, COLORS.text, { x: liveX, y: labelY, 'font-size': labelSize, 'font-weight': 450 });
    // Lanes full width, each labelled at its end, flush with its node: the calibrated lane above, the
    // production lane below.
    canY = 228.5;
    prodY = 246.5;
    x0 = 0;
    xe = Math.floor(W - edge - 4.5) + 0.5; // the end nodes, stroke included, stay 4 px in
    const labelEnd = xe + 4;
    const forms = ribbonTitle === TEXT.liveTitle ? [TEXT.calibrated] : [TEXT.calibratedCanary, TEXT.calibrated];
    const canaryLabel = forms.find(form => measure(form, 12) <= labelEnd - edge) ?? TEXT.calibrated;
    word(canaryLabel, COLORS.reading, { x: labelEnd, y: canY - 10, 'font-size': 12, 'text-anchor': 'end' });
    word(TEXT.production, COLORS.reading, { x: labelEnd, y: prodY + 16, 'font-size': 12, 'text-anchor': 'end' });
  } else {
    const textRoom = W - edge - liveX;
    const title = labelWidth(TEXT.liveTitle) <= textRoom ? TEXT.liveTitle : TEXT.live;
    word(title, COLORS.text, { x: liveX, y: labelY, 'font-size': labelSize, 'font-weight': 450 });
    wrap(TEXT.liveDetail, 12, textRoom, measure).forEach((line, i) => {
      word(line, COLORS.muted, { x: liveX, y: detailY + i * lineGap, 'font-size': 12 });
    });
    // The lanes straddle the lens's centre. Wide, each lane's label shares a baseline with a line of
    // the readout across the panel; the lane meets its label at the middle of the lowercase letters.
    const canaryLabelY = wide ? titleY : Math.round(cy - 20) + 4;
    const productionLabelY = wide ? detailLineY : Math.round(cy + 20) + 4;
    canY = canaryLabelY - 3.5;
    prodY = productionLabelY - 3.5;
    const laneLabel = Math.max(measure(TEXT.calibrated, 12), measure(TEXT.production, 12));
    x0 = boundaryX;
    xe = Math.floor(W - edge - laneLabel - 12) - 0.5;
    word(TEXT.calibrated, COLORS.reading, { x: xe + 12, y: canaryLabelY, 'font-size': 12 });
    word(TEXT.production, COLORS.reading, { x: xe + 12, y: productionLabelY, 'font-size': 12 });
    const joined = TEXT.confirmed.join(TEXT.joiner);
    const confirmed = measure(joined, 12) <= textRoom ? [joined] : TEXT.confirmed.flatMap(part => wrap(part, 12, textRoom, measure));
    confirmed.forEach((line, i) => {
      word(line, COLORS.muted, { x: liveX, y: productionLabelY + 36 + i * lineGap, 'font-size': 12 });
    });
  }
  const laneLength = xe - x0;
  const xs = Math.round(x0 + Math.max(40, Math.min(110, 0.28 * laneLength))); // where the canary lane splits off
  const bend = Math.round(Math.max(36, Math.min(80, 0.3 * laneLength)));
  // The calibrated lane first, so the production lane runs unbroken past the split.
  const canaryLane = el('path', {
    d: `M${xs} ${prodY}C${xs + bend / 3} ${prodY} ${xs + (2 * bend) / 3} ${canY} ${xs + bend} ${canY}H${xe}`,
    fill: 'none', stroke: TONE.ghost, 'stroke-width': 1,
  }, live);
  el('path', { d: `M${x0} ${prodY}H${xe}`, fill: 'none', stroke: TONE.ghost, 'stroke-width': 1 }, live);

  // The canary lane's S-bend, measured by arc length so that every auction travels at the same
  // speed, bend or not (the lane's path is x = xs + bend·u, y = prodY − rise·smoothstep(u)).
  const rise = prodY - canY;
  const SAMPLES = 32;
  const bendLengths = [0];
  for (let k = 1; k <= SAMPLES; k++) {
    const a = (k - 1) / SAMPLES;
    const b = k / SAMPLES;
    bendLengths.push((bendLengths[k - 1] ?? 0) + Math.hypot(bend * (b - a), rise * (smoothstep(b) - smoothstep(a))));
  }
  const bendLength = bendLengths[SAMPLES] ?? bend;
  const toSplit = xs - x0;
  const productionPath = xe - x0;
  const canaryPath = toSplit + bendLength + (xe - xs - bend);
  /** Where an auction is once it has travelled `d` px along its lane. */
  const place = (d: number, canary: boolean): [number, number] => {
    if (!canary || d <= toSplit) return [x0 + d, prodY];
    const s = d - toSplit;
    if (s >= bendLength) return [xs + bend + (s - bendLength), canY];
    let k = 1;
    while (k < SAMPLES && (bendLengths[k] ?? Infinity) < s) k++;
    const from = bendLengths[k - 1] ?? 0;
    const to = bendLengths[k] ?? bendLength;
    const u = (k - 1 + (s - from) / Math.max(1e-6, to - from)) / SAMPLES;
    return [xs + bend * u, prodY - rise * smoothstep(u)];
  };

  // The stream's pace: on a phone, slow enough that an auction takes CROSS seconds to cross.
  const speed = narrow ? Math.min(SPEED, productionPath / CROSS) : SPEED;
  const spawn = speed === SPEED ? SPAWN : GAP / speed;
  // How long an auction is in flight or lighting its node, counted in auctions; and the first auction
  // drawn, the one entering as the stream starts.
  const lifeAuctions = (canaryPath / speed + LIGHT.rise + LIGHT.fall + 0.1) / spawn;
  const firstAuction = Math.max(0, Math.ceil(STILL_AUCTIONS - (STILL - T.stream) / spawn - 1e-6));

  // The auctions in flight (enough for a full lane), then the two models at the lanes' ends.
  const flight = el('g', {}, live);
  const pool = Array.from({ length: Math.ceil(lifeAuctions) + 4 }, () => el('circle', { r: 2.25, fill: COLORS.muted, opacity: 0 }, flight));
  const canaryNode = el('circle', { cx: xe, cy: canY, r: 3.5, fill: COLORS.surface, stroke: TONE.ghost, 'stroke-width': 1.25 }, live);
  const productionNode = el('circle', { cx: xe, cy: prodY, r: 3.5, fill: COLORS.surface, stroke: TONE.ghost, 'stroke-width': 1.25 }, live);

  dispose();

  const visited = new Uint8Array(pool.length);

  return {
    render(t: number) {
      // The ribbon: each window fills its frame left to right as its name comes up, its detail
      // arriving with it.
      for (const w of windows) {
        const k = easeOut(phase(t, w.start, w.duration));
        set(w.bar, 'width', Math.max(0, w.width * k - 1.5));
        set(w.bar, 'opacity', k > 0.01 ? 1 : 0);
        set(w.name, 'fill', mixColor(TONE.waiting, COLORS.text, k));
        if (w.detail) fadeIn(w.detail, t, w.start + 0.1, 0.4, 4);
      }
      if (leader) {
        const drawn = easeOut(phase(t, T.leader, 0.4));
        set(leader, 'y2', leaderTop + (leaderEnd - leaderTop) * drawn);
        set(leader, 'opacity', drawn > 0 ? 1 : 0);
      }

      // The lens: points arrive outside the ring, then calibration pulls each onto it, linearly in
      // log space, leaving a ghost and a trail.
      fadeIn(contour, t, T.appear, 0.4);
      set(ring, 'stroke-opacity', 0.5 + 0.5 * easeOut(phase(t, T.ring, 0.6)));
      const trailColor = mixColor(TONE.ghost, TONE.recede, easeOut(phase(t, T.settle, 0.8)));
      for (const p of points) {
        const shown = easeOut(phase(t, p.appear, T.appearFor));
        const moved = easeInOut(phase(t, p.move, T.travel));
        const r = r1 + perDoubling * (p.from + (p.to - p.from) * moved);
        const x = cx + p.dx * r;
        const y = cy + p.dy * r;
        set(p.dot, 'cx', x);
        set(p.dot, 'cy', y);
        set(p.dot, 'opacity', shown);
        set(p.dot, 'r', dotRadius * (0.85 + 0.15 * shown));
        set(p.ghost, 'opacity', clamp01(moved * 4));
        set(p.trail, 'x2', x);
        set(p.trail, 'y2', y);
        set(p.trail, 'opacity', moved > 0 ? 1 : 0);
        set(p.trail, 'stroke', trailColor);
      }

      // The readout shows only the two measured means: 6.07, then 0.18.
      fadeIn(readout, t, T.appear, 0.4, 4);
      set(before, 'opacity', 1 - easeOut(phase(t, T.swap, 0.18)));
      set(after, 'opacity', easeOut(phase(t, T.swap + 0.06, 0.24)));
      fadeIn(readoutDetail, t, T.detail, 0.4, 4);

      // Live: the boundary draws down, then the live part switches on: its words brighten, the
      // calibrated lane and its node turn amber.
      const drawn = easeOut(phase(t, T.boundary, 0.6));
      set(boundary, 'y2', boundaryTop + (boundaryBottom - boundaryTop) * drawn);
      set(boundary, 'opacity', drawn > 0 ? 1 : 0);
      const on = easeOut(phase(t, T.liveOn, 0.6));
      for (const w of words) set(w.node, 'fill', mixColor(TONE.waiting, w.tone, on));
      set(canaryLane, 'stroke', mixColor(TONE.ghost, TONE.amberHalf, on));
      set(canaryNode, 'stroke', mixColor(TONE.ghost, COLORS.amber, on));
      set(productionNode, 'stroke', mixColor(TONE.ghost, COLORS.muted, on));

      // The quiet loop: auctions flow at an uneven pace, and a limited share bend into the calibrated
      // model's lane, whose node lights as each one reaches it. The stream is counted in auctions from
      // the still, so the still is the same picture at every speed.
      visited.fill(0);
      let light = 0;
      if (t > T.stream) {
        const u = (t - STILL) / spawn + STILL_AUCTIONS;
        const last = Math.floor(u) + 1;
        const first = Math.max(firstAuction, Math.floor(u - lifeAuctions) - 1);
        for (let n = first; n <= last; n++) {
          const travelled = (u - entry(n)) * GAP;
          if (travelled < 0) continue;
          const canary = CANARY.has(slot(n));
          const length = canary ? canaryPath : productionPath;
          if (travelled > length) {
            if (canary) light = Math.max(light, glow((travelled - length) / speed));
            continue;
          }
          const index = n % pool.length;
          const dot = pool[index];
          if (!dot) continue;
          visited[index] = 1;
          const [x, y] = place(travelled, canary);
          set(dot, 'cx', x);
          set(dot, 'cy', y);
          // Canary auctions are larger as well as amber, so the two kinds differ by more than hue.
          set(dot, 'r', canary ? 3 : 2.25);
          set(dot, 'fill', canary ? COLORS.amber : COLORS.muted);
          set(dot, 'opacity', Math.min(clamp01(travelled / 18), clamp01((length - travelled) / 26)));
        }
      }
      pool.forEach((dot, i) => {
        if (!visited[i]) set(dot, 'opacity', 0);
      });
      set(canaryNode, 'fill', mixColor(COLORS.surface, COLORS.amber, light * 0.7));
    },
  };
}

/** The moments the figures above the panel answer (src/content.ts), in the order of the work and of the
    figures: the readout goes from 6.07 to 0.18, the Score window comes on, and the live part switches on. */
const BEATS = { calibrated: T.swap, scored: T.score, live: T.liveOn };

const scene: SceneModule = { still: STILL, story: T.done, beats: BEATS, build };
export default scene;
