import { useCallback, useEffect, useState } from 'react';

// Chrome's Data Saver, or a connection the browser itself classes as 2G: keep the still until asked.
export const LESS_DATA = prefersLessData();

/** What the footage is doing, as components/CornerSun.tsx reports it. */
export type MediaStatus = 'still' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';

function prefersLessData() {
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };
  return connection?.saveData === true || connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g';
}

export type SunMotion = {
  /** What the visitor has asked for: whether the footage plays. CornerSun reports what actually
      happened through onStatus. */
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
  /** Sets the switch outright (the terminal's `sun pause`, `sun play` and `sun`). */
  set: (command: 'play' | 'pause' | 'toggle') => void;
  onStatus: (status: MediaStatus) => void;
};

/**
 * The visitor's say over the Sun's motion, which is its footage: the simulated Sun turns about its
 * axis once in each loop, the observed Sun moves as the real one did, and the still, the loop's
 * first frame, does not move. It is one switch with two handles: the control under the Sun in the
 * corner (components/CornerSun.tsx), and the terminal's `sun` command (src/terminal/commands.ts).
 *
 * A visitor who prefers reduced motion, or is saving data, has the still until Play is pressed.
 * Footage that fails, or that the browser will not start by itself, turns the switch off: what is on
 * show stays, and the control offers Play (or Retry) to ask for the footage again.
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
  const set = useCallback((command: 'play' | 'pause' | 'toggle') => {
    if (command === 'toggle') return toggle();
    if (command === 'play' && failed) setRetry(value => value + 1);
    setPlaying(command === 'play');
  }, [failed, toggle]);

  return { playing, asked, status, retry, label: failed ? 'Retry motion' : playing ? 'Pause motion' : 'Play motion', toggle, set, onStatus };
}
