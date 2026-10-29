import { useRef, type CSSProperties, type ReactNode } from 'react';
import { StageContext, usePinnedStage } from '../hooks/usePinnedStage';

type Props = {
  /** The length of the visual's opening story, in seconds (components/visuals/scenes.ts). The stylesheet
      turns it into the distance the page scrolls while the story is told. */
  story: number;
  /** The project's figures, pinned above the visual as one block where the two fit. */
  lead?: ReactNode;
  /** Those figures wait for moments of the story (their `beat` in src/content.ts): where they pin with
      the visual, the stylesheet gives the story more room, so the moments come one at a time. */
  cued?: boolean;
  /** The visual. */
  children: ReactNode;
};

/**
 * The stage a project's visual stands on. Where it can, the visual comes to rest in the middle of the
 * window and stays there while the page scrolls on. That scrolling first tells its story, forwards and
 * back, with the window to itself; then the finished picture waits while the project's text comes up
 * from the foot of the window to meet it, and the two leave with the page. styles/work.css does the
 * pinning and hooks/usePinnedStage.ts says when (reduced motion, short windows and blocks too tall for
 * the window are left as they were: the visual in the flow, playing by its clock).
 *
 * The data attributes here are only starting values: after mount usePinnedStage owns them.
 */
export function ProjectStage({ story, lead, cued, children }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const stage = usePinnedStage(track, story);
  return (
    <div ref={track} className="project-stage" data-pinned="off" data-lead={lead ? 'out' : undefined} data-cued={lead && cued ? '' : undefined} style={{ '--story': story } as CSSProperties}>
      <div className="project-stage-pin">
        {lead}
        <StageContext.Provider value={stage}>{children}</StageContext.Provider>
      </div>
    </div>
  );
}
