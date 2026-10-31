import { profile, toolkit } from '../content';
import { Arrow } from './icons';
import { InlineList } from './InlineList';

/** About, on the page's one light ground: the biography set large, then education, certifications,
    the toolkit and earlier experience in four columns. */
export function About() {
  const { education, credentials, earlier } = profile;
  const [lead, ...rest] = profile.biography;
  return (
    <section id="about" className="about-section" aria-labelledby="about-heading">
      <div className="about-head grid">
        <h2 id="about-heading" className="label" tabIndex={-1}>About</h2>
      </div>
      <div className="about-main grid">
        <p className="about-lead">{lead}</p>
        <div className="about-more">
          {rest.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
        </div>
      </div>
      <div className="about-columns grid">
        <section className="about-column education">
          <h3 className="label muted">Education</h3>
          <p className="about-strong">{education.university}</p>
          <p>{education.school}</p>
          <p>{education.degree}</p>
          <p>Expected {education.graduation} · GPA {education.gpa}</p>
          <h4 className="label muted">Selected coursework</h4>
          <InlineList items={education.courses} />
          <h4 className="label muted">Activities</h4>
          <InlineList items={education.activities} />
          <h4 className="label muted">Course project</h4>
          <p>
            <a href={education.courseProject.href} target="_blank" rel="noreferrer">
              {education.courseProject.name} <Arrow /><span className="sr-only"> (code on GitHub, opens in a new tab)</span>
            </a>
          </p>
          <p className="about-small">{education.courseProject.summary}</p>
        </section>

        <section className="about-column credentials">
          <h3 className="label muted">Certifications</h3>
          <ul>
            {credentials.map(credential => (
              <li key={credential.name}>
                {credential.href ? (
                  <a href={credential.href} target="_blank" rel="noreferrer">
                    {credential.name} <Arrow /><span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <span>{credential.name}</span>
                )}
                <span className="about-small">{credential.issuer} · <span className="keep-together">{credential.date}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <section className="about-column skills">
          <h3 className="label muted">Toolkit</h3>
          <dl>
            {toolkit.map(skill => (
              <div key={skill.area}>
                <dt className="label muted">{skill.area}</dt>
                <dd>{skill.items.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="about-column earlier">
          <h3 className="label muted">Earlier</h3>
          <p className="about-strong">{earlier.organization}</p>
          <p>{earlier.role}</p>
          <p className="about-small">{earlier.dates} · {earlier.location}</p>
          <p>{earlier.summary}</p>
        </section>
      </div>
    </section>
  );
}
