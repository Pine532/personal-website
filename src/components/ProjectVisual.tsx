import { Component, useId, useState, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { VisualPlaybackContext } from '../hooks/useVisualClock';
import { VisualFrame } from './visuals/VisualFrame';
import type { SceneModule } from './visuals/types';

type Props = {
  /** Whose visual this is, to tell the pause buttons apart for screen readers ("Pause the FreeWheel visual"). */
  name: string;
  /** What the visual shows: its text alternative (the art itself is hidden from screen readers). */
  label: string;
  /** The line under the panel: it starts "Illustration:" and says what is schematic. It also names the figure. */
  caption: string;
  load: () => Promise<{ default: SceneModule }>;
};

/**
 * A project's moving visual: the art, its caption, and a pause control. The art plays only while
 * it is in view (hooks/useVisualClock.ts); where its stage pins it (components/ProjectStage.tsx),
 * scrolling tells its story and the clock takes over after, with the quiet loop. The control is about
 * what the art does by itself. Pressed while the page is still scrolling through the story it says
 * Play at once, and means it: the story goes on with the scrolling, and no loop follows it until Play
 * is pressed. Visitors who prefer reduced motion see a still that tells the whole story, until they
 * press Play. A visual whose scene cannot be loaded, built or painted is left out entirely, so no empty
 * box or idle button remains.
 */
export function ProjectVisual(props: Props) {
  return (
    <PanelBoundary>
      <Panel {...props} />
    </PanelBoundary>
  );
}

/** Keeps anything a visual throws while React renders it inside that visual: the panel is left out
    (React reports the error) and the rest of the page carries on. */
class PanelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Panel({ name, label, caption, load }: Props) {
  const reduced = usePrefersReducedMotion();
  const captionId = useId();
  // null: the visitor has not chosen, so their motion preference decides.
  const [choice, setChoice] = useState<'play' | 'pause' | null>(null);
  // Turning reduced motion on sets an earlier choice aside, so the visual returns to its still;
  // turning it off keeps the choice (a paused visual stays paused).
  const [wasReduced, setWasReduced] = useState(reduced);
  if (reduced !== wasReduced) {
    setWasReduced(reduced);
    if (reduced) setChoice(null);
  }
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const paused = choice === null ? reduced : choice === 'pause';
  return (
    <figure className="project-visual" aria-labelledby={captionId}>
      <div className="project-visual-art" role="img" aria-label={label}>
        <VisualPlaybackContext.Provider value={{ paused, reduced, chosen: choice !== null }}>
          <VisualFrame load={load} onFail={() => setFailed(true)} />
        </VisualPlaybackContext.Provider>
      </div>
      <figcaption className="project-visual-caption">
        <span id={captionId}>{caption}</span>
        <button type="button" className="visual-toggle" onClick={() => setChoice(paused ? 'play' : 'pause')}>
          <svg viewBox="0 0 10 10" aria-hidden="true">{paused ? <path d="M2.6 1.6v6.8L8.6 5z" /> : <path d="M3 1.8v6.4M7 1.8v6.4" />}</svg>
          <span>{paused ? 'Play' : 'Pause'}<span className="sr-only"> the {name} visual</span></span>
        </button>
      </figcaption>
    </figure>
  );
}
