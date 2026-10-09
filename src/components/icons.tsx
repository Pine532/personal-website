const ARROWS = {
  'up-right': 'M5 15 15 5M5 5h10v10',
  down: 'M10 3v14M4 11l6 6 6-6',
  up: 'M10 17V3M4 9l6-6 6 6',
  back: 'M14 6 6 14M6 6v8h8',
};

/** Decorative stroke icons. The accompanying text carries the meaning, so they are hidden from assistive technology. */
export function Arrow({ direction = 'up-right' }: { direction?: keyof typeof ARROWS }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={ARROWS[direction]} />
    </svg>
  );
}

export function Playback({ paused }: { paused: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={paused ? 'm7 4 9 6-9 6V4Z' : 'M7 5v10M13 5v10'} />
    </svg>
  );
}
