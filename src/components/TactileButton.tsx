import { useEffect, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type PointerEvent } from 'react';

// How far the face drifts toward the pointer, in pixels from center.
const PULL_X = 2;
const PULL_Y = 1.5;
// A slightly underdamped spring, integrated at a fixed 120 Hz so it behaves the same on any display.
const STIFFNESS = 320;
const DAMPING = 32;
const STEP = 1 / 120;
const AT_REST = 0.015;
// Only a pointer that can hover gets the drift, and reduced motion never does.
const FINE_POINTER = matchMedia('(hover: hover) and (pointer: fine)');
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');

/**
 * The tactile response shared by buttons and links: the face drifts slightly toward a fine
 * pointer and a reflection follows it. Only the inner .button-motion layer moves, so the real
 * target stays put. Touch input and reduced motion get no drift. Once the pointer has gone the
 * reflection goes back to where it rests: facing the Sun, where the Sun lights the control
 * (hooks/useLitControls.ts).
 */
function useTactile() {
  const face = useRef<HTMLSpanElement>(null);
  const spring = useRef({ x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0, frame: 0, last: 0, remainder: 0 });

  function paint() {
    const s = spring.current;
    face.current?.style.setProperty('--pull-x', `${s.x.toFixed(3)}px`);
    face.current?.style.setProperty('--pull-y', `${s.y.toFixed(3)}px`);
  }

  function tick(now: number) {
    const s = spring.current;
    s.remainder += Math.min((now - s.last) / 1000, 0.05);
    s.last = now;
    while (s.remainder >= STEP) {
      s.vx += ((s.targetX - s.x) * STIFFNESS - s.vx * DAMPING) * STEP;
      s.vy += ((s.targetY - s.y) * STIFFNESS - s.vy * DAMPING) * STEP;
      s.x += s.vx * STEP;
      s.y += s.vy * STEP;
      s.remainder -= STEP;
    }
    paint();
    const moving = Math.abs(s.targetX - s.x) + Math.abs(s.targetY - s.y) + Math.abs(s.vx) + Math.abs(s.vy) > AT_REST;
    if (moving) {
      s.frame = requestAnimationFrame(tick);
    } else {
      // Settle exactly on the target and stop the loop.
      Object.assign(s, { x: s.targetX, y: s.targetY, vx: 0, vy: 0, frame: 0 });
      paint();
    }
  }

  function pullTo(x: number, y: number) {
    const s = spring.current;
    s.targetX = x;
    s.targetY = y;
    if (!s.frame) {
      s.last = performance.now();
      s.frame = requestAnimationFrame(tick);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!FINE_POINTER.matches || REDUCED_MOTION.matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    pullTo((x - 0.5) * 2 * PULL_X, (y - 0.5) * 2 * PULL_Y);
    face.current?.style.setProperty('--reflection-x', `${x * 100}%`);
    face.current?.style.setProperty('--reflection-y', `${y * 100}%`);
  }

  useEffect(() => {
    const s = spring.current;
    function reset() {
      cancelAnimationFrame(s.frame);
      Object.assign(s, { x: 0, y: 0, vx: 0, vy: 0, targetX: 0, targetY: 0, frame: 0, remainder: 0 });
      paint();
    }
    document.addEventListener('visibilitychange', reset);
    REDUCED_MOTION.addEventListener('change', reset);
    return () => {
      reset();
      document.removeEventListener('visibilitychange', reset);
      REDUCED_MOTION.removeEventListener('change', reset);
    };
  }, []);

  const release = () => {
    pullTo(0, 0);
    face.current?.style.removeProperty('--reflection-x');
    face.current?.style.removeProperty('--reflection-y');
  };
  return { face, events: { onPointerMove, onPointerLeave: release, onPointerCancel: release, onBlur: release } };
}

type Variant = 'primary' | 'secondary';
// The tactile response owns these handlers, so a caller cannot pass its own.
type Reserved = 'onPointerMove' | 'onPointerLeave' | 'onPointerCancel' | 'onBlur';
type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, Reserved> & { variant: Variant };
type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, Reserved> & { href: string; variant?: Variant };

const classNames = (variant: Variant, extra?: string) => `tactile-button tactile-button--${variant}${extra ? ` ${extra}` : ''}`;
// Where the control's edges show the Sun's light (styles/light.css); empty otherwise.
const litEdge = <span className="lit-edge" aria-hidden="true" />;

/** A button that does something on the page (the scene controls). */
export function TactileButton({ children, variant, className, ...props }: ButtonProps) {
  const { face, events } = useTactile();
  return (
    <button {...props} {...events} className={classNames(variant, className)}>
      <span className="button-motion" ref={face}><span className="button-surface">{children}{litEdge}</span></span>
    </button>
  );
}

/** The same control as a link, for actions that go somewhere (View my work, email). */
export function TactileLink({ children, variant = 'primary', className, ...props }: LinkProps) {
  const { face, events } = useTactile();
  return (
    <a {...props} {...events} className={classNames(variant, className)}>
      <span className="button-motion" ref={face}><span className="button-surface">{children}{litEdge}</span></span>
    </a>
  );
}
