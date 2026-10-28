import { createContext, useContext, useEffect, useEffectEvent, useRef, type RefObject } from 'react';
import { headerHeight } from '../layout';
import { StageContext } from './usePinnedStage';

/** What the panel around a project visual decides: whether its motion is wanted. */
export type VisualPlayback = {
  /** Motion is not wanted: the visitor pressed Pause, or prefers reduced motion and has not pressed Play. */
  paused: boolean;
  /** The visitor prefers reduced motion. */
  reduced: boolean;
  /** The visitor pressed Pause or Play, so that choice decides rather than the motion preference. */
  chosen: boolean;
};

export const VisualPlaybackContext = createContext<VisualPlayback>({ paused: false, reduced: false, chosen: false });

/** The frame a visual shows before its story has started: the still when motion is not wanted, otherwise the beginning. */
export const waitingFrame = ({ paused, reduced }: VisualPlayback, still: number) => (paused || reduced ? still : 0);

// One animation-frame loop serves every visual that is playing. A visual whose frame throws is dropped
// from the loop and told so (after the loop, so its handler cannot stop the others), and the rest play on.
type Ticker = { tick: (now: number) => void; fail: () => void };
const ticking = new Set<Ticker>();
let frame = 0;
function loop(now: number) {
  for (const ticker of [...ticking]) {
    if (!ticking.has(ticker)) continue;
    try {
      ticker.tick(now);
    } catch (error) {
      ticking.delete(ticker);
      reportError(error);
      queueMicrotask(ticker.fail);
    }
  }
  frame = ticking.size > 0 ? requestAnimationFrame(loop) : 0;
}
function subscribe(ticker: Ticker) {
  ticking.add(ticker);
  if (!frame) frame = requestAnimationFrame(loop);
  return () => {
    ticking.delete(ticker);
    if (ticking.size === 0 && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

// Visibility is measured against the part of the window below the fixed header. The story begins the
// first time three quarters of the art is visible there (in a window too short for that, nearly as much
// as the window can show); after that it plays whenever a tenth of it is. A visitor who pressed Play
// needs only the tenth to start it.
const START_RATIO = 0.75;
const RUN_RATIO = 0.1;
const THRESHOLDS = Array.from({ length: 21 }, (_, step) => step / 20);
// In windows under 600 px tall the header scrolls away with the page instead (styles/hero.css).
const HEADER_SCROLLS_AWAY = '(max-height: 599px)';
// A slow frame, or a tab that was in the background, advances the visual by no more than this (seconds).
const LONGEST_STEP = 0.1;
// While scrolling tells the story, its time follows the scroll a little behind, so a mouse wheel's steps
// do not show as jumps: each frame (at 60 a second) closes this share of what is left, and within the
// last few thousandths of a second it lands exactly.
const FOLLOW = 0.2;
const SETTLED = 0.004;
// How long the art takes to dip when scrolling takes the time back from a loop that has moved on to
// another picture (milliseconds; styles/work.css fades it most of the way out, and back in, over the
// same time).
const DIP = 140;

type Timing = {
  /** A moment at which the whole story is visible: the frame shown when there is no motion. */
  still: number;
  /** Where motion starts when a visitor who prefers reduced motion presses Play. */
  playFrom: number;
  /** The moment the opening story is over: what scrolling runs to while the visual's stage is pinned. */
  story: number;
  /** The moment from which the quiet loop shows another picture than the finished one (visuals/types.ts),
      or Infinity if it never does. */
  departs: number;
  /** The scene is built and can paint. */
  ready: boolean;
  /** Painting threw. The clock has reported the error and stopped for good. */
  onError: () => void;
};

/**
 * Drives one project visual. `draw(seconds)` paints the visual at that moment of its own time; it
 * runs once per animation frame, but only while the visual is in view, the tab is visible, motion
 * is wanted, and the scene is `ready`. The visual's time stands still while it waits, and it resumes
 * where it stopped. The story starts from its beginning the first time it plays, or from `playFrom`
 * when a visitor who prefers reduced motion has pressed Play.
 *
 * While nothing moves it shows the still or the moment where it stopped (see `rest`). The element gets
 * data-motion="running" or "stopped", for the site's checks.
 *
 * On a pinned stage (hooks/usePinnedStage.ts) the opening story is not the clock's to tell. Its time is
 * the stage's progress through its scrub, from 0 to `story`, forwards and back, followed with a little
 * easing: the waiting frame until the stage comes to rest, the finished picture from the scrub's end,
 * which stands through the hold while the project's text comes up to it. Only when the stage has let go
 * does the clock run the quiet loop, as before: while the visual is in view and motion is wanted.
 *
 * So Pause and Play are about the loop, which is all the visual does by itself: scrolling tells the
 * story whichever is chosen, since that is the visitor's own doing, and a visitor who presses Pause
 * part-way through it gets a finished picture that stays still.
 *
 * Once running, the loop goes on while the page is anywhere below the scrub. Scrolling back up into the
 * scrub takes the time back: the picture returns to the story's finished frame and follows the page
 * from there, never back through what the loop has shown. Where the loop has moved on to another
 * picture (`departs`), the art dips most of the way out and back around the change; where it has only
 * added a detail, the story simply takes over. A loop that has gone out of sight returns to the
 * finished picture too. The element carries data-story-time, the last moment scrolling set, in seconds,
 * and data-handover while the art is dipped.
 */
export function useVisualClock(target: RefObject<Element | null>, draw: (seconds: number) => void, { still, playFrom, story, departs, ready, onError }: Timing) {
  const { paused, reduced, chosen } = useContext(VisualPlaybackContext);
  const stage = useContext(StageContext);
  const paint = useEffectEvent(draw);
  const fail = useEffectEvent(onError);
  // The visual's own time, and what is known of its visibility, outlast changes of playback. `placed`:
  // scrolling has set the time at least once. `looping`: on a pinned stage, the time is the clock's.
  const clock = useRef({ seconds: 0, started: false, ratio: 0, reachable: 1, broken: false, placed: false, looping: false });

  useEffect(() => {
    const element = target.current;
    const state = clock.current;
    if (!element || !ready || state.broken) return;
    const playing = chosen && !paused;
    const scrubbed = stage?.pinned ? stage : null;
    let stop: (() => void) | null = null;
    let last = 0;
    // The moment scrolling asks for, or null while the time is the clock's.
    let goal: number | null = null;
    // When the art began to dip out for a handover (by the frame clock), or null.
    let dip: number | null = null;
    const undip = () => {
      dip = null;
      element.removeAttribute('data-handover');
    };

    const halt = () => {
      if (state.broken) return;
      state.broken = true;
      stop?.();
      stop = null;
      element.setAttribute('data-motion', 'stopped');
      fail();
    };
    // The frame to show while nothing moves. Before the story starts, the waiting frame. After: the
    // still for a visitor who prefers reduced motion and has not chosen, otherwise wherever it stopped.
    const rest = () => {
      if (scrubbed) return state.seconds;
      if (!state.started) return waitingFrame({ paused, reduced, chosen }, still);
      return reduced && !chosen ? still : state.seconds;
    };
    const show = (seconds: number) => {
      paint(seconds);
      scrubbed?.show(seconds);
      if (goal !== null) element.setAttribute('data-story-time', seconds.toFixed(3));
    };
    const tick = (now: number) => {
      const elapsed = Math.min(Math.max(0, now - last) / 1000, LONGEST_STEP);
      last = now;
      if (dip !== null) {
        // The loop's last picture stands while it fades. At its faintest the finished picture takes its
        // place, and the stylesheet brings the art back while the time goes on to where the page is.
        if (now - dip < DIP) return;
        undip();
        state.seconds = story;
      }
      if (goal === null) {
        state.seconds += elapsed;
        show(state.seconds);
        return;
      }
      const gap = goal - state.seconds;
      state.seconds = Math.abs(gap) <= SETTLED ? goal : state.seconds + gap * (1 - (1 - FOLLOW) ** (elapsed * 60));
      show(state.seconds);
      // Arrived: nothing more to draw until the page scrolls again, or, past the hold, the clock's turn.
      if (state.seconds === goal) reconcile();
    };
    const visible = (wanted: number) => state.ratio > 0 && state.ratio >= Math.min(wanted, state.reachable - 0.05);
    /** On a pinned stage: sets `goal`, and says whether the time must still move to reach it. */
    const follow = (pinned: NonNullable<typeof scrubbed>) => {
      const progress = pinned.progress();
      const seen = state.placed && state.ratio > 0;
      if (progress > 0) state.started = true;
      state.placed = true;
      // The clock has the time once the stage has let go, and keeps it until the page is back in the scrub.
      if (progress >= 1 && (state.looping || pinned.released())) {
        if (dip !== null) undip();
        // A loop that ran on with no one to see it returns to the finished picture.
        if (!seen) state.seconds = story;
        // The story is told to its end first (a page flung past it).
        goal = state.seconds < story ? story : null;
        state.looping = goal === null;
        if (goal !== null) return true;
        element.setAttribute('data-story-time', story.toFixed(3));
        return false;
      }
      // Otherwise the time is the scroll's: before the scrub, in it, and through the hold on the way down.
      goal = progress * story;
      if (state.looping) {
        state.looping = false;
        if (seen && state.seconds > departs && dip === null) {
          dip = performance.now();
          element.setAttribute('data-handover', '');
        }
      }
      if (dip !== null) return true;
      // Whatever the clock had made of the time, scrolling takes it up from the story's end. And out of
      // sight, or set for the first time, there is nothing to ease from.
      state.seconds = seen ? Math.min(state.seconds, story) : goal;
      if (state.seconds !== goal) return true;
      element.setAttribute('data-story-time', goal.toFixed(3));
      return false;
    };
    const reconcile = () => {
      if (state.broken) return;
      const chasing = scrubbed ? follow(scrubbed) : false;
      const inView = visible(state.started || playing ? RUN_RATIO : START_RATIO);
      // With a goal the time is the scroll's: a stage in its scrub or its hold, or not yet at it, keeps to
      // its frame, paused or not.
      const clocked = goal === null && inView && !paused && document.visibilityState === 'visible';
      const run = chasing || clocked;
      if (run && !stop) {
        if (!scrubbed && !state.started) {
          state.started = true;
          state.seconds = reduced ? playFrom : 0;
        }
        last = performance.now();
        stop = subscribe({ tick, fail: halt });
      } else if (!run && stop) {
        stop();
        stop = null;
      }
      if (!stop) {
        try {
          show(rest());
        } catch (error) {
          reportError(error);
          halt();
          return;
        }
      }
      element.setAttribute('data-motion', stop ? 'running' : 'stopped');
    };

    // The observer is made again when the header starts or stops covering the top of the window.
    const header = matchMedia(HEADER_SCROLLS_AWAY);
    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      const covered = header.matches ? 0 : headerHeight();
      observer = new IntersectionObserver(entries => {
        const entry = entries.at(-1);
        if (entry) {
          state.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
          // The most of the art this window can show at once.
          const room = entry.rootBounds?.height ?? Infinity;
          state.reachable = Math.min(1, room / Math.max(1, entry.boundingClientRect.height));
        }
        reconcile();
      }, { rootMargin: `${-covered}px 0px 0px 0px`, threshold: THRESHOLDS });
      observer.observe(element);
    };
    if (typeof IntersectionObserver === 'undefined') {
      state.ratio = 1;
    } else {
      observe();
      header.addEventListener('change', observe);
    }
    document.addEventListener('visibilitychange', reconcile);
    const unfollow = scrubbed?.follow(reconcile);
    reconcile();
    return () => {
      observer?.disconnect();
      header.removeEventListener('change', observe);
      document.removeEventListener('visibilitychange', reconcile);
      unfollow?.();
      stop?.();
      // A handover cut short is finished: whoever has the time next starts from the story's end.
      if (dip !== null) {
        undip();
        state.seconds = story;
      }
      element.setAttribute('data-motion', 'stopped');
      element.removeAttribute('data-story-time');
    };
  }, [target, stage, paused, reduced, chosen, still, playFrom, story, departs, ready]);
}
