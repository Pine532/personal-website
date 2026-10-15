import { useEffect, useRef, useState } from 'react';
import { profile } from '../content';
import { useScrollSpy } from '../hooks/useScrollSpy';
import type { SunMotion } from '../hooks/useSunMotion';
import { SUN_FRAMING } from '../media';
import { subscribeSuns } from '../sunPlace';
import { Playback } from './icons';

const SECTIONS = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact' },
] as const;
const SECTION_IDS = SECTIONS.map(section => section.id);

// How far a Sun's fringe reaches, in radii of its disc.
const FRINGE = SUN_FRAMING.fringe / SUN_FRAMING.disc;

/** `motion` is the visitor's say over the Sun's motion (hooks/useSunMotion.ts): the control here is
    the second of its handles. */
export function SiteHeader({ motion }: { motion: SunMotion }) {
  const activeSection = useScrollSpy(SECTION_IDS);
  // Whether a Sun is on show away from the hero: the Sun in its corner or on its way down to close
  // the page, or the closing box's own with any of it in the window. There it turns beside whatever
  // is being read, footage or still, with the hero's own control a long way up the page.
  const [afield, setAfield] = useState(false);
  // And whether the Sun is still in the hero while the hero's control is not all in the window: in a
  // short window, or one zoomed far in, the Sun turns in the first screen with that control a screen
  // or more below it.
  const [atHero, setAtHero] = useState(false);
  const [controlAway, setControlAway] = useState(false);
  // In a short window the header scrolls away with the page (styles/hero.css), and a control in it
  // is no use to a Sun further down: it is offered only while the header is in the window.
  const header = useRef<HTMLElement>(null);
  const [headerShown, setHeaderShown] = useState(true);
  useEffect(() => subscribeSuns(({ main, closing }) => {
    const closes = !!closing && closing.y - closing.r * FRINGE < window.innerHeight && closing.y + closing.r * FRINGE > 0;
    setAfield((!!main && main.sun !== 'hero') || closes);
    setAtHero(main?.sun === 'hero');
  }), []);
  useEffect(() => {
    const control = document.querySelector('.hero-controls');
    if (!control || !header.current || typeof IntersectionObserver === 'undefined') return;
    const watching = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === control) setControlAway(entry.intersectionRatio < 1);
        else setHeaderShown(entry.isIntersecting);
      }
    }, { threshold: [0, 1] });
    watching.observe(control);
    watching.observe(header.current);
    return () => watching.disconnect();
  }, []);

  return (
    <header className="site-header" ref={header}>
      <div className="header-field" aria-hidden="true" />
      <nav className="site-navigation" aria-label="Main">
        {SECTIONS.map(section => (
          <a key={section.id} href={`#${section.id}`} aria-current={activeSection === section.id ? 'true' : undefined}>
            {section.label}
          </a>
        ))}
      </nav>
      <div className="header-home">
        {/* The hero's motion control again, within reach while a Sun is on show away from the hero,
            and while the Sun in the hero turns out of that control's reach. It names what pressing
            it will do, as that one does. styles/hero.css hides it otherwise; a visitor who has never
            had motion on is not offered it. */}
        <button type="button" className="motion-toggle" data-shown={(afield || (atHero && controlAway)) && headerShown && motion.asked} aria-label={motion.label} onClick={motion.toggle}>
          <Playback paused={!motion.playing} />
        </button>
        {/* The link home: the name, and the Sun itself once it has docked in the corner. The Sun is
            the hero's own and is not in here; .wordmark-sun is its disc's place in the corner, which
            makes the docked Sun part of the link, and is where hooks/useSunDock.ts reads the corner
            from. styles/hero.css hides the link until the Sun is there. */}
        <a className="wordmark" href="#top" aria-label={`${profile.name}, back to top`}>
          <span className="wordmark-name" translate="no">{profile.name}</span>
          <span className="wordmark-sun" aria-hidden="true" />
        </a>
      </div>
    </header>
  );
}
