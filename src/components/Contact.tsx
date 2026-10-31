import { profile } from '../content';
import { Arrow } from './icons';

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children} <Arrow /><span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Contact closes the page: the invitation set large, the address, and the links. */
export function Contact() {
  return (
    <section id="contact" className="contact-section" aria-labelledby="contact-heading">
      <div className="contact-main grid">
        <p className="contact-label label muted">Contact</p>
        <h2 id="contact-heading" className="contact-heading" tabIndex={-1}>Get in touch.</h2>
        <div className="contact-ways">
          <a className="contact-email" href={`mailto:${profile.email}`}>{profile.email}</a>
          <ul className="contact-links label">
            <li><ExternalLink href={profile.linkedin}>LinkedIn</ExternalLink></li>
            {profile.github && <li><ExternalLink href={profile.github}>GitHub</ExternalLink></li>}
            {profile.resumeUrl && <li><a href={profile.resumeUrl} download="Owen_Sun_Zhang_Resume.pdf">Résumé <Arrow direction="down" /><span className="sr-only"> (PDF download)</span></a></li>}
          </ul>
          <p className="contact-location label muted">{profile.location} · B.S. expected {profile.education.graduation}</p>
        </div>
      </div>
    </section>
  );
}
