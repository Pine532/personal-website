import { useRef } from 'react';
import { projects, workIntroduction, type CaseStudy, type Figure } from '../content';
import { usePinnedStages } from '../hooks/usePinnedStage';
import { usePrintExpansion } from '../hooks/usePrintExpansion';
import { Arrow } from './icons';
import { InlineList } from './InlineList';
import { ProjectStage } from './ProjectStage';
import { ProjectVisual } from './ProjectVisual';
import { scenes, stories } from './visuals/scenes';

/**
 * Headline numbers, in reading order: the value, what it measures, then its context.
 * The explicit list role keeps the list announced in Safari, which drops it from unstyled lists.
 * A figure that answers a moment of the visual below it says which; its tone is then the stage's to
 * set (hooks/usePinnedStage.ts), and "full" here is only the starting value.
 */
function Figures({ figures }: { figures: Figure[] }) {
  if (figures.length === 0) return null;
  return (
    <ul className="figures" role="list" aria-label="Key figures">
      {figures.map(figure => (
        <li className="figure" key={figure.label} data-beat={figure.beat} data-tone={figure.beat ? 'full' : undefined}>
          <span className="figure-value">{figure.value}</span>{' '}
          <span className="figure-label">{figure.label}</span>
          {figure.detail && <>{' '}<span className="figure-detail">{figure.detail}</span></>}
        </li>
      ))}
    </ul>
  );
}

function Comparison({ comparison }: { comparison: NonNullable<CaseStudy['comparison']> }) {
  return (
    <div className="comparison">
      <table>
        <caption>{comparison.caption}</caption>
        <thead>
          <tr>{comparison.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr>
        </thead>
        <tbody>
          {comparison.rows.map(([metric, value, baseline]) => (
            <tr key={metric}>
              <th scope="row">{metric}</th>
              <td>{value}</td>
              <td>{baseline}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseNotes({ project }: { project: CaseStudy }) {
  if (project.details.length === 0 && !project.comparison) return null;
  return (
    <details id={`case-${project.id}`} className="case-details">
      <summary>
        <span>Case notes<span className="sr-only">: {project.organization}</span></span>
        <svg className="disclosure-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M4 10h12" />
          <path className="disclosure-vertical" d="M10 4v12" />
        </svg>
      </summary>
      <div className="case-content">
        {project.comparison && <Comparison comparison={project.comparison} />}
        <div className="case-blocks">
          {project.details.map(detail => (
            <section key={detail.heading}>
              <h4>{detail.heading}</h4>
              {detail.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
        </div>
        <p className="case-links">
          <a href={`#case-${project.id}`} className="case-permalink">
            Link to these notes<span className="sr-only">: {project.organization}</span>
          </a>
        </p>
      </div>
    </details>
  );
}

/**
 * The project's figures, then its moving visual, when it has one, on its stage: after the heading,
 * before the body. The figures stand on the stage with the visual, which draws what they claim: left
 * above it they would be sliding out under the header while its story was told.
 */
function Showing({ project }: { project: CaseStudy }) {
  const figures = <Figures figures={project.figures} />;
  const load = scenes[project.id];
  const story = stories[project.id];
  if (!project.visual || !load || story === undefined) return figures;
  return (
    <ProjectStage story={story} lead={project.figures.length > 0 ? figures : undefined} cued={project.figures.some(figure => figure.beat)}>
      <ProjectVisual {...project.visual} load={load} />
    </ProjectStage>
  );
}

function Project({ project, featured }: { project: CaseStudy; featured: boolean }) {
  return (
    <article id={project.id} className={featured ? 'project project--featured' : 'project'} aria-labelledby={`title-${project.id}`}>
      <div className="project-heading">
        <div>
          <h3 id={`title-${project.id}`}>{project.title}</h3>
          <p className="project-organization" translate="no">{project.organization}</p>
          <p className="project-role">{project.role}</p>
        </div>
        <p className="project-date">
          {project.dates}
          {project.location && <> <span>{project.location}</span></>}
        </p>
      </div>
      <Showing project={project} />
      <div className="project-body">
        <div>
          <p className="project-summary">{project.summary}</p>
          {project.tools.length > 0 && <InlineList items={project.tools} className="project-tools" label="Tools" />}
          {project.links.map(link => (
            <a className="project-link" key={link.href} href={link.href} target="_blank" rel="noreferrer">
              {link.label} <Arrow /><span className="sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </div>
        <dl className="project-facts">
          {project.facts.map(fact => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.text}</dd>
            </div>
          ))}
        </dl>
      </div>
      <CaseNotes project={project} />
    </article>
  );
}

export function Work() {
  usePrintExpansion();
  const probe = useRef<HTMLSpanElement>(null);
  usePinnedStages(probe);
  return (
    <section id="work" className="work-section section-shell" aria-labelledby="work-heading">
      {/* Never seen: as tall as the window at its smallest (styles/work.css), for the stages to measure. */}
      <span ref={probe} className="stage-probe" aria-hidden="true" />
      <div className="section-heading">
        <h2 id="work-heading" tabIndex={-1}>Selected work</h2>
        <p>{workIntroduction}</p>
      </div>
      <div className="projects">
        {projects.map((project, index) => <Project key={project.id} project={project} featured={index === 0} />)}
      </div>
    </section>
  );
}
