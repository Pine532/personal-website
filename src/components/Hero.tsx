import { profile } from '../content';
import type { Action } from '../terminal/commands';
import { Terminal } from './Terminal';

/** The opening: the statement, set large, with the line beside it, and the terminal beneath them. */
export function Hero({ onAction }: { onAction: (action: Action) => void }) {
  return (
    <section id="top" className="hero" aria-labelledby="hero-heading">
      <div className="hero-top grid">
        <h1 id="hero-heading" className="hero-headline" tabIndex={-1}>
          <span className="sr-only">{profile.name}. </span>{profile.headline}
        </h1>
        <p className="hero-descriptor label">{profile.descriptor}</p>
      </div>
      <Terminal onAction={onAction} />
    </section>
  );
}
