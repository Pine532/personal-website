import { useEffect } from 'react';

/**
 * Opens every case note for printing, then restores the reader's own open/closed choices, and the
 * place the page was scrolled to: the printed document is far shorter than the page, and a browser that
 * lays it out in the page's own window can leave the page scrolled only as far as the paper went.
 * styles/print.css also forces the notes visible, so they print even if these events never fire.
 */
export function usePrintExpansion() {
  useEffect(() => {
    // The notes this hook opened and has not yet closed again. A set, so a second beforeprint
    // before the afterprint cannot forget them.
    const opened = new Set<HTMLDetailsElement>();
    // Where the page was before the first of them was opened, or null when nothing is being printed.
    let place: number | null = null;
    function expand() {
      place ??= window.scrollY;
      for (const details of document.querySelectorAll<HTMLDetailsElement>('details:not([open])')) {
        details.open = true;
        opened.add(details);
      }
    }
    function restore() {
      for (const details of opened) details.open = false;
      opened.clear();
      if (place !== null) window.scrollTo(0, place);
      place = null;
    }
    window.addEventListener('beforeprint', expand);
    window.addEventListener('afterprint', restore);
    return () => {
      window.removeEventListener('beforeprint', expand);
      window.removeEventListener('afterprint', restore);
    };
  }, []);
}
