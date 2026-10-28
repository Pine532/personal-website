import { useEffect, useRef, useState } from 'react';
import { projects } from '../content';
import { followScroll } from '../scroll';
import { prompt } from '../terminal/commands';

/**
 * The index of work: each project's name set very large, in a list that leads to its case below.
 * Beside the list, where there is room, a preview reads the project's README as the terminal
 * would: the project under the pointer, or, with no pointer over the list, the one nearest the
 * middle of the window as the page scrolls.
 */
export function WorkIndex() {
  const list = useRef<HTMLOListElement>(null);
  const hovered = useRef<string | null>(null);
  const [active, setActive] = useState(projects[0]!.id);

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    /** The middle of each row down the page, and the window's height. */
    let middles: { id: string; middle: number }[] = [];
    let windowHeight = 0;
    let scroll = window.scrollY;
    const update = () => {
      if (hovered.current) return;
      const line = scroll + windowHeight * 0.5;
      let nearest = middles[0];
      for (const row of middles) if (Math.abs(row.middle - line) < Math.abs(nearest!.middle - line)) nearest = row;
      if (nearest) setActive(nearest.id);
    };
    const measure = () => {
      scroll = window.scrollY;
      windowHeight = window.innerHeight;
      middles = [...element.querySelectorAll<HTMLElement>('.index-row')].map(row => {
        const box = row.getBoundingClientRect();
        return { id: row.dataset.id ?? '', middle: scroll + (box.top + box.bottom) / 2 };
      });
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
    return () => {
      stopFollowing();
      sizes?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const current = projects.find(project => project.id === active) ?? projects[0]!;
  const figures = current.figures.slice(0, 3).map(figure => `${figure.value.padEnd(8)} ${figure.label}`);

  return (
    <div className="index grid">
      <ol ref={list} className="index-rows" onPointerLeave={() => { hovered.current = null; }}>
        {projects.map((project, index) => (
          <li key={project.id}>
            <a
              className="index-row"
              href={`#${project.id}`}
              data-id={project.id}
              data-active={active === project.id}
              onPointerEnter={event => {
                if (event.pointerType === 'touch') return;
                hovered.current = project.id;
                setActive(project.id);
              }}
              onFocus={() => setActive(project.id)}
            >
              <span className="index-number label muted">{String(index + 1).padStart(2, '0')}</span>
              <span className="index-name">{project.short}</span>
              <span className="index-title label muted">{project.title}</span>
            </a>
          </li>
        ))}
      </ol>
      {/* Decorative: it repeats what the case below says, as the terminal would print it. */}
      <aside className="index-preview" aria-hidden="true">
        <div className="index-preview-screen" key={current.id}>
          <span className="t-prompt">{prompt(['projects'])}</span> <span className="t-cmd">cat {current.id}/README.md</span>{'\n'}
          <span className="t-heading">{current.title}</span>{'\n'}
          <span>{current.organization} — {current.role}</span>{'\n'}
          <span className="t-muted">{current.location ? `${current.dates} · ${current.location}` : current.dates}</span>{'\n'}
          {figures.length > 0 && <>{'\n'}{figures.map(figure => <span key={figure}>{figure}{'\n'}</span>)}</>}
          {'\n'}<span className="t-muted">open {current.id}   → the full case below</span>
        </div>
      </aside>
    </div>
  );
}
