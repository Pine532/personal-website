import { useContext, useEffect, useEffectEvent, useRef, useState } from 'react';
import { StageContext } from '../../hooks/usePinnedStage';
import { useVisualClock, VisualPlaybackContext, waitingFrame } from '../../hooks/useVisualClock';
import { layoutFor, type Scene, type SceneModule } from './types';

type Props = {
  /** Loads the scene's module (a dynamic import, so its code arrives only when the panel is near). */
  load: () => Promise<{ default: SceneModule }>;
  /** Called once if the scene cannot be loaded, built or painted. The error has already been reported. */
  onFail: () => void;
};

// A long label in the art's label type (styles/work.css sets the probe's type). Its size follows the
// font, the text size and any text spacing the visitor applies, which the scenes' measured labels follow too.
const PROBE_TEXT = 'Mean conversion-ratio error';

/**
 * Hosts a project's scene inside the panel's art box, whose size styles/work.css reserves before any
 * script runs. The scene's code is fetched once the panel comes within a screen of the viewport, and
 * the scene is built once the fonts are ready (labels are placed by their measured text). It is built
 * again after any later font loading, and when the box's size, the text metrics (a hidden probe) or the
 * device pixel ratio change; a panel that is not within a screen of the viewport is rebuilt when it next
 * comes near. The visual's clock (hooks/useVisualClock.ts) keeps running across rebuilds. If the scene
 * cannot be loaded, built or painted, the error is reported and `onFail` is called.
 *
 * A failed load is not retried: browsers keep a failed module fetch for the life of the page, so
 * importing the same chunk again fails at once without a request.
 */
export function VisualFrame({ load, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const scene = useRef<Scene | null>(null);
  const shown = useRef(0);
  const broken = useRef(false);
  // The scene's timing, known once it is first built: the clock waits for it.
  const [timing, setTiming] = useState<{ still: number; playFrom: number; story: number; departs: number } | null>(null);
  // Tells the panel once; it then removes itself (components/ProjectVisual.tsx).
  const failed = () => {
    if (broken.current) return;
    broken.current = true;
    onFail();
  };
  const fail = useEffectEvent((error: unknown) => {
    if (broken.current) return;
    reportError(error);
    failed();
  });
  // The first build shows the frame the clock will show while the story waits (its still, for a
  // visitor who prefers reduced motion), so no other frame flashes before the clock takes over. On a
  // pinned stage that is wherever scrolling has the story: its end, on a page opened further down. The
  // stage is asked where the page is at this instant, in case it has moved within this very frame.
  const playback = useContext(VisualPlaybackContext);
  const stage = useContext(StageContext);
  const firstFrame = useEffectEvent(({ still, story }: SceneModule) => {
    if (!stage?.pinned) return waitingFrame(playback, still);
    stage.arrive();
    return stage.progress() * story;
  });
  // The figures above the visual wait for the scene's named moments (hooks/usePinnedStage.ts). The stage
  // is told the moment the first frame shows along with them: on a page opened past the story the
  // figures are then at their full tone from the start, not taken down for the instant before the
  // clock says so.
  const cue = useEffectEvent(({ beats, story }: SceneModule) => {
    stage?.cue(beats, shown.current);
    // The page made room for the story before the scene arrived; the two lengths must be one. The build
    // stops if they are not (config/story-lengths.ts); while developing, this says so.
    if (import.meta.env.DEV && stage && Math.abs(stage.story - story) > 0.005) {
      reportError(new Error(`A scene's story lasts ${story} s, but components/visuals/scenes.ts says ${stage.story} s.`));
    }
  });

  useEffect(() => {
    const element = host.current;
    const metrics = probe.current;
    if (!element || !metrics) return;
    let module: SceneModule | null = null;
    let requested = false;
    let near = typeof IntersectionObserver === 'undefined';
    // Whether the fonts have finished loading since the module arrived, and whether they have loaded
    // again since the last build (both force a build even when nothing measured has changed).
    let fontsReady = false;
    let force = false;
    let builtFor = '';
    let timed = false;
    let frame = 0;
    let disposed = false;

    const build = () => {
      frame = 0;
      if (disposed || broken.current || !module || !fontsReady || document.fonts.status !== 'loaded') return;
      // Not within a screen of the viewport: nothing is drawn now; the next approach builds it.
      if (!near) return;
      // The layout comes from the unrounded width, as styles/work.css's container queries pick the
      // height from it (a 639.75 px column is narrow there, so it must be narrow here too).
      const box = element.getBoundingClientRect();
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      // A hidden panel (in print, for one) has no size: keep the scene as it is until it has one again.
      if (width < 1 || height < 1) return;
      const layout = layoutFor(box.width);
      const text = metrics.getBoundingClientRect();
      const key = `${width} ${height} ${layout} ${devicePixelRatio} ${Math.round(text.width)} ${Math.round(text.height)}`;
      if (key === builtFor && !force) return;
      builtFor = key;
      force = false;
      try {
        scene.current = null;
        element.replaceChildren();
        const next = module.build(element, { width, height, layout });
        if (!timed) shown.current = firstFrame(module);
        next.render(shown.current);
        scene.current = next;
      } catch (error) {
        scene.current = null;
        fail(error);
        return;
      }
      if (!timed) {
        timed = true;
        cue(module);
        setTiming({ still: module.still, playFrom: module.playFrom ?? 0, story: module.story, departs: module.departs ?? Infinity });
      }
    };
    const schedule = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(build);
    };
    const fontsLoaded = () => {
      force = true;
      schedule();
    };

    // Fetch the scene the first time the panel comes near; track nearness for rebuilds.
    const fetchScene = () => {
      requested = true;
      Promise.resolve().then(load).then(loaded => {
        if (disposed) return;
        module = loaded.default;
        document.fonts.ready.then(() => {
          fontsReady = true;
          fontsLoaded();
        });
      }, error => {
        if (!disposed) fail(error);
      });
    };
    const nearby = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      near = entries.at(-1)?.isIntersecting ?? near;
      if (!near) return;
      if (!requested) fetchScene();
      schedule();
    }, { rootMargin: '100% 0px' });
    nearby?.observe(element);
    if (!nearby) fetchScene();

    // The box's size and the probe's text metrics. Builds wait for the fonts (see build).
    const resized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resized?.observe(element);
    resized?.observe(metrics);
    document.fonts.addEventListener('loadingdone', fontsLoaded);

    // The device pixel ratio (a window moved to another screen): matchMedia fires once per change.
    let resolution: MediaQueryList | null = null;
    const watchResolution = () => {
      resolution?.removeEventListener('change', resolutionChanged);
      resolution = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
      resolution.addEventListener('change', resolutionChanged);
    };
    function resolutionChanged() {
      watchResolution();
      schedule();
    }
    watchResolution();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      nearby?.disconnect();
      resized?.disconnect();
      document.fonts.removeEventListener('loadingdone', fontsLoaded);
      resolution?.removeEventListener('change', resolutionChanged);
    };
  }, [load]);

  const cost = useRef({ total: 0, frames: 0 });
  const paint = (seconds: number) => {
    shown.current = seconds;
    const current = scene.current;
    if (!current) return;
    if (!import.meta.env.DEV) {
      current.render(seconds);
      return;
    }
    // In development, the average time a frame takes to paint, for checking each scene's cost.
    const begin = performance.now();
    current.render(seconds);
    const measure = cost.current;
    measure.total += performance.now() - begin;
    measure.frames += 1;
    if (measure.frames % 30 === 0) host.current?.setAttribute('data-frame-cost', (measure.total / measure.frames).toFixed(3));
  };
  useVisualClock(host, paint, { still: timing?.still ?? 0, playFrom: timing?.playFrom ?? 0, story: timing?.story ?? 0, departs: timing?.departs ?? Infinity, ready: timing !== null, onError: failed });

  // data-motion starts "stopped"; hooks/useVisualClock.ts updates it once the scene is built.
  return (
    <>
      <div ref={host} className="project-visual-host" aria-hidden="true" data-motion="stopped" />
      <span ref={probe} className="project-visual-probe" aria-hidden="true">{PROBE_TEXT}</span>
    </>
  );
}
