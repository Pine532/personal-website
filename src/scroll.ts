// The page's scroll position, for everything that follows it: the page's state for the header and
// the Sun (hooks/usePageState.ts), the index of work, the project stages, and the navigation's
// current section. One passive
// listener and one frame for all of them, and one reading of the position. It is read as the scroll
// event arrives, before anything is written in that frame, so the read never makes the browser lay
// the page out a second time. (While a CSS transition is running, the header's name fading in for
// one, the read has the browser bring that one element's style up to date a little early; nothing
// more.) The followers then only work things out and write.

type Follower = (scroll: number) => void;

const followers = new Set<Follower>();
let frame = 0;
let scroll = 0;

function run() {
  frame = 0;
  for (const follower of followers) follower(scroll);
}

function onScroll() {
  scroll = window.scrollY;
  if (!frame) frame = requestAnimationFrame(run);
}

/** Calls `follower` with the scroll position, once in each frame in which the page has scrolled.
    Followers are called in the order they began. Returns the way to stop. */
export function followScroll(follower: Follower) {
  if (followers.size === 0) window.addEventListener('scroll', onScroll, { passive: true });
  followers.add(follower);
  return () => {
    followers.delete(follower);
    if (followers.size > 0) return;
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(frame);
    frame = 0;
  };
}
