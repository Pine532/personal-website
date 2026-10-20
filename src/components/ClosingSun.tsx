import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useClosingSunPlace } from '../hooks/useClosingSunPlace';
import { sunVariant } from '../media';
import { sunLands, watchSunLands } from '../sunPlace';
import { SunStill } from './SunStill';

// The hero's pace (components/SolarScene.tsx): the footage's own.
const PLAYBACK_RATE = 1.0;

/**
 * The box the page closes on, beside "Get in touch.". Where the Sun has a way down from its corner
 * (hooks/useSunDock.ts), this is where it lands, and the box shows nothing of its own: it only
 * keeps the place. Everywhere else it shows a Sun of its own: the still, with the hero's footage
 * over it while it is on screen. That is the file the hero has already loaded, and it is requested
 * only when this Sun is first seen with motion wanted. `moving` is whether the visitor wants the
 * footage playing (hooks/useSunMotion.ts: Pause motion stops both Suns), so a visitor who prefers
 * reduced motion or is saving data keeps the still, which does not move: it is the loop's first
 * frame. If the footage cannot play, the still stays; footage that fails once it has shown keeps the
 * frame it stopped on, the same face of the Sun, rather than giving way to the loop's first. Like the
 * Sun itself it lights the page around it, so it says where it is, and whether its footage is up
 * (hooks/useClosingSunPlace.ts). A Sun standing in the corner fades out as this one comes up into the
 * window (hooks/useSunDock.ts), so the page ends on one Sun.
 */
export function ClosingSun({ moving }: { moving: boolean }) {
  const square = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const variant = sunVariant();
  // Whether the box shows its own Sun: not where the Sun itself comes down to it.
  const own = !useSyncExternalStore(watchSunLands, sunLands, () => false);
  useClosingSunPlace(square, own, ready);

  useEffect(() => {
    const media = video.current;
    if (!media) return;
    let visible = typeof IntersectionObserver === 'undefined';
    let disposed = false;
    const reconcile = () => {
      if (disposed) return;
      if (!own || !moving || !visible || document.hidden) {
        media.pause();
        return;
      }
      if (!media.getAttribute('src')) {
        media.muted = true;
        media.defaultPlaybackRate = PLAYBACK_RATE;
        media.playbackRate = PLAYBACK_RATE;
        media.src = variant.source;
      }
      // A refused or failed play leaves the still showing, or the frame the footage stopped on.
      media.play().catch(() => {});
    };
    const show = () => setReady(true);
    media.addEventListener('playing', show);
    document.addEventListener('visibilitychange', reconcile);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries.at(-1)?.isIntersecting ?? visible;
      reconcile();
    });
    observer?.observe(media);
    reconcile();
    return () => {
      disposed = true;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', reconcile);
      media.removeEventListener('playing', show);
      media.pause();
    };
  }, [own, moving, variant]);

  return (
    <div className="closing-sun" ref={square} aria-hidden="true">
      <SunStill loading="lazy" decoding="async" />
      <video ref={video} className="closing-video" data-ready={ready} muted loop playsInline preload="none" disablePictureInPicture tabIndex={-1} />
    </div>
  );
}
