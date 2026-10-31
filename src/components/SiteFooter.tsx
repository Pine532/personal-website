import { profile } from '../content';
import { Arrow } from './icons';

/** The foot of the page: the name at the page's full width, and the small print. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-top grid">
        <p className="label" translate="no">{profile.name}</p>
        <p className="label muted">{profile.field}<br />{profile.location}</p>
        <a className="back-to-top label" href="#top">Back to top <Arrow direction="up" /></a>
      </div>
      <p className="footer-wordmark" aria-hidden="true" translate="no">{profile.name}</p>
      <div className="footer-foot grid label muted">
        <span>© {new Date().getFullYear()} {profile.name}</span>
        <span>Boston University · {profile.education.degree}</span>
      </div>
    </footer>
  );
}
