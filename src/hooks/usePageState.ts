import { useEffect, type RefObject } from 'react';
import { followScroll } from '../scroll';

// How far the page scrolls before the header draws in (styles/header.css).
const SCROLLED_AT = 48;

/**
 * Two things the fixed elements need to know about the page under them, written on `.site` as
 * data attributes: whether the page has scrolled (data-scrolled: the header and the Sun's caption
 * then stand in dark pills, so what scrolls beneath them never shows through), and whether the Sun
 * in the corner stands over the light About section (data-ground="paper": its sky is drawn tighter
 * there, styles/sun.css), or would reach it with its fringe. Where About is, and where the Sun's disc is, are measured ahead of time,
 * whenever the layout can have changed; while the page scrolls nothing is measured.
 */
export function usePageState(site: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = site.current;
    if (!element) return;
    let scroll = window.scrollY;
    let aboutTop = Infinity;
    let aboutBottom = -Infinity;
    // The Sun's reach down the window, fringe included.
    let sunTop = 0;
    let sunBottom = 0;

    const update = () => {
      element.dataset.scrolled = String(scroll > SCROLLED_AT);
      // Paper from the moment any of the Sun's fringe would lie over the light section.
      element.dataset.ground = aboutTop < scroll + sunBottom && aboutBottom > scroll + sunTop ? 'paper' : 'field';
    };
    const measure = () => {
      scroll = window.scrollY;
      const about = document.getElementById('about');
      if (about) {
        const box = about.getBoundingClientRect();
        aboutTop = box.top + scroll;
        aboutBottom = box.bottom + scroll;
      }
      const styles = getComputedStyle(document.documentElement);
      const top = parseFloat(styles.getPropertyValue('--corner-top')) || 0;
      const disc = parseFloat(styles.getPropertyValue('--corner-disc')) || 0;
      const fringe = disc * 0.105;
      sunTop = top - fringe;
      sunBottom = top + disc + fringe;
      update();
    };

    measure();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    sizes?.observe(document.body);
    const stopFollowing = followScroll(next => {
      scroll = next;
      update();
    });
    window.addEventListener('resize', measure);
    window.addEventListener('pageshow', measure);
    return () => {
      stopFollowing();
      sizes?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
    };
  }, [site]);
}
