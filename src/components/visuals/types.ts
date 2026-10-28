// The contract between a project's moving visual (a "scene", one module per project in this folder)
// and the panel that hosts it (components/visuals/VisualFrame.tsx).

/** Which of the three layouts the panel's width calls for (see styles/work.css for the heights). */
export type Layout = 'wide' | 'medium' | 'narrow';

export type Size = {
  /** The art box in CSS pixels; the scene's SVG uses these as its coordinates (viewBox 0 0 width height). */
  width: number;
  height: number;
  layout: Layout;
};

/** A scene built for one size. */
export type Scene = {
  /** Paints the visual as it is `seconds` into its own time. Called once per animation frame while it plays,
      and once for a still. It must not read layout (no getBoundingClientRect or offsetWidth). */
  render(seconds: number): void;
};

/** What a scene module exports by default. */
export type SceneModule = {
  /** Builds the scene into `host`, an empty element of exactly `size`. It may throw; the panel then
      reports the error and removes itself. */
  build(host: HTMLElement, size: Size): Scene;
  /** A moment, in seconds, at which the whole story is visible: the frame shown when there is no motion. */
  still: number;
  /** The moment the opening story is over and the picture first complete, in seconds: everything after it
      is the quiet loop. While the visual's stage is pinned (hooks/usePinnedStage.ts) scrolling runs from 0
      to here. ./scenes.ts repeats it, so the page can make that room before the scene's code arrives, and
      the build stops if the two differ (config/story-lengths.ts). */
  story: number;
  /** Named moments of the story, in seconds, for figures above the visual that answer them (the `beat` of
      a figure in src/content.ts). */
  beats?: Readonly<Record<string, number>>;
  /** The moment, in seconds, after which the quiet loop shows another picture than the finished one: a
      later case, a chart that has run on. Scrolling back into the story from beyond it dips the art most
      of the way out and back around the change (hooks/useVisualClock.ts). Leave it out where the loop
      only ever adds a detail to the finished picture, which the story can take over from as it is. */
  departs?: number;
  /** Where motion starts, in seconds, when a visitor who prefers reduced motion presses Play. Default 0,
      the story's beginning; a scene whose story would first take its still apart can start later. */
  playFrom?: number;
};

/** The layout for an art box this many CSS pixels wide, unrounded (the same breakpoints as the container
    queries in styles/work.css, which compare the unrounded width). */
export const layoutFor = (width: number): Layout => (width >= 960 ? 'wide' : width >= 640 ? 'medium' : 'narrow');
