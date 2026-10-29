// The build-repair agent's visual (the Microsoft industry project in src/content.ts).
// Three builds, one per architecture and each in its own Docker environment, run past the five
// failure kinds. In each cycle one build breaks at an example stage: the agent's loop (inspect,
// hypothesize, patch, compile, validate) closes around the break in amber, a patch mends it with an
// amber splice, and the build runs on to a validated artifact. The closed loop stays drawn around the
// splice while the finished picture holds, so the hold (and the reduced-motion still) shows a repair
// rather than three passed builds. The five cases rotate so every failure kind and architecture
// appears; the rotation is this panel's loop, and each cycle clears the last, so nothing tallies.
import { COLORS, easeOut, el, phase, set, text } from './draw';
import type { SceneModule } from './types';

/** Every word the art draws, exported so the site's checks can read them all without running the scene.
    The failures and patches are textbook examples written for the illustration, not cases from the
    project; the caption in src/content.ts says so. Where a list offers alternatives they run longest
    first, and the longest that fits is drawn, so enlarged letter or word spacing gets a shorter form
    rather than an overflow. */
export const TEXT = {
  /** The top line. The last is the project's own wording. */
  environment: ['Each build runs in its own isolated Docker environment', 'Each build in an isolated Docker environment', 'Isolated Docker environments'],
  archs: ['x86_64', 'ARM/aarch64', 'RISC-V'],
  /** The same architectures, for phone column heads too narrow for the full names. */
  archsShort: ['x86_64', 'ARM', 'RISC-V'],
  /** The failure kinds from the project text, set out in the order a build meets them. */
  stages: ['dependency', 'configuration', 'compiler', 'linker', 'packaging'],
  artifact: 'artifact',
  validated: 'artifact validated',
  loop: 'Agent loop:',
  steps: ['inspect', 'hypothesize', 'patch', 'compile', 'validate'],
  /** Joins an architecture to its failure in the phone layout's status line. */
  joiner: ' · ',
  /** One example per cycle; `arch` and `stage` index the lists above, and `patch` lists the patch's forms. */
  cases: [
    { arch: 2, stage: 1, kind: 'Configuration failure', log: 'cannot guess build type', patch: ['+ --build=riscv64-linux-gnu'] },
    { arch: 1, stage: 2, kind: 'Compiler failure', log: "narrowing conversion of '-1' from 'int' to 'char'", patch: ['+ signed char kStep[]'] },
    { arch: 0, stage: 0, kind: 'Dependency failure', log: 'Could NOT find ZLIB', patch: ['+ RUN apt-get install -y zlib1g-dev', '+ apt-get install zlib1g-dev', '+ zlib1g-dev'] },
    { arch: 2, stage: 3, kind: 'Linker failure', log: "undefined reference to `__atomic_exchange_1'", patch: ['+ LIBS += -latomic'] },
    { arch: 1, stage: 4, kind: 'Packaging failure', log: 'Arch dependent binaries in noarch package', patch: ['- BuildArch: noarch'] },
  ],
} as const;

type Case = (typeof TEXT.cases)[number];
type Point = { x: number; y: number };
type Lane = { a: Point; b: Point };
/** A word of the legend: where it starts, its baseline and its width. */
type Slot = { x: number; y: number; w: number };

/** Build logs and patches are the site's one monospace. */
const MONO = "font-family: ui-monospace, 'SF Mono', Menlo, monospace";
const INK = {
  ...COLORS,
  /** Loop steps not yet reached: the dimmest text tone that still reads (5.3:1 on the surface). */
  waiting: '#8a887f',
  failure: '#e0703a', // the Sun's red-orange, for the break only
} as const;

// ---- Timing, in seconds of the visual's own clock ----
const START = [0.12, 0.22, 0.32] as const; // the three builds begin a beat apart
// A build crosses its whole track, linearly, when nothing breaks: 1024 px on the widest (1320 px)
// panel, so traces never pass 200 px/s.
const TRAVEL = 5.12;
const LOOP_DELAY = 0.25; // from the break to the loop's first step
const STEP = 0.5; // each of the loop's five steps
const RESUME = 0.35; // from the mend to the build running on
const SETTLE = 0.65; // the last artifact is filled, checked and labelled
const HOLD = 4.5; // the complete picture, its repair still drawn, holds before the next case
const EXIT = 0.3; // the finished case leaves as the next one begins
const ARRIVE = 0.4; // labels and marks arrive (ease-out, 4 px rise for labels)
const TICK = 0.12; // the step name above the trace crossfades into the next this quickly
const RISE = 4;

/** Phone layout: on a phone turned on its side (an art box of 480–639 px) the build columns keep to
    this width, set from the left, instead of stretching. */
const MAX_COLUMN = 110;

function nth<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new RangeError(`buildRepair: no item ${index}`);
  return item;
}
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

/** A case lasts until its broken build has been mended, has run on, and has held complete. Where
    the break falls does not change this, so the length is the same at every width. */
const caseLength = (arch: number) => nth(START, arch) + TRAVEL + LOOP_DELAY + 5 * STEP + RESUME + SETTLE + HOLD;
const LENGTHS = TEXT.cases.map(c => caseLength(c.arch));
const ROTATION = sum(LENGTHS);
/** The first case after its repair: all three artifacts validated, the splice and patch shown, the
    closed loop around them and the legend lit. */
const STILL = nth(LENGTHS, 0) - 0.25;

const r2 = (value: number) => Math.round(value * 100) / 100;
/** The first case as its hold begins: the opening story. The cases after it are the loop. */
const STORY = r2(nth(LENGTHS, 0) - HOLD);
const hex = (color: string) => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
/** A color part way from `from` to `to`. */
function blend(from: string, to: string, k: number) {
  if (k <= 0) return from;
  if (k >= 1) return to;
  const a = hex(from), b = hex(to);
  return `rgb(${a.map((v, i) => Math.round(v + (nth(b, i) - v) * k)).join(' ')})`;
}
/** Eased arrival over ARRIVE seconds from `start`. */
const arrival = (t: number, start: number, duration = ARRIVE) => easeOut(phase(t, start, duration));
/** Opacity of something leaving over `duration` from `start` (exits are quicker than entrances). */
const leaving = (t: number, start: number, duration = EXIT) => 1 - easeOut(phase(t, start, duration));
const rise = (k: number) => `translate(0 ${r2((1 - k) * RISE)})`;

/** Where a case's words go, worked out at build time (the scene never measures while it plays). */
type Placement = {
  patch: string; // the longest form of the patch that fits
  patchSize: number;
  patchW: number;
  markerW: number; // the '+ ' or '- ' before the code
  x: number; // the patch (and, beside the break, the step name above it)
  y: number;
  anchor: 'start' | 'end';
  failY: number; // beside the break: the failure, and its log where there is room
  showLog: boolean;
  prefix: string; // phone: the architecture before the patch, where both fit
  status: string; // phone: '<arch> · <kind>' in the status line, or the kind alone
};

/** One case's moments, for this layout's geometry. */
type Plan = {
  case: Case;
  arch: number;
  pBreak: number; // how far along its track the build breaks, 0–1
  at: Point; // where
  tBreak: number;
  tLoop: number;
  tFixed: number;
  tResume: number;
  arrive: readonly number[]; // when each lane's build reaches its artifact
  place: Placement;
};

/** The marks that show a mend: the splice, and the patch beside the break (or in the status line). */
type Mend = {
  splice: SVGPathElement;
  fail: SVGTextElement | null;
  kind: SVGTSpanElement | null;
  log: SVGTSpanElement | null;
  patch: SVGGElement;
  patchText: SVGTextElement;
  prefix: SVGTextElement | null; // phone status: the architecture before the patch
  strike: SVGLineElement;
};

/** The agent's loop: a ring of five steps around the break, swept in amber as the agent works. */
type Ring = { group: SVGGElement; base: SVGCircleElement; arc: SVGCircleElement; dots: SVGCircleElement[] };

/** The marks at the end of each lane: the built artifact, its check and its label. */
type Finish = { fill: SVGRectElement; check: SVGPathElement; label: SVGTextElement | null };

const scene: SceneModule = {
  still: STILL,
  story: STORY,
  // The first case holds complete until the next one begins, and the picture is another from there on.
  departs: r2(nth(LENGTHS, 0)),
  build(host, { width: W, height: H, layout }) {
    const svg = el('svg', { viewBox: `0 0 ${Math.max(1, W)} ${Math.max(1, H)}`, 'aria-hidden': 'true' }, host);
    // A box too small to hold the drawing (a window narrower than about 170 px) gets an empty one.
    if (W < 120 || H < 120) return { render() {} };

    // Labels are placed by their measured widths (the fonts have loaded before build runs). The widths
    // include any letter or word spacing the reader has set; the host builds the scene again when it changes.
    const probe = el('text', { x: 0, y: -40 }, svg);
    const measure = (content: string, size: number, mono = false, weight = 400) => {
      probe.setAttribute('font-size', String(size));
      probe.setAttribute('font-weight', String(weight));
      if (mono) probe.setAttribute('style', MONO);
      else probe.removeAttribute('style');
      probe.textContent = content;
      return probe.getComputedTextLength();
    };

    const narrow = layout === 'narrow';
    const horizontal = !narrow;
    const INSET = 4; // nothing but rules comes closer than this to the art's edges
    const room = W - 2 * INSET;
    const structure = el('g', {}, svg);
    const outgoing = el('g', { opacity: 0 }, svg); // the finished case, while it leaves
    const marks = el('g', {}, svg);
    const words = el('g', {}, svg);

    const label = (parent: Element, content: string, x: number, y: number, size: number, fill: string, extra: Record<string, string | number> = {}) =>
      text(parent, content, { x: r2(x), y: r2(y), 'font-size': size, fill, ...extra });

    // ---- Layout: rows on wide and medium panels; on phones the grid turns 90 degrees ----
    const lanes: Lane[] = [];
    let trackLength: number;
    let stageEnd: number; // where the last stage ends along the track (before the artifact)
    // The splice ends well inside the ring, clear of its step dots, since the closed loop stays around it.
    let ringR: number, spliceHalf: number, capHalf: number, breakHalf: number;
    let legendSize: number;
    let legend: Slot[] = [];
    let statusY = 0;
    let calloutLeft = 0, calloutRight = 0;
    /** The architecture names this layout draws (a narrow phone may need the short ones). */
    let archNames: readonly string[] = TEXT.archs;

    // The top line: the longest wording that fits; the shortest at 11 px as a last resort, or none.
    let topSize = 12;
    let topLine: string | undefined = TEXT.environment.find(line => measure(line, topSize) <= room);
    if (topLine === undefined) {
      const shortest = nth(TEXT.environment, TEXT.environment.length - 1);
      if (measure(shortest, 11) <= room) {
        topLine = shortest;
        topSize = 11;
      }
    }

    if (horizontal) {
      const medium = layout === 'medium';
      const archW = Math.max(...TEXT.archs.map(a => measure(a, 13, false, 450)));
      const validW = measure(TEXT.validated, 12);
      const x0 = Math.max(medium ? 0 : 168, Math.round(INSET + archW + 16));
      const xEnd = Math.round(W - 6 - 28 - validW); // the check at +12, its label at +28, 6 px clear of the edge
      stageEnd = xEnd - (medium ? 36 : 52);
      trackLength = xEnd - x0;
      ringR = 22;
      spliceHalf = 14;
      capHalf = 4;
      breakHalf = 8;

      // Column heads: the stages, then the artifact. They drop to 11 px only where 12 px would crowd,
      // and stagger onto two rows only where even 11 px would (enlarged letter spacing on a medium panel).
      const stageW = (stageEnd - x0) / 5;
      const heads = [...TEXT.stages, TEXT.artifact];
      const headX = (i: number) => (i < 5 ? x0 + stageW * (i + 0.5) : xEnd);
      const clear = (size: number, stride: number) =>
        heads.every((head, i) => i < stride || headX(i) - headX(i - stride) - (measure(head, size) + measure(nth(heads, i - stride), size)) / 2 >= 10);
      const staggered = !clear(11, 1);
      const headSize = staggered ? (clear(12, 2) ? 12 : 11) : clear(12, 1) ? 12 : 11;
      const headY = staggered ? [medium ? 31 : 29, medium ? 44 : 42] : [medium ? 37 : 35];
      const ruleTop = staggered ? (medium ? 52.5 : 50.5) : medium ? 45.5 : 43.5;
      const pitch = Math.floor((H - 28.5 - ruleTop) / 3); // 72 px rows on wide panels (64 px plus an 8 px gap)

      if (topLine) label(structure, topLine, INSET, medium ? 15 : 14, topSize, INK.muted);
      heads.forEach((head, i) => label(structure, head, headX(i), nth(headY, staggered ? i % 2 : 0), headSize, INK.muted, { 'text-anchor': 'middle' }));

      for (let r = 0; r <= 3; r++) {
        const y = ruleTop + r * pitch;
        el('line', { x1: 0, x2: W, y1: y, y2: y, stroke: INK.line }, structure);
      }
      TEXT.archs.forEach((arch, r) => {
        const y = ruleTop + (r + 0.5) * pitch;
        lanes.push({ a: { x: x0, y }, b: { x: xEnd, y } });
        label(structure, arch, INSET, y + 4.5, 13, INK.text, { 'font-weight': 450 });
      });

      // The legend: its title under the architectures, its steps from the start of the tracks.
      legendSize = 12;
      const legendY = H - 10;
      label(structure, TEXT.loop, INSET, legendY, legendSize, INK.muted);
      const stepW = TEXT.steps.map(s => measure(s, legendSize));
      const gap = Math.max(12, Math.min(30, (W - 8 - x0 - sum(stepW)) / 4));
      let x = x0;
      legend = stepW.map(w => {
        const slot = { x, y: legendY, w };
        x += w + gap;
        return slot;
      });
      calloutLeft = INSET + archW + 12;
      calloutRight = xEnd - 22;
    } else {
      // Columns are builds (Docker environments), rows are stages, and builds run downward.
      const stageLabels = [...TEXT.stages, TEXT.artifact];
      const right = W - INSET - 0.5;
      const gap = 8;
      type Grid = { stageSize: number; labelRight: number; left: number; colW: number };
      const columns = (stageSize: number): Grid => {
        const labelRight = INSET + Math.max(...stageLabels.map(s => measure(s, stageSize)));
        const left = labelRight + 10;
        return { stageSize, labelRight, left, colW: Math.min(MAX_COLUMN, (right - left - 2 * gap) / 3) };
      };
      const frameX = (grid: Grid, i: number) => Math.round(grid.left + i * (grid.colW + gap)) + 0.5;
      const middle = (grid: Grid, i: number) => Math.round(frameX(grid, i) + grid.colW / 2) + 0.5;
      /** Do the heads keep 8 px apart, and inside the art? */
      const headFits = (names: readonly string[], grid: Grid, size: number) => {
        const half = names.map(arch => measure(arch, size, false, 450) / 2);
        return (
          middle(grid, 0) - nth(half, 0) >= INSET &&
          middle(grid, 2) + nth(half, 2) <= W - INSET &&
          half.every((h, i) => i === 0 || middle(grid, i) - middle(grid, i - 1) - (h + nth(half, i - 1)) >= 8)
        );
      };
      // The full architecture names at the largest size that fits (beside 12 px stage labels, then 11 px);
      // the short names only where the full ones cannot fit at all.
      let grid = columns(11);
      let headSize = 11;
      archNames = TEXT.archsShort;
      search: for (const names of [TEXT.archs, TEXT.archsShort]) {
        for (const stageSize of [12, 11]) {
          const candidate = columns(stageSize);
          const size = [13, 12, 11].find(s => headFits(names, candidate, s));
          if (size !== undefined) {
            grid = candidate;
            headSize = size;
            archNames = names;
            break search;
          }
        }
      }

      // The legend: one row with its title where that fits, then one row without it; then two rows, the
      // second set under the first step. Gaps run 10–16 px, and the row keeps 8 px clear on the right.
      legendSize = 11;
      const stepW = TEXT.steps.map(s => measure(s, legendSize));
      const lineEnd = W - 8;
      /** The gap that sets steps [from, to) in a row starting at `x`, or -1 where they do not fit. */
      const rowGap = (x: number, from: number, to: number) => {
        const widths = stepW.slice(from, to);
        if (widths.length === 1) return x + sum(widths) <= lineEnd ? 16 : -1;
        const g = Math.min(16, (lineEnd - x - sum(widths)) / (widths.length - 1));
        return g >= 10 ? g : -1;
      };
      const titleEnd = INSET + measure(TEXT.loop, legendSize) + 10;
      const arrangements = [
        { title: true, split: 5 }, { title: false, split: 5 },
        { title: true, split: 2 }, { title: true, split: 3 }, { title: true, split: 1 },
        { title: false, split: 3 }, { title: false, split: 2 },
      ];
      let arranged = { title: false, split: 3, x2: INSET, gap: 10 };
      for (const { title, split } of arrangements) {
        const x1 = title ? titleEnd : INSET;
        const g1 = rowGap(x1, 0, split);
        if (g1 < 0) continue;
        if (split === 5) {
          arranged = { title, split, x2: x1, gap: g1 };
          break;
        }
        let x2 = x1;
        let g2 = rowGap(x2, split, 5);
        if (g2 < 0 && x1 !== INSET) {
          x2 = INSET;
          g2 = rowGap(x2, split, 5);
        }
        if (g2 < 0) continue;
        arranged = { title, split, x2, gap: Math.min(g1, g2) };
        break;
      }
      const twoRows = arranged.split < 5;

      // Two legend rows take their room from the stages, which close up from 26 to 24 px.
      const frameTop = 42.5;
      const y0 = 55;
      const stagePitch = twoRows ? 24 : 26;
      stageEnd = y0 + stagePitch * 5;
      const yEnd = stageEnd + 20;
      trackLength = yEnd - y0;
      ringR = 14;
      spliceHalf = 8;
      capHalf = 3;
      breakHalf = 6;

      if (topLine) label(structure, topLine, INSET, 14, topSize, INK.muted);
      archNames.forEach((arch, i) => {
        const x = frameX(grid, i);
        const mid = middle(grid, i);
        el('rect', { x, y: frameTop, width: Math.round(grid.colW), height: Math.round(yEnd + 13 - frameTop), fill: 'none', stroke: INK.line }, structure);
        label(structure, arch, mid, 34, headSize, INK.text, { 'text-anchor': 'middle', 'font-weight': 450 });
        lanes.push({ a: { x: mid, y: y0 }, b: { x: mid, y: yEnd } });
      });
      TEXT.stages.forEach((stage, i) => label(structure, stage, grid.labelRight, y0 + stagePitch * (i + 0.5) + 4, grid.stageSize, INK.muted, { 'text-anchor': 'end' }));
      label(structure, TEXT.artifact, grid.labelRight, yEnd + 4, grid.stageSize, INK.muted, { 'text-anchor': 'end' });

      statusY = twoRows ? H - 44 : H - 33;
      const rowY = twoRows ? [H - 26, H - 11] : [H - 12];
      if (arranged.title) label(structure, TEXT.loop, INSET, nth(rowY, 0), legendSize, INK.muted);
      let x = arranged.title ? titleEnd : INSET;
      legend = stepW.map((w, k) => {
        if (k === arranged.split) x = arranged.x2;
        const slot = { x, y: nth(rowY, k < arranged.split ? 0 : 1), w };
        x += w + arranged.gap;
        return slot;
      });
    }

    const along = (lane: Lane, p: number): Point => ({ x: lane.a.x + (lane.b.x - lane.a.x) * p, y: lane.a.y + (lane.b.y - lane.a.y) * p });
    /** How far along a track stage boundary `i` sits (0–5; fractions fall inside a stage). */
    const stageFraction = (i: number) => ((stageEnd - (horizontal ? nth(lanes, 0).a.x : nth(lanes, 0).a.y)) * i) / 5 / trackLength;

    // ---- Tracks, with a tick at each stage boundary, and the empty artifact at each end ----
    lanes.forEach(lane => {
      el('line', { x1: lane.a.x, y1: lane.a.y, x2: lane.b.x, y2: lane.b.y, stroke: INK.line }, structure);
      let ticks = '';
      for (let i = 0; i <= 5; i++) {
        const p = along(lane, stageFraction(i));
        ticks += horizontal ? `M${Math.round(p.x) + 0.5} ${p.y - 3.5}v7` : `M${p.x - 3.5} ${Math.round(p.y) + 0.5}h7`;
      }
      el('path', { d: ticks, stroke: INK.line, fill: 'none' }, structure);
      el('rect', { x: lane.b.x - 4, y: lane.b.y - 4, width: 8, height: 8, fill: INK.surface, stroke: INK.ghost, 'stroke-width': 1.25 }, structure);
    });

    // ---- What changes ----
    const makeFinish = (parent: Element, lane: Lane): Finish => {
      const e = lane.b;
      const dx = horizontal ? 12 : 9;
      return {
        fill: el('rect', { x: e.x - 4, y: e.y - 4, width: 8, height: 8, fill: INK.text, stroke: INK.text, 'stroke-width': 1.25, opacity: 0 }, parent),
        check: el('path', { d: `M${e.x + dx} ${e.y - 0.5}l3 3l6-7`, fill: 'none', stroke: INK.text, 'stroke-width': 1.5, 'stroke-linejoin': 'round', 'stroke-dasharray': 14, 'stroke-dashoffset': 14, opacity: 0 }, parent),
        label: horizontal ? label(parent, TEXT.validated, e.x + 28, e.y + 4, 12, INK.muted, { opacity: 0 }) : null,
      };
    };
    /** The repaired build's artifact and check stay in --text; the clean builds' are --muted, so the eye
        lands on the repair rather than on the checks. */
    const tint = (finish: Finish, repaired: boolean) => {
      const tone = repaired ? INK.text : INK.muted;
      set(finish.fill, 'fill', tone);
      set(finish.fill, 'stroke', tone);
      set(finish.check, 'stroke', tone);
    };
    const makeMend = (parent: Element): Mend => {
      const splice = el('path', { fill: 'none', stroke: INK.amber, 'stroke-width': 1.5, opacity: 0 }, parent);
      let fail: SVGTextElement | null = null, kind: SVGTSpanElement | null = null, log: SVGTSpanElement | null = null, prefix: SVGTextElement | null = null;
      if (horizontal) {
        fail = el('text', { 'font-size': 12, opacity: 0 }, parent);
        kind = el('tspan', {}, fail);
        log = el('tspan', { style: MONO, dx: 8 }, fail);
      }
      const patch = el('g', { opacity: 0 }, parent);
      if (!horizontal) prefix = label(patch, '', INSET, statusY, 12, INK.reading);
      const patchText = el('text', { 'font-size': 12, style: MONO }, patch);
      const strike = el('line', { stroke: INK.muted, opacity: 0 }, patch);
      return { splice, fail, kind, log, patch, patchText, prefix, strike };
    };
    const circumference = 2 * Math.PI * ringR;
    const dotR = horizontal ? 3 : 2.5;
    const makeRing = (parent: Element, opacity: number): Ring => {
      const group = el('g', { opacity }, parent);
      const base = el('circle', { r: ringR, fill: 'none', stroke: INK.firm }, group);
      const arc = el('circle', { r: ringR, fill: 'none', stroke: INK.amber, 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-dasharray': `0 ${r2(circumference + 2)}` }, group);
      const dots = TEXT.steps.map(() => el('circle', { r: dotR, fill: INK.surface, stroke: INK.ghost, 'stroke-width': 1.25 }, group));
      return { group, base, arc, dots };
    };
    const placeRing = (ring: Ring, b: Point) => {
      for (const node of [ring.base, ring.arc]) {
        node.setAttribute('cx', String(r2(b.x)));
        node.setAttribute('cy', String(r2(b.y)));
      }
      ring.arc.setAttribute('transform', `rotate(-90 ${r2(b.x)} ${r2(b.y)})`);
      ring.dots.forEach((dot, k) => {
        const angle = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        dot.setAttribute('cx', String(r2(b.x + ringR * Math.cos(angle))));
        dot.setAttribute('cy', String(r2(b.y + ringR * Math.sin(angle))));
      });
    };

    // The finished case, complete, for its exit (a copy of its last frame): traces, then its splice
    // over them, its closed loop, then the artifacts.
    lanes.forEach(lane => el('line', { x1: lane.a.x, y1: lane.a.y, x2: lane.b.x, y2: lane.b.y, stroke: INK.reading, 'stroke-width': 1.5, 'stroke-linecap': 'round' }, outgoing));
    const old = { mend: makeMend(outgoing), ring: makeRing(outgoing, 1), finish: lanes.map(lane => makeFinish(outgoing, lane)) };
    old.ring.arc.setAttribute('stroke-dasharray', `${r2(circumference)} ${r2(circumference + 2)}`);
    old.ring.dots.forEach(dot => {
      dot.setAttribute('fill', INK.amber);
      dot.setAttribute('stroke', INK.amber);
    });
    old.finish.forEach(f => {
      f.fill.setAttribute('opacity', '1');
      f.check.setAttribute('opacity', '1');
      f.check.setAttribute('stroke-dashoffset', '0');
      f.label?.setAttribute('opacity', '1');
    });

    // The case under way, back to front: traces, the splice and break over them, the loop, then heads.
    const lines = lanes.map(lane => el('line', { x1: lane.a.x, y1: lane.a.y, x2: lane.a.x, y2: lane.a.y, stroke: INK.reading, 'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: 0 }, marks));
    const mend = makeMend(marks);
    const brk = el('line', { stroke: INK.failure, 'stroke-width': 1.5, opacity: 0 }, marks);
    const ring = makeRing(marks, 0);
    const traces = lanes.map((lane, r) => ({
      line: nth(lines, r),
      head: el('circle', { r: 2.75, fill: INK.text, opacity: 0 }, marks),
      finish: makeFinish(marks, lane),
    }));
    // Above the trace, the step under way. Two words take turns, so one can leave as the next arrives.
    const tickers = horizontal ? [0, 1].map(() => el('text', { 'font-size': 12, fill: INK.amber, opacity: 0 }, words)) : [];
    const failure = horizontal ? null : label(words, '', INSET, statusY, 12, INK.failure, { opacity: 0 });

    // The legend: the loop's five steps, lit in step with the ring. The step under way is also
    // underlined, so it differs from the steps done by more than its hue.
    const steps = TEXT.steps.map((step, k) => {
      const slot = nth(legend, k);
      return { node: label(words, step, slot.x, slot.y, legendSize, INK.waiting), ...slot };
    });
    const links = steps.slice(0, 4).map((from, k) => {
      const to = nth(steps, k + 1);
      if (to.y !== from.y) return null; // the legend breaks onto its second row here
      const end = from.x + from.w;
      return horizontal
        ? el('line', { x1: r2(end + 6), x2: r2(to.x - 6), y1: from.y - 3.5, y2: from.y - 3.5, stroke: INK.line }, words)
        : el('circle', { cx: r2((end + to.x) / 2), cy: from.y - 3, r: 1, fill: INK.line }, words);
    });
    const underline = el('line', { x1: 0, x2: 0, y1: 0, y2: 0, stroke: INK.amber, opacity: 0 }, words);

    // ---- Each case's moments and placements ----
    const longestStep = Math.max(...TEXT.steps.map(s => measure(s, 12)));
    const placeCase = (c: Case, b: Point): Placement => {
      const variants: readonly string[] = c.patch;
      const markerW = (patch: string, size: number) => measure(patch.slice(0, 2), size, true);
      const archName = nth(archNames, c.arch);
      if (horizontal) {
        // The callout takes whichever side of the break has room, drops the log rather than clip it,
        // and shortens the patch only where its full form does not fit beside the break.
        const inset = ringR + 12;
        const kindW = measure(c.kind, 12);
        const logW = measure(c.log, 12, true);
        const widths = variants.map(p => measure(p, 12, true));
        const full = Math.max(kindW + 8 + logW, nth(widths, 0), longestStep);
        const roomRight = calloutRight - (b.x + inset);
        const roomLeft = b.x - inset - calloutLeft;
        const right = roomRight >= full || (roomLeft < full && roomRight >= roomLeft);
        const side = right ? roomRight : roomLeft;
        const x = right ? b.x + inset : b.x - inset;
        const inside = right ? W - INSET - x : x - INSET;
        let k = widths.findIndex(w => w <= side);
        if (k < 0) k = widths.findIndex(w => w <= inside);
        if (k < 0) k = widths.length - 1;
        const patch = nth(variants, k);
        const patchW = nth(widths, k);
        return {
          patch, patchSize: 12, patchW, markerW: markerW(patch, 12), x, y: b.y - 12, anchor: right ? 'start' : 'end',
          failY: b.y + 21, showLog: side >= Math.max(kindW + 8 + logW, patchW, longestStep), prefix: '', status: '',
        };
      }
      // Phone: '<arch> <patch>' in the status line; the patch alone, or a shorter form, where that does not fit.
      const archW = measure(archName, 12);
      let pick: { prefix: string; patch: string; size: number; w: number } | null = null;
      for (const patch of variants) {
        const w = measure(patch, 12, true);
        if (archW + 8 + w <= room) pick = { prefix: archName, patch, size: 12, w };
        else if (w <= room) pick = { prefix: '', patch, size: 12, w };
        if (pick) break;
      }
      if (!pick) {
        const patch = nth(variants, variants.length - 1);
        pick = { prefix: '', patch, size: 11, w: measure(patch, 11, true) };
      }
      const status = `${archName}${TEXT.joiner}${c.kind.toLowerCase()}`;
      return {
        patch: pick.patch, patchSize: pick.size, patchW: pick.w, markerW: markerW(pick.patch, pick.size),
        x: pick.prefix ? INSET + archW + 8 : INSET, y: statusY, anchor: 'start', failY: 0, showLog: false,
        prefix: pick.prefix, status: measure(status, 12) <= room ? status : c.kind,
      };
    };
    const plans: Plan[] = TEXT.cases.map(c => {
      const lane = nth(lanes, c.arch);
      const pBreak = stageFraction(c.stage + 0.5);
      const tBreak = nth(START, c.arch) + pBreak * TRAVEL;
      const tLoop = tBreak + LOOP_DELAY;
      const tFixed = tLoop + 5 * STEP;
      const tResume = tFixed + RESUME;
      const arrive = lanes.map((_, r) => (r === c.arch ? tResume + (1 - pBreak) * TRAVEL : nth(START, r) + TRAVEL));
      const at = along(lane, pBreak);
      return { case: c, arch: c.arch, pBreak, at, tBreak, tLoop, tFixed, tResume, arrive, place: placeCase(c, at) };
    });
    probe.remove();

    /** Places a case's splice and patch (and, beside the break, its failure line). */
    const placeMend = (m: Mend, index: number) => {
      const plan = nth(plans, index);
      const c = plan.case;
      const p = plan.place;
      const removed = p.patch.startsWith('-');
      m.patchText.textContent = p.patch;
      m.patchText.setAttribute('font-size', String(p.patchSize));
      m.patchText.setAttribute('fill', removed ? INK.muted : INK.amber);
      m.patchText.setAttribute('x', String(r2(p.x)));
      m.patchText.setAttribute('y', String(r2(p.y)));
      m.patchText.setAttribute('text-anchor', p.anchor);
      m.strike.setAttribute('opacity', removed ? '1' : '0');
      const left = p.anchor === 'start' ? p.x : p.x - p.patchW;
      const y = Math.round(p.y - 4) + 0.5;
      set(m.strike, 'x1', left + p.markerW);
      set(m.strike, 'x2', left + p.patchW);
      set(m.strike, 'y1', y);
      set(m.strike, 'y2', y);
      if (m.prefix) m.prefix.textContent = p.prefix;
      if (m.fail && m.kind && m.log) {
        m.fail.setAttribute('x', String(r2(p.x)));
        m.fail.setAttribute('y', String(r2(p.failY)));
        m.fail.setAttribute('text-anchor', p.anchor);
        m.kind.textContent = c.kind;
        m.log.textContent = p.showLog ? c.log : '';
      }
      if (m === mend) {
        for (const node of tickers) {
          node.setAttribute('x', String(r2(p.x)));
          node.setAttribute('y', String(r2(p.y)));
          node.setAttribute('text-anchor', p.anchor);
        }
      }
    };
    /** The splice: an amber bridge across the break with square end caps, drawn out from its centre. */
    const splicePath = (b: Point, k: number) => {
      const half = r2(spliceHalf * k), cap = r2(capHalf * k);
      return horizontal
        ? `M${r2(b.x - half)} ${r2(b.y - cap)}V${r2(b.y + cap)}M${r2(b.x - half)} ${b.y}H${r2(b.x + half)}M${r2(b.x + half)} ${r2(b.y - cap)}V${r2(b.y + cap)}`
        : `M${r2(b.x - cap)} ${r2(b.y - half)}H${r2(b.x + cap)}M${b.x} ${r2(b.y - half)}V${r2(b.y + half)}M${r2(b.x - cap)} ${r2(b.y + half)}H${r2(b.x + cap)}`;
    };

    let shown = -1; // which case (counted from the very first) the marks are set up for
    const setCase = (count: number, index: number) => {
      shown = count;
      const plan = nth(plans, index);
      const b = plan.at;
      placeMend(mend, index);
      if (failure) failure.textContent = plan.place.status;
      placeRing(ring, b);
      if (horizontal) {
        brk.setAttribute('x1', String(r2(b.x)));
        brk.setAttribute('x2', String(r2(b.x)));
        brk.setAttribute('y1', String(r2(b.y - breakHalf)));
        brk.setAttribute('y2', String(r2(b.y + breakHalf)));
      } else {
        brk.setAttribute('x1', String(r2(b.x - breakHalf)));
        brk.setAttribute('x2', String(r2(b.x + breakHalf)));
        brk.setAttribute('y1', String(r2(b.y)));
        brk.setAttribute('y2', String(r2(b.y)));
      }
      traces.forEach((trace, r) => tint(trace.finish, r === plan.arch));
      // The case before this one, complete, for its exit.
      if (count > 0) {
        const prior = (index + TEXT.cases.length - 1) % TEXT.cases.length;
        const priorPlan = nth(plans, prior);
        placeMend(old.mend, prior);
        placeRing(old.ring, priorPlan.at);
        old.finish.forEach((finish, r) => tint(finish, r === priorPlan.arch));
        old.mend.splice.setAttribute('d', splicePath(priorPlan.at, 1));
        old.mend.splice.setAttribute('opacity', '1');
        old.mend.patch.setAttribute('opacity', '1');
        if (old.mend.fail && old.mend.kind && old.mend.log) {
          old.mend.fail.setAttribute('opacity', '1');
          old.mend.kind.setAttribute('fill', INK.muted);
          old.mend.log.setAttribute('fill', INK.muted);
        }
      }
    };

    const render = (seconds: number) => {
      const time = Math.max(0, seconds);
      const rotations = Math.floor(time / ROTATION);
      let t = time - rotations * ROTATION;
      let index = 0;
      while (index < LENGTHS.length - 1 && t >= nth(LENGTHS, index)) {
        t -= nth(LENGTHS, index);
        index++;
      }
      const count = rotations * TEXT.cases.length + index;
      if (count !== shown) setCase(count, index);
      const plan = nth(plans, index);
      const b = plan.at;

      // The previous case leaves as this one begins, so the panel is never empty.
      set(outgoing, 'opacity', count > 0 ? leaving(t, 0) : 0);

      // Builds run linearly; the broken one waits at its break until the patch lands.
      traces.forEach((trace, r) => {
        const lane = nth(lanes, r);
        const start = nth(START, r);
        const failing = r === plan.arch;
        let p: number;
        if (!failing || t < plan.tBreak) p = phase(t, start, TRAVEL);
        else if (t < plan.tResume) p = plan.pBreak;
        else p = plan.pBreak + (1 - plan.pBreak) * phase(t, plan.tResume, (1 - plan.pBreak) * TRAVEL);
        const broken = failing && t >= plan.tBreak && t < plan.tResume;
        const arrived = t >= nth(plan.arrive, r);
        const head = along(lane, p);
        const end = broken ? along(lane, plan.pBreak - 5 / trackLength) : head;
        set(trace.line, 'x2', end.x);
        set(trace.line, 'y2', end.y);
        set(trace.line, 'opacity', t >= start ? 1 : 0);
        set(trace.head, 'cx', head.x);
        set(trace.head, 'cy', head.y);
        set(trace.head, 'opacity', broken || arrived ? 0 : arrival(t, start));
        const reached = nth(plan.arrive, r);
        set(trace.finish.fill, 'opacity', arrival(t, reached));
        const drawn = arrival(t, reached + 0.15);
        set(trace.finish.check, 'stroke-dashoffset', 14 * (1 - drawn));
        set(trace.finish.check, 'opacity', drawn > 0 ? 1 : 0);
        if (trace.finish.label) {
          const k = arrival(t, reached + 0.25);
          set(trace.finish.label, 'opacity', k);
          set(trace.finish.label, 'transform', rise(k));
        }
      });

      // The break, in the Sun's red-orange, until the patch lands.
      set(brk, 'opacity', arrival(t, plan.tBreak) * leaving(t, plan.tFixed));
      // The loop arrives around the break and sweeps once through its five steps. Closed, it stays at
      // full strength around the splice until the case leaves.
      const step = t < plan.tLoop ? -1 : Math.min(5, Math.floor((t - plan.tLoop) / STEP));
      set(ring.group, 'opacity', arrival(t, plan.tBreak + 0.1));
      const swept = phase(t, plan.tLoop, 5 * STEP);
      set(ring.arc, 'stroke-dasharray', `${r2(swept * circumference)} ${r2(circumference + 2)}`);
      ring.dots.forEach((dot, k) => {
        const lit = step >= k;
        set(dot, 'fill', lit ? INK.amber : INK.surface);
        set(dot, 'stroke', lit ? INK.amber : INK.ghost);
      });

      // The mend: an amber splice across the break, and the patch.
      const spliced = arrival(t, plan.tFixed + 0.05);
      set(mend.splice, 'd', splicePath(b, spliced));
      set(mend.splice, 'opacity', spliced > 0 ? 1 : 0);
      // The patch takes the step name's place once that has left (no two words overlap).
      const patched = arrival(t, plan.tFixed + 0.2);
      set(mend.patch, 'opacity', patched);
      set(mend.patch, 'transform', rise(patched));
      const settled = easeOut(phase(t, plan.tFixed, EXIT));
      if (mend.fail && mend.kind && mend.log) {
        const k = arrival(t, plan.tBreak + 0.1);
        set(mend.fail, 'opacity', k);
        set(mend.fail, 'transform', rise(k));
        set(mend.kind, 'fill', blend(INK.failure, INK.muted, settled));
        set(mend.log, 'fill', blend(INK.reading, INK.muted, settled));
      }
      // The step under way, above the trace. The first arrives as labels do; each later one rises into
      // place as the one before rises away, over the same TICK on the same curve, so together they never
      // dim (a crossfade, not a blink). The last leaves as the patch takes its place.
      const current = Math.min(4, step);
      const handover = easeOut(phase(t, plan.tLoop + current * STEP, TICK));
      tickers.forEach((node, i) => {
        let word = -1, opacity = 0, dy = 0;
        if (current >= 0 && current % 2 === i) {
          const k = current === 0 ? arrival(t, plan.tLoop) : handover;
          word = current;
          opacity = k * (current === 4 ? leaving(t, plan.tFixed) : 1);
          dy = (1 - k) * RISE;
        } else if (current >= 1) {
          word = current - 1;
          opacity = 1 - handover;
          dy = -handover * RISE;
        }
        if (word >= 0 && node.textContent !== nth(TEXT.steps, word)) node.textContent = nth(TEXT.steps, word);
        set(node, 'opacity', opacity);
        set(node, 'transform', `translate(0 ${r2(dy)})`);
      });
      if (failure) {
        const k = arrival(t, plan.tBreak + 0.1);
        set(failure, 'opacity', k * leaving(t, plan.tFixed));
        set(failure, 'transform', rise(k));
      }

      // The legend lights the step under way in amber (and underlines it), the steps done in the
      // reading color, and leaves the rest waiting; closed, the loop lights them all.
      const fading = count > 0 && t < EXIT ? easeOut(phase(t, 0, EXIT)) : 1;
      steps.forEach(({ node }, k) => {
        let fill: string = INK.waiting;
        if (count > 0 && t < EXIT) fill = blend(INK.reading, INK.waiting, fading);
        else if (step >= 5) fill = INK.reading;
        else if (step >= 0) fill = k === step ? INK.amber : k < step ? INK.reading : INK.waiting;
        set(node, 'fill', fill);
      });
      links.forEach((link, k) => {
        if (!link) return;
        const lit = step > k || (count > 0 && t < EXIT && fading < 0.5);
        set(link, horizontal ? 'stroke' : 'fill', lit ? INK.ghost : INK.line);
      });
      const under = step >= 0 && step < 5 ? nth(steps, step) : null;
      if (under) {
        const y = Math.round(under.y + 4) + 0.5;
        set(underline, 'x1', under.x);
        set(underline, 'x2', under.x + under.w);
        set(underline, 'y1', y);
        set(underline, 'y2', y);
      }
      set(underline, 'opacity', under ? 1 : 0);
    };

    return { render };
  },
};

export default scene;
