import { useCallback, useEffect, useState } from 'react';
import type { MediaStatus } from '../components/SolarScene';

// Chrome's Data Saver, or a connection the browser itself classes as 2G: keep the still until asked.
export const LESS_DATA = prefersLessData();

function prefersLessData() {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
  return connection?.saveData === true || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g';
}

export type SunMotion = {
  /** What the visitor has asked for. SolarScene reports what actually happened through onStatus. */
  playing: boolean;
  /** Whether motion has been on at all in this visit. A visitor who prefers reduced motion or is
      saving data, and has never pressed Play, is not offered the control a second time. */
  asked: boolean;
  status: MediaStatus;
  /** Incremented to reload the footage after a failure. */
  retry: number;
  /** What pressing a motion control will do, which is also what it is called. */
  label: string;
  toggle: () => void;
  onStatus: (status: MediaStatus) => void;
};

/**
 * The visitor's say over the Sun's motion. It is one switch with two handles: the control in the
 * hero, and one in the header for as long as the footage plays away from the hero, in the corner
 * and on its way down (components/SiteHeader.tsx), so that it can be stopped from wherever it is
 * seen moving. The closing box's own Sun follows the same switch (components/ClosingSun.tsx).
 */
export function useSunMotion(reduced: boolean): SunMotion {
  const [playing, setPlaying] = useState(!reduced && !LESS_DATA);
  const [asked, setAsked] = useState(playing);
  const [status, setStatus] = useState<MediaStatus>('still');
  const [retry, setRetry] = useState(0);

  const onStatus = useCallback((next: MediaStatus) => {
    // A pause that follows a failure or a blocked autoplay must not hide that message.
    setStatus(previous => (next === 'paused' && (previous === 'error' || previous === 'blocked') ? previous : next));
    if (next === 'error' || next === 'blocked') setPlaying(false);
  }, []);

  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  useEffect(() => {
    if (playing) setAsked(true);
  }, [playing]);

  const failed = status === 'error';
  const toggle = useCallback(() => {
    if (failed) setRetry(value => value + 1);
    setPlaying(value => !value);
  }, [failed]);

  return { playing, asked, status, retry, label: failed ? 'Retry motion' : playing ? 'Pause motion' : 'Play motion', toggle, onStatus };
}
