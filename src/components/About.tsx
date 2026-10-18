import { profile, toolkit } from '../content';
import { Arrow } from './icons';
import { InlineList } from './InlineList';

export function About() {
  const { education, credentials, earlier } = profile;
  return (
    <section id="about" className="about-section section-shell" aria-labelledby="about-heading">
      <div className="about-main">
        <div>
          <h2 id="about-heading" tabIndex={-1}>About</h2>
          <div className="biography">
            {profile.biography.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          </div>
        </div>

        <div className="about-background">
          <section className="education">
            <h3>{education.university}</h3>
            <p className="school">{education.school}</p>
            <p>{education.degree}</p>
            <p className="graduation">Expected {education.graduation} <span>GPA {education.gpa}</span></p>
            <div className="listing">
              <h4>Selected coursework</h4>
              <InlineList items={education.courses} />
            </div>
            <div className="listing">
              <h4>Activities</h4>
              <InlineList items={education.activities} />
            </div>
            <div className="listing">
              <h4>Course project</h4>
              <a href={education.courseProject.href} target="_blank" rel="noreferrer">
                {education.courseProject.name} <Arrow /><span className="sr-only"> (code on GitHub, opens in a new tab)</span>
              </a>
              <p>{education.courseProject.summary}</p>
            </div>
          </section>

          <section className="credentials">
            <h3>Certifications</h3>
            <ul>
              {credentials.map(credential => (
                <li key={credential.name}>
                  {credential.href ? (
                    <a href={credential.href} target="_blank" rel="noreferrer">
                      {credential.name} <Arrow /><span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="credential-name">{credential.name}</span>
                  )}
                  <span className="credential-meta">{credential.issuer}{'\u00A0· '}<span className="keep-together">{credential.date}</span></span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <div className="about-detail">
        <section className="skills">
          <h3>Technical toolkit</h3>
          <dl>
            {toolkit.map(skill => (
              <div key={skill.area}>
                <dt>{skill.area}</dt>
                <dd>{skill.items.join(', ')}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="earlier">
          <h3>Earlier experience</h3>
          <p className="earlier-organization">{earlier.organization}</p>
          <p className="earlier-role">{earlier.role}</p>
          <p className="earlier-date">{earlier.dates} · {earlier.location}</p>
          <p className="earlier-summary">{earlier.summary}</p>
        </section>
      </div>
    </section>
  );
}
