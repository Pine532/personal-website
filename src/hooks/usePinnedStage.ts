import { createContext, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { headerHeight } from '../layout';
import { followScroll } from '../scroll';

// A project's visual stands on a stage (components/ProjectStage.tsx): a track taller than the visual by
// two scroll distances, in which the visual is sticky. It comes to rest in the middle of the window and
// stays while the page scrolls through the first distance, the scrub, which tells its story; it stays
// through the second, the hold, while the project's text comes up from the foot of the window to meet
// it; then it leaves with the page. The stylesheet does all of that (styles/work.css); nothing here
// moves anything. This file decides whether a stage pins at all, tells the stylesheet how tall the
// pinned block is, and works out where in its scrub and hold each stage is: the visual's clock turns
// that into the story's time (hooks/useVisualClock.ts), and the controls' lit edges into where a pinned
// control really is (hooks/useLitControls.ts).
//
// Sizes and places are measured ahead of time, all stages in one pass, whenever the layout can have
// changed. While the page scrolls nothing is measured: scroll.ts gives the position, once a frame.
//
// A stage that starts or stops pinning makes the page taller or shorter around whoever is reading it
// (reduced motion asked for part-way down, a window dragged shorter). The visual that was in the window
// is then put back where it stood, so neither it nor a control in focus under it is thrown out of sight.

/** What a visual is told by the stage it stands on. */
export type Stage = {
  /** The stage pins, and scrolling tells the visual's story. */
  pinned: boolean;
  /** The story's length the stage was laid out for, in seconds (components/visuals/scenes.ts). */
  story: number;
  /** How far through the scrub the page is: 0 until the stage has come to rest, 1 from the scrub's end on. */
  progress(): number;
  /** The page has scrolled through the hold too: the block has let go and rides the page again. */
  released(): boolean;
  /** Places the stages for where the page is at this instant. They are otherwise placed a frame after
      the page scrolls, which is too late for a visual drawing its first frame in that same frame (a
      reloaded page being put back where it was): it would draw the place the page has just left. It
      reads the page's position, so it is not for the scroll's own path. */
  arrive(): void;
  /** Calls `listener` whenever either of those has changed. Returns the way to stop. */
  follow(listener: () => void): () => void;
  /** Gives the stage the scene's named moments (visuals/types.ts), for the figures that answer them,
      and the moment the visual shows as they arrive, in seconds. */
  cue(beats: Readonly<Record<string, number>> | undefined, seconds: number): void;
  /** Tells the stage which moment of the story its visual now shows, in seconds. */
  show(seconds: number): void;
};

export const StageContext = createContext<Stage | null>(null);

// A stage pins only where it can: for a visitor who has not asked for less motion, in a window tall
// enough to keep its header (styles/hero.css). styles/work.css asks the first question in the same
// words, and adds that the page is on a screen.
const ABLE = '(prefers-reduced-motion: no-preference)';
// The second is answered here alone, in pixels. The window's height is taken at its smallest, the 100svh
// the stylesheet rests a block by, from an element the stylesheet makes exactly that tall
// (components/Work.tsx). It does not change as a phone's toolbars come and go, so no stage starts or
// stops pinning under a thumb; and a browser that does not know the unit gives the element no height,
// so nothing pins there and the visuals play by their clocks.
const TALL = 600;
// On paper the stylesheet lays the stages flat by itself, and nothing here is measured or changed: the
// page that comes back from the print dialog is then the one that went in (hooks/usePrintExpansion.ts
// sees that it comes back at the same place).
const PRINT = 'print';
// And only when the pinned block fits below the header with this much room above and below it.
const CLEAR = 24;

/** 'whole': a stage with figures above its visual pins the two as one block. 'visual': the visual pins
    alone (the only way, for a stage without figures). */
type Mode = 'off' | 'visual' | 'whole';

type Entry = {
  track: HTMLElement;
  mode: Mode;
  /** The pinned block's height, as written to --stage-height; negative until the stage is first measured. */
  height: number;
  /** What the stylesheet makes sticky: the pin, or the visual alone when the figures are left out of it. */
  block: HTMLElement | null;
  /** The scroll position at which the block comes to rest, then how far the page scrolls through its
      story, and how far again while the finished picture waits for the text. */
  start: number;
  scrub: number;
  hold: number;
  /** How far down the window the visual stands while its block is held. */
  rest: number;
  progress: number;
  released: boolean;
  listeners: Set<() => void>;
  /** The figures above the visual that wait for a moment of its story. */
  figures: { element: HTMLElement; beat: string }[];
  beats: Readonly<Record<string, number>> | null;
  shown: number;
  /** Tells React whether the stage pins. */
  pins: (pinned: boolean) => void;
};

const entries = new Set<Entry>();
const within = (value: number) => Math.max(0, Math.min(1, value));
/** The element that is as tall as the window at its smallest. */
let smallest: HTMLElement | null = null;
/** The scroll position the stages were last placed for. */
let placed = 0;
/** How far a stage holds its block back down the page at a scroll position: nothing until the block
    comes to rest, then one for one with the page, through the scrub and the hold. */
const held = (entry: Entry, scroll: number) => (entry.block ? Math.max(0, Math.min(entry.scrub + entry.hold, scroll - entry.start)) : 0);

// Whoever places things by where the stages hold their blocks is told when that has been measured anew.
const watchers = new Set<() => void>();

/** Calls `listener` whenever the stages' places have changed. Returns the way to stop. */
export function watchStages(listener: () => void) {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}

/**
 * For something inside a stage's pinned block: how far the block is held back down the page at a
 * scroll position, in pixels. Nothing until the block comes to rest, then one for one with the page,
 * through the scrub and the hold. Null for anything that rides the page. It asks the stage each time,
 * so it stays right when the stages are measured again; no layout is read.
 */
export function heldBack(element: Element): ((scroll: number) => number) | null {
  for (const entry of entries) {
    if (entry.track.contains(element)) return scroll => (entry.block?.contains(element) ? held(entry, scroll) : 0);
  }
  return null;
}

/** Brings each waiting figure up to its full tone once the story has reached its moment, and takes it
    down again when the story goes back. Only figures pinned with their visual wait: everywhere else
    they are at full tone. Until the scene's moments are known, a stage the page has passed counts as told. */
function tone(entry: Entry) {
  for (const { element, beat } of entry.figures) {
    const at = entry.beats?.[beat];
    const told = at === undefined ? entry.progress >= 1 : entry.shown >= at;
    const next = entry.mode !== 'whole' || told ? 'full' : 'dim';
    if (element.dataset.tone !== next) element.dataset.tone = next;
  }
}

/** Works out where in its scrub and hold each stage is at this scroll position, and tells those for
    which that has changed. */
function place(scroll: number) {
  placed = scroll;
  for (const entry of entries) {
    const pinned = entry.mode !== 'off' && entry.scrub > 0;
    const past = scroll - entry.start;
    const progress = pinned ? within(past / entry.scrub) : 0;
    const released = pinned && past >= entry.scrub + entry.hold;
    if (progress === entry.progress && released === entry.released) continue;
    entry.progress = progress;
    entry.released = released;
    tone(entry);
    for (const listener of [...entry.listeners]) listener();
  }
}

function measure() {
  if (matchMedia(PRINT).matches) return;
  const tall = smallest?.getBoundingClientRect().height ?? 0;
  const header = headerHeight();
  const room = tall - header - 2 * CLEAR;
  const able = matchMedia(ABLE).matches && tall >= TALL;

  // First every stage's own sizes, which say whether it pins, and how.
  const sized = [...entries].map(entry => {
    const visual = entry.track.querySelector<HTMLElement>('.project-visual');
    const lead = entry.track.querySelector<HTMLElement>('.figures');
    // A visual that could not load has left the page.
    const box = visual?.getBoundingClientRect();
    const height = box?.height ?? 0;
    const above = lead ? lead.getBoundingClientRect().height + (parseFloat(getComputedStyle(lead).marginBottom) || 0) : 0;
    const fits = (block: number) => block <= room;
    const mode: Mode = !able || height <= 0 ? 'off' : lead && fits(above + height) ? 'whole' : fits(height) ? 'visual' : 'off';
    entry.figures = [...entry.track.querySelectorAll<HTMLElement>('.figure[data-beat]')].map(element => ({ element, beat: element.dataset.beat ?? '' }));
    // Where the visual stood in the window when the stages were last placed, and whether it was held
    // there at rest. For one that pinned this is worked out, not read: the stylesheet lets go by itself
    // when less motion is asked for, and by now its box may be somewhere else.
    const back = held(entry, placed);
    const stood = entry.block ? entry.start + entry.rest + back - placed : box?.top ?? 0;
    return { entry, visual, lead, above, mode, height: mode === 'whole' ? above + height : height, size: height, stood, rested: back > 0 && back < entry.scrub + entry.hold };
  });
  // The visual in the window, if its stage is about to start or stop pinning: it is put back below. Not
  // a stage measured for the first time, as the page opens: no one has been reading that page yet, and
  // where it opens is the browser's to say (a reload returns to its place by itself).
  const covered = tall >= TALL ? header : 0;
  const foot = document.documentElement.clientHeight;
  const kept = sized.find(({ entry, mode, size, stood }) => entry.height >= 0 && size > 0 && (mode === 'off') !== (entry.mode === 'off') && stood < foot && stood + size > covered);

  // Then what the stylesheet needs to know. A stage that starts or stops pinning changes the page's
  // height, so the places are read only after every one of these is written.
  for (const { entry, lead, mode, height } of sized) {
    const { track } = entry;
    const pinned = mode === 'off' ? 'off' : 'on';
    if (track.dataset.pinned !== pinned) track.dataset.pinned = pinned;
    if (lead) {
      const led = mode === 'whole' ? 'in' : 'out';
      if (track.dataset.lead !== led) track.dataset.lead = led;
    }
    if (height !== entry.height) {
      entry.height = height;
      track.style.setProperty('--stage-height', `${height}px`);
    }
  }

  // Where each pinned block comes to rest, and how long its scrub and its hold are: all three as the
  // stylesheet has them. The block's place is worked out from its track's, which rides the page, so it
  // does not matter where in its travel the block happens to be held just now.
  let moved = false;
  for (const { entry, visual, lead, above, mode } of sized) {
    const before = [entry.mode, entry.block, entry.start, entry.scrub, entry.hold] as const;
    entry.mode = 'off';
    entry.block = null;
    entry.start = 0;
    entry.scrub = 0;
    entry.hold = 0;
    entry.rest = 0;
    if (mode !== 'off' && visual) {
      // With figures left out of the pin, the visual itself is what sticks, below them.
      const apart = !!lead && mode === 'visual';
      const block = apart ? visual : entry.track.querySelector<HTMLElement>('.project-stage-pin');
      const top = block ? parseFloat(getComputedStyle(block).top) : NaN;
      const after = getComputedStyle(entry.track, '::after');
      const scrub = parseFloat(after.height);
      if (block && top >= 0 && scrub > 0) {
        entry.mode = mode;
        entry.block = block;
        // The page's position is read here, after the track's: the browser may have moved the page to
        // keep its own place in it when the stages changed height.
        entry.start = entry.track.getBoundingClientRect().top + window.scrollY + (apart ? above : 0) - top;
        entry.scrub = scrub;
        entry.hold = parseFloat(after.paddingBottom) || 0;
        entry.rest = top + (apart ? 0 : above);
      } else {
        // The stylesheet has not given the block a resting place or the story a distance that can be
        // read back, so the stage cannot pin after all: it is left as one that never did.
        entry.track.dataset.pinned = 'off';
      }
    }
    if ((before[0] === 'off') !== (entry.mode === 'off')) entry.pins(entry.mode !== 'off');
    if (before[0] !== entry.mode || before[1] !== entry.block || before[2] !== entry.start || before[3] !== entry.scrub || before[4] !== entry.hold) moved = true;
  }

  let scroll = window.scrollY;
  if (kept?.visual) {
    const { entry, visual, size, stood, rested } = kept;
    // Riding the page now, it goes back to its place in the window; one that was held at rest, in a
    // window that no longer has that place, as near to it as shows the whole of it. Pinning now, it had
    // yet to come to rest if it stood below its resting place, and has been let go if it stood above.
    const to = entry.block
      ? entry.start + entry.rest - stood + (stood < entry.rest ? entry.scrub + entry.hold : 0)
      : scroll + visual.getBoundingClientRect().top - (rested ? Math.max(covered + CLEAR, Math.min(stood, foot - size - CLEAR)) : stood);
    if (Math.abs(to - scroll) >= 1) {
      window.scrollTo(0, to);
      scroll = window.scrollY;
    }
  }

  // Each stage's place first, then its figures' tones, which follow from it.
  place(scroll);
  for (const entry of entries) tone(entry);
  if (moved) for (const watcher of [...watchers]) watcher();
}

/**
 * Keeps every stage measured. Called once, by the section that holds the stages, whose layout effect
 * runs after theirs: so the stages are all measured together, before the page is first drawn, and
 * the room each one's scrub and hold take is there from the start. `probe` is the element the
 * stylesheet makes as tall as the window at its smallest.
 */
export function usePinnedStages(probe: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    smallest = probe.current;
    measure();
    // Whatever changes a stage's size or moves it down the page (text that wraps differently, an opened
    // case note, a visual that could not load) changes the height of the page's body. The measuring waits
    // for the next frame, since it may itself change that height.
    let frame = 0;
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(soon);
    sizes?.observe(document.body);
    const able = matchMedia(ABLE);
    const print = matchMedia(PRINT);
    able.addEventListener('change', measure);
    print.addEventListener('change', measure);
    window.addEventListener('resize', measure);
    // The browser may restore a scroll position after layout effects have run.
    window.addEventListener('pageshow', measure);
    document.fonts?.addEventListener('loadingdone', soon);
    const stopFollowing = followScroll(place);

    return () => {
      cancelAnimationFrame(frame);
      sizes?.disconnect();
      able.removeEventListener('change', measure);
      print.removeEventListener('change', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pageshow', measure);
      document.fonts?.removeEventListener('loadingdone', soon);
      stopFollowing();
      smallest = null;
    };
  }, [probe]);
}

/**
 * One stage: `track` is its .project-stage element, laid out for a story of `story` seconds. Returns
 * what the visual on it needs to know. The data attributes and --stage-height on the track are this
 * hook's to write once it has mounted.
 */
export function usePinnedStage(track: RefObject<HTMLElement | null>, story: number): Stage {
  const [pinned, setPinned] = useState(false);
  const entry = useRef<Entry | null>(null);

  useLayoutEffect(() => {
    const element = track.current;
    if (!element) return;
    // One record for the life of the stage, so the visual that follows it is never left behind.
    const own = (entry.current ??= { track: element, mode: 'off', height: -1, block: null, start: 0, scrub: 0, hold: 0, rest: 0, progress: 0, released: false, listeners: new Set(), figures: [], beats: null, shown: 0, pins: setPinned });
    own.track = element;
    entries.add(own);
    return () => {
      entries.delete(own);
    };
  }, [track]);

  return useMemo<Stage>(() => ({
    pinned,
    story,
    progress: () => entry.current?.progress ?? 0,
    released: () => entry.current?.released ?? false,
    arrive: () => place(window.scrollY),
    follow(listener) {
      const own = entry.current;
      own?.listeners.add(listener);
      return () => {
        own?.listeners.delete(listener);
      };
    },
    cue(beats, seconds) {
      const own = entry.current;
      if (!own) return;
      own.beats = beats ?? null;
      own.shown = seconds;
      tone(own);
    },
    show(seconds) {
      const own = entry.current;
      if (!own || own.shown === seconds) return;
      own.shown = seconds;
      if (own.figures.length > 0) tone(own);
    },
  }), [pinned, story]);
}
