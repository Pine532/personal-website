// Terrier Motorsport: precharge on the bench.
//
// A generic precharge circuit drawn as a schematic, beside a scope that plots the DC-link
// capacitor's voltage and the precharge current against time in RC time constants. The story plays
// once: AIR− closes, the precharge relay sends current through the resistor, the capacitor charges,
// at 90% of pack voltage (the team’s threshold) AIR+ closes, and then the precharge relay opens. The steps only
// ever move forward. The marker ends on step 4 and then leaves, to show the sequence is complete,
// and step 3, the 90% rule, stays the brightest step from then on. Phones show one step at a time,
// so their status line ends on step 4; there the scope itself labels the 90% crossing 'AIR+ closes'
// at every width, so the rule stays legible in the hold and the still.
//
// The quiet loop never re-runs the sequence: no relay, charge, heat or step moves again. It is the
// held picture plus a persistence sweep: every 12–16 s a 1 px time base in the ghost tone crosses
// the scope behind the finished traces, at no more than 76 px/s, and fades out at the far edge
// (LOOP_START, SCAN_SPEED and the scan in render()).
//
// Only the RC physics is real, in relative units (τ = time / RC): V = 1 − e^−τ of pack voltage,
// I = e^−τ of its peak V/R, and 90% at τ = ln 10 ≈ 2.3. The topology, the relay timing, the speed
// of the charges and the heat scale are schematic, as the caption says.

import { COLORS, easeInOut, easeOut, el, mix, phase, set, text } from './draw';
import type { SceneModule } from './types';

/** Every word and number the art can show. The site's checks read these. */
export const TEXT = {
  accumulator: 'Accumulator',
  motorController: 'Motor controller',
  airPlus: 'AIR+',
  airMinus: 'AIR−',
  isolation: 'isolation relay',
  prechargeRelay: 'Precharge relay',
  resistor: 'Resistor',
  prechargeBranch: 'Precharge relay and resistor',
  /** The branch's label where even the shared one does not fit (enlarged text spacing). */
  prechargePath: 'Precharge path',
  dcLink: 'DC link',
  plus: '+',
  minus: '−',
  current: 'Precharge current',
  peak: 'Peak V/R, set by the resistor',
  voltage: 'Capacitor voltage',
  ofPack: '% of pack',
  /** Phones name the traces inside the plot, in short. */
  currentShort: 'Current',
  voltageShort: 'Voltage',
  closes: 'AIR+ closes',
  /** The same, on two lines, where one does not fit beside the crossing. */
  closesLines: ['AIR+', 'closes'],
  crossing: '2.3 RC',
  ticks: ['0', '1 RC', '2 RC', '3 RC'],
  full: '100%',
  threshold: '90%',
  half: '50%',
  zero: '0',
  /** The sequence. `short` is used only where the full wording would crowd the layout. */
  steps: [
    { numeral: '1', label: 'AIR− closes', short: 'AIR− closes' },
    { numeral: '2', label: 'Precharge relay closes', short: 'Precharge relay closes' },
    { numeral: '3', label: 'At 90%, AIR+ closes', short: 'At 90%: AIR+ closes' },
    { numeral: '4', label: 'Precharge relay opens', short: 'Precharge relay opens' },
  ],
} as const;

/* ---------- the physics, in relative units ---------- */

const LN10 = Math.log(10); // 1 − e^−τ reaches 0.9 at τ = ln 10, about 2.3 RC
const TAU_MIN = -0.5; // the scope's window
const TAU_MAX = 3.5;
const SEC_PER_RC = 1.25; // so the sweep takes 5 s to cross the scope
const SWING = 0.28; // a relay's contacts close (schematic)
const OPEN = 0.3; // a relay opens; every exit takes this long
const TAU_CROSS = LN10; // the 90% condition: AIR+ is commanded closed
const TAU_CONTACT = TAU_CROSS + SWING / SEC_PER_RC; // its contacts meet one swing later
const STEP3_HOLD = 1.5; // step 3 is the current step this long before the precharge relay opens
const TAU_OPEN = TAU_CROSS + STEP3_HOLD / SEC_PER_RC; // (schematic; its current is already ~0 by then)
const TAU_FAST = 0.03; // the last few percent arrive through AIR+, almost at once
const V_CONTACT = 1 - Math.exp(-TAU_CONTACT);

/** Capacitor voltage, as a fraction of pack voltage. */
function vCap(tau: number) {
  if (tau <= 0) return 0;
  if (tau < TAU_CONTACT) return 1 - Math.exp(-tau);
  return 1 - (1 - V_CONTACT) * Math.exp(-(tau - TAU_CONTACT) / TAU_FAST);
}
/** Current through the precharge resistor, as a fraction of its peak V/R. */
function iPre(tau: number) {
  return tau < 0 || tau >= TAU_OPEN ? 0 : 1 - vCap(tau);
}
/** Charge moved around the precharge loop (the integral of the current): how far the charges have travelled. */
function charge(tau: number) {
  if (tau <= 0) return 0;
  if (tau < TAU_CONTACT) return 1 - Math.exp(-tau);
  const t = Math.min(tau, TAU_OPEN) - TAU_CONTACT;
  return V_CONTACT + (1 - V_CONTACT) * TAU_FAST * (1 - Math.exp(-t / TAU_FAST));
}

/* ---------- timing, in seconds into the story ---------- */

const PRE = 1.4; // the precharge relay's contacts meet: τ = 0
const sAt = (tau: number) => PRE + tau * SEC_PER_RC;
const T = {
  airMinus: 0.6, // AIR−'s contacts meet
  pre: PRE,
  sweep: sAt(TAU_MIN),
  cross: sAt(TAU_CROSS), // 4.28 s: the key moment
  contact: sAt(TAU_CONTACT),
  end: sAt(TAU_MAX), // 5.78 s: the sweep reaches the end of the scope
  open: sAt(TAU_OPEN), // 5.78 s: step 4, the precharge relay opens
  done: sAt(TAU_OPEN) + 1.1, // 6.88 s: the sequence is complete and the marker leaves
};
const TRAVEL = 0.6; // the step marker moving to the next step
const ARRIVE = 0.4; // a label arrives with its mark
const RISE = 4;
const HEAT = 0.35; // the resistor warms over this long once current flows (a thermal lag, schematic)
const HANDOFF = 0.15; // on phones, the stagger between one status line leaving and the next arriving
const STILL = 8.5; // the held picture: sequence complete, step 3 brightest, before the quiet loop
const STORY = Math.round((T.done + ARRIVE) * 100) / 100; // 7.28 s: the marker has left and the last label has arrived
const LOOP_START = 10; // the first persistence sweep, after a hold of about 3 s
const SCAN_SPEED = 75; // px/s at most, the loop's limit; a sweep takes 6–12 s and repeats every 12–16 s
const DOT_TRAVEL = 144; // px of travel per unit of charge: 115 px/s at the peak current
const MAX_DOTS = 46;
const EMPHASIS = 2; // step 3, the 90% rule: once reached it stays the brightest step

/** When each step becomes the current one. */
const STEP_AT = [T.airMinus - SWING, T.pre - SWING, T.cross, T.open] as const;

/* ---------- colour ---------- */

const HEAT_COLOR = '#dc6a2c';
type RGB = readonly [number, number, number];
const rgb = (hex: string): RGB => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const TONE = {
  text: rgb(COLORS.text),
  reading: rgb(COLORS.reading),
  muted: rgb(COLORS.muted),
  amber: rgb(COLORS.amber),
  ghost: rgb(COLORS.ghost),
  heat: rgb(HEAT_COLOR),
};
const blend = (a: RGB, b: RGB, k: number): RGB => [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
const css = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
/** A step's tone by its level: 0 waiting (--muted), 1 done (--reading), 2 current or emphasised (--text). */
const toneOf = (level: number) => (level <= 1 ? blend(TONE.muted, TONE.reading, level) : blend(TONE.reading, TONE.text, level - 1));

/* ---------- small helpers ---------- */

type Typo = { readonly size: number; readonly weight: number };
type Anchor = 'start' | 'middle' | 'end';
type Pt = readonly [number, number];
type Rect = { x0: number; x1: number; y0: number; y1: number };
type Relay = { blade: SVGLineElement; a: SVGCircleElement; b: SVGCircleElement; x: number; y: number; deg: number };
type Item = { group: SVGGElement; label: SVGTextElement; x: number; y: number; w: number };

const r1 = (v: number) => Math.round(v * 10) / 10;
/** A coordinate on the half pixel, so a 1 px line is crisp. */
const half = (v: number) => Math.floor(v) + 0.5;
const pathOf = (points: readonly Pt[]) => points.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join(' ');
const lengthOf = (points: readonly Pt[]) => {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
};
function zigzag(x0: number, y: number, length: number, amplitude: number, peaks: number): Pt[] {
  const lead = 6;
  const seg = (length - 2 * lead) / (2 * peaks);
  const points: Pt[] = [[x0, y], [x0 + lead, y]];
  let x = x0 + lead + seg / 2;
  points.push([x, y - amplitude]);
  for (let i = 0; i < 2 * peaks - 1; i++) {
    x += seg;
    points.push([x, i % 2 === 0 ? y + amplitude : y - amplitude]);
  }
  x += seg / 2;
  points.push([x, y], [x0 + length, y]);
  return points;
}
/** How closed a relay is: its contacts meet at `meet`, and it opens again at `openAt`. */
const closedness = (u: number, meet: number, openAt: number) =>
  easeInOut(phase(u, meet - SWING, SWING)) * (1 - easeOut(phase(u, openAt, OPEN)));
/** The box a label's glyphs take: cap height above the baseline, descenders below. */
const glyphBox = (x: number, y: number, width: number, size: number, anchor: Anchor): Rect => {
  const x0 = anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width;
  return { x0, x1: x0 + width, y0: y - 0.76 * size, y1: y + 0.24 * size };
};
const apart = (a: Rect, b: Rect, gap: number) => a.x1 + gap <= b.x0 || b.x1 + gap <= a.x0 || a.y1 + 1 <= b.y0 || b.y1 + 1 <= a.y0;

// Widths in px below which a layout's schematic gets crowded: the tablet list then takes the steps'
// short wording, and phones put one status line under the schematic instead of a list beside it.
const MEDIUM_SCHEMATIC = 360;
const NARROW_SCHEMATIC = 320;
// The narrowest layout's schematic stops widening here, so it never stretches.
const NARROW_CAP = 420;
const ROW_GAP = 24;

let uid = 0;

const scene: SceneModule = {
  still: STILL,
  story: STORY,
  build(host, { width: W, height: H, layout }) {
    const wide = layout === 'wide';
    // The tablet layout needs its 304 px box. If a box only just under 640 px wide was rounded up to
    // 'medium' but kept the phones' 272 px height, the phone layout is drawn instead of spilling over the caption.
    const narrow = layout === 'narrow' || (layout === 'medium' && H < 304);
    // Primary labels, secondary labels and ticks. Phones step each down a size to fit the schematic and the scope.
    const P: Typo = { size: narrow ? 12 : 13, weight: 450 };
    const S: Typo = { size: narrow ? 11 : 12, weight: 400 };
    const K: Typo = { size: 11, weight: 400 };

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}` }, host);
    const probe = el('text', { x: -999, y: -999 }, svg);
    const measure = (content: string, t: Typo) => {
      probe.setAttribute('font-size', String(t.size));
      probe.setAttribute('font-weight', String(t.weight));
      probe.textContent = content;
      return probe.getComputedTextLength();
    };
    const write = (parent: Element, content: string, x: number, y: number, t: Typo, fill: string, anchor: Anchor = 'start') =>
      text(parent, content, { x: r1(x), y: r1(y), 'font-size': t.size, 'font-weight': t.weight, fill, 'text-anchor': anchor });
    const group = (parent: Element, attributes: Record<string, string | number> = {}) => el('g', attributes, parent);

    // The labels placed so far, as glyph boxes, so that each later one can step around them. Every
    // label keeps 4 px from the art's edges, and labels on a shared row keep 8 px apart.
    const placed: Rect[] = [];
    const boxOf = (content: string, x: number, y: number, t: Typo, anchor: Anchor = 'start') => glyphBox(x, y, measure(content, t), t.size, anchor);
    const room = (r: Rect, gap = 8) => r.x0 >= 4 - 0.01 && r.x1 <= W - 4 + 0.01 && placed.every(o => apart(r, o, gap));
    const put = (parent: Element, content: string, x: number, y: number, t: Typo, fill: string, anchor: Anchor = 'start') => {
      placed.push(boxOf(content, x, y, t, anchor));
      return write(parent, content, x, y, t, fill, anchor);
    };

    /* ---------- the sequence's form: a row (wide), a list (tablets; phones with room), or one status line ---------- */

    // From each step's numeral to its words: 6 px past the widest numeral, which grows with letter spacing.
    const numeralGap = Math.max(narrow ? 13 : 14, Math.ceil(Math.max(...TEXT.steps.map(step => measure(step.numeral, P)))) + 6);
    const widthsOf = (labels: readonly string[]) => labels.map(label => measure(label, P));
    let steps: readonly string[] = TEXT.steps.map(step => step.label);
    let stepWidths = widthsOf(steps);
    const useWords = (short: boolean) => {
      steps = TEXT.steps.map(step => (short ? step.short : step.label));
      stepWidths = widthsOf(steps);
    };
    const listWidth = () => numeralGap + Math.max(...stepWidths);
    const rowWidth = () => stepWidths.reduce((sum, w) => sum + numeralGap + w, 0);
    let form: 'row' | 'list' | 'status' = wide ? 'row' : 'list';
    if (wide) {
      if (4 + rowWidth() + 3 * ROW_GAP > W - 4) useWords(true);
    } else if (!narrow) {
      if (W - 6 - listWidth() - 52 < MEDIUM_SCHEMATIC) useWords(true);
    } else if (W - 6 - listWidth() - 40 < NARROW_SCHEMATIC) {
      useWords(true);
      if (W - 6 - listWidth() - 40 < NARROW_SCHEMATIC) {
        form = 'status';
        useWords(false);
        if (4 + numeralGap + Math.max(...stepWidths) > W - 4) useWords(true);
      }
    }
    const listX = form === 'list' ? Math.round(W - 6 - listWidth()) : 0;

    /* ---------- geometry for this layout ---------- */

    const dcWidth = measure(TEXT.dcLink, S);

    // Schematic.
    let xBat: number, xA: number, xB: number, xC: number;
    let yT: number, yP: number, yB: number;
    let plateLong: number, plateShort: number, cells: number, pairGap: number;
    let swLen: number, openDeg: number, resLen: number, resAmp: number, capW: number, capGap: number;
    let box: Rect;
    let showDC = true;
    // Scope.
    let px0: number, px1: number, py0: number, py1: number, tickY: number;
    // The schematic's right edge.
    let sw = W;

    if (wide) {
      sw = Math.round(Math.min(640, W * 0.5));
      const f = sw / 640;
      plateLong = 28; plateShort = 14; cells = 3; pairGap = 12;
      xBat = Math.round(Math.max(104 * f, 5 + measure(TEXT.accumulator, P) + 12 + plateLong / 2));
      xC = sw - 86;
      xA = Math.round(Math.max(196 * f, xBat + 52));
      xB = Math.round(Math.min(468 * f, xC - 70));
      yT = 60; yP = 120; yB = 200;
      swLen = 44; openDeg = 24; resLen = 60; resAmp = 6; capW = 30; capGap = 10;
      box = { x0: xC - 44, y0: 38, x1: sw, y1: 222 };
      px0 = sw + 92; px1 = W - 6; py0 = 60.5; py1 = 200.5; tickY = 218;
    } else if (!narrow) {
      // Medium: the schematic on the left, the steps listed on the right, the scope across the bottom.
      sw = listX - 12 - 40;
      plateLong = 24; plateShort = 12; cells = 2; pairGap = 11;
      xBat = 4 + plateLong / 2;
      capW = 24; capGap = 8;
      const boxWidth = Math.round(16 + capW + 8 + dcWidth + 8);
      box = { x0: sw - boxWidth, y0: 26, x1: sw, y1: 124 };
      xC = box.x0 + 16 + capW / 2;
      xA = Math.round(Math.max(sw * 0.2, xBat + 44));
      xB = box.x0 - 26;
      yT = 38; yP = 68; yB = 112;
      swLen = 40; openDeg = 20; resLen = 52; resAmp = 5;
      px0 = 40; px1 = W - 6; py0 = 160.5; py1 = 280.5; tickY = 296;
    } else {
      // Narrow: the schematic on top, never wider than NARROW_CAP, with the steps listed beside it when
      // there is room (as on tablets) or one status line under it; then the scope.
      sw = form === 'list' ? listX - 40 : Math.min(W - 4, NARROW_CAP);
      plateLong = 22; plateShort = 11; cells = 2; pairGap = 11;
      xBat = 4 + plateLong / 2;
      capW = 24; capGap = 8;
      xA = 46;
      // The motor controller's frame keeps its DC-link label only while the precharge branch still has room.
      const merged = measure(TEXT.prechargeBranch, S);
      const frame = (dc: boolean) => Math.round(14 + capW + (dc ? 7 + dcWidth + 6 : 14));
      showDC = sw - frame(true) - 20 - xA >= merged + 24;
      box = { x0: sw - frame(showDC), y0: 20, x1: sw, y1: 110 };
      xC = box.x0 + 14 + capW / 2;
      xB = box.x0 - 20;
      yT = 31; yP = 60; yB = 99;
      swLen = 34; openDeg = 22; resLen = 44; resAmp = 5;
      px0 = 36; px1 = W - 5; py0 = form === 'list' ? 136.5 : 148.5; py1 = 234.5; tickY = py1 + 15;
    }
    // The y-axis labels sit left of the plot and keep 4 px from the edge, however wide their text.
    const yGap = narrow ? 7 : 8;
    const yLabels = wide ? [TEXT.full, TEXT.threshold, TEXT.half, TEXT.zero] : narrow ? [TEXT.threshold, TEXT.zero] : [TEXT.threshold, TEXT.half, TEXT.zero];
    px0 = Math.max(px0, Math.ceil(4 + Math.max(...yLabels.map(label => measure(label, K))) + yGap));

    const yMid = Math.round((yT + yB) / 2);
    const cS = Math.round((xA + xB) / 2);
    const branch = xB - xA;
    const cP = Math.round(xA + 0.26 * branch);
    const cR = Math.round(xA + 0.68 * branch);
    const span = (cells - 1) * pairGap + 6;
    const batTop = Math.round(yMid - span / 2);
    const batBot = batTop + span;
    const plateY = (cap: 'top' | 'bottom') => yMid + (cap === 'top' ? -capGap / 2 : capGap / 2);

    /* ---------- schematic ---------- */

    // The motor controller, with the DC-link capacitor inside it: a frame that must read, so in the ghost tone.
    el('rect', {
      x: half(box.x0), y: half(box.y0), width: Math.round(box.x1 - box.x0) - 1, height: Math.round(box.y1 - box.y0) - 1,
      fill: 'none', stroke: COLORS.ghost, 'stroke-width': 1, 'stroke-dasharray': '3 3',
    }, svg);

    const X = { bat: half(xBat), a: half(xA), b: half(xB), c: half(xC) };
    const Y = { t: half(yT), p: half(yP), b: half(yB) };
    const L = swLen;
    const wires = group(svg, { fill: 'none', stroke: COLORS.ghost, 'stroke-width': 1 });
    const mainPaths = [
      `M${X.bat} ${batTop} V${Y.t} H${cS - L / 2}`,
      `M${cS + L / 2} ${Y.t} H${X.c} V${plateY('top')}`,
      `M${X.c} ${plateY('bottom')} V${Y.b} H${cS + L / 2}`,
      `M${cS - L / 2} ${Y.b} H${X.bat} V${batBot}`,
    ];
    for (const d of mainPaths) el('path', { d }, wires);
    const resistorPoints = zigzag(cR - resLen / 2, Y.p, resLen, resAmp, 4);
    el('path', { d: `M${X.a} ${Y.t} V${Y.p} H${cP - L / 2}` }, wires);
    el('path', { d: `M${cP + L / 2} ${Y.p} H${cR - resLen / 2}` }, wires);
    el('path', { d: `M${cR + resLen / 2} ${Y.p} H${X.b} V${Y.t}` }, wires);
    for (const x of [X.a, X.b]) el('circle', { cx: x, cy: Y.t, r: 2.5, fill: COLORS.ghost }, svg);

    // The pack connected to the motor controller: lit once both AIRs are closed.
    const lit = group(svg, { fill: 'none', stroke: COLORS.reading, 'stroke-width': 1.5, opacity: 0 });
    for (const d of mainPaths) el('path', { d }, lit);
    for (const x of [X.a, X.b]) el('circle', { cx: x, cy: Y.t, r: 2.5, fill: COLORS.reading, stroke: 'none' }, lit);

    // The resistor warms with the power it takes, I²R: only its stroke colour changes.
    const resistor = el('path', { d: pathOf(resistorPoints), fill: 'none', stroke: COLORS.ghost, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, svg);

    // The accumulator: a stack of cells, long plate positive.
    const pack = group(svg, { fill: COLORS.ghost });
    for (let i = 0; i < cells; i++) {
      const y = batTop + i * pairGap;
      el('line', { x1: xBat - plateLong / 2, x2: xBat + plateLong / 2, y1: y + 0.5, y2: y + 0.5, stroke: COLORS.ghost, 'stroke-width': 1 }, pack);
      el('rect', { x: xBat - plateShort / 2, y: y + 5, width: plateShort, height: 2.5 }, pack);
    }

    // The DC-link capacitor's plates take the voltage's colour as it charges.
    const plates = group(svg, { stroke: COLORS.ghost, 'stroke-width': 1.5 });
    for (const which of ['top', 'bottom'] as const) {
      el('line', { x1: xC - capW / 2, x2: xC + capW / 2, y1: plateY(which), y2: plateY(which) }, plates);
    }

    // Charges: evenly spaced dots whose speed is the precharge current.
    const loopTop: Pt[] = [[X.bat, batTop], [X.bat, Y.t], [X.a, Y.t], [X.a, Y.p], ...resistorPoints, [X.b, Y.p], [X.b, Y.t], [X.c, Y.t], [X.c, plateY('top') - 3]];
    const loopBottom: Pt[] = [[X.c, plateY('bottom') + 3], [X.c, Y.b], [X.bat, Y.b], [X.bat, batBot + 3]];
    const spacing = Math.max(narrow ? 12 : 14, (lengthOf(loopTop) + lengthOf(loopBottom)) / MAX_DOTS);
    const dots = group(svg, {
      fill: 'none', stroke: COLORS.text, 'stroke-width': narrow ? 2.25 : 2.5, 'stroke-linecap': 'round',
      'stroke-dasharray': `0 ${r1(spacing)}`, opacity: 0,
    });
    const dotPaths = [el('path', { d: pathOf(loopTop) }, dots), el('path', { d: pathOf(loopBottom) }, dots)];

    // Relays: AIR+ on the positive rail, the precharge relay in the branch around it, AIR− on the negative rail.
    const relay = (cx: number, y: number): Relay => {
      const x = cx - L / 2;
      const blade = el('line', { x1: x, y1: y, x2: x + L - 1.5, y2: y, stroke: COLORS.muted, 'stroke-width': 1.5 }, svg);
      const a = el('circle', { cx: x, cy: y, r: 3.5, fill: COLORS.surface, stroke: COLORS.ghost, 'stroke-width': 1.25 }, svg);
      const b = el('circle', { cx: x + L, cy: y, r: 3.5, fill: COLORS.surface, stroke: COLORS.ghost, 'stroke-width': 1.25 }, svg);
      return { blade, a, b, x, y, deg: openDeg };
    };
    const airPlus = relay(cS, Y.t);
    const prechargeRelay = relay(cP, Y.p);
    const airMinus = relay(cS, Y.b);

    /* ---------- schematic labels ---------- */

    const labels = group(svg);
    if (wide) {
      put(labels, TEXT.accumulator, xBat - plateLong / 2 - 12, yMid + 4.5, P, COLORS.text, 'end');
      put(labels, TEXT.motorController, box.x0, 15, P, COLORS.text);
      put(labels, TEXT.airPlus, cS, 15, P, COLORS.text, 'middle');
      put(labels, TEXT.airMinus, cS, yB + 22, P, COLORS.text, 'middle');
      // Each AIR's kind beneath its name, while it clears the motor controller's label.
      const sub = (y: number) => boxOf(TEXT.isolation, cS, y, S, 'middle');
      if (room(sub(30)) && room(sub(yB + 37))) {
        put(labels, TEXT.isolation, cS, 30, S, COLORS.muted, 'middle');
        put(labels, TEXT.isolation, cS, yB + 37, S, COLORS.muted, 'middle');
      }
    } else {
      // The top row: the accumulator on the left, the motor controller on the right, AIR+ between them.
      // When enlarged text crowds the row, the outer two step down a size before anything moves.
      const topY = narrow ? 13 : 15;
      const nameW = measure(TEXT.airPlus, P);
      const subW = measure(TEXT.isolation, S);
      const outerFit = (t: Typo) => {
        const left = boxOf(TEXT.accumulator, 4.5, topY, t);
        const right = boxOf(TEXT.motorController, box.x1, topY, t, 'end');
        return apart(left, glyphBox(cS, topY, nameW, P.size, 'middle'), 8) && apart(right, glyphBox(cS, topY, nameW, P.size, 'middle'), 8);
      };
      const outer = outerFit(P) || !outerFit(S) ? P : S;
      put(labels, TEXT.accumulator, 4.5, topY, outer, COLORS.text);
      put(labels, TEXT.motorController, box.x1, topY, outer, COLORS.text, 'end');
      // Tablets set each AIR's kind beside its name, since there is no room beneath it; it drops out
      // (for both AIRs) when the row cannot hold it. Phones never show it.
      const pair = nameW + 6 + subW;
      const sublabels = !narrow && room(glyphBox(cS - pair / 2, topY, pair, P.size, 'start'));
      // If even the name cannot sit in the row, it goes under its rail.
      const airPlusY = sublabels || room(glyphBox(cS, topY, nameW, P.size, 'middle')) ? topY : yT + (narrow ? 16 : 17);
      const airLabel = (name: string, y: number) => {
        if (!sublabels) {
          put(labels, name, cS, y, P, COLORS.text, 'middle');
          return;
        }
        const width = measure(name, P);
        const start = cS - (width + 6 + subW) / 2;
        put(labels, name, start, y, P, COLORS.text);
        put(labels, TEXT.isolation, start + width + 6, y, S, COLORS.muted);
      };
      airLabel(TEXT.airPlus, airPlusY);
      airLabel(TEXT.airMinus, yB + (narrow ? 16 : 17));
    }
    if (showDC) put(labels, TEXT.dcLink, xC + capW / 2 + (narrow ? 7 : 8), yMid + 4, S, COLORS.muted);

    // The battery's signs, and the precharge branch: a label under each part when they fit apart, one
    // shared label otherwise, then a shorter one; the signs make way before the label would overflow.
    const signX = xBat + plateLong / 2 + 5;
    const signs = [boxOf(TEXT.plus, signX, batTop + 4, S), boxOf(TEXT.minus, signX, batBot + 4, S)];
    const branchY = yP + (wide ? 25 : narrow ? 18 : 19);
    const rightLimit = box.x0 - 8;
    const relayBox = boxOf(TEXT.prechargeRelay, cP, branchY, P, 'middle');
    const resistorBox = boxOf(TEXT.resistor, cR, branchY, P, 'middle');
    let signsShown = true;
    if (relayBox.x0 >= signX + 14 && resistorBox.x1 <= rightLimit && apart(relayBox, resistorBox, 18) && room(relayBox) && room(resistorBox)) {
      put(labels, TEXT.prechargeRelay, cP, branchY, P, COLORS.text, 'middle');
      put(labels, TEXT.resistor, cR, branchY, P, COLORS.text, 'middle');
    } else {
      const choices: [string, Typo][] = [[TEXT.prechargeBranch, P], [TEXT.prechargeBranch, S], [TEXT.prechargePath, P], [TEXT.prechargePath, S]];
      const fit = (leftLimit: number) => {
        for (const [content, t] of choices) {
          const w = measure(content, t);
          if (w > rightLimit - leftLimit) continue;
          const centre = Math.min(Math.max((xA + xB) / 2, leftLimit + w / 2), rightLimit - w / 2);
          if (room(glyphBox(centre, branchY, w, t.size, 'middle'))) return { content, t, centre };
        }
        return null;
      };
      let choice = fit(signX + 14);
      if (!choice) {
        signsShown = false;
        choice = fit(xBat + plateLong / 2 + 8);
      }
      const last = choice ?? { content: TEXT.prechargePath, t: S, centre: (xA + xB) / 2 };
      put(labels, last.content, last.centre, branchY, last.t, COLORS.text, 'middle');
    }
    if (signsShown) {
      placed.push(...signs);
      write(labels, TEXT.plus, signX, batTop + 4, S, COLORS.muted);
      write(labels, TEXT.minus, signX, batBot + 4, S, COLORS.muted);
    }

    /* ---------- scope ---------- */

    const xOf = (tau: number) => px0 + ((tau - TAU_MIN) / (TAU_MAX - TAU_MIN)) * (px1 - px0);
    const yOf = (v: number) => py1 - v * (py1 - py0);
    const scope = group(svg);
    const hline = (y: number, stroke: string, dash?: string) =>
      el('line', { x1: px0, x2: px1, y1: y, y2: y, stroke, 'stroke-width': 1, ...(dash ? { 'stroke-dasharray': dash } : {}) }, scope);
    // Gridlines are decoration (--line); the axis and its ticks must read (the ghost tone).
    hline(py0, COLORS.line);
    hline(yOf(0.5), COLORS.line);
    hline(py1, COLORS.ghost);
    hline(yOf(0.9), COLORS.amber, '3 3');
    // 2.3 RC, under the crossing: on the tick row when it stands well clear of 2 RC, on a row of its own
    // beneath where there is one (desktop and phones), and otherwise on the tick row in place of the 2 RC label.
    const xc = xOf(TAU_CROSS);
    const yc = yOf(0.9);
    const crossWidth = measure(TEXT.crossing, K);
    const clearOfTwo = Math.abs(xOf(2) - xc) - (measure(TEXT.ticks[2], K) + crossWidth) / 2;
    const crossY = clearOfTwo >= 20 || !(wide || narrow) ? tickY : tickY + (narrow ? 13 : 15);
    const omitTwo = crossY === tickY && clearOfTwo < 20;
    TEXT.ticks.forEach((label, k) => {
      const x = half(xOf(k));
      el('line', { x1: x, x2: x, y1: py1, y2: py1 + 4, stroke: COLORS.ghost, 'stroke-width': 1 }, scope);
      if (!(omitTwo && k === 2)) write(scope, label, x, tickY, K, COLORS.muted, 'middle');
    });
    const yLabel = (label: string, v: number) => write(scope, label, px0 - yGap, yOf(v) + 4, K, COLORS.muted, 'end');
    if (wide) yLabel(TEXT.full, 1);
    const ninety = yLabel(TEXT.threshold, 0.9);
    if (!narrow) yLabel(TEXT.half, 0.5);
    yLabel(TEXT.zero, 0);

    // The quiet loop's persistence sweep: a time base in the ghost tone, behind the traces and labels.
    const scan = el('line', { x1: half(px0), x2: half(px0), y1: py0, y2: py1, stroke: COLORS.ghost, 'stroke-width': 1, opacity: 0 }, svg);
    const scanSpan = px1 - px0;
    const scanTime = Math.min(12, Math.max(6, scanSpan / SCAN_SPEED)); // ≤ 76 px/s, never faster than 6 s across
    const loopTime = Math.max(12, scanTime + 4);

    // The traces: exact curves, revealed by the sweep.
    const vPoints: Pt[] = [];
    const iPoints: Pt[] = [[xOf(0), yOf(0)]];
    const sample = (tau: number) => {
      vPoints.push([xOf(tau), yOf(vCap(tau))]);
      iPoints.push([xOf(tau), yOf(iPre(tau))]);
    };
    for (let k = 0; k <= 175; k++) {
      const tau = k * 0.02;
      if (tau > TAU_CONTACT && tau - 0.02 <= TAU_CONTACT) for (let j = 0; j <= 20; j++) sample(TAU_CONTACT + j * 0.006);
      sample(tau);
    }
    vPoints.sort((a, b) => a[0] - b[0]);
    iPoints.sort((a, b) => a[0] - b[0]);

    const clipId = `precharge-sweep-${++uid}`;
    const clip = el('clipPath', { id: clipId }, el('defs', {}, svg));
    const clipX = px0 - 3;
    const sweep = el('rect', { x: clipX, y: 0, width: 0, height: H }, clip);
    const traces = group(svg, { 'clip-path': `url(#${clipId})`, fill: 'none', 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
    el('path', { d: pathOf(iPoints), stroke: COLORS.text }, traces);
    el('path', { d: pathOf(vPoints), stroke: COLORS.amber }, traces);

    // The 90% crossing: the moment AIR+ is allowed to close.
    const dropX = half(xc);
    const drop = el('line', { x1: dropX, x2: dropX, y1: yc + 4, y2: yc + 4, stroke: COLORS.amber, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 }, svg);
    const node = el('circle', { cx: xc, cy: yc, r: 3.5, fill: COLORS.amber, stroke: COLORS.surface, 'stroke-width': 1.25, opacity: 0 }, svg);
    const headI = el('circle', { cx: xOf(0), cy: py1, r: 3.5, fill: COLORS.surface, stroke: COLORS.text, 'stroke-width': 1.25, opacity: 0 }, svg);
    const headV = el('circle', { cx: xOf(0), cy: py1, r: 3.5, fill: COLORS.amber, stroke: COLORS.surface, 'stroke-width': 1.25, opacity: 0 }, svg);

    const crossing = group(svg, { opacity: 0 });
    const crossingLabel = write(crossing, TEXT.crossing, xc, crossY, K, COLORS.text, 'middle');

    // AIR+ closes, beside the crossing, where the traces leave room: right of the contact when it fits
    // there, else right of the drop line, else on two lines. It shows at every width, phones included.
    const closesType = narrow ? K : S;
    const closesY = yc + (narrow ? 14 : 17);
    const closesOptions: { x: number; lines: readonly string[] }[] = [
      { x: xOf(TAU_CONTACT) + (narrow ? 6 : 8), lines: [TEXT.closes] },
      { x: dropX + 5, lines: [TEXT.closes] },
      { x: xOf(TAU_CONTACT) + (narrow ? 6 : 8), lines: TEXT.closesLines },
      { x: dropX + 5, lines: TEXT.closesLines },
    ];
    const closesFit = closesOptions.find(o => o.x + Math.max(...o.lines.map(line => measure(line, closesType))) <= px1 - 2) ?? closesOptions[3];
    const closes = group(svg, { opacity: 0 });
    const closesLabels = (closesFit?.lines ?? []).map((line, k) =>
      write(closes, line, closesFit?.x ?? 0, closesY + k * (closesType.size + 2), closesType, COLORS.reading));

    // What the traces are: named directly beside the plot (desktop and tablets) or inside it (phones).
    const arrivals: { node: SVGGElement; at: number }[] = [];
    if (wide) {
      const left = xOf(0) - 0.5;
      // The peak note drops out rather than crowd the unit beneath the voltage's name (enlarged text spacing).
      const showPeak = left + measure(TEXT.peak, S) + 16 <= px1 - measure(TEXT.ofPack, S);
      const current = group(svg, { opacity: 0 });
      write(current, TEXT.current, left, py0 - 26, P, COLORS.text);
      if (showPeak) write(current, TEXT.peak, left, py0 - 11, S, COLORS.muted);
      const voltage = group(svg, { opacity: 0 });
      write(voltage, TEXT.voltage, px1, py0 - 26, P, COLORS.amber, 'end');
      write(voltage, TEXT.ofPack, px1, py0 - 11, S, COLORS.muted, 'end');
      arrivals.push({ node: current, at: T.pre }, { node: voltage, at: T.pre + 0.1 });
    } else if (!narrow) {
      const y = py0 - 10;
      const left = xOf(0) - 0.5;
      const currentWidth = measure(TEXT.current, P);
      const peakWidth = measure(TEXT.peak, S);
      const voltageWidth = measure(TEXT.voltage, P);
      const unitWidth = measure(TEXT.ofPack, S);
      let showPeak = true;
      let showUnit = true;
      const crowded = () => left + currentWidth + (showPeak ? 8 + peakWidth : 0) + 16 > px1 - voltageWidth - (showUnit ? 8 + unitWidth : 0);
      if (crowded()) showPeak = false;
      if (crowded()) showUnit = false;
      const current = group(svg, { opacity: 0 });
      write(current, TEXT.current, left, y, P, COLORS.text);
      if (showPeak) write(current, TEXT.peak, left + currentWidth + 8, y, S, COLORS.muted);
      const voltage = group(svg, { opacity: 0 });
      if (showUnit) write(voltage, TEXT.ofPack, px1, y, S, COLORS.muted, 'end');
      write(voltage, TEXT.voltage, px1 - (showUnit ? unitWidth + 8 : 0), y, P, COLORS.amber, 'end');
      arrivals.push({ node: current, at: T.pre }, { node: voltage, at: T.pre + 0.1 });
    } else {
      // Phones name each trace beside itself rather than with a key told apart by colour: 'Voltage' over
      // the rising curve, under the 90% line, and 'Current' under the falling curve, above the axis. Each
      // is placed where its curve passes 2.5 px clear of its glyphs, and arrives once the sweep has drawn
      // the curve beside it and its trace head has passed.
      const perTau = (px1 - px0) / (TAU_MAX - TAU_MIN);
      const levelAt = (y: number) => (py1 - y) / (py1 - py0);
      const CLEAR = 2.5;
      const voltageAt = (t: Typo, clear = CLEAR) => {
        const base = yc + 0.5 + clear + 0.76 * t.size;
        const limit = levelAt(base + 0.24 * t.size + clear); // the voltage stays below this level under the label
        if (limit <= 0 || limit >= 1) return null;
        const tauR = -Math.log(1 - limit);
        const tauL = tauR - measure(TEXT.voltageShort, t) / perTau;
        // Before ln 2 the falling current is the upper curve; it must pass below the label's first letter,
        // which has no descender.
        return tauL >= 0.05 && Math.exp(-tauL) <= levelAt(base + clear) ? { x: xOf(tauR), y: base, t, at: sAt(tauR) + 0.15 } : null;
      };
      const currentAt = (t: Typo, clear = CLEAR) => {
        const base = py1 - 0.5 - 3;
        const floor = levelAt(base - 0.76 * t.size - clear); // the current stays above this level over the label
        if (floor <= 0 || floor >= 1) return null;
        const tauR = -Math.log(floor);
        const tauL = tauR - measure(TEXT.currentShort, t) / perTau;
        // The rising voltage must already be above the label where it starts, and the label must end
        // before the drop line.
        return 1 - Math.exp(-tauL) >= floor && xOf(tauR) <= dropX - 6 ? { x: xOf(tauR), y: base, t, at: sAt(tauR) + 0.15 } : null;
      };
      const named: [string, string, { x: number; y: number; t: Typo; at: number }][] = [];
      // The names never drop out: failing every fit, each takes its smaller size with a tighter margin.
      const v = voltageAt(P) ?? voltageAt(S) ?? voltageAt(S, 1.5);
      const c = currentAt(P) ?? currentAt(S) ?? currentAt(S, 1.5);
      if (v) named.push([TEXT.voltageShort, COLORS.amber, v]);
      if (c) named.push([TEXT.currentShort, COLORS.text, c]);
      for (const [content, fill, spot] of named) {
        const g = group(svg, { opacity: 0 });
        write(g, content, spot.x, spot.y, spot.t, fill, 'end');
        arrivals.push({ node: g, at: spot.at });
      }
    }

    /* ---------- the sequence ---------- */

    const items: Item[] = [];
    let marker: SVGLineElement | null = null;
    const statusY = 136;
    if (form === 'row') {
      let total = rowWidth();
      let gap = Math.max(ROW_GAP, (sw - 4 - total) / 3);
      if (4 + total + 3 * gap > W - 4) gap = Math.max(12, (W - 8 - total) / 3);
      total += 3 * gap;
      const ruleY = 253.5;
      let x = 4;
      el('line', { x1: 0, x2: Math.round(Math.max(sw, 4 + total)), y1: ruleY, y2: ruleY, stroke: COLORS.line, 'stroke-width': 1 }, svg);
      steps.forEach((label, k) => {
        const w = numeralGap + (stepWidths[k] ?? 0);
        const g = group(svg);
        write(g, TEXT.steps[k]?.numeral ?? '', x, 275, P, COLORS.muted).setAttribute('font-weight', '400');
        const node = write(g, label, x + numeralGap, 275, P, COLORS.muted);
        items.push({ group: g, label: node, x, y: ruleY, w });
        x += w + gap;
      });
      marker = el('line', { x1: 0, x2: 0, y1: ruleY, y2: ruleY, stroke: COLORS.amber, 'stroke-width': 1.5, opacity: 0 }, svg);
    } else if (form === 'list') {
      // A vertical rule beside the list, with the amber mark beside the current step.
      const pitch = narrow ? 24 : 26;
      const first = narrow ? 13 : 15; // on the baseline of the schematic's top labels
      const lift = narrow ? 9 : 11; // the marker runs from the step's cap height to just below its baseline
      const ruleX = listX - 12.5;
      el('line', { x1: ruleX, x2: ruleX, y1: Math.max(4, first - lift), y2: first + 3 * pitch + 4, stroke: COLORS.line, 'stroke-width': 1 }, svg);
      steps.forEach((label, k) => {
        const y = first + k * pitch;
        const g = group(svg);
        write(g, TEXT.steps[k]?.numeral ?? '', listX, y, P, COLORS.muted).setAttribute('font-weight', '400');
        const node = write(g, label, listX + numeralGap, y, P, COLORS.muted);
        items.push({ group: g, label: node, x: ruleX, y: y - lift, w: lift + 4 });
      });
      marker = el('line', { x1: ruleX, x2: ruleX, y1: 0, y2: 0, stroke: COLORS.amber, 'stroke-width': 1.5, opacity: 0 }, svg);
    } else {
      steps.forEach((label, k) => {
        const g = group(svg, { opacity: 0 });
        write(g, TEXT.steps[k]?.numeral ?? '', 4, statusY, P, COLORS.muted).setAttribute('font-weight', '400');
        const node = write(g, label, 4 + numeralGap, statusY, P, COLORS.muted);
        items.push({ group: g, label: node, x: 4, y: statusY, w: numeralGap + (stepWidths[k] ?? 0) });
      });
    }
    probe.remove();

    /* ---------- render one moment ---------- */

    const xFor = (step: number) => items[step]?.x ?? 0;
    const wFor = (step: number) => items[step]?.w ?? 0;
    const yFor = (step: number) => items[step]?.y ?? 0;

    function setRelay(r: Relay, k: number) {
      set(r.blade, 'transform', `rotate(${(-r.deg * (1 - k)).toFixed(2)} ${r.x} ${r.y})`);
      set(r.blade, 'stroke', css(blend(TONE.muted, TONE.reading, k)));
      const contact = css(blend(TONE.ghost, TONE.reading, k));
      set(r.a, 'stroke', contact);
      set(r.b, 'stroke', contact);
    }
    const arrive = (target: Element, k: number) => {
      set(target, 'opacity', k);
      set(target, 'transform', `translate(0 ${r1((1 - k) * RISE)})`);
    };

    function render(seconds: number) {
      const u = Math.max(0, seconds);
      const tau = (u - PRE) / SEC_PER_RC;
      const arrival = (at: number) => easeOut(phase(u, at, ARRIVE));

      // Relays: each closes once, and only the precharge relay opens again.
      setRelay(airMinus, closedness(u, T.airMinus, Infinity));
      setRelay(prechargeRelay, closedness(u, T.pre, T.open));
      setRelay(airPlus, closedness(u, T.contact, Infinity));
      set(lit, 'opacity', easeOut(phase(u, T.contact, 0.7)));

      // Charges move as far as the charge that has flowed, so their speed is the current.
      const travelled = -charge(tau) * DOT_TRAVEL;
      for (const path of dotPaths) set(path, 'stroke-dashoffset', travelled);
      set(dots, 'opacity', easeOut(phase(u, T.pre, 0.25)) * (1 - easeOut(phase(u, T.contact, OPEN))));
      // The resistor takes I²R, but it warms over HEAT rather than in a single frame.
      const current = iPre(tau);
      set(resistor, 'stroke', css(blend(TONE.ghost, TONE.heat, current * current * easeOut(phase(u, T.pre, HEAT)))));
      set(plates, 'stroke', css(blend(TONE.ghost, TONE.amber, vCap(tau))));

      // The sweep.
      const tc = Math.min(TAU_MAX, Math.max(TAU_MIN, tau));
      const xNow = xOf(tc);
      set(sweep, 'width', u >= T.sweep ? xNow - clipX + 0.75 : 0);
      const head = easeOut(phase(u, T.pre - 0.04, 0.16)) * (1 - easeOut(phase(u, T.end, OPEN)));
      set(headV, 'cx', xNow);
      set(headV, 'cy', yOf(vCap(tc)));
      set(headV, 'opacity', head);
      set(headI, 'cx', xNow);
      set(headI, 'cy', yOf(iPre(tc)));
      set(headI, 'opacity', head);
      for (const a of arrivals) arrive(a.node, arrival(a.at));

      // The 90% crossing.
      const crossed = easeOut(phase(u, T.cross, ARRIVE));
      set(node, 'opacity', crossed);
      set(drop, 'opacity', u >= T.cross ? 1 : 0);
      set(drop, 'y2', mix(yc + 4, py1, easeOut(phase(u, T.cross + 0.05, 0.5))));
      set(ninety, 'fill', css(blend(TONE.muted, TONE.text, crossed)));
      arrive(crossing, arrival(T.cross + 0.05));
      set(crossingLabel, 'fill', css(blend(TONE.muted, TONE.text, crossed)));
      arrive(closes, arrival(T.contact));
      const shut = css(blend(TONE.muted, TONE.reading, arrival(T.contact)));
      for (const line of closesLabels) set(line, 'fill', shut);

      // The quiet loop: the held picture, with a persistence sweep crossing the scope now and then.
      const cycle = u >= LOOP_START ? (u - LOOP_START) % loopTime : -1;
      const sweeping = cycle >= 0 && cycle < scanTime;
      set(scan, 'transform', `translate(${sweeping ? ((cycle / scanTime) * scanSpan).toFixed(1) : 0} 0)`);
      set(scan, 'opacity', sweeping ? easeOut(phase(cycle, 0, ARRIVE)) * (1 - easeOut(phase(cycle, scanTime - OPEN, OPEN))) : 0);

      // The sequence. Steps light in order and never go back. Once the precharge relay has opened, the
      // marker leaves and step 4 settles to --reading; step 3, the 90% rule, stays the brightest step.
      let mark = -1;
      while (mark + 1 < STEP_AT.length && (STEP_AT[mark + 1] ?? Infinity) <= u) mark++;
      const level = (k: number) => {
        const on = easeOut(phase(u, STEP_AT[k] ?? Infinity, ARRIVE));
        const off = k === EMPHASIS ? 0 : easeOut(phase(u, STEP_AT[k + 1] ?? T.done, ARRIVE));
        return on * (2 - off);
      };
      if (form !== 'status') {
        items.forEach((item, k) => set(item.label, 'fill', css(toneOf(level(k)))));
        if (marker && mark >= 0) {
          const from = Math.max(0, mark - 1);
          const e = mark > 0 ? easeInOut(phase(u, STEP_AT[mark] ?? 0, TRAVEL)) : 1;
          if (form === 'row') {
            set(marker, 'x1', mix(xFor(from), xFor(mark), e));
            set(marker, 'x2', mix(xFor(from) + wFor(from), xFor(mark) + wFor(mark), e));
          } else {
            const y = mix(yFor(from), yFor(mark), e);
            set(marker, 'y1', y);
            set(marker, 'y2', y + wFor(mark));
          }
          const settle = mark > 0 ? 1 : easeOut(phase(u, STEP_AT[0], ARRIVE));
          set(marker, 'opacity', settle * (1 - easeOut(phase(u, T.done, OPEN))));
        } else if (marker) set(marker, 'opacity', 0);
      } else {
        // One status line: the current step, handing over to the next. Before the first step, step 1
        // waits in --muted; after the last, step 4 stays, settling to --reading.
        const shown = Math.max(0, mark);
        const swap = mark > 0;
        const since = STEP_AT[shown] ?? 0;
        // The old line leaves first and the new one follows a beat later, so two lines never sit on top of each other.
        const incoming = swap ? easeOut(phase(u, since + HANDOFF, ARRIVE)) : 1;
        const outgoing = swap ? 1 - easeOut(phase(u, since, OPEN)) : 0;
        const last = mark === STEP_AT.length - 1 ? easeOut(phase(u, T.done, ARRIVE)) : 0;
        const brightness = mark < 0 ? 0 : mark === 0 ? level(0) : 2 - last;
        items.forEach((item, k) => {
          set(item.group, 'opacity', k === shown ? incoming : swap && k === shown - 1 ? outgoing : 0);
          set(item.group, 'transform', `translate(0 ${k === shown ? r1((1 - incoming) * RISE) : 0})`);
          set(item.label, 'fill', css(toneOf(k === shown ? brightness : 2)));
        });
      }
    }

    return { render };
  },
};

export default scene;
