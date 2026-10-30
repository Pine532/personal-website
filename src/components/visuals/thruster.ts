// The Rocket Propulsion Group's visual: a cross-section of a generic converging–diverging nozzle.
//
// The story, in seconds from the first view. While the panel waits to be seen, the section's outline
// is already there, faint, in the line tone. The pen inks it (0.1–0.8 s), uncovering the hatched wall
// behind it, and as it finishes a flow front sets off from the head of the chamber to the end of the
// plume (0.5–2.95 s), at an even pace along the axis: where the page's scrolling tells this story
// (hooks/useVisualClock.ts) each stretch of it then has something new to show, which a front that
// rode with the gas would not, creeping through the chamber for half its time and gone through the
// nozzle in an instant. Each label arrives as the front reaches the part it names: subsonic in the chamber,
// Mach 1 at the throat (the one amber idea, a sonic line), supersonic beyond it, shock diamonds in
// the plume. From then on the flow simply runs; nothing replays, and Play pressed on the
// reduced-motion still carries on from that moment (playFrom) instead of replaying the intro.
//
// The flow follows quasi-one-dimensional isentropic flow through the drawn shape: the area sets the
// Mach number, which is 1 at the throat. The drawn speeds keep that ordering but are compressed
// (exit to chamber about 7:1, against 26–27:1 for this shape) so the chamber still visibly drifts.
// The caption calls the panel an illustration and the shape generic; it does not mention the
// compression, which "Illustration" covers as an illustrative magnitude.
//
// Two layers: one opaque canvas for what moves (tracers and Mach disks), under an SVG that holds the
// walls, hatching, plume lines and labels. The SVG settles when the story ends and is not written
// again, so a frame of the running flow costs one canvas redraw.

import { COLORS, clamp01, easeOut, el, fadeIn, phase, set, text } from './draw';
import type { Layout, SceneModule, Size } from './types';

/** Every word drawn inside the art; nothing is drawn on the canvas. "Mach 1" is physics notation, not
    a project figure. When a row of labels would not fit (a reader's own wider text spacing on the
    narrowest panels), a second line gives way to its short form, then the row's second lines are left
    out: the names and their leaders still say what happens where. */
export const TEXT = {
  chamber: { name: 'Subsonic', sub: 'in the chamber' },
  throat: { name: 'Mach 1', sub: 'at the throat' },
  nozzle: { name: 'Supersonic', sub: 'beyond the throat', short: 'past the throat' },
  plume: { name: 'Shock diamonds', sub: 'in the plume' },
} as const;
type Part = keyof typeof TEXT;
type Words = { name: string; sub: string; short?: string };

/** The Sun's red-orange, for the shock pattern only (physical heat): the Mach disks and the first
    diamond cell in the brightest tone, the hairlines darkening downstream. */
const SHOCK = { near: '#f0a050', mid: '#d9733a', far: '#b4380a' } as const;

// The story's timing (seconds).
const PEN_START = 0.1; // the section is pen-plotted: a line draw, ease-out over 700 ms
const PEN_DURATION = 0.7;
const FRONT_START = 0.5; // the flow front, at an even pace along the axis
const FRONT_DURATION = 2.45;
const ARRIVE = 0.4; // a label arrives with its mark: 400 ms ease-out, rising 4 px
const RISE = 4;

// Label placement (px).
const EDGE = 6; // labels keep this far from the art's edges
const GAP = 16; // and this far from the next label in their row
const INSET = 8; // a leader meets its label at least this far inside the label's right end

/* ---------- nozzle physics: only the shape of the relations is used ---------- */

const GAMMA = 1.2;
const areaRatio = (mach: number) =>
  (1 / mach) * Math.pow((2 / (GAMMA + 1)) * (1 + ((GAMMA - 1) / 2) * mach * mach), (GAMMA + 1) / (2 * (GAMMA - 1)));

/** The Mach number at which the flow area is `ratio` times the throat's, on the subsonic or supersonic branch. */
function machFromArea(ratio: number, supersonic: boolean) {
  let low = supersonic ? 1 : 1e-4;
  let high = supersonic ? 10 : 1;
  for (let i = 0; i < 46; i++) {
    const mid = 0.5 * (low + high);
    const excess = areaRatio(mid) - ratio;
    if (supersonic ? excess > 0 : excess < 0) high = mid;
    else low = mid;
  }
  return 0.5 * (low + high);
}

/** Flow speed over the stagnation speed of sound. */
const speedOf = (mach: number) => mach / Math.sqrt(1 + ((GAMMA - 1) / 2) * mach * mach);
const smooth = (from: number, to: number, x: number) => {
  const k = clamp01((x - from) / (to - from));
  return k * k * (3 - 2 * k);
};
const clamp = (value: number, low: number, high: number) => (value < low ? low : value > high ? high : value);

/* ---------- layout ---------- */

type Geometry = {
  W: number;
  H: number;
  layout: Layout;
  /** The axis (a half pixel, so the centreline is crisp). */
  A: number;
  /** The head of the chamber, the end of the chamber, the throat and the exit (inner wall). */
  xh: number;
  xc: number;
  xt: number;
  xe: number;
  /** Chamber, throat and exit radii; wall thickness at the chamber, throat and exit; the head's corner. */
  Rc: number;
  rt: number;
  Re: number;
  tw: number;
  twT: number;
  twE: number;
  cr: number;
  /** Shock-cell length (schematic). */
  Lc: number;
  /** The plume has faded out by here, 90% of the width. */
  fadeEnd: number;
  /** The drawn exit speed (px/s), the tracers, and how long a parcel takes to draw its streak (s). */
  vExit: number;
  lanes: number;
  perLane: number;
  tau: number;
  tracerWidth: number;
  hatch: number;
  /** Label baselines (name, then the line under it) for the row above and the row below the nozzle. */
  top: readonly [number, number];
  bottom: readonly [number, number];
};

// Schematic proportions only: the project gives no dimensions.
function makeGeometry({ width: W, height: H, layout }: Size): Geometry {
  const fadeEnd = 0.9 * W;
  if (layout === 'narrow') {
    // One scale for lengths and radii, so the section keeps the 342 px proportions from 301 to 547 px
    // (radii keep a floor below that) instead of stretching; past 547 px it holds its size, so the
    // panels up to 639 px only lengthen the plume, by under one shock cell.
    const k = clamp(W / 342, 0.78, 1.6);
    const r = clamp(k, 0.88, 1.6);
    const Re = 34 * r;
    // The nozzle sits midway between the two label rows; the room left over goes under the lower one.
    return {
      W, H, layout, A: 129.5,
      xh: 14 * k, xc: 84 * k, xt: 116 * k, xe: 176 * k,
      Rc: 30 * r, rt: 11.5 * r, Re, tw: 6 * r, twT: 5 * r, twE: 3 * r, cr: 5 * r,
      Lc: 2.1 * Re, fadeEnd,
      vExit: 96 * Math.min(1, k), lanes: 8, perLane: 20, tau: 0.2, tracerWidth: 1, hatch: 4,
      top: [19, 35], bottom: [H - 40, H - 24],
    };
  }
  // Wide: one row of labels above a nozzle that fills the rest as the approved concept's did (58% of the
  // height). Medium: the labels alternate above and below, and the nozzle takes half the width.
  const wide = layout === 'wide';
  const s = wide ? Math.min(1, W / 1320) : W / 1248;
  const r = wide ? clamp(W / 1320, 0.9, 1) * 1.15 : 0.944;
  const Re = 68 * r;
  return {
    W, H, layout, A: wide ? 172.5 : 152.5,
    xh: 36 * s, xc: 300 * s, xt: 398 * s, xe: 624 * s,
    Rc: 62 * r, rt: 23 * r, Re, tw: 10 * r, twT: 8 * r, twE: 4.5 * r, cr: 8 * r,
    Lc: (wide ? 2.5 : 2.2) * Re, fadeEnd,
    vExit: 140 * Math.min(1, W / 1320), lanes: 10, perLane: wide ? 26 : 22, tau: 0.2, tracerWidth: 1.1, hatch: 5,
    top: [19, 36], bottom: [H - 32, H - 15],
  };
}

/** The jet boundary's radius `xi` past the exit: a beaded plume that narrows where the shocks cross the axis. */
function jetR(g: Geometry, xi: number) {
  const grow = 1 + (0.06 * xi) / g.Lc;
  const decay = Math.exp(-xi / (3.2 * g.Lc));
  const ramp = smooth(0, 0.3 * g.Lc, xi);
  const wave = Math.sin((Math.PI * xi) / g.Lc);
  return g.Re * grow * (1 - 0.085 * decay * ramp * wave * wave);
}

/* ---------- the wall profile, sampled every pixel ---------- */

type Profile = { rAt(x: number): number; roAt(x: number): number };

function buildProfile(g: Geometry, xEnd: number): Profile {
  const x0 = Math.floor(g.xh);
  const n = Math.ceil(xEnd) + 2 - x0;
  const r = new Float32Array(n);
  const ro = new Float32Array(n);
  // Bell-shaped diverging section: leaves the throat smoothly, opens quickly, then straightens toward the exit.
  const Ld = g.xe - g.xt;
  const p1x = g.xt + 0.12 * Ld, p2x = g.xt + 0.34 * Ld, p2r = g.Re - 0.12 * (g.Re - g.rt);
  const steps = 600;
  const bx = new Float64Array(steps + 1);
  const br = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    bx[i] = a * g.xt + b * p1x + c * p2x + d * g.xe;
    br[i] = a * g.rt + b * g.rt + c * p2r + d * g.Re;
  }
  const bell = (x: number) => {
    let low = 0, high = steps;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (bx[mid]! <= x) low = mid;
      else high = mid;
    }
    const xl = bx[low]!, xr = bx[high]!;
    const f = (x - xl) / (xr - xl || 1);
    return br[low]! + f * (br[high]! - br[low]!);
  };
  for (let i = 0; i < n; i++) {
    const x = x0 + i;
    let radius: number, wall: number;
    if (x <= g.xc) {
      radius = g.Rc;
      wall = g.tw;
    } else if (x <= g.xt) {
      const u = (x - g.xc) / (g.xt - g.xc);
      radius = g.rt + (g.Rc - g.rt) * 0.5 * (1 + Math.cos(Math.PI * u));
      wall = g.tw + (g.twT - g.tw) * u;
    } else if (x <= g.xe) {
      const u = (x - g.xt) / (g.xe - g.xt);
      radius = bell(x);
      wall = g.twT + (g.twE - g.twT) * u;
    } else {
      radius = jetR(g, x - g.xe);
      wall = 0;
    }
    r[i] = radius;
    ro[i] = radius + wall;
  }
  const sample = (values: Float32Array, x: number) => {
    const f = x - x0;
    const i = f <= 0 ? 0 : f >= n - 2 ? n - 2 : Math.floor(f);
    const k = clamp01(f - i);
    const a = values[i]!;
    return a + (values[i + 1]! - a) * k;
  };
  return { rAt: x => sample(r, x), roAt: x => sample(ro, x) };
}

/* ---------- the flow: speed along the nozzle, and where a parcel is at each age ---------- */

type Flow = {
  /** Seconds a parcel takes from the head to the end of the plume. */
  Tend: number;
  xAt(age: number): number;
  tAt(x: number): number;
};

function buildFlow(g: Geometry, profile: Profile, xEnd: number): Flow {
  const x0 = Math.floor(g.xh);
  const n = Math.ceil(xEnd) + 1 - x0;
  const v = new Float64Array(n);
  const qExit = speedOf(machFromArea((g.Re / g.rt) ** 2, true));
  for (let i = 0; i < n; i++) {
    const x = x0 + i;
    let q: number;
    if (x <= g.xe) {
      const ratio = Math.max(1.0002, (profile.rAt(x) / g.rt) ** 2);
      q = speedOf(machFromArea(ratio, x > g.xt));
    } else {
      // Behind each standing shock the jet slows a little, then expands again.
      const xi = x - g.xe;
      let dip = 0;
      for (let k = 0; k < 8; k++) {
        const centre = (k + 0.5) * g.Lc + 0.07 * g.Lc;
        dip += Math.exp(-(((xi - centre) / (0.15 * g.Lc)) ** 2)) * Math.exp(-0.35 * k);
      }
      q = qExit * (1 - 0.16 * dip);
    }
    // Drawn speed: the physical ordering, compressed (power 0.58) so the chamber still visibly drifts.
    const head = 0.42 + 0.58 * smooth(g.xh, g.xh + 0.55 * (g.xc - g.xh), x);
    v[i] = g.vExit * Math.pow(q / qExit, 0.58) * head;
  }
  const T = new Float64Array(n);
  for (let i = 1; i < n; i++) T[i] = T[i - 1]! + 2 / (v[i]! + v[i - 1]!);
  const Tend = T[n - 1]!;
  const tAt = (x: number) => {
    const f = clamp(x - x0, 0, n - 1.001);
    const i = Math.floor(f);
    return T[i]! + (T[i + 1]! - T[i]!) * (f - i);
  };
  const size = 4096;
  const inverse = new Float32Array(size);
  let j = 0;
  for (let k = 0; k < size; k++) {
    const age = (k / (size - 1)) * Tend;
    while (j < n - 2 && T[j + 1]! < age) j++;
    const f = (age - T[j]!) / (T[j + 1]! - T[j]! || 1);
    inverse[k] = x0 + j + clamp01(f);
  }
  const xAt = (age: number) => {
    if (age <= 0) return inverse[0]!;
    const f = (age / Tend) * (size - 1);
    const i = f | 0;
    if (i >= size - 1) return inverse[size - 1]!;
    const a = inverse[i]!;
    return a + (inverse[i + 1]! - a) * (f - i);
  };
  return { Tend, xAt, tAt };
}

/** One tracer: its lane across the stream, the age at which it is born in the chamber, and where it starts in its life. */
type Tracer = { lane: number; born: number; life: number; offset: number };

// Tracers are born throughout the chamber (where the gas is produced) and each rides one streamline.
function buildTracers(g: Geometry, flow: Flow) {
  let seed = 20240117;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const span = 0.86 * (g.xc - g.xh);
  const tracers: Tracer[] = [];
  for (let lane = 0; lane < g.lanes; lane++) {
    const across = -0.86 + (1.72 * lane) / (g.lanes - 1);
    for (let k = 0; k < g.perLane; k++) {
      const born = flow.tAt(g.xh + 3 + span * ((k + random()) / g.perLane));
      const life = flow.Tend - born;
      tracers.push({ lane: across + (random() - 0.5) * 0.06, born, life, offset: random() * life });
    }
  }
  return tracers;
}

/* ---------- drawing helpers ---------- */

type Point = [number, number];
const pathOf = (points: Point[]) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');

/** The polyline's length; and, at each fraction of that length, where along x its pen is and how far
    from the first point's height it has reached so far (sampled 256 times, read by interpolation). */
function measure(points: Point[]) {
  const along: number[] = [];
  let total = 0, px = 0, py = 0;
  points.forEach(([x, y], i) => {
    if (i) total += Math.hypot(x - px, y - py);
    along.push(total);
    px = x;
    py = y;
  });
  const samples = 256;
  const xs = new Float32Array(samples + 1);
  const reach = new Float32Array(samples + 1);
  const y0 = points[0]?.[1] ?? 0;
  let j = 0, furthest = 0;
  for (let k = 0; k <= samples; k++) {
    const target = (k / samples) * total;
    while (j < along.length - 2 && along[j + 1]! < target) j++;
    const a = points[j]!, b = points[j + 1] ?? a;
    const la = along[j]!, lb = along[j + 1] ?? la;
    const f = clamp01((target - la) / (lb - la || 1));
    xs[k] = a[0] + (b[0] - a[0]) * f;
    furthest = Math.max(furthest, Math.abs(a[1] + (b[1] - a[1]) * f - y0));
    reach[k] = furthest;
  }
  const read = (values: Float32Array, fraction: number) => {
    const f = clamp01(fraction) * samples;
    const i = Math.min(samples - 1, Math.floor(f));
    const a = values[i]!;
    return a + (values[i + 1]! - a) * (f - i);
  };
  return { total, xAt: (fraction: number) => read(xs, fraction), reachAt: (fraction: number) => read(reach, fraction) };
}

let builds = 0; // keeps the SVG ids of successive builds apart

/** One label's place: `want` is where its leader would best meet its part, `low`–`high` the stretch of
    the part the leader may move along, and `leader` where it ends up. */
type Slot = { part: Part; row: 'top' | 'bottom'; want: number; leader: number; low: number; high: number; width: number; x: number };

/** Places one row of labels: each starts at its leader if it can, and is nudged left or right so that
    none overlaps another or the art's edges; a leader then moves along its part to stay under its label. */
function placeRow(slots: Slot[], W: number) {
  for (const slot of slots) slot.x = slot.want;
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i]!, next = slots[i + 1];
    slot.x = Math.min(slot.x, (next ? next.x - GAP : W - EDGE) - slot.width);
  }
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!, previous = slots[i - 1];
    slot.x = Math.max(slot.x, previous ? previous.x + previous.width + GAP : EDGE);
  }
  for (const slot of slots) slot.leader = clamp(clamp(slot.want, slot.x, slot.x + slot.width - INSET), slot.low, slot.high);
}

/** Whether a placed row keeps inside the art's edges, with every leader meeting its own label. */
const rowFits = (slots: Slot[], W: number) =>
  slots.every(slot => slot.x >= EDGE - 0.01 && slot.x + slot.width <= W - EDGE + 0.01 && slot.leader >= slot.x && slot.leader <= slot.x + slot.width);

/* ---------- the scene ---------- */

/** Tracers are stroked in this many brightness steps. */
const BUCKETS = 16;
/** A tracer fades in over this long (s) where it is born in the chamber. */
const BIRTH = 0.4;

const scene: SceneModule = {
  // Steady flow, every label in place.
  still: 12,
  // The front has left the plume and the last label and Mach disk have arrived (at every width: a label
  // can arrive no later than the front's end).
  story: FRONT_START + FRONT_DURATION + ARRIVE,
  // Play on the reduced-motion still continues the steady flow from it, rather
  // than taking the finished section apart to replay the intro.
  playFrom: 12,
  build(host, size) {
    const g = makeGeometry(size);
    const { W, H, A } = g;
    const xEnd = Math.min(W - 2, g.fadeEnd + 8);
    const profile = buildProfile(g, xEnd);
    const flow = buildFlow(g, profile, xEnd);
    const tracers = buildTracers(g, flow);
    /** When the flow front reaches `x`, in seconds of the story. */
    const reachedAt = (x: number) => FRONT_START + FRONT_DURATION * clamp01((x - g.xh) / (xEnd - g.xh));
    const id = `thruster-${++builds}`;

    /* The canvas: one opaque layer for what moves. */
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.surface;
      ctx.fillRect(0, 0, W, H);
    }

    /* The SVG: everything that stands still once drawn. */
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', focusable: 'false' }, host);
    const defs = el('defs', {}, svg);
    const hatch = el('pattern', { id: `${id}-hatch`, patternUnits: 'userSpaceOnUse', width: g.hatch, height: g.hatch, patternTransform: 'rotate(45)' }, defs);
    el('line', { x1: g.hatch / 2, y1: 0, x2: g.hatch / 2, y2: g.hatch, stroke: COLORS.line, 'stroke-width': 1 }, hatch);
    const penRect = el('rect', { x: 0, y: 0, width: 0, height: H }, el('clipPath', { id: `${id}-pen` }, defs));
    const frontRect = el('rect', { x: g.xe - 1, y: 0, width: 0, height: H }, el('clipPath', { id: `${id}-front` }, defs));
    // The plume's lines fade out by 90% of the width: the end of the flow.
    const fadingStroke = (name: string, stops: [number, string, number][]) => {
      const gradient = el('linearGradient', { id: `${id}-${name}`, gradientUnits: 'userSpaceOnUse', x1: g.xe, y1: 0, x2: g.fadeEnd, y2: 0 }, defs);
      for (const [offset, color, opacity] of stops) el('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }, gradient);
      return `url(#${id}-${name})`;
    };
    // The first diamond cell, which the label points at, holds its tone at half strength (3:1 on the
    // surface); past it the hairlines darken and fade out.
    const cell = clamp(g.Lc / (g.fadeEnd - g.xe), 0.2, 0.6);
    const shockStroke = fadingStroke('shock', [[0, SHOCK.near, 0.5], [cell, SHOCK.near, 0.5], [cell + 0.3 * (1 - cell), SHOCK.mid, 0.4], [cell + 0.65 * (1 - cell), SHOCK.far, 0.26], [1, SHOCK.far, 0]]);
    const edgeStroke = fadingStroke('edge', [[0, COLORS.ghost, 1], [1, COLORS.ghost, 0]]);

    // Centreline (dash-dot, the drafting convention; a decoration, so the firm tone); it is there before the pen starts.
    const xo = g.xh - g.tw;
    el('path', { d: `M${Math.max(4, xo - 10).toFixed(1)} ${A}H${(g.xe + 0.3 * (g.fadeEnd - g.xe)).toFixed(1)}`, fill: 'none', stroke: COLORS.firm, 'stroke-width': 1, 'stroke-dasharray': '10 3 1 3' }, svg);

    // Inner and outer contours, sampled from the profile, each starting on the axis at the head.
    const step = 1.5;
    const innerTop: Point[] = [[g.xh, A], [g.xh, A - g.Rc + g.cr]];
    const innerBottom: Point[] = [[g.xh, A], [g.xh, A + g.Rc - g.cr]];
    for (let a = 1; a <= 6; a++) {
      const th = (Math.PI / 2) * (a / 6);
      const x = g.xh + g.cr - g.cr * Math.cos(th), dy = g.Rc - g.cr + g.cr * Math.sin(th);
      innerTop.push([x, A - dy]);
      innerBottom.push([x, A + dy]);
    }
    for (let x = g.xh + g.cr + step; x < g.xe; x += step) {
      const radius = profile.rAt(x);
      innerTop.push([x, A - radius]);
      innerBottom.push([x, A + radius]);
    }
    const rExit = profile.rAt(g.xe);
    innerTop.push([g.xe, A - rExit]);
    innerBottom.push([g.xe, A + rExit]);

    const Ro = g.Rc + g.tw, cro = g.cr + g.tw * 0.6;
    const outerTop: Point[] = [[xo, A], [xo, A - Ro + cro]];
    const outerBottom: Point[] = [[xo, A], [xo, A + Ro - cro]];
    for (let a = 1; a <= 8; a++) {
      const th = (Math.PI / 2) * (a / 8);
      const x = xo + cro - cro * Math.cos(th), dy = Ro - cro + cro * Math.sin(th);
      outerTop.push([x, A - dy]);
      outerBottom.push([x, A + dy]);
    }
    for (let x = xo + cro + step; x < g.xe; x += step) {
      const radius = x < g.xh ? Ro : profile.roAt(x);
      outerTop.push([x, A - radius]);
      outerBottom.push([x, A + radius]);
    }
    const roExit = profile.roAt(g.xe - 0.01);
    outerTop.push([g.xe, A - roExit], [g.xe, A - rExit]);
    outerBottom.push([g.xe, A + roExit], [g.xe, A + rExit]);

    // The section's outline in the line tone, whole from the first frame, so the panel waiting to be
    // seen already shows the nozzle and the pen inks over a drawing that is there. Once the pen has
    // finished, its lines cover this one exactly, and it is hidden.
    const outline = el('path', { d: [outerTop, outerBottom, innerTop, innerBottom].map(pathOf).join(''), fill: 'none', stroke: COLORS.line, 'stroke-width': 1, 'stroke-linejoin': 'round', 'stroke-linecap': 'butt' }, svg);

    // The hatched wall section (outer contour, back along the inner one), uncovered behind the pen.
    const wall = el('g', { 'clip-path': `url(#${id}-pen)` }, svg);
    el('path', { d: `${pathOf(outerTop.concat([...innerTop].reverse()))}Z`, fill: `url(#${id}-hatch)` }, wall);
    el('path', { d: `${pathOf(outerBottom.concat([...innerBottom].reverse()))}Z`, fill: `url(#${id}-hatch)` }, wall);

    const contours = [
      { points: outerTop, stroke: COLORS.ghost, width: 1 },
      { points: outerBottom, stroke: COLORS.ghost, width: 1 },
      { points: innerTop, stroke: COLORS.text, width: 1.5 },
      { points: innerBottom, stroke: COLORS.text, width: 1.5 },
    ].map(({ points, stroke, width }) => {
      const { total } = measure(points);
      const length = total + 1;
      const node = el('path', { d: pathOf(points), fill: 'none', stroke, 'stroke-width': width, 'stroke-linejoin': 'round', 'stroke-linecap': 'butt', 'stroke-dasharray': `${length.toFixed(1)} ${length.toFixed(1)}`, 'stroke-dashoffset': length.toFixed(1) }, svg);
      return { node, length };
    });
    const pen = measure(innerTop);

    // The plume: the jet boundary and the standing shock pattern, uncovered as the flow front passes.
    const plume = el('g', { 'clip-path': `url(#${id}-front)` }, svg);
    const edgeTop: Point[] = [], edgeBottom: Point[] = [];
    for (let x = g.xe; x <= g.fadeEnd + 2; x += 2) {
      const radius = jetR(g, x - g.xe);
      edgeTop.push([x, A - radius]);
      edgeBottom.push([x, A + radius]);
    }
    for (const points of [edgeTop, edgeBottom]) el('path', { d: pathOf(points), fill: 'none', stroke: edgeStroke, 'stroke-width': 1, 'stroke-dasharray': '3 3' }, plume);
    const zigA: Point[] = [[g.xe, A - rExit * 0.9]], zigB: Point[] = [[g.xe, A + rExit * 0.9]];
    for (let k = 0; ; k++) {
      const cross = g.xe + (k + 0.5) * g.Lc, reflect = g.xe + (k + 1) * g.Lc;
      zigA.push([cross, A]);
      zigB.push([cross, A]);
      if (reflect > g.fadeEnd + 0.5 * g.Lc) break;
      const h = jetR(g, (k + 1) * g.Lc) * 0.72, sign = k % 2 === 0 ? 1 : -1;
      zigA.push([reflect, A + sign * h]);
      zigB.push([reflect, A - sign * h]);
    }
    for (const points of [zigA, zigB]) el('path', { d: pathOf(points), fill: 'none', stroke: shockStroke, 'stroke-width': 1, 'stroke-linejoin': 'round' }, plume);

    // The sonic line across the throat: whole dashes, centred between the walls.
    const throatX = Math.round(g.xt) + 0.5;
    const sonicLength = 6 * Math.max(1, Math.floor((2 * g.rt - 4.5 + 3) / 6)) - 3;
    const sonic = el('line', { x1: throatX, y1: A - sonicLength / 2, x2: throatX, y2: A + sonicLength / 2, stroke: COLORS.amber, 'stroke-width': 1.5, 'stroke-dasharray': '3 3', opacity: 0 }, svg);

    // Labels: what the flow is doing, then where. Each sits at the end of a straight leader that drops
    // to the part it names; wide panels keep them in one row, narrower ones alternate above and below.
    const alternate = g.layout !== 'wide';
    const chamberSpan = g.xc - g.xh, nozzleSpan = g.xe - g.xt;
    const slotFor = (part: Part, row: Slot['row'], want: number, low: number, high: number): Slot => ({ part, row, want, leader: want, low, high, width: 0, x: 0 });
    const slots = [
      slotFor('chamber', 'top', g.xh + (g.layout === 'narrow' ? 0.3 : 0.36) * chamberSpan, g.xh + 0.15 * chamberSpan, g.xc - 0.15 * chamberSpan),
      slotFor('throat', alternate ? 'bottom' : 'top', throatX - 0.5, throatX - 0.5, throatX - 0.5),
      slotFor('nozzle', 'top', g.xt + (alternate ? 0.52 : 0.6) * nozzleSpan, g.xt + 0.3 * nozzleSpan, g.xe - 0.08 * nozzleSpan),
      slotFor('plume', alternate ? 'bottom' : 'top', g.xe + 0.5 * g.Lc, g.xe + 0.25 * g.Lc, g.fadeEnd - 0.3 * (g.fadeEnd - g.xe)),
    ];
    const labels = slots.map(slot => {
      const words: Words = TEXT[slot.part];
      const group = el('g', { opacity: 0 }, svg);
      const [y1, y2] = slot.row === 'top' ? g.top : g.bottom;
      const name = text(group, words.name, { y: y1, fill: COLORS.text, 'font-size': 13, 'font-weight': 450 });
      const sub = text(group, words.sub, { y: y2, fill: COLORS.muted, 'font-size': 12 });
      // The second line's forms, in order of preference: in full, short (where the part has a short
      // form), left out. Each is measured as drawn, so a reader's own text spacing is included.
      const forms = [words.sub, words.short ?? words.sub, ''];
      const widths = forms.map(form => {
        if (!form) return 0;
        sub.textContent = form;
        return sub.getComputedTextLength();
      });
      return { slot, group, name, sub, nameWidth: name.getComputedTextLength(), forms, widths, form: 0, at: 0 };
    });
    // Each row takes the first of those forms with which all its labels fit (the last one if none does).
    for (const row of ['top', 'bottom'] as const) {
      const members = labels.filter(label => label.slot.row === row);
      const placed = members.map(label => label.slot);
      for (let form = 0; form < 3; form++) {
        for (const label of members) {
          label.form = form;
          label.slot.width = Math.max(label.nameWidth, label.widths[form]!);
        }
        placeRow(placed, W);
        if (rowFits(placed, W)) break;
      }
    }
    for (const label of labels) {
      const { slot, group, name, sub } = label;
      const x = Math.round(slot.x);
      name.setAttribute('x', String(x));
      const second = label.forms[label.form]!;
      if (second) {
        sub.textContent = second;
        sub.setAttribute('x', String(x));
      } else sub.remove();
      const lx = slot.part === 'throat' ? throatX : Math.round(slot.leader) + 0.5;
      const outer = slot.part === 'plume' ? jetR(g, lx - g.xe) + 6 : profile.roAt(lx) + 5;
      const [y1, y2] = slot.row === 'top' ? g.top : g.bottom;
      // A leader starts 9 px under the label's last line (above the nozzle) or stops 15 px over its name (below).
      const [from, to] = slot.row === 'top' ? [(second ? y2 : y1) + 9, A - outer] : [A + outer, y1 - 15];
      el('line', { x1: lx, y1: from, x2: lx, y2: to, stroke: slot.part === 'throat' ? COLORS.amber : COLORS.ghost, 'stroke-width': 1 }, group);
      // The label arrives as the flow front reaches the part it names.
      label.at = reachedAt(lx);
    }
    const throatLabel = labels.find(label => label.slot.part === 'throat');

    /* ---------- the story ---------- */

    const frontX = (t: number) => {
      if (t < FRONT_START) return -Infinity;
      const p = (t - FRONT_START) / FRONT_DURATION;
      return p >= 1 ? Infinity : g.xh + p * (xEnd - g.xh);
    };
    const storyEnd = Math.max(FRONT_START + FRONT_DURATION, ...labels.map(label => label.at + ARRIVE), PEN_START + PEN_DURATION);
    let settled = false;

    function drawStory(t: number) {
      const drawn = easeOut(phase(t, PEN_START, PEN_DURATION));
      set(outline, 'visibility', drawn >= 1 ? 'hidden' : 'visible');
      for (const contour of contours) set(contour.node, 'stroke-dashoffset', contour.length * (1 - drawn));
      // The hatching is uncovered exactly where the inner contour's pen has reached: outward from the
      // axis up the head, then downstream.
      const reach = drawn >= 1 ? H : pen.reachAt(drawn) + g.tw + 2;
      set(penRect, 'width', drawn >= 1 ? W : drawn <= 0 ? 0 : pen.xAt(drawn) + 2);
      set(penRect, 'y', A - reach);
      set(penRect, 'height', 2 * reach);
      const front = frontX(t);
      set(frontRect, 'width', front === -Infinity ? 0 : clamp(front - g.xe + 1, 0, W - g.xe + 1));
      for (const label of labels) {
        const k = fadeIn(label.group, t, label.at, ARRIVE, RISE);
        if (label === throatLabel) set(sonic, 'opacity', k);
      }
    }

    /* ---------- the flow, redrawn every frame on the canvas ---------- */

    // How bright a tracer is at each x: dim in the chamber (0.4 of --text there, about 3.5:1 on the
    // surface), bright through the throat, fading out in the plume.
    const x0 = Math.floor(g.xh);
    const columns = Math.ceil(xEnd) + 2 - x0;
    const brightness = new Float32Array(columns);
    const spread = new Float32Array(columns);
    const fadeStart = g.xe + 0.06 * (g.fadeEnd - g.xe);
    for (let i = 0; i < columns; i++) {
      const x = x0 + i;
      let a = 0.4 + 0.46 * smooth(g.xc - 0.1 * chamberSpan, g.xt + 0.3 * nozzleSpan, x);
      a *= 1 - 0.35 * smooth(g.xe, fadeStart, x);
      a *= 1 - smooth(fadeStart, g.fadeEnd, x);
      brightness[i] = a;
      spread[i] = profile.rAt(x) * (x <= g.xe ? 0.93 : 0.95);
    }
    const column = (values: Float32Array, x: number) => {
      const f = x - x0;
      const i = f <= 0 ? 0 : f >= columns - 2 ? columns - 2 : Math.floor(f);
      const a = values[i]!;
      return a + (values[i + 1]! - a) * (f - i);
    };

    // Streaks are batched by brightness, so a frame strokes a few paths, not hundreds.
    const bucketData = Array.from({ length: BUCKETS }, () => new Float32Array(tracers.length * 8));
    const bucketCount = new Int32Array(BUCKETS);
    const bucketStyle = Array.from({ length: BUCKETS }, (_, b) => `rgba(244, 242, 235, ${(b / (BUCKETS - 1)).toFixed(3)})`);
    const push = (alpha: number, xa: number, ya: number, xb: number, yb: number) => {
      const b = Math.min(BUCKETS - 1, Math.round(alpha * (BUCKETS - 1)));
      if (b < 1) return;
      const data = bucketData[b]!, o = bucketCount[b]! * 4;
      data[o] = xa;
      data[o + 1] = ya;
      data[o + 2] = xb;
      data[o + 3] = yb;
      bucketCount[b] = bucketCount[b]! + 1;
    };

    // Mach disks: where the shocks cross the axis, short and crisp, weakening downstream. Each arrives
    // (400 ms ease-out) as the flow front reaches it.
    const disks: { x: number; half: number; strength: number; at: number }[] = [];
    for (let k = 0; ; k++) {
      const x = g.xe + (k + 0.5) * g.Lc;
      if (x > g.fadeEnd) break;
      const plumeFade = 1 - smooth(g.xe + 0.5 * (g.fadeEnd - g.xe), g.fadeEnd, x);
      const at = reachedAt(x);
      disks.push({ x, half: 0.2 * jetR(g, x - g.xe) * Math.exp(-0.18 * k), strength: 0.55 * Math.exp(-0.42 * k) * plumeFade, at });
    }

    // Only the band the flow can reach is cleared each frame.
    const band = Math.max(g.Rc, jetR(g, g.fadeEnd - g.xe)) + 3;
    const clearX = Math.max(0, Math.floor(xo)), clearW = Math.min(W, Math.ceil(g.fadeEnd + 4)) - clearX;

    function drawFlow(t: number) {
      if (!ctx) return;
      ctx.fillStyle = COLORS.surface;
      ctx.fillRect(clearX, A - band, clearW, 2 * band);
      const front = frontX(t);
      if (front === -Infinity) return;
      bucketCount.fill(0);
      for (const p of tracers) {
        const age = p.born + ((t + p.offset) % p.life);
        const xHead = flow.xAt(age);
        let a = column(brightness, xHead) * smooth(p.born, p.born + BIRTH, age);
        if (front !== Infinity) a *= clamp01((front - xHead) / 36);
        if (a < 0.05) continue;
        // Each streak is the path its parcel covers in tau seconds, so its length shows its speed;
        // the head is brighter than the tail, so a still frame shows the direction too.
        let xTail = flow.xAt(Math.max(p.born, age - g.tau));
        if (xHead - xTail < 0.9) xTail = xHead - 0.9;
        const xMid = xTail + 0.45 * (xHead - xTail);
        const yMid = A + p.lane * column(spread, xMid);
        push(a * 0.38, xTail, A + p.lane * column(spread, xTail), xMid, yMid);
        push(a, xMid, yMid, xHead, A + p.lane * column(spread, xHead));
      }
      ctx.lineCap = 'round';
      ctx.lineWidth = g.tracerWidth;
      for (let b = 1; b < BUCKETS; b++) {
        const count = bucketCount[b]!;
        if (!count) continue;
        const data = bucketData[b]!;
        ctx.strokeStyle = bucketStyle[b]!;
        ctx.beginPath();
        for (let i = 0; i < count * 4; i += 4) {
          ctx.moveTo(data[i]!, data[i + 1]!);
          ctx.lineTo(data[i + 2]!, data[i + 3]!);
        }
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = SHOCK.near;
      disks.forEach((disk, k) => {
        const on = easeOut(phase(t, disk.at, ARRIVE));
        // A slight shimmer (within 7%), the only motion in the plume's standing pattern.
        const shimmer = 1 + 0.05 * Math.sin(t * 2.6 + k * 1.9) + 0.02 * Math.sin(t * 7.3 + k * 4.1);
        const alpha = Math.min(0.6, disk.strength * on * shimmer);
        if (alpha < 0.02) return;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(disk.x, A - disk.half);
        ctx.lineTo(disk.x, A + disk.half);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    return {
      render(seconds) {
        // The SVG parts follow the story until it ends, then are left alone.
        const done = seconds >= storyEnd;
        if (!(done && settled)) {
          drawStory(seconds);
          settled = done;
        }
        drawFlow(seconds);
      },
    };
  },
};

export default scene;
