import { Component, type ReactNode } from 'react';
import { profile, projects } from '../content';

/**
 * If the page fails while rendering, show its essentials as plain text instead of an empty
 * black screen. React logs the error itself.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div>
        <main className="plain-page">
          <h1>{profile.name}</h1>
          <p>{profile.introduction}</p>
          <p>
            <a href={`mailto:${profile.email}`}>{profile.email}</a> · <a href={profile.linkedin}>LinkedIn</a>
            {profile.github && <> · <a href={profile.github}>GitHub</a></>} · {profile.location}
          </p>
          <h2>Selected work</h2>
          <ul>
            {projects.map(project => (
              <li key={project.id}><strong>{project.title}</strong>. {project.organization}, {project.dates}. {project.summary}</li>
            ))}
          </ul>
          <p>Something went wrong while loading the full site. Reloading the page may help.</p>
        </main>
      </div>
    );
  }
}
