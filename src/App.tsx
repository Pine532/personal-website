import { useRef } from 'react';
import { About } from './components/About';
import { Contact } from './components/Contact';
import { Hero } from './components/Hero';
import { SiteFooter } from './components/SiteFooter';
import { SiteHeader } from './components/SiteHeader';
import { Sunlight } from './components/Sunlight';
import { Work } from './components/Work';
import { useHashNavigation } from './hooks/useHashNavigation';
import { useLitControls } from './hooks/useLitControls';
import { useLitText } from './hooks/useLitText';
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion';
import { useSunDock } from './hooks/useSunDock';
import { useSunMotion } from './hooks/useSunMotion';

export default function App() {
  const site = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useSunDock(site, reduced);
  useLitControls(site);
  useLitText(site);
  useHashNavigation();
  // Whether the visitor wants the Sun moving: the hero's control, the header's and the footer's are
  // one switch, and the closing box's own Sun follows it.
  const motion = useSunMotion(reduced);

  return (
    // The data attributes here are only starting values: after mount useSunDock owns the first
    // five, and Sunlight the last.
    <div className="site" ref={site} data-sun-dock="off" data-sun-descent="off" data-sun="hero" data-corner="sun" data-hero-name="shown" data-sunlight="off">
      <a className="skip-link" href="#work">Skip to selected work</a>
      <SiteHeader motion={motion} />
      <main>
        <Hero reduced={reduced} motion={motion} />
        <Work />
        <About />
        <Contact sunMoving={motion.playing} />
      </main>
      <SiteFooter motion={motion} />
      <Sunlight />
    </div>
  );
}
