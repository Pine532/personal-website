// Small drawing tools shared by the project visuals (components/visuals/*.ts).

const NS = 'http://www.w3.org/2000/svg';

/** The site's colors (styles/base.css), and the dimmer line tones the visuals use. */
export const COLORS = {
  text: '#f4f2eb',
  reading: '#c8c5ba',
  muted: '#aaa89f',
  amber: '#f2cf63',
  line: '#35372f',
  surface: '#10110e',
  /** Structure that must read: a firmer line than --line. */
  firm: '#4b4d44',
  /** Inactive marks and ghosts. */
  ghost: '#6e6c64',
} as const;

type Attributes = Record<string, string | number>;

/** A new SVG element with these attributes, appended to `parent` when one is given. */
export function el<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Attributes = {}, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const name in attributes) node.setAttribute(name, String(attributes[name]));
  parent?.appendChild(node);
  return node;
}

/** A <text> element holding `content`. */
export function text(parent: Element, content: string, attributes: Attributes = {}) {
  const node = el('text', attributes, parent);
  node.textContent = content;
  return node;
}

const written = new WeakMap<Element, Map<string, string>>();

/** Sets an attribute only when its value changes, so parts at rest cost nothing per frame.
    Numbers are rounded to hundredths, which is finer than a device pixel. */
export function set(node: Element, name: string, value: string | number) {
  let cache = written.get(node);
  if (!cache) written.set(node, (cache = new Map()));
  const next = typeof value === 'number' ? String(Math.round(value * 100) / 100) : value;
  if (cache.get(name) !== next) {
    cache.set(name, next);
    node.setAttribute(name, next);
  }
}

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
/** How far through [start, start + duration] the moment `t` is, from 0 to 1. */
export const phase = (t: number, start: number, duration: number) => clamp01((t - start) / duration);
export const mix = (from: number, to: number, k: number) => from + (to - from) * k;

/** A CSS cubic-bezier timing function, solved for y at a given x. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const ax = 1 + 3 * x1 - 3 * x2, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 + 3 * y1 - 3 * y2, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const curveX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const curveY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const error = curveX(s) - x;
      if (Math.abs(error) < 1e-5) return curveY(s);
      const slope = slopeX(s);
      if (Math.abs(slope) < 1e-6) break;
      s -= error / slope;
    }
    let low = 0, high = 1;
    s = x;
    for (let i = 0; i < 24; i++) {
      const value = curveX(s);
      if (Math.abs(value - x) < 1e-5) break;
      if (value < x) low = s; else high = s;
      s = (low + high) / 2;
    }
    return curveY(s);
  };
}

/** The site's --ease-out, and a strong ease-in-out for movement on screen. */
export const easeOut = cubicBezier(0.23, 1, 0.32, 1);
export const easeInOut = cubicBezier(0.77, 0, 0.175, 1);

/** Fades `node` in over [start, start + duration], rising `rise` px as it does. Returns the eased progress. */
export function fadeIn(node: Element, t: number, start: number, duration: number, rise = 0) {
  const k = easeOut(phase(t, start, duration));
  set(node, 'opacity', k);
  if (rise) set(node, 'transform', `translate(0 ${(1 - k) * rise})`);
  return k;
}
