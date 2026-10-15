import { useEffect, useState } from 'react';
import { headerHeight } from '../layout';
import { followScroll } from '../scroll';

/**
 * Reports which reading section is under the reader's eye, or null above the first of them.
 * Where the sections start is measured ahead of time, whenever the page's layout can have changed;
 * while the page scrolls nothing is measured (scroll.ts gives the scroll position, once a frame).
 */
export function useScrollSpy(sectionIds: readonly string[]) {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  useEffect(() => {
    const header = headerHeight();
    let scroll = 0;
    /** Where each section starts, down the page; the window's height, and the page's. */
    let tops: number[] = [];
    let windowHeight = 0;
    let pageHeight = 0;

    function update() {
      // A section becomes current once its top crosses a line 40% down the viewport.
      const line = windowHeight * 0.4;
      let current = -1;
      tops.forEach((top, index) => {
        if (top - scroll <= line) current = index;
      });
      // The last section can be too short to reach that line. At the bottom of the page it
      // becomes current, unless the current section's start is itself still in view (a very
      // tall window showing several sections at once).
      const atBottom = windowHeight + scroll >= pageHeight - 2;
      if (atBottom && current >= 0 && tops[current]! - scroll < header) current = sectionIds.length - 1;
      setActiveSection(sectionIds[current] ?? null);
    }

    function measure() {
      scroll = window.scrollY;
      windowHeight = window.innerHeight;
      pageHeight = document.documentElement.scrollHeight;
      tops = sectionIds.map(id => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) + scroll);
      update();
    }

    measure();
    // Whatever moves a section down the page (an opened case note, text that wraps differently)
    // changes the height of the page's body. A browser that cannot report that is measured as it
    // scrolls instead.
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    sizes?.observe(document.body);
    const stopFollowing = followScroll(next => {
      scroll = next;
      if (sizes) update();
      else measure();
    });
    window.addEventListener('resize', measure);
    // The browser may restore a scroll position after effects have run.
    window.addEventListener('pageshow', measure);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      stopFollowing();
      sizes?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [sectionIds]);

  return activeSection;
}
