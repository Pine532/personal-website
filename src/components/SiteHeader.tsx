import { profile } from '../content';
import { useScrollSpy } from '../hooks/useScrollSpy';

const SECTIONS = [
  { id: 'work', label: 'Work' },
  { id: 'about', label: 'About' },
  { id: 'contact', label: 'Contact' },
] as const;
const SECTION_IDS = SECTIONS.map(section => section.id);

/** The fixed header: the name, a line about Owen, and the navigation, in the page's first three
    columns; the Sun stands in the fourth (components/CornerSun.tsx). Once the page has scrolled the
    name and the links stand in dark pills (styles/header.css), so they read over the light About
    section too. */
export function SiteHeader() {
  const activeSection = useScrollSpy(SECTION_IDS);
  const year = profile.education.graduation.slice(-2);
  return (
    <header className="site-header grid">
      <a className="site-name label" href="#top" translate="no">{profile.name}</a>
      <p className="site-tagline label muted">{profile.field}<br />{profile.education.university} ’{year}</p>
      <nav className="site-navigation label" aria-label="Main">
        {SECTIONS.map(section => (
          <a key={section.id} href={`#${section.id}`} aria-current={activeSection === section.id ? 'true' : undefined}>
            {section.label}
          </a>
        ))}
        {profile.resumeUrl && <a href={profile.resumeUrl} download="Owen_Sun_Zhang_Resume.pdf">Résumé<span className="sr-only"> (PDF download)</span></a>}
      </nav>
    </header>
  );
}
