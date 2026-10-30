// Comcast: the Sprinkler ad-serving platform leaves EC2 Auto Scaling Groups (drawn as one), whose scaling
// took a manual step, for Kubernetes on Amazon EKS; then KEDA adds and removes pods as a schematic load
// rises and falls. The contract is in ./types.ts; the caption and text alternative are in src/content.ts.
import { COLORS, clamp01, cubicBezier, easeInOut, easeOut, el, fadeIn, phase, set, text } from './draw';
import type { SceneModule } from './types';

/** Every word the art draws, exported so the site's checks can read them all. The only figure, 99.99%,
    is the project's own availability target; the digit in 'EC2' and the zone numbers are names. A short
    form is drawn when the full one does not fit: on narrow art, or when a reader widens text spacing. */
export const TEXT = {
  before: 'EC2 Auto Scaling Groups', // as the project's text says; one group stands for them (the caption calls every count schematic)
  beforeNote: 'Scaling took manual intervention',
  beforeNoteShort: 'Scaling took manual steps',
  manual: 'manual',
  instance: 'EC2',
  after: 'Kubernetes on Amazon EKS',
  afterNote: 'Deployed with Helm and ArgoCD, scaled by KEDA',
  afterNoteShort: 'Deployed with Helm and ArgoCD',
  target: 'Multi-AZ, for a 99.99% availability target',
  zones: ['Availability zone 1', 'Availability zone 2', 'Availability zone 3'],
  zonesShort: ['Zone 1', 'Zone 2', 'Zone 3'],
  node: 'node',
  migrated: 'Migrated',
  keda: 'KEDA autoscaling',
  kedaRises: ['adds ', 'pods', ' as load rises,'],
  kedaFalls: 'removes them as it falls',
  kedaShort: ['KEDA adds and removes ', 'pods', ' with load'],
  kedaShorter: ['KEDA adds and removes ', 'pods', ''],
  pods: 'pods',
  load: 'load',
} as const;

/* Tones. Lines that carry meaning (the group, its instances while they hold units, the zones, the nodes
   and the free slots) are COLORS.ghost, 3.6:1 on the surface. COLORS.firm (2.2:1) is decoration only:
   the strip's edge, and an instance once it is empty. Words stay at 4.5:1 or more at every moment. */
const TONE = {
  quiet: '#8a887f', // the emptied group's words: quieter than --muted, still 5.3:1
  migratedFill: '#1f1f1c', // --reading at 8% over --surface, opaque so a pod in flight hides what it crosses
  addedFill: '#302c1a', // amber at 14% over --surface
} as const;

const at = (values: ArrayLike<number>, index: number) => values[index] ?? 0;

const channels = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
/** The colour a fraction `k` of the way from `from` to `to` (both #rrggbb); exactly `from` at 0. */
function mixColor(from: string, to: string, k: number) {
  if (k <= 0) return from;
  if (k >= 1) return to;
  const a = channels(from), b = channels(to);
  return `#${a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * k).toString(16).padStart(2, '0')).join('')}`;
}

/* ---------- The schematic load, and the pods KEDA keeps for it ---------- */

const PERIOD = 18; // seconds per load cycle: two surges of different heights
const STEP = 0.05; // sampling step, seconds
const SAMPLES = Math.round(PERIOD / STEP);
const FLOOR = 12; // the pods carried over from the three instances
const CAP = 36; // KEDA adds at most 24, so the migrated pods stay readable and 12 of 48 slots stay free
const HOLD = 2; // seconds KEDA waits before it removes pods
const HEADROOM = 1.1; // pods kept per unit of load
const PER_INSTANCE = 4;

/** A surge centred at `centre` in a cycle position `s` (0 ≤ s < PERIOD), summed over neighbouring cycles. */
function surge(s: number, centre: number, rise: number, fall: number) {
  let sum = 0;
  for (const wrap of [-PERIOD, 0, PERIOD]) {
    const d = s - centre - wrap;
    const width = d < 0 ? rise : fall;
    sum += Math.exp(-(d * d) / (2 * width * width));
  }
  return sum;
}
/** The load at load-cycle time `s`, in pods' worth of work: a quick rise and a slower fall, twice. */
function demand(s: number) {
  const cycle = ((s % PERIOD) + PERIOD) % PERIOD;
  const turn = (2 * Math.PI * cycle) / PERIOD;
  return 7.5 + 24.7 * surge(cycle, 4, 1, 2) + 11.5 * surge(cycle, 13.5, 1, 1.6) + 0.35 * Math.sin(5 * turn) + 0.25 * Math.sin(9 * turn + 1.3);
}
const wrapIndex = (i: number) => ((i % SAMPLES) + SAMPLES) % SAMPLES;
const podsAt = new Uint8Array(SAMPLES);
{
  const wanted = new Uint8Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) wanted[i] = Math.min(CAP, Math.max(FLOOR, Math.ceil(HEADROOM * demand(i * STEP))));
  const hold = Math.round(HOLD / STEP);
  for (let i = 0; i < SAMPLES; i++) {
    let most = 0;
    for (let j = 0; j <= hold; j++) most = Math.max(most, at(wanted, wrapIndex(i - j)));
    podsAt[i] = most;
  }
}
// The strip must never show fewer pods than load: checked once, in development.
if (import.meta.env.DEV) {
  for (let i = 0; i < SAMPLES; i++) {
    if (at(podsAt, i) < demand(i * STEP)) console.error(`comcast visual: pods below load at ${(i * STEP).toFixed(2)} s`);
  }
}

/* ---------- Story timing, in seconds ---------- */

// The "before" picture, the Auto Scaling Group with two instances and their units, is drawn from the
// start: it is what a panel waiting to play shows. The story opens on the manual flag.
const T = {
  flag: 0.7, // the manual flag drops onto the group...
  third: 0.9, // ...and a third instance draws in under it
  cluster: 1.1, // EKS: zones, then nodes, then their free slots (after the flag has had the stage)
  connector: 1.45, // the "Migrated" arrow
  fly: 1.65, // the first unit leaves; the farthest zone fills first
  groupGap: 0.38, // between instances
  stagger: 0.06, // between the units of one instance
  // A unit's flight. Wide and medium cross up to three quarters of the art, so they take longer, on a
  // gentle in-out walked at an even pace along the path: no more than about 24 px a frame at 60 Hz.
  flight: 1.3,
  drop: 0.9, // narrow: a short drop on the site's travel curve
  glowIn: 0.15, // a landing unit brightens as it settles into its slot...
  glowOut: 0.45, // ...and eases back; every glow ends before the story settles
  strip: 3.3, // load and pods over time
  sim: 3.6, // the load starts to move...
  ramp: 0.4, // ...easing up to speed
  settled: 4.4, // every transition of the story has finished (later if the last glow needs it)
};
const S0 = 1.76; // where in the load cycle the story starts: just before the larger surge
// A peak of the larger surge, every amber pod in place: the same moment of the load as 6.6 s, three
// cycles on, so the strip has filled with the time since the migration.
const STILL = 6.6 + 3 * PERIOD;
// The opening story ends on that peak the first time round: the migration is done and KEDA has answered
// one surge, with only that much of the strip drawn.
const STORY = 6.6;
const FADE_IN = 0.4; // a pod KEDA adds
const FADE_OUT = 0.3; // a pod KEDA removes
const SPEED = 24; // px per second of load-cycle time

const flightEase = cubicBezier(0.45, 0, 0.55, 1);

/** Unit i rides out of instance i % 3 and lands in zone i % 3; instances empty right to left. */
const flightStart = (i: number) => T.fly + (2 - (i % 3)) * T.groupGap + Math.floor(i / 3) * T.stagger;
const emptiedAt = (k: number) => flightStart(k + 3 * (PER_INSTANCE - 1)) + 0.25;

function simTime(t: number) {
  const u = t - T.sim;
  if (u <= 0) return S0;
  return S0 + (u < T.ramp ? (u * u) / (2 * T.ramp) : u - T.ramp / 2);
}

/* ---------- Layout ---------- */

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Words = readonly [string, string, string];
type Plan = {
  titleY: number;
  subY: number;
  beforeNote: string;
  after: Point & { subY: number; note: string };
  target: number | null; // baseline of the availability note, or null when it is left to the figures
  asg: Box;
  inst: Box[];
  unit: number;
  unitGap: number;
  unitY: number;
  zones: Box[];
  zoneLabels: readonly string[];
  zoneLabelY: number;
  zonePad: number;
  nodes: Box[];
  pod: number;
  cols: number;
  gapX: number;
  gapY: number;
  gridY: number; // top of a node's pod grid, from the node's top
  boxLabelY: number | null; // baseline of the 'EC2' and 'node' tags, or null when they are left out
  flag: { x: number; labelX: number; labelY: number; stemTop: number; dotY: number };
  connector: { x1: number; y1: number; x2: number; y2: number; label: Point & { anchor: 'middle' | 'start' } };
  via: Point;
  strip: { left: number; right: number; top: number; bottom: number };
  legend: Point; // the strip's label: right edge (wide, medium) or left edge (narrow) and first baseline
  kedaLine: Words; // the narrow layout's one-line legend
};

const PAD = 4; // nothing comes nearer the art's edges than this
const NARROW_SPAN = 432; // the narrow composition stops widening here, so a landscape phone doesn't stretch it
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

type Measure = (content: string, size: number, weight?: number) => number;

/** Wide and medium: the group on the left, the arrow, the cluster on the right, the strip beneath. */
function planColumns(W: number, H: number, medium: boolean, measure: Measure): Plan {
  const titleY = 17, subY = 35, top = 52, band = 44;
  const boxTop = top + band, boxH = medium ? 76 : 66;
  const frameH = band + boxH + 14;
  const bw = clamp(Math.round(W * 0.19), 168, 252);
  // The gap holds the "Migrated" arrow; its label keeps 4 px clear of the frames on either side.
  const gap = Math.max(clamp(Math.round(W * 0.075), 64, 104), Math.ceil(measure(TEXT.migrated, 12)) + 8);
  const cx = PAD + bw + gap;
  const instPad = medium ? 10 : 12, instGap = medium ? 8 : 10;
  const instW = (bw - 2 * instPad - 2 * instGap) / 3;
  const inst = [0, 1, 2].map(k => ({ x: Math.round(PAD + instPad + k * (instW + instGap)), y: boxTop, w: Math.round(instW), h: boxH }));
  const zoneGap = medium ? 8 : 14, zonePad = medium ? 8 : 12, nodeGap = medium ? 6 : 10;
  const zoneW = (W - PAD - cx - 2 * zoneGap) / 3;
  const nodeW = (zoneW - 2 * zonePad - nodeGap) / 2;
  const zones: Box[] = [];
  const nodes: Box[] = [];
  for (let z = 0; z < 3; z++) {
    const zx = Math.round(cx + z * (zoneW + zoneGap));
    zones.push({ x: zx, y: top, w: Math.round(cx + z * (zoneW + zoneGap) + zoneW) - zx, h: frameH });
    for (let nd = 0; nd < 2; nd++) {
      const nx = Math.round(cx + z * (zoneW + zoneGap) + zonePad + nd * (nodeW + nodeGap));
      nodes.push({ x: nx, y: boxTop, w: Math.round(cx + z * (zoneW + zoneGap) + zonePad + nd * (nodeW + nodeGap) + nodeW) - nx, h: boxH });
    }
  }
  // The grid spreads across a wide node, so eight 8 px pods don't sit in an empty box.
  const pod = 8, gapY = 8;
  const gapX = clamp(Math.floor((nodeW - 2 * (medium ? 12 : 22) - 4 * pod) / 3), 4, 16);
  // The first instance and node are tagged, unless a tag would crowd its box.
  const tagsFit = measure(TEXT.instance, 11) + 12 <= instW && measure(TEXT.node, 11) + 12 <= nodeW;
  const boxLabelY = tagsFit ? 15 : null;
  const gridY = Math.round(20 + (boxH - 20 - (2 * pod + gapY)) / 2);
  const third = inst[2] ?? inst[0]!;
  const flagX = Math.round(third.x + third.w / 2) + 0.5;

  const beforeNote = PAD + measure(TEXT.beforeNote, 12) <= cx - 16 ? TEXT.beforeNote : TEXT.beforeNoteShort;
  const zoneLabels = measure(TEXT.zones[2], 12) <= zoneW - 2 * zonePad - 4 ? TEXT.zones : TEXT.zonesShort;

  // The availability note sits on whichever heading line has room, or under the zones; if the box is
  // too short for that (a column a fraction under a breakpoint), it is left to the figures below.
  const afterNote = TEXT.afterNote;
  const noteLeft = W - PAD - measure(TEXT.target, 12);
  const labelRoom = 8 + Math.ceil(Math.max(measure(TEXT.pods, 12), measure(TEXT.load, 12)));
  const stripTop = H - 66;
  let target: number | null = null;
  if (noteLeft >= cx + measure(afterNote, 12) + 28) target = subY;
  else if (noteLeft >= cx + measure(TEXT.after, 13, 450) + 28) target = titleY;
  else if (top + frameH + 24 <= stripTop - 8) target = top + frameH + 20;
  // Units cross the gap along the arrow, so its label sits a little above it and their path a little below.
  const connY = boxTop + gridY + pod + gapY / 2;
  const x1 = PAD + bw + 12, x2 = cx - 12;
  return {
    titleY, subY, beforeNote,
    after: { x: cx, y: titleY, subY, note: afterNote },
    target,
    asg: { x: PAD, y: top, w: bw, h: frameH },
    inst, unit: 8, unitGap: 8, unitY: boxTop + gridY,
    zones, zoneLabels, zoneLabelY: 21, zonePad,
    nodes, pod, cols: 4, gapX, gapY, gridY, boxLabelY,
    flag: { x: flagX, labelX: flagX, labelY: top + 21, stemTop: top + 26, dotY: boxTop + 0.5 },
    connector: { x1, y1: connY + 0.5, x2, y2: connY + 0.5, label: { x: (x1 + x2) / 2, y: connY - 12, anchor: 'middle' } },
    via: { x: (x1 + x2) / 2, y: connY + 6 },
    strip: { left: cx, right: W - PAD - labelRoom, top: stripTop, bottom: stripTop + 40 },
    legend: { x: cx - 20, y: stripTop + 11 },
    kedaLine: TEXT.kedaShort,
  };
}

/** Narrow: the group above, a short drop, the cluster below it, the strip at the foot. From 440 px on
    the composition keeps the width it has there, left-aligned under the headings. */
function planStack(W: number, measure: Measure): Plan {
  const titleY = 15, subY = 31;
  const asgTop = 38, asgH = 36;
  const instW = 30, instH = 26, instTop = asgTop + 5;
  const span = Math.min(W - 2 * PAD, NARROW_SPAN);
  const inst = [0, 1, 2].map(k => ({ x: Math.round(PAD + (span * (2 * k + 1)) / 6 - instW / 2), y: instTop, w: instW, h: instH }));
  const zoneTop = 133, zoneGap = 8, zonePad = 6;
  const zoneW = (span - 2 * zoneGap) / 3;
  const zones: Box[] = [];
  const nodes: Box[] = [];
  for (let z = 0; z < 3; z++) {
    const zx = Math.round(PAD + z * (zoneW + zoneGap));
    const zw = Math.round(PAD + z * (zoneW + zoneGap) + zoneW) - zx;
    zones.push({ x: zx, y: zoneTop, w: zw, h: 60 });
    for (let nd = 0; nd < 2; nd++) nodes.push({ x: zx + zonePad, y: zoneTop + 20 + nd * 20, w: zw - 2 * zonePad, h: 16 });
  }
  const pod = 6;
  const nodeW = zoneW - 2 * zonePad;
  const gapX = clamp(Math.floor((nodeW - 8 - 8 * pod) / 7), 2, 6);
  const third = inst[2] ?? inst[0]!;
  const flagX = Math.round(third.x + third.w / 2) + 0.5;
  // The flag's stem crosses the note's line, so a note that would reach it takes its short form.
  const beforeNote = PAD + measure(TEXT.beforeNote, 12) <= flagX - 8 ? TEXT.beforeNote : TEXT.beforeNoteShort;
  // 'manual' hangs from the title row, centred on its stem, nudged right if the title comes near.
  const half = measure(TEXT.manual, 12) / 2;
  const labelX = Math.min(Math.max(flagX, PAD + measure(TEXT.before, 13, 450) + 12 + half), W - PAD - half);
  const afterNote = measure(TEXT.afterNote, 12) <= W - 2 * PAD ? TEXT.afterNote : TEXT.afterNoteShort;
  const zoneLabels = measure(TEXT.zones[2], 12) <= zoneW - 2 * zonePad - 4 ? TEXT.zones : TEXT.zonesShort;
  const labelRoom = 8 + Math.ceil(Math.max(measure(TEXT.pods, 12), measure(TEXT.load, 12)));
  // The legend line ends before the strip's 'pods' label, which can rise to its row.
  const kedaLine = measure(TEXT.kedaShort.join(''), 12) <= span - labelRoom + 2 ? TEXT.kedaShort : TEXT.kedaShorter;
  const xm = Math.round(PAD + span / 2) + 0.5;
  const y1 = asgTop + asgH + 5, y2 = 94;
  const stripTop = 220;
  return {
    titleY, subY, beforeNote,
    after: { x: PAD, y: 109, subY: 125, note: afterNote },
    target: null,
    asg: { x: PAD, y: asgTop, w: span, h: asgH },
    inst, unit: pod, unitGap: 4, unitY: instTop + (instH - (2 * pod + 4)) / 2,
    zones, zoneLabels, zoneLabelY: 14, zonePad,
    nodes, pod, cols: 8, gapX, gapY: 0, gridY: 5, boxLabelY: null,
    flag: { x: flagX, labelX, labelY: titleY, stemTop: titleY + 5, dotY: instTop + 0.5 },
    // The middle instance's units fall either side of the arrow, so its label keeps clear of them.
    connector: { x1: xm, y1, x2: xm, y2, label: { x: xm + 13, y: (y1 + y2) / 2 + 4, anchor: 'start' } },
    via: { x: xm, y: (y1 + y2) / 2 },
    strip: { left: PAD, right: PAD + span - labelRoom, top: stripTop, bottom: stripTop + 40 },
    legend: { x: PAD, y: stripTop - 8 },
    kedaLine,
  };
}

let builds = 0;

const scene: SceneModule = {
  still: STILL,
  story: STORY,
  // The strip runs on at once, and so do the pods under it.
  departs: STORY,
  build(host, { width: W, height: H, layout }) {
    const narrow = layout === 'narrow';
    const id = `comcast-${++builds}`;
    // The strip's labels move every frame; the art must never be what the browser keeps the page
    // anchored to, or the page would drift with them while the reader is below it.
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, style: 'overflow-anchor: none' }, host);
    const measure: Measure = (content, size, weight = 400) => {
      const probe = text(svg, content, { 'font-size': size, 'font-weight': weight });
      const length = probe.getComputedTextLength();
      probe.remove();
      return length;
    };
    const plan = narrow ? planStack(W, measure) : planColumns(W, H, layout === 'medium', measure);
    const { pod, strip: st } = plan;
    const defs = el('defs', {}, svg);
    const flight = narrow ? T.drop : T.flight;
    const travel = narrow ? easeInOut : flightEase;
    const lastLanding = flightStart(FLOOR - 3) + flight;
    const settledAt = Math.max(T.settled, lastLanding + T.glowOut + 0.05);

    /* Before, drawn from the start: the Auto Scaling Group with two instances. Then one manual change
       grows it to three. */
    text(svg, TEXT.before, { x: PAD, y: plan.titleY, 'font-size': 13, 'font-weight': 450, fill: COLORS.text });
    text(svg, plan.beforeNote, { x: PAD, y: plan.subY, 'font-size': 12, fill: COLORS.muted });
    const { asg } = plan;
    el('rect', { x: asg.x + 0.5, y: asg.y + 0.5, width: asg.w - 1, height: asg.h - 1, fill: 'none', stroke: COLORS.ghost, 'stroke-dasharray': '3 3' }, svg);
    // Each instance's outline, which recedes once its units have left.
    const outlines: Element[][] = plan.inst.map((b, k) =>
      k < 2 ? [el('rect', { x: b.x + 0.5, y: b.y + 0.5, width: b.w - 1, height: b.h - 1, fill: 'none', stroke: COLORS.ghost }, svg)] : []);
    const first = plan.inst[0]!;
    const tag = plan.boxLabelY === null ? null : text(svg, TEXT.instance, { x: first.x + 8, y: first.y + plan.boxLabelY, 'font-size': 11, fill: COLORS.muted });
    // The third instance draws in from the flag's dot: two halves, clockwise and counterclockwise.
    const third = plan.inst[2] ?? first;
    const left = third.x + 0.5, right = third.x + third.w - 0.5, top = third.y + 0.5, bottom = third.y + third.h - 0.5;
    const middle = plan.flag.x;
    const shell3 = el('g', { opacity: 0 }, svg);
    const halves = [
      { d: `M${middle} ${top}H${right}V${bottom}H${middle}`, length: 2 * (right - middle) + (bottom - top) },
      { d: `M${middle} ${top}H${left}V${bottom}H${middle}`, length: 2 * (middle - left) + (bottom - top) },
    ].map(({ d, length }) => ({
      length,
      path: el('path', { d, fill: 'none', stroke: COLORS.ghost, 'stroke-dasharray': `${length + 1} ${length + 1}`, 'stroke-dashoffset': length + 1 }, shell3),
    }));
    outlines[2]?.push(...halves.map(half => half.path));

    const flag = el('g', { opacity: 0 }, svg);
    const flagLabel = text(flag, TEXT.manual, { x: plan.flag.labelX, y: plan.flag.labelY, 'font-size': 12, fill: COLORS.muted, 'text-anchor': 'middle' });
    const stem = el('line', { x1: plan.flag.x, x2: plan.flag.x, y1: plan.flag.stemTop, y2: plan.flag.dotY - 4.5, stroke: COLORS.muted, 'stroke-dasharray': '3 3' }, flag);
    const dot = el('circle', { cx: plan.flag.x, cy: plan.flag.dotY, r: 3.5, fill: COLORS.surface, stroke: COLORS.text, 'stroke-width': 1.25 }, flag);

    /* After: Kubernetes on Amazon EKS, across three availability zones. */
    const afterTitle = text(svg, TEXT.after, { x: plan.after.x, y: plan.after.y, 'font-size': 13, 'font-weight': 450, fill: COLORS.text, opacity: 0 });
    const afterNote = text(svg, plan.after.note, { x: plan.after.x, y: plan.after.subY, 'font-size': 12, fill: COLORS.muted, opacity: 0 });
    const target = plan.target === null ? null : text(svg, TEXT.target, { x: W - PAD, y: plan.target, 'font-size': 12, fill: COLORS.muted, 'text-anchor': 'end', opacity: 0 });
    const zones = plan.zones.map(b =>
      el('rect', { x: b.x + 0.5, y: b.y + 0.5, width: b.w - 1, height: b.h - 1, fill: 'none', stroke: COLORS.ghost, 'stroke-dasharray': '3 3', opacity: 0 }, svg));
    const zoneLabels = plan.zones.map((b, z) =>
      text(svg, plan.zoneLabels[z] ?? '', { x: b.x + plan.zonePad, y: b.y + plan.zoneLabelY, 'font-size': 12, fill: COLORS.muted, opacity: 0 }));
    const nodes = plan.nodes.map((b, n) => {
      const frame = el('g', { opacity: 0 }, svg);
      el('rect', { x: b.x + 0.5, y: b.y + 0.5, width: b.w - 1, height: b.h - 1, fill: 'none', stroke: COLORS.ghost }, frame);
      if (n === 0 && plan.boxLabelY !== null) text(frame, TEXT.node, { x: b.x + 8, y: b.y + plan.boxLabelY, 'font-size': 11, fill: COLORS.muted });
      return frame;
    });

    // Pod i goes to zone i % 3, alternating nodes, filling each node's grid row by row.
    const gridW = plan.cols * pod + (plan.cols - 1) * plan.gapX;
    const slots: Point[] = [];
    for (let i = 0; i < 3 * 2 * 8; i++) {
      const z = i % 3, k = Math.floor(i / 3), nd = k % 2, j = Math.floor(k / 2);
      const node = plan.nodes[z * 2 + nd] ?? plan.nodes[0]!;
      const col = j % plan.cols, row = Math.floor(j / plan.cols);
      slots.push({ x: Math.round(node.x + (node.w - gridW) / 2 + col * (pod + plan.gapX)), y: node.y + plan.gridY + row * (pod + plan.gapY) });
    }
    let freeDots = '';
    for (const slot of slots) freeDots += `M${slot.x + pod / 2 - 1} ${slot.y + pod / 2 - 1}h2v2h-2z`;
    const free = el('path', { d: freeDots, fill: COLORS.ghost, opacity: 0 }, svg);

    /* The "Migrated" arrow; its head rides the tip of the line as it draws. */
    const c = plan.connector;
    const connectorLength = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
    const connector = el('line', { x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2, stroke: COLORS.muted, 'stroke-dasharray': `${connectorLength} ${connectorLength}`, 'stroke-dashoffset': connectorLength }, svg);
    const head = el('path', { d: narrow ? 'M-4 -5L0 0L4 -5' : 'M-5 -4L0 0L-5 4', fill: 'none', stroke: COLORS.muted, opacity: 0 }, svg);
    const connectorLabel = text(svg, TEXT.migrated, { x: c.label.x, y: c.label.y, 'font-size': 12, fill: COLORS.reading, 'text-anchor': c.label.anchor, opacity: 0 });

    /* Pods. The first twelve begin as the instances' units: hollow squares outlined in --reading. KEDA
       adds the rest: amber circles, so the two kinds differ in shape as well as colour. */
    const unitGrid = 2 * plan.unit + plan.unitGap;
    const unitOf = (i: number): Point => {
      const b = plan.inst[i % 3] ?? third, u = Math.floor(i / 3);
      return { x: Math.round(b.x + (b.w - unitGrid) / 2) + (u % 2) * (plan.unit + plan.unitGap), y: Math.round(plan.unitY) + Math.floor(u / 2) * (plan.unit + plan.unitGap) };
    };
    const podLayer = el('g', {}, svg);
    const migrated = slots.slice(0, FLOOR).map((slot, i) => {
      const from = unitOf(i);
      const mark = el('rect', {
        x: from.x + 0.5, y: from.y + 0.5, width: pod - 1, height: pod - 1, rx: 1,
        fill: TONE.migratedFill, stroke: COLORS.reading, opacity: i % 3 < 2 ? 1 : 0,
      }, podLayer);
      return { mark, slot, from };
    });
    const added = slots.slice(FLOOR, CAP).map(slot =>
      el('circle', { cx: slot.x + pod / 2, cy: slot.y + pod / 2, r: pod / 2 - 0.5, fill: TONE.addedFill, stroke: COLORS.amber, opacity: 0 }, podLayer));

    // Wide and medium: each unit's path is a quadratic curve through the arrow's middle, walked by arc
    // length so that the ease alone sets its speed (the curve's own parameter speeds up near the end).
    const quad = (a: number, control: number, b: number, u: number) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * control + u * u * b;
    const SEGMENTS = 32;
    const paths = narrow ? [] : migrated.map(p => {
      const point = (u: number): Point => ({ x: quad(p.from.x, plan.via.x - pod / 2, p.slot.x, u), y: quad(p.from.y, plan.via.y - pod / 2, p.slot.y, u) });
      const lengths = [0];
      let previous = point(0);
      for (let n = 1; n <= SEGMENTS; n++) {
        const next = point(n / SEGMENTS);
        lengths.push((lengths[n - 1] ?? 0) + Math.hypot(next.x - previous.x, next.y - previous.y));
        previous = next;
      }
      return { point, lengths };
    });
    const along = (path: { point: (u: number) => Point; lengths: number[] }, k: number) => {
      const goal = k * (path.lengths[SEGMENTS] ?? 0);
      let n = 1;
      while (n < SEGMENTS && (path.lengths[n] ?? 0) < goal) n++;
      const a = path.lengths[n - 1] ?? 0, b = path.lengths[n] ?? a;
      return path.point((n - 1 + (b > a ? (goal - a) / (b - a) : 0)) / SEGMENTS);
    };

    /* The strip: load and pods over load-cycle time, scrolling left; no values, no clock. The traces
       begin at the migration: they enter at the right edge and fill the strip once. */
    const span = (st.right - st.left) / SPEED;
    const LOW = 5, HIGH = 37;
    const yOf = (value: number) => st.bottom - 2 - ((value - LOW) / (HIGH - LOW)) * (st.bottom - st.top - 4);
    const xOf = (s: number) => ((s + span) * SPEED).toFixed(1);
    let loadPath = '';
    const firstPoint = Math.floor((-span - 1) / 0.1), lastPoint = Math.ceil((PERIOD + 1) / 0.1);
    for (let n = firstPoint; n <= lastPoint; n++) loadPath += `${n === firstPoint ? 'M' : 'L'}${xOf(n * 0.1)} ${yOf(demand(n * 0.1)).toFixed(1)}`;
    let podsPath = '', previous = '';
    const from = Math.floor((-span - 1) / STEP), to = Math.ceil((PERIOD + 1) / STEP);
    for (let n = from; n <= to; n++) {
      const y = (Math.round(yOf(at(podsAt, wrapIndex(n)))) + 0.25).toFixed(2);
      if (n === from) podsPath = `M${xOf(n * STEP)} ${y}`;
      else if (y !== previous) podsPath += `H${xOf(n * STEP)}V${y}`;
      previous = y;
    }
    podsPath += `H${xOf(to * STEP)}`;

    const clip = el('clipPath', { id: `${id}-strip` }, defs);
    const reveal = el('rect', { x: st.right, y: st.top - 4, width: 0, height: st.bottom - st.top + 8 }, clip);
    const chart = el('g', { opacity: 0 }, svg);
    el('line', { x1: st.left, x2: st.right, y1: st.bottom + 0.5, y2: st.bottom + 0.5, stroke: COLORS.line }, chart);
    const traces = el('g', { 'clip-path': `url(#${id}-strip)` }, chart);
    const scroll = el('g', {}, traces);
    el('path', { d: loadPath, fill: 'none', stroke: COLORS.reading, 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, scroll);
    el('path', { d: podsPath, fill: 'none', stroke: COLORS.amber, 'stroke-width': 1.5 }, scroll);
    const edge = el('line', { x1: st.right + 0.5, x2: st.right + 0.5, y1: st.top - 4, y2: st.bottom + 4, stroke: COLORS.firm, opacity: 0 }, svg);
    const loadLabel = text(svg, TEXT.load, { x: st.right + 8, y: st.bottom, 'font-size': 12, fill: COLORS.muted, opacity: 0 });
    const podsLabel = text(svg, TEXT.pods, { x: st.right + 8, y: st.bottom, 'font-size': 12, fill: COLORS.amber, opacity: 0 });

    const legend = el('g', { opacity: 0 }, svg);
    const words = (parent: Element, parts: Words, attributes: Record<string, string | number>) => {
      const line = text(parent, '', attributes);
      line.append(parts[0]);
      el('tspan', { fill: COLORS.amber }, line).textContent = parts[1];
      if (parts[2]) line.append(parts[2]);
    };
    if (narrow) {
      words(legend, plan.kedaLine, { x: plan.legend.x, y: plan.legend.y, 'font-size': 12, fill: COLORS.reading });
    } else {
      const end = { x: plan.legend.x, 'text-anchor': 'end' };
      text(legend, TEXT.keda, { ...end, y: plan.legend.y, 'font-size': 13, 'font-weight': 450, fill: COLORS.text });
      words(legend, TEXT.kedaRises, { ...end, y: plan.legend.y + 17, 'font-size': 12, fill: COLORS.muted });
      text(legend, TEXT.kedaFalls, { ...end, y: plan.legend.y + 33, 'font-size': 12, fill: COLORS.muted });
    }

    /* ---------- One moment ---------- */

    // Narrow: units fall through the EKS heading and the zones' labels, so those words wait until they land.
    const headAt = narrow ? lastLanding - 0.1 : T.cluster;
    const zoneLabelAt = (z: number) => (narrow ? headAt + 0.15 + z * 0.06 : T.cluster + 0.1 + z * 0.08);

    function story(t: number) {
      const dropped = easeOut(phase(t, T.flag, 0.5));
      set(flag, 'opacity', dropped);
      set(flag, 'transform', `translate(0 ${(-6 * (1 - dropped)).toFixed(2)})`);
      set(shell3, 'opacity', t >= T.third ? 1 : 0);
      const drawn = easeOut(phase(t, T.third, 0.55));
      for (const half of halves) set(half.path, 'stroke-dashoffset', (half.length + 1) * (1 - drawn));
      // Once an instance is empty its outline recedes; the group's words stay readable.
      outlines.forEach((parts, k) => {
        const tone = mixColor(COLORS.ghost, COLORS.firm, easeOut(phase(t, emptiedAt(k), 0.5)));
        for (const part of parts) set(part, 'stroke', tone);
      });
      if (tag) set(tag, 'fill', mixColor(COLORS.muted, TONE.quiet, easeOut(phase(t, emptiedAt(0), 0.5))));
      const retired = easeOut(phase(t, emptiedAt(2), 0.5));
      set(flagLabel, 'fill', mixColor(COLORS.muted, TONE.quiet, retired));
      set(stem, 'stroke', mixColor(COLORS.muted, COLORS.ghost, retired));
      set(dot, 'stroke', mixColor(COLORS.text, TONE.quiet, retired));

      fadeIn(afterTitle, t, headAt, 0.4, 4);
      fadeIn(afterNote, t, headAt + 0.1, 0.4, 4);
      if (target) fadeIn(target, t, T.cluster + 0.2, 0.4, 4);
      zones.forEach((frame, z) => set(frame, 'opacity', easeOut(phase(t, T.cluster + 0.1 + z * 0.08, 0.6))));
      zoneLabels.forEach((label, z) => (narrow ? fadeIn(label, t, zoneLabelAt(z), 0.4, 4) : set(label, 'opacity', easeOut(phase(t, zoneLabelAt(z), 0.6)))));
      nodes.forEach((frame, n) => set(frame, 'opacity', easeOut(phase(t, T.cluster + 0.25 + Math.floor(n / 2) * 0.08 + (n % 2) * 0.05, 0.6))));
      set(free, 'opacity', easeOut(phase(t, T.cluster + 0.45, 0.6)));

      const reach = easeOut(phase(t, T.connector, 0.6));
      set(connector, 'stroke-dashoffset', connectorLength * (1 - reach));
      set(head, 'opacity', Math.min(1, reach * 3));
      set(head, 'transform', `translate(${(c.x1 + (c.x2 - c.x1) * reach).toFixed(2)} ${(c.y1 + (c.y2 - c.y1) * reach).toFixed(2)})`);
      fadeIn(connectorLabel, t, T.connector + 0.15, 0.4, 4);

      migrated.forEach((p, i) => {
        const start = flightStart(i);
        const u = travel(phase(t, start, flight));
        let x = p.from.x, y = p.from.y;
        const path = paths[i];
        if (u >= 1) {
          x = p.slot.x;
          y = p.slot.y;
        } else if (u > 0 && path) {
          ({ x, y } = along(path, u));
        } else if (u > 0) {
          // Each zone sits under its instance: units fall straight down and slide sideways only at
          // the end, inside the node row.
          const v = 1 - u;
          x = p.from.x + (p.slot.x - p.from.x) * u * u * u;
          y = p.from.y + (p.slot.y - p.from.y) * (3 * v * v * u * 0.85 + 3 * v * u * u + u * u * u);
        }
        set(p.mark, 'x', x + 0.5);
        set(p.mark, 'y', y + 0.5);
        // A landing unit brightens as it settles into its slot, then eases back to --reading.
        const land = start + flight;
        const glow = t < land ? flightEase(phase(t, land - T.glowIn, T.glowIn)) : 1 - flightEase(phase(t, land, T.glowOut));
        set(p.mark, 'stroke', mixColor(COLORS.reading, COLORS.text, glow));
        if (i % 3 === 2) set(p.mark, 'opacity', easeOut(phase(t, T.third + 0.25, 0.4)));
      });

      set(chart, 'opacity', easeOut(phase(t, T.strip, 0.5)));
      fadeIn(legend, t, T.strip + 0.05, 0.4, 4);
      set(edge, 'opacity', easeOut(phase(t, T.strip + 0.35, 0.4)));
      fadeIn(podsLabel, t, T.strip + 0.4, 0.4, 4);
      fadeIn(loadLabel, t, T.strip + 0.45, 0.4, 4);
    }

    const firstSample = Math.floor(S0 / STEP);
    function loop(t: number) {
      const s = simTime(t);
      const live = t >= T.sim;
      const sample = Math.floor(s / STEP);
      const count = live ? at(podsAt, wrapIndex(sample)) : FLOOR;
      const cycle = ((s % PERIOD) + PERIOD) % PERIOD;
      set(scroll, 'transform', `translate(${(st.left - cycle * SPEED).toFixed(2)} 0)`);
      // Only the time since the migration is drawn: it enters at the right edge.
      const recorded = (s - S0) * SPEED;
      const reach = Math.max(st.left, st.right - recorded);
      set(reveal, 'x', reach);
      set(reveal, 'width', recorded > 0 ? st.right + 1 - reach : 0);

      // Each added pod fades in when the count first covers it, and out when the count drops below it.
      added.forEach((mark, m) => {
        if (!live) {
          set(mark, 'opacity', 0);
          return;
        }
        const needed = FLOOR + 1 + m;
        const on = count >= needed;
        let since = Infinity;
        for (let j = sample; j > sample - Math.ceil(FADE_IN / STEP); j--) {
          const before = j - 1 < firstSample ? false : at(podsAt, wrapIndex(j - 1)) >= needed;
          if (before !== on) {
            since = s - j * STEP;
            break;
          }
        }
        set(mark, 'opacity', on ? easeOut(clamp01(since / FADE_IN)) : 1 - easeOut(clamp01(since / FADE_OUT)));
      });

      // The direct labels follow their traces at the strip's right edge, kept 13 px apart.
      let loadY = yOf(demand(s)) + 4, podsY = Math.round(yOf(count)) - 3;
      if (loadY - podsY < 13) {
        const mid = (loadY + podsY) / 2;
        podsY = mid - 6.5;
        loadY = mid + 6.5;
      }
      set(loadLabel, 'y', loadY);
      set(podsLabel, 'y', podsY);
    }

    let settled = false;
    return {
      render(seconds) {
        if (!settled || seconds < settledAt) {
          story(seconds);
          settled = seconds >= settledAt;
        }
        loop(seconds);
      },
    };
  },
};

export default scene;
