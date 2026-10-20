import { profile } from '../content';
import { Arrow } from './icons';
import { ClosingSun } from './ClosingSun';
import { TactileLink } from './TactileButton';

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children} <Arrow /><span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function Contact({ sunMoving }: { sunMoving: boolean }) {
  return (
    <section id="contact" className="contact-section section-shell" aria-labelledby="contact-heading">
      <div className="contact-main">
        <div>
          <h2 id="contact-heading" tabIndex={-1}>Get in touch.</h2>
          <p className="contact-location">{profile.location} · B.S. expected {profile.education.graduation}</p>
          <div className="contact-options">
            <TactileLink href={`mailto:${profile.email}`}><span>{profile.email}</span><Arrow /></TactileLink>
            <ul className="contact-links">
              <li><ExternalLink href={profile.linkedin}>LinkedIn</ExternalLink></li>
              {profile.github && <li><ExternalLink href={profile.github}>GitHub</ExternalLink></li>}
              {profile.resumeUrl && <li><a href={profile.resumeUrl} download="Owen_Sun_Zhang_Resume.pdf">Résumé <Arrow direction="down" /><span className="sr-only"> (PDF download)</span></a></li>}
            </ul>
          </div>
        </div>
        {/* The page closes as it opened: the whole Sun, its footage playing while the hero's is. */}
        <ClosingSun moving={sunMoving} />
      </div>
    </section>
  );
}
