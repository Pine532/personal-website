import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sun } from '../content';
import type { SunMotion } from '../hooks/useSunMotion';
import { SUN_MEDIA } from '../media';

// Where the disc is at least 96 CSS px across (styles/sun.css: tablets and up) the footage plays;
// a phone's corner shows the still and downloads no video.
export const FOOTAGE_QUERY = '(min-width: 701px) and (min-height: 500px)';
// The still first appears in coarse blocks that sharpen in a few steps: the sides of the canvas it
// is drawn into on the way, and how long each step shows.
const RESOLVE_STEPS = [6, 12, 24, 48];
const RESOLVE_MS = 90;

/**
 * The Sun, fixed in the window's upper-right corner (styles/sun.css sizes it): its still, with the
 * footage over it once that is playing. The footage is the Sun's only motion; the simulated Sun turns
 * about its axis once in each sixteen-second loop. `motion` is the visitor's switch for it
 * (hooks/useSunMotion.ts); the control for that stands under the Sun with its credit. The video
 * loads only once motion is wanted, so reduced-motion and data-saving visitors download nothing
 * until they press Play, and it pauses in a hidden tab.
 */
export function CornerSun({ motion }: { motion: SunMotion }) {
  const still = useRef<HTMLImageElement>(null);
  const pixels = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const attached = useRef(false);
  const [whole, setWhole] = useState(false);
  const [ready, setReady] = useState(false);
  const [large, setLarge] = useState(() => matchMedia(FOOTAGE_QUERY).matches);
  const { playing, retry, onStatus } = motion;

  useEffect(() => {
    const query = matchMedia(FOOTAGE_QUERY);
    const update = () => setLarge(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // The still is shown only once all of it has arrived, so a slow connection never paints part of a Sun.
  useLayoutEffect(() => {
    const image = still.current;
    if (!image) return;
    const show = () => setWhole(true);
    if (image.complete) {
      if (image.naturalWidth > 0) show();
      return;
    }
    image.addEventListener('load', show);
    return () => image.removeEventListener('load', show);
  }, []);

  // The still resolves from blocks: drawn small into a canvas shown pixelated over it, in steps.
  useEffect(() => {
    const image = still.current;
    const canvas = pixels.current;
    if (!whole || !image || !canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let step = 0;
    let timer = 0;
    const draw = () => {
      const side = RESOLVE_STEPS[step];
      if (side === undefined) {
        canvas.dataset.shown = 'false';
        return;
      }
      canvas.width = side;
      canvas.height = side;
      context.drawImage(image, 0, 0, side, side);
      canvas.dataset.shown = 'true';
      step += 1;
      timer = window.setTimeout(draw, RESOLVE_MS);
    };
    draw();
    return () => {
      window.clearTimeout(timer);
      canvas.dataset.shown = 'false';
    };
  }, [whole]);

  useEffect(() => {
    attached.current = false;
  }, [retry]);

  useEffect(() => {
    const media = video.current;
    if (!media || !large) return;
    let disposed = false;
    let attempt = 0;
    media.muted = true;
    // A video element that has just been put in (the window grown past the footage threshold) has no footage yet.
    if (!media.getAttribute('src')) attached.current = false;
    const attach = () => {
      if (attached.current) return;
      attached.current = true;
      onStatus('loading');
      media.src = SUN_MEDIA.source;
      media.load();
    };
    /** Plays when motion is wanted in a visible tab; otherwise pauses. */
    const reconcile = () => {
      if (disposed) return;
      if (!playing || document.hidden) {
        attempt += 1;
        media.pause();
        return;
      }
      attach();
      const current = ++attempt;
      media.play().catch(error => {
        if (disposed || current !== attempt || error.name === 'AbortError') return;
        onStatus(error.name === 'NotAllowedError' ? 'blocked' : 'error');
      });
    };
    const onPlaying = () => {
      setReady(true);
      onStatus('playing');
    };
    const onPause = () => onStatus('paused');
    const onWaiting = () => onStatus('loading');
    const onError = () => {
      // Footage that fails before it has shown leaves the still; failed footage that had shown keeps its last frame.
      if (media.readyState < 2) setReady(false);
      onStatus('error');
    };
    media.addEventListener('playing', onPlaying);
    media.addEventListener('pause', onPause);
    media.addEventListener('waiting', onWaiting);
    media.addEventListener('error', onError);
    document.addEventListener('visibilitychange', reconcile);
    reconcile();
    return () => {
      disposed = true;
      attempt += 1;
      media.removeEventListener('playing', onPlaying);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('waiting', onWaiting);
      media.removeEventListener('error', onError);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [playing, large, retry, onStatus]);

  return (
    <>
      {/* Footage that has shown stays up when paused, holding the frame it reached. */}
      <div className="corner-sun" aria-hidden="true" data-whole={whole} data-ready={ready && large}>
        <div className="corner-sun-disc">
          <img ref={still} className="corner-sun-media corner-sun-still" src={SUN_MEDIA.still} width={SUN_MEDIA.pixels} height={SUN_MEDIA.pixels} alt="" fetchPriority="high" />
          <canvas ref={pixels} className="corner-sun-media corner-sun-pixels" width={6} height={6} data-shown="false" />
          {large && <video ref={video} className="corner-sun-media corner-sun-video" muted loop playsInline preload="none" disablePictureInPicture tabIndex={-1} />}
        </div>
      </div>
      <div className="corner-sun-caption label">
        {sun.credit && (
          <a href={sun.credit.href} target="_blank" rel="noreferrer">
            {sun.credit.title}<span className="sr-only"> ({sun.credit.spoken}; opens in a new tab)</span>
          </a>
        )}
        <a href={sun.more.href} target="_blank" rel="noreferrer">
          {sun.more.label}<span className="sr-only"> ({sun.more.spoken}; opens in a new tab)</span>
        </a>
        {large && (
          <button type="button" className="corner-sun-toggle" onClick={motion.toggle} aria-label={`${motion.label} of the Sun`}>
            {motion.status === 'error' ? 'Retry' : playing ? 'Pause' : 'Play'}
          </button>
        )}
      </div>
    </>
  );
}
