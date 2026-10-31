import { useCallback, useEffect, useRef } from 'react';
import { About } from './components/About';
import { Contact } from './components/Contact';
import { CornerSun } from './components/CornerSun';
import { Hero } from './components/Hero';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { Work } from './components/Work';
import { useHashNavigation } from './hooks/useHashNavigation';
import { usePageState } from './hooks/usePageState';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import { useSunMotion } from './hooks/useSunMotion';
import { scrollToElement, startSmoothScroll } from './smoothScroll';
import type { Action } from './terminal/commands';

export default function App() {
  const site = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  usePageState(site);
  // Whether the visitor wants the Sun moving: the control under it and the terminal's `sun` are one switch.
  const motion = useSunMotion(reduced);
  useHashNavigation();
  useEffect(() => startSmoothScroll(), []);

  // What the terminal asks of the page (components/Terminal.tsx).
  const { set: setMotion } = motion;
  const onAction = useCallback((action: Action) => {
    if (action.type === 'scroll') {
      const target = document.querySelector<HTMLElement>(action.target);
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      if (action.target !== window.location.hash) history.pushState(null, '', action.target);
      scrollToElement(target);
    } else if (action.type === 'visit') {
      window.open(action.href, '_blank', 'noopener');
    } else if (action.type === 'sun') {
      setMotion(action.command);
    }
  }, [setMotion]);

  return (
    // The data attributes here are only starting values: after mount usePageState owns them.
    <div className="site" ref={site} data-scrolled="false" data-ground="field">
      <a className="skip-link" href="#work">Skip to selected work</a>
      <SiteHeader />
      <CornerSun motion={motion} />
      <main>
        <Hero onAction={onAction} />
        <Work />
        <About />
        <Contact />
      </main>
      <SiteFooter />
    </div>
  );
}
