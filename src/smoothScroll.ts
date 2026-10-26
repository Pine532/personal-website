import Lenis from 'lenis';

// Smooth scrolling (Lenis): the wheel's steps are eased so the page glides, and in-page links,
// the navigation's and the terminal's, travel instead of jumping. It is left out for visitors who
// prefer reduced motion, and switched off if they ask for that while the page is open. The page's
// own scrolling is still the window's: position: sticky, scroll events and scroll positions all
// work as they do without it. A scroller inside the page (the terminal's screen) takes the wheel
// while it has somewhere to go, then the page does.

const REDUCED = '(prefers-reduced-motion: reduce)';
let lenis: Lenis | null = null;

/** Starts smooth scrolling where it is wanted. Returns the way to stop. */
export function startSmoothScroll() {
  const reduced = matchMedia(REDUCED);
  const start = () => {
    if (lenis || reduced.matches) return;
    lenis = new Lenis({ autoRaf: true, lerp: 0.09, allowNestedScroll: true });
  };
  const stop = () => {
    lenis?.destroy();
    lenis = null;
  };
  const onChange = () => (reduced.matches ? stop() : start());
  start();
  reduced.addEventListener('change', onChange);
  return () => {
    reduced.removeEventListener('change', onChange);
    stop();
  };
}

/** Whether scrolling is being smoothed just now. */
export const smoothScrolling = () => lenis !== null;

/** Brings `target` to the top of the window, clear of the header by its own scroll margin (which both
    the browser and Lenis honor): gliding where scrolling is smoothed, at once otherwise. */
export function scrollToElement(target: HTMLElement, { instant = false } = {}) {
  if (lenis && !instant) {
    lenis.scrollTo(target);
    return;
  }
  target.scrollIntoView({ behavior: 'instant' });
}
