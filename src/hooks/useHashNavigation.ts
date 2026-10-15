import { useEffect } from 'react';

/** The element a fragment names, or null for an empty, unknown, or malformed one such as "#%". */
function targetOf(hash: string) {
  if (hash.length < 2) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
}

/** Moves keyboard and screen-reader focus to where reading continues: a section's heading, or a case note's summary. */
function focusStart(target: HTMLElement) {
  const start = target.querySelector<HTMLElement>(target instanceof HTMLDetailsElement ? 'summary' : ':is(h1, h2)[tabindex]');
  start?.focus({ preventScroll: true });
}

/**
 * Makes in-page links behave on a page that renders after load:
 * - a link opened fresh (/#contact, /#case-freewheel) scrolls to its target once it exists;
 * - links to case notes open their disclosure;
 * - following a link moves focus to the heading of the section, or the summary of the case notes, it leads to.
 */
export function useHashNavigation() {
  useEffect(() => {
    // On back/forward and reload the browser restores the reader's own scroll position
    // (main.tsx renders synchronously so that it can), so only a fresh visit is scrolled.
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const restored = navigation?.type === 'reload' || navigation?.type === 'back_forward';
    const initial = targetOf(window.location.hash);
    if (initial instanceof HTMLDetailsElement) initial.open = true;
    if (initial && !restored) initial.scrollIntoView();

    // Later fragment changes are scrolled by the browser itself; it only needs help with a
    // closed disclosure, whose contents it cannot scroll to.
    function onHashChange() {
      const target = targetOf(window.location.hash);
      if (target instanceof HTMLDetailsElement && !target.open) {
        target.open = true;
        target.scrollIntoView();
      }
    }
    function onClick(event: MouseEvent) {
      // Leave modified clicks alone: they open the link somewhere else.
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
      const target = link ? targetOf(link.hash) : null;
      // Wait for the browser's own jump, then hand focus over.
      if (target) requestAnimationFrame(() => focusStart(target));
    }
    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('click', onClick);
    };
  }, []);
}
