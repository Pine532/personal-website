// Where the page's Suns are on screen. There is one Sun, the hero's own: it rests in the hero, rides
// up into the window's upper-right corner and stays there, and where it has a way down it leaves the
// corner at the end of the page and comes to rest in the closing box. hooks/useSunDock.ts moves it,
// and says where it is in the same frame. Where it has no way down, the closing box shows a Sun of
// its own, the corner's fades out as that one comes into the window, and
// hooks/useClosingSunPlace.ts says where that one is. components/Sunlight.tsx lights
// the page from both, hooks/useLitText.ts and hooks/useLitControls.ts turn the lit edges of the
// letters and the controls toward them, and components/SolarScene.tsx plays the footage by the first.

export type SunPlace = {
  /** The center of its disc, in pixels from the window's left and top edges. */
  x: number;
  y: number;
  /** The radius of its disc in pixels: the edge of the Sun itself, without its fringe. */
  r: number;
  /** How much of its light reaches the page, from 0 to 1. Less than all of it while the header
      covers part of the disc, while a Sun that has just appeared in the corner comes in, and while
      the corner's Sun gives way to the closing box's own at the end of the page. */
  light: number;
};

/** The Sun itself also says where it is on its travels: in the hero or on its way up from it, at
    rest in the corner, or on its way down to the closing box (and in it). And whether its footage
    shows: a disc too small for the footage shows its still. */
export type MainSun = SunPlace & { sun: 'hero' | 'corner' | 'closing'; footage: boolean };

/** The closing box's own Sun rides the page, so it also says where it is on the page: how far
    below its center the page ends. That does not change as the page scrolls. */
export type ClosingSun = SunPlace & { foot: number };

export type Suns = {
  /** Null means the Sun is not on screen: it has left with the hero and has no corner to stand in,
      or has not come into it yet, or has given way to the closing box's own at the page's end. */
  main: MainSun | null;
  /** Null means the closing box has no Sun of its own just now (the Sun itself comes down to it), or
      that one is too far from the window for any of its light to reach it. */
  closing: ClosingSun | null;
};

type Listener = (suns: Suns) => void;

let current: Suns = { main: null, closing: null };
const listeners = new Set<Listener>();

const samePlace = (one: SunPlace | null, other: SunPlace | null) =>
  one === other || (!!one && !!other && one.x === other.x && one.y === other.y && one.r === other.r && one.light === other.light);

function publish(suns: Suns) {
  current = suns;
  for (const listener of listeners) listener(current);
}

/** Says where the Sun is now. */
export function publishMainSun(place: MainSun | null) {
  if (samePlace(place, current.main) && place?.sun === current.main?.sun && place?.footage === current.main?.footage) return;
  publish({ ...current, main: place });
}

/** Says where the closing box's own Sun is now. */
export function publishClosingSun(place: ClosingSun | null) {
  if (samePlace(place, current.closing) && place?.foot === current.closing?.foot) return;
  publish({ ...current, closing: place });
}

/** Calls `listener` with both Suns' places at once, then each time either changes. Returns the way to stop. */
export function subscribeSuns(listener: Listener) {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

// Whether the Sun has a way down to the closing box (hooks/useSunDock.ts decides, whenever the
// layout changes). While it has, the box shows nothing of its own: the Sun that arrives is the Sun.
let landing = false;
const watchers = new Set<() => void>();

/** Says whether the Sun comes down to close the page. */
export function setSunLands(lands: boolean) {
  if (lands === landing) return;
  landing = lands;
  for (const watcher of watchers) watcher();
}

/** Whether the Sun comes down to close the page. */
export function sunLands() {
  return landing;
}

/** Calls `listener` whenever the answer of sunLands() has changed. Returns the way to stop. */
export function watchSunLands(listener: () => void) {
  watchers.add(listener);
  return () => {
    watchers.delete(listener);
  };
}
