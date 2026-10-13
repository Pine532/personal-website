import { useEffect, useRef, useState } from 'react';
import { sunVariant } from '../media';
import { subscribeSuns } from '../sunPlace';
import { SunStill } from './SunStill';

export type MediaStatus = 'still' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';

type Props = {
  /** Whether the visitor wants motion. Playback also pauses while the Sun is off screen or too small for its footage, and in hidden tabs. */
  playing: boolean;
  zoomed: boolean;
  reduced: boolean;
  onStatus: (status: MediaStatus) => void;
  /** Increment to reload the footage after a failure. */
  retry: number;
};

// 1.2x the video's own pace: the eight-second loop plays in about 6.7 seconds.
const PLAYBACK_RATE = 1.2;
// The footage is shown once data arrives this much faster than it plays, measured over at
// least SAMPLE_SECONDS. A slower connection waits until the whole loop has arrived.
const SMOOTH_MARGIN = 1.25;
const SAMPLE_SECONDS = 0.6;
// The still is the loop's first frame. Footage this close to its start simply takes over from
// the still; later than that, it returns to the start first, so the hand-over shows no jump.
const SEAMLESS_SECONDS = 0.2;

/**
 * The Sun: a still with one native video over it (the simulation or the NASA footage, see
 * media.ts). It is the one Sun of the whole page: the square around it, .solar-position, is what
 * hooks/useSunDock.ts takes from the hero to the window's corner and down to the closing box. The
 * video keeps its own time and nothing else touches it.
 */
export function SolarScene({ playing, zoomed, reduced, onStatus, retry }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const wantsMotion = useRef(playing);
  const reconcilePlayback = useRef<() => void>(() => {});
  // The video is set up only once motion has been requested, so reduced-motion visitors
  // download nothing until they press Play.
  const [activated, setActivated] = useState(playing);
  const [ready, setReady] = useState(false);
  const variant = sunVariant();

  useEffect(() => {
    wantsMotion.current = playing;
    if (playing) setActivated(true);
    reconcilePlayback.current();
  }, [playing]);

  useEffect(() => {
    const media = video.current;
    if (!media || !activated) return;
    // Until the first intersection report arrives, treat the Sun as out of view: a visitor who
    // opens a link to a later section fetches none of the footage.
    let inWindow = typeof IntersectionObserver === 'undefined';
    // Whether the footage is on show (sunPlace.ts): not while the Sun is off screen or behind the
    // header, and not in a corner where its disc is too small for it.
    let shown = false;
    let attached = false;
    let revealed = false;
    let disposed = false;
    let failed = false;
    // Each play() or pause() request gets a number, so a stale play() rejection is ignored.
    let attempt = 0;
    // Where buffering stood when it was first measured.
    let sample: { time: number; end: number } | null = null;

    setReady(false);
    media.muted = true;
    media.defaultPlaybackRate = PLAYBACK_RATE;
    media.playbackRate = PLAYBACK_RATE;

    const fail = () => {
      failed = true;
      attempt++;
      setReady(false);
      onStatus('error');
    };
    /** Requests the footage, the first time it is wanted on screen. */
    const attach = () => {
      if (attached) return;
      attached = true;
      onStatus('loading');
      media.src = variant.source;
      media.load();
    };
    /** Plays when motion is wanted and the Sun is on screen in a visible tab; otherwise pauses. */
    const reconcile = () => {
      if (disposed || failed) return;
      if (!wantsMotion.current || !inWindow || !shown || document.hidden) {
        attempt++;
        media.pause();
        return;
      }
      attach();
      const current = ++attempt;
      media.play().catch(error => {
        if (disposed || current !== attempt || error.name === 'AbortError') return;
        if (error.name === 'NotAllowedError') onStatus('blocked');
        else fail();
      });
    };
    /** True when the footage can keep moving: the whole loop has arrived, or data outruns playback. */
    const canPlaySmoothly = () => {
      const buffered = media.buffered;
      if (!buffered.length || !Number.isFinite(media.duration)) return false;
      const end = buffered.end(buffered.length - 1);
      if (end >= media.duration - 0.05) return true;
      const time = performance.now();
      if (!sample) {
        sample = { time, end };
        return false;
      }
      const seconds = (time - sample.time) / 1000;
      return seconds > SAMPLE_SECONDS && (end - sample.end) / seconds > media.playbackRate * SMOOTH_MARGIN;
    };
    const show = () => {
      if (disposed || failed || media.paused) return;
      setReady(true);
      onStatus('playing');
    };
    /** Shows the footage. Until it can play without stalling, it keeps loading beneath the still. */
    const reveal = () => {
      if (disposed || failed || media.paused) return;
      if (revealed) {
        show();
      } else if (!canPlaySmoothly()) {
        onStatus('loading');
      } else {
        revealed = true;
        if (media.currentTime <= SEAMLESS_SECONDS) {
          show();
        } else {
          media.addEventListener('seeked', show, { once: true });
          media.currentTime = 0;
        }
      }
    };
    const revealWhenSmooth = () => {
      if (!revealed) reveal();
    };
    const onPause = () => {
      // Loading may idle while paused, so measure afresh on return.
      sample = null;
      if (!failed) onStatus('paused');
    };
    // Playback has stopped to wait for data (a connection that slowed, or Play pressed mid-load).
    const onWaiting = () => {
      if (!failed) onStatus('loading');
    };

    media.addEventListener('playing', reveal);
    media.addEventListener('progress', revealWhenSmooth);
    media.addEventListener('timeupdate', revealWhenSmooth);
    media.addEventListener('suspend', revealWhenSmooth);
    media.addEventListener('pause', onPause);
    media.addEventListener('waiting', onWaiting);
    media.addEventListener('error', fail);
    document.addEventListener('visibilitychange', reconcile);
    // Watch the disk itself, not the scene around it. The Sun's place adds what the window cannot
    // know: decoding stops as soon as the footage cannot be seen, behind the header or under the
    // still of a small Sun, and it goes on wherever a large one travels or stands.
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      inWindow = entries[entries.length - 1]?.isIntersecting ?? true;
      reconcile();
    });
    observer?.observe(media);
    const stopFollowingSun = subscribeSuns(({ main }) => {
      const next = !!main && main.footage;
      if (next === shown) return;
      shown = next;
      reconcile();
    });
    reconcilePlayback.current = reconcile;
    reconcile();

    return () => {
      disposed = true;
      attempt++;
      reconcilePlayback.current = () => {};
      observer?.disconnect();
      stopFollowingSun();
      document.removeEventListener('visibilitychange', reconcile);
      media.removeEventListener('playing', reveal);
      media.removeEventListener('progress', revealWhenSmooth);
      media.removeEventListener('timeupdate', revealWhenSmooth);
      media.removeEventListener('suspend', revealWhenSmooth);
      media.removeEventListener('seeked', show);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('waiting', onWaiting);
      media.removeEventListener('error', fail);
      media.pause();
    };
  }, [activated, onStatus, retry, variant]);

  return (
    <div className={zoomed ? 'solar-scene solar-scene--close' : 'solar-scene'} aria-hidden="true" data-still={reduced && !playing}>
      <div className="solar-position">
        <div className="solar-plane">
          <SunStill className="solar-media" fetchPriority="high" />
          <video
            ref={video}
            className={ready ? 'solar-media solar-video solar-video--ready' : 'solar-media solar-video'}
            muted
            loop
            playsInline
            preload="metadata"
            disablePictureInPicture
            tabIndex={-1}
          />
        </div>
      </div>
    </div>
  );
}
