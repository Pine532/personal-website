import { useLayoutEffect, type RefObject } from 'react';
import { SUN_FRAMING, sunVariant } from '../media';
import { followScroll } from '../scroll';
import { publishMainSun, setSunLands, type MainSun } from '../sunPlace';

// Squeezed small, the footage only glitters: a browser draws a small video from a scattering of
// its pixels, and a small picture from all of them. What counts is the pixels of the screen it is
// drawn on, not the page's: the same disc 200px across is drawn from every other pixel of the
// footage on a dense screen and from one in five on a plain one, where it is harsh and speckled.
// So a disc narrower than this many pixels of the screen gives way to the still beneath the
// footage, a little at a time on its way to a corner where it will be smaller, and a Sun that
// stands in such a corner is its still. Nor is a disc under FOOTAGE_DISC wide given footage on any
// screen: the corner of a phone or a tablet shows the still, however dense its pixels.
const FOOTAGE_PIXELS = 256;
const FOOTAGE_DISC = 128;
// Where the Sun does not travel, it leaves with the hero and then stands in the corner. It does not
// pop in there: the Sun and its light come in over this much scrolling.
const CORNER_RISE = 240;
// How far a Sun's fringe reaches, in radii of its disc.
const FRINGE = SUN_FRAMING.fringe / SUN_FRAMING.disc;
// On its way down to close the page the Sun takes at least this many pixels of scrolling for each
// pixel it comes down the window, and while it is wider than its lane its fringe keeps this far
// below the last of the words above the closing box.
const DESCENT_PACE = 1.5;
const WORDS_GAP = 8;

/** Shrinking and drifting share this curve: quick at first, so the Sun is small by the time it
    nears the header, and at rest as it lands. */
const easeOut = (progress: number) => 1 - (1 - progress) ** 2;
/** Coming down, the Sun leaves the corner gently and lands gently. */
const smooth = (progress: number) => progress * progress * (3 - 2 * progress);
const mix = (from: number, to: number, share: number) => from + (to - from) * share;
const within = (value: number) => Math.max(0, Math.min(1, value));

/** A disc in the window: its center and its radius. */
type Disc = { x: number; y: number; r: number };

/** The Sun's way down to the closing box. */
type Descent = {
  /** The scroll position at the page's end, where the Sun arrives. */
  end: number;
  /** How far before the end the Sun leaves the corner, and how far before it the Sun may begin to
      grow: from there on a Sun the size of the corner's is wholly below the last of the words. */
  length: number;
  growth: number;
  /** The closing box's disc as it stands in the window once the page has ended. */
  box: Disc;
  /** Where the words above the closing box end, in the window then: the foot of the About
      section's text. From that line down to the box the page beneath the Sun is empty (About's
      bottom padding, then the Contact section's top). */
  wordsEnd: number;
};

/** Where the Sun has no way down, the stretch of scrolling in which the closing box comes up into
    the window: where it begins, and how long it is. */
type Handover = { from: number; length: number };

type Geometry = {
  /** The center of the Sun's square at rest: across the window, and down the page. */
  x: number;
  pageY: number;
  /** Half the width of that square. */
  half: number;
  /** How far down the window the fixed header reaches; 0 where it scrolls away with the page. */
  header: number;
  /** The corner the Sun docks in, where there is one: its disc there. Its height is where the
      browser stops the square (--sun-stick), so it is the corner's own to the sixty-fourth of a
      pixel a browser lays things out by. */
  corner: Disc | null;
  /** The Sun's way down from the corner at the end of the page, where it has one. */
  descent: Descent | null;
  /** Where it has a corner but no way down: the stretch over which it gives way to the closing
      box's own Sun. */
  handover: Handover | null;
  /** How wide a disc has to be to show all of its footage, on this screen. */
  footage: number;
  /** The bottom of the hero's name, down the page. */
  nameEnd: number;
  /** The window's height. */
  windowHeight: number;
};

/** Where the Sun is on its way down, with `left` pixels of the page still to scroll. It comes down
    its lane at the size it had in the corner, and grows toward the box only once it is below the
    last of About's words: from there on nothing but empty page and the box is beneath it. */
function descend({ length, growth, box, wordsEnd }: Descent, corner: Disc, left: number): Disc {
  // A page cannot always be scrolled to a fraction of a pixel, so the last half pixel of the way
  // counts as arrived: the Sun is on the box, wherever the page has stopped.
  if (left <= 0.5) return { x: box.x, y: box.y + left, r: box.r };
  const y = mix(corner.y, box.y, smooth(1 - left / length));
  const grown = left < growth ? smooth(1 - left / growth) : 0;
  // The largest disc whose fringe clears the last of the words from here.
  const clearing = (y - (wordsEnd + left) - WORDS_GAP) / FRINGE;
  const eased = mix(corner.r, box.r, grown);
  const r = eased > corner.r ? Math.min(eased, Math.max(corner.r, clearing)) : eased;
  // It grows leftward: its center leaves the lane exactly as fast as it widens.
  const share = box.r === corner.r ? grown : (r - corner.r) / (box.r - corner.r);
  return { x: mix(corner.x, box.x, share), y, r };
}

/**
 * Moves the Sun. It is one Sun for the whole page, the hero's own: the square that holds its still
 * and its footage is never copied and never moved in the document.
 *
 * At the top it rests in the hero and rides the page, so the browser moves it and this hook does
 * not. As the page scrolls down it shrinks and drifts until its disc sits exactly in the window's
 * upper-right corner (where styles/base.css says: --corner-disc across, --corner-top down, its right
 * edge on the page's inset). There the browser stops it: the square is sticky (styles/hero.css),
 * and --sun-stick, written here whenever the layout changes, is how far down the window its top
 * comes to rest. So the Sun stops in its corner in the very frame the page reaches it, however
 * fast the page is thrown, and nothing is written again while the page scrolls beneath it.
 * Scrolling back up reverses it.
 *
 * Over the last stretch of the page it leaves the corner, comes down and grows into the closing box
 * beside "Get in touch." (.closing-sun), arriving exactly as the page ends; scrolling back takes it
 * up again. That needs a clear way down: the lane the reading sections keep under the corner on a
 * wide window (styles/base.css). Without one it would cross their words, so it stays in the corner
 * and the closing box shows a Sun of its own (components/ClosingSun.tsx). The page still ends on one
 * Sun: as that box comes up into the window the corner's Sun gives way to it, fading out over the
 * scrolling that brings the box into view, and it comes back as the box goes down again.
 *
 * Only a transform is written on .solar-position, once per frame of a journey, from geometry
 * measured ahead of time; nothing is measured while scrolling. It is worked out from where the
 * browser has the square: riding the page until its center comes level with the corner's, held
 * there from then on. (Where the Sun does not travel it is not sticky: it stands in the corner
 * fixed in the window, where the resting one is at the top of the page.) The size is always the
 * disc's on screen, whatever "Look closer" has done to the picture inside. On the way to a corner
 * too small for it the footage fades into its still (--footage on the video, which styles/hero.css
 * turns into its opacity).
 *
 * `root` is the .site element, and it carries what this hook decides, for the stylesheet and the
 * browser checks:
 *   data-sun-dock     "on" while the Sun travels to the corner. "off" where it does not: the visitor
 *                     prefers reduced motion, the header is not fixed (short windows), or the
 *                     browser cannot report size changes. The Sun then scrolls away beneath the
 *                     header, and where there is a corner it comes in there, still, once the hero's
 *                     name and Sun have both left.
 *   data-sun-descent  "on" where the Sun comes down to the closing box at the end of the page.
 *   data-sun          Where the Sun is: "hero" (at rest or on its way up), "corner", "closing" (on
 *                     its way down, and in the box), or "none" when it is not on screen. It changes
 *                     in the frame the transform does, so there is never a frame with two Suns.
 *   data-corner       "free" once the Sun has left its corner for the page's end: on its way down,
 *                     from where the whole of it is below the header; or having given way to the
 *                     closing box's own. Otherwise "sun": the corner is the Sun's, there or not yet.
 *                     The link home's name then takes the corner (styles/hero.css).
 *   data-hero-name    "gone" once the hero's name has scrolled under the header, otherwise "shown".
 * The same frame also says where the Sun is and how much of its light reaches the page
 * (sunPlace.ts): all of it, except where the Sun does not travel. There the hero's Sun gives as
 * much as the share of its disc still showing below the header, and the corner's comes in
 * gradually, so the light never jumps. A corner's Sun that gives way to the closing box's own
 * takes its light with it, by the same share.
 */
export function useSunDock(root: RefObject<HTMLElement | null>, reduced: boolean) {
  useLayoutEffect(() => {
    const site = root.current;
    const section = site?.querySelector<HTMLElement>('.opening');
    const scene = section?.querySelector<HTMLElement>('.solar-scene');
    const square = scene?.querySelector<HTMLElement>('.solar-position');
    const plane = square?.querySelector<HTMLElement>('.solar-plane');
    if (!site || !section || !scene || !square || !plane) return;
    const video = plane.querySelector<HTMLElement>('.solar-video');
    const name = section.querySelector<HTMLElement>('.name-lockup');
    const header = site.querySelector<HTMLElement>('.site-header');
    // The corner's disc is laid out in the header, as the part of the link home the Sun covers.
    const spot = header?.querySelector<HTMLElement>('.wordmark-sun') ?? null;
    const about = site.querySelector<HTMLElement>('.about-section');
    const contact = site.querySelector<HTMLElement>('.contact-section');
    const closing = contact?.querySelector<HTMLElement>('.closing-sun') ?? null;

    let frame = 0;
    let disposed = false;
    let docking = false;
    let geometry: Geometry = { x: 0, pageY: 0, half: 0, header: 0, corner: null, descent: null, handover: null, footage: FOOTAGE_DISC, nameEnd: 0, windowHeight: 0 };
    // The scroll position: as scroll.ts reports it while the page scrolls, and read afresh by
    // measure().
    let scroll = 0;
    // How large "Look closer" shows the picture inside its square just now, and how many of its
    // transitions are under way.
    let zoom = 1;
    let zooming = 0;
    // What is written now: the transform and the opacity on .solar-position, and how much of the
    // footage shows.
    let written = '';
    let faded = '';
    let footage = '';

    const readZoom = () => {
      // The computed transform reads "matrix(a, ...)", and a is the picture's scale.
      const scale = parseFloat(getComputedStyle(plane).transform.replace(/^matrix(3d)?\(/, ''));
      zoom = scale > 0 ? scale : 1;
    };

    const setState = (key: 'sun' | 'corner' | 'heroName', value: string) => {
      if (site.dataset[key] !== value) site.dataset[key] = value;
    };

    const paint = () => {
      frame = 0;
      if (disposed) return;
      if (zooming > 0) {
        readZoom();
        schedule();
      }
      const { corner, descent, handover } = geometry;
      // Riding the page, this is where the Sun's center is now. `rest` is the radius of its frame's
      // circle, and `restDisc` of its disc, before any journey.
      const y = geometry.pageY - scroll;
      const rest = geometry.half * zoom;
      const restDisc = rest * SUN_FRAMING.disc;
      let disc: Disc | null = null;
      let sun: MainSun['sun'] = 'hero';
      let light = 1;
      // How much of a Sun standing in the corner is left, where it gives way to the closing box's
      // own: all of it until the box shows at the foot of the window, none once the box is in view.
      const staying = handover ? 1 - within((scroll - handover.from) / handover.length) : 1;

      if (docking && corner) {
        // It has arrived when the browser stops it: from where its center has ridden up to the
        // corner's height, and not a fraction of a pixel sooner, or the Sun would be said to stand
        // in a corner it is still riding up to.
        const travel = geometry.pageY - corner.y;
        const progress = scroll >= travel ? 1 : Math.max(0, scroll / travel);
        const left = descent ? Math.max(0, descent.end - scroll) : Infinity;
        if (progress < 1) {
          const eased = easeOut(progress);
          disc = { x: mix(geometry.x, corner.x, eased), y, r: mix(restDisc, corner.r, eased) };
        } else if (descent && left < descent.length) {
          sun = 'closing';
          disc = descend(descent, corner, left);
        } else if (staying > 0) {
          sun = 'corner';
          light = staying;
          disc = corner;
        }
      } else if (rest > 0 && y + rest > geometry.header && y - rest < geometry.windowHeight) {
        // As much light as there is disc below the header's edge (the window's, where the header
        // scrolls away).
        light = within((y + restDisc - geometry.header) / (restDisc * 2));
        disc = { x: geometry.x, y, r: restDisc };
      } else if (corner) {
        // It comes into the corner once the hero's name and Sun have both scrolled away beneath
        // the header.
        const since = scroll - (Math.max(geometry.nameEnd, geometry.pageY + rest) - geometry.header);
        if (since >= 0 && staying > 0) {
          sun = 'corner';
          light = Math.min(1, since / CORNER_RISE) * staying;
          disc = corner;
        }
      }

      let transform = '';
      let share = '';
      if (disc && restDisc > 0) {
        // Where the browser has the square's center just now. Travelling, it rides the page down
        // to the corner's height and is held there; standing in the corner without having
        // travelled, it is fixed where the resting one is at the top of the page.
        const held = docking && corner ? Math.max(corner.y, y) : sun === 'hero' ? y : geometry.pageY;
        const down = disc.y - held;
        if (disc.x !== geometry.x || down !== 0 || disc.r !== restDisc) {
          transform = `translate(${(disc.x - geometry.x).toFixed(2)}px, ${down.toFixed(2)}px) scale(${(disc.r / restDisc).toFixed(5)})`;
        }
        // All of the footage at rest, however small the Sun is there, and none of it for a disc
        // as small as a corner the footage would only glitter in.
        const full = Math.min(geometry.footage, restDisc * 2);
        const none = Math.min(corner ? corner.r * 2 : 0, full);
        const shown = disc.r * 2 >= full ? 1 : full > none ? within((disc.r * 2 - none) / (full - none)) : 0;
        if (shown < 1) share = shown.toFixed(3);
      }
      const fade = disc && sun === 'corner' && light < 1 ? light.toFixed(3) : '';

      // Where the Sun is, first: where it does not travel the stylesheet takes the square out of
      // the page or puts it back by this, and the transform below is for the square as it then
      // stands.
      setState('sun', disc ? sun : 'none');
      if (transform !== written) {
        if (transform) square.style.transform = transform;
        else square.style.removeProperty('transform');
        written = transform;
      }
      if (fade !== faded) {
        if (fade) square.style.opacity = fade;
        else square.style.removeProperty('opacity');
        faded = fade;
      }
      if (share !== footage) {
        if (share) video?.style.setProperty('--footage', share);
        else video?.style.removeProperty('--footage');
        footage = share;
      }
      // The corner is free once the Sun has gone on from it: down, clear of the header, fringe and
      // all; or out, where the closing box's own Sun has taken over.
      const left = disc ? sun === 'closing' && disc.y - disc.r * FRINGE >= geometry.header : !!handover && staying === 0;
      setState('corner', corner && left ? 'free' : 'sun');
      setState('heroName', geometry.nameEnd - scroll <= geometry.header ? 'gone' : 'shown');
      publishMainSun(disc ? { sun, ...disc, light, footage: share !== '0.000' } : null);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    /** The Sun's way down from `corner`, if the page has one for it. Everything is read from the
        page as it stands at `scroll`, and worked out for where it will stand at its end. */
    const wayDown = (corner: Disc, travel: number, windowHeight: number): Descent | null => {
      if (!about || !contact || !closing) return null;
      const end = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const target = closing.getBoundingClientRect();
      if (target.width <= 0) return null;
      const box = { x: target.left + target.width / 2, y: target.top + target.height / 2 + scroll - end, r: (target.width / 2) * SUN_FRAMING.disc };
      const contactTop = contact.getBoundingClientRect().top + scroll - end;
      const reading = about.getBoundingClientRect();
      const padding = getComputedStyle(about);
      // The lane: what the reading sections leave free at their right-hand side. It has to hold
      // the whole Sun, fringe and all, or the Sun would come down across their words.
      const lane = reading.right - (parseFloat(padding.paddingRight) || 0);
      if (corner.x - corner.r * FRINGE < lane) return null;
      // The last of the words above the box: About's text ends where its bottom padding begins.
      const wordsEnd = Math.min(contactTop, reading.bottom - (parseFloat(padding.paddingBottom) || 0) + scroll - end);
      // It sets off as the Contact section first shows at the foot of the window, or sooner where
      // that would hurry it; never before it has docked.
      const fall = box.y - corner.y;
      const length = Math.min(Math.max(windowHeight - contactTop, fall * DESCENT_PACE), end - travel);
      if (fall <= 0 || length <= 0) return null;
      // How far a Sun of the corner's size clears the last of the words with `left` pixels still to
      // scroll. The nearer the end, the further: so the place where it first clears is found by
      // halving.
      const clear = (left: number) => mix(corner.y, box.y, smooth(1 - left / length)) - corner.r * FRINGE - WORDS_GAP - (wordsEnd + left);
      if (clear(0) < 0) return null;
      let growth = length;
      if (clear(length) < 0) {
        let far = length;
        growth = 0;
        for (let step = 0; step < 24; step++) {
          const middle = (growth + far) / 2;
          if (clear(middle) >= 0) growth = middle;
          else far = middle;
        }
      }
      return { end, length, growth, box, wordsEnd };
    };

    /** Where a Sun that stays in the corner gives way to the closing box's own: from the scroll
        position at which the box first shows at the foot of the window to the one at which all of
        it is in view (or the page ends). */
    const wayOut = (windowHeight: number): Handover | null => {
      const target = closing?.getBoundingClientRect();
      if (!target || target.height <= 0) return null;
      const end = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const from = target.top + scroll - windowHeight;
      return { from, length: Math.max(1, Math.min(target.bottom + scroll - windowHeight, end) - from) };
    };

    const measure = () => {
      if (disposed) return;
      // Never display the footage larger than the pixels delivered: cap the square at
      // source width / device pixel ratio. CSS reads this as --sun-pixel-limit.
      section.style.setProperty('--sun-pixel-limit', `${sunVariant().pixels / Math.max(1, window.devicePixelRatio)}px`);
      // The square is measured where the stylesheet puts it at rest: without the transform painted
      // below, and without the stop that holds it in the corner.
      square.style.removeProperty('transform');
      square.style.removeProperty('--sun-stick');
      written = '';
      scroll = window.scrollY;
      const box = square.getBoundingClientRect();
      // Fixed in the window, it stands where it does at the top of the page.
      const riding = getComputedStyle(square).position !== 'fixed';
      const fixed = !!header && getComputedStyle(header).position === 'fixed';
      const place = fixed && spot ? spot.getBoundingClientRect() : null;
      readZoom();
      // The square's top stops where its center is the corner's. A browser lays things out in
      // sixty-fourths of a pixel: the stop is one of those, the next one down, so that the Sun is
      // never held a hair before it is said to have arrived, and the corner is where it is held.
      const stick = place ? Math.ceil((place.top + place.height / 2 - box.height / 2) * 64) / 64 : 0;
      const corner = place && place.width > 0 ? { x: place.left + place.width / 2, y: stick + box.height / 2, r: place.width / 2 } : null;
      const pageY = box.top + box.height / 2 + (riding ? scroll : 0);
      const windowHeight = window.innerHeight;
      // Travelling needs a corner to land in, a Sun larger than the one that stands there, resting
      // below it, and a browser that reports the size changes this geometry depends on.
      docking = !reduced && typeof ResizeObserver !== 'undefined' && !!corner
        && (box.width / 2) * zoom * SUN_FRAMING.disc > corner.r && pageY > corner.y;
      const descent = docking && corner ? wayDown(corner, pageY - corner.y, windowHeight) : null;
      geometry = {
        x: box.left + box.width / 2,
        pageY,
        half: box.width / 2,
        header: fixed && header ? header.getBoundingClientRect().bottom : 0,
        corner,
        descent,
        handover: corner && !descent ? wayOut(windowHeight) : null,
        footage: Math.max(FOOTAGE_DISC, FOOTAGE_PIXELS / Math.max(1, window.devicePixelRatio)),
        nameEnd: name ? name.getBoundingClientRect().bottom + scroll : 0,
        windowHeight,
      };
      site.dataset.sunDock = docking ? 'on' : 'off';
      if (docking) square.style.setProperty('--sun-stick', `${stick}px`);
      site.dataset.sunDescent = geometry.descent ? 'on' : 'off';
      setSunLands(!!geometry.descent);
      paint();
    };

    // measure() sets a custom property that can resize the square, so size changes are handled on
    // the next frame rather than inside the observer's own callback (which browsers report as a
    // ResizeObserver loop).
    let measureFrame = 0;
    const measureSoon = () => {
      if (!measureFrame) measureFrame = requestAnimationFrame(() => { measureFrame = 0; measure(); });
    };

    // "Look closer" changes the picture's size inside the square: at once from the keyboard, over a
    // transition otherwise. Its size is followed frame by frame while it changes.
    const onZoomChange = () => {
      readZoom();
      schedule();
    };
    const onZoomTransition = (event: TransitionEvent) => {
      if (event.target !== plane || event.propertyName !== 'transform') return;
      zooming = Math.max(0, zooming + (event.type === 'transitionrun' ? 1 : -1));
      onZoomChange();
    };

    // The pixel limit, and the size the footage needs, follow the device pixel ratio (a window
    // moved to another screen), which changes without a resize: matchMedia fires once per change.
    let resolution: MediaQueryList | null = null;
    const watchResolution = () => {
      resolution?.removeEventListener('change', resolutionChanged);
      resolution = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      resolution.addEventListener('change', resolutionChanged);
    };
    function resolutionChanged() {
      watchResolution();
      measure();
    }

    measure();
    watchResolution();
    // Whatever makes the page longer or shorter (an opened case note, text that wraps differently)
    // moves its end, and the closing box with it: that changes the height of the page's body.
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureSoon);
    for (const element of [section, square, name, header, spot, closing, document.body]) if (element) sizes?.observe(element);
    const zoomed = new MutationObserver(onZoomChange);
    zoomed.observe(scene, { attributes: true, attributeFilter: ['class'] });
    plane.addEventListener('transitionrun', onZoomTransition);
    plane.addEventListener('transitionend', onZoomTransition);
    plane.addEventListener('transitioncancel', onZoomTransition);
    const stopFollowing = followScroll(next => {
      scroll = next;
      paint();
    });
    window.addEventListener('resize', measure);
    // The browser may restore a scroll position after layout effects have run.
    window.addEventListener('pageshow', measure);
    document.fonts?.addEventListener('loadingdone', measure);
    document.fonts?.ready.then(measure);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame);
      sizes?.disconnect();
      zoomed.disconnect();
      plane.removeEventListener('transitionrun', onZoomTransition);
      plane.removeEventListener('transitionend', onZoomTransition);
      plane.removeEventListener('transitioncancel', onZoomTransition);
      stopFollowing();
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
      resolution?.removeEventListener('change', resolutionChanged);
      square.style.removeProperty('transform');
      square.style.removeProperty('--sun-stick');
      square.style.removeProperty('opacity');
      video?.style.removeProperty('--footage');
      section.style.removeProperty('--sun-pixel-limit');
      site.dataset.sunDock = 'off';
      site.dataset.sunDescent = 'off';
      site.dataset.sun = 'hero';
      site.dataset.corner = 'sun';
      site.dataset.heroName = 'shown';
      setSunLands(false);
      publishMainSun(null);
    };
  }, [root, reduced]);
}
