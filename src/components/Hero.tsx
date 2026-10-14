import { useEffect, useState, type MouseEvent } from 'react';
import { bareAddress, profile, sun } from '../content';
import { LESS_DATA, type SunMotion } from '../hooks/useSunMotion';
import { Arrow, Playback } from './icons';
import { SolarScene, type MediaStatus } from './SolarScene';
import { TactileButton, TactileLink } from './TactileButton';

// A load that takes longer than this is worth mentioning; a normal one is not. The footage is
// shown only once it can play without stalling (SolarScene), about a second on a fast connection.
const SLOW_LOAD_MS = 2500;

function statusMessage(status: MediaStatus, slowLoad: boolean, reduced: boolean, playing: boolean) {
  if (status === 'error') return 'Video unavailable. Showing a matching still.';
  if (status === 'blocked') return 'Autoplay was blocked. Select Play motion.';
  if (status === 'loading' && slowLoad) return sun.loading;
  if (reduced && !playing) return 'Still view · reduced motion';
  if (LESS_DATA && status === 'still') return 'Still view · saving data';
  return '';
}

/** `motion` is the visitor's say over the Sun's motion (hooks/useSunMotion.ts): the control here is
    one of its two handles. */
export function Hero({ reduced, motion }: { reduced: boolean; motion: SunMotion }) {
  const { playing, status, retry, onStatus } = motion;
  const [zoomed, setZoomed] = useState(false);
  // Keyboard-triggered zoom skips the transition (event.detail is 0 for keyboard activation).
  const [instantZoom, setInstantZoom] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);

  // The status line is a live region, so it only announces a load that is actually slow.
  useEffect(() => {
    if (status !== 'loading') {
      setSlowLoad(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowLoad(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const toggleZoom = (event: MouseEvent<HTMLButtonElement>) => {
    setInstantZoom(event.detail === 0);
    setZoomed(value => !value);
  };

  return (
    <section id="top" className="opening" aria-labelledby="hero-heading" data-instant={instantZoom || reduced}>
      <div className="hero">
        {/* Set in capitals; the label gives assistive technology the name as it is written. */}
        <h1 id="hero-heading" className="name-lockup" aria-label={profile.name} tabIndex={-1} translate="no">{profile.name.toUpperCase()}</h1>
        <div className="introduction">
          <p className="intro-copy">{profile.introduction}</p>
          {/* Shown only in print, where the Contact section is left out. */}
          <p className="print-only">
            <a href={`mailto:${profile.email}`}>{profile.email}</a> · <a href={profile.linkedin}>{bareAddress(profile.linkedin)}</a>
            {profile.github && <> · <a href={profile.github}>{bareAddress(profile.github)}</a></>} · {profile.location}
          </p>
          <div className="hero-primary">
            <TactileLink href="#work"><span>View my work</span><Arrow direction="down" /></TactileLink>
          </div>
        </div>
        <div className="hero-footer">
          <div className="scene-tools">
            {/* Each control names what pressing it will do, so neither needs a pressed state. */}
            <div className="hero-controls" role="group" aria-label="Solar scene controls">
              <TactileButton variant="secondary" className="zoom-control" onClick={toggleZoom}>
                <span>{zoomed ? 'Step back' : 'Look closer'}</span>
                <Arrow direction={zoomed ? 'back' : 'up-right'} />
              </TactileButton>
              <TactileButton variant="secondary" onClick={motion.toggle}>
                <Playback paused={!playing} />
                <span>{motion.label}</span>
              </TactileButton>
            </div>
            <p className="media-status" role="status">{statusMessage(status, slowLoad, reduced, playing)}</p>
          </div>
          <div className="solar-attribution">
            {/* The scene itself is hidden from assistive technology; this link is its description. */}
            {sun.credit && (
              <a className="source-credit" href={sun.credit.href} target="_blank" rel="noreferrer">
                <span>{sun.credit.title}</span>
                <span>
                  {sun.credit.detail} <Arrow />
                  <span className="sr-only"> ({sun.credit.spoken}; opens in a new tab)</span>
                </span>
              </a>
            )}
            <a className="source-usage" href={sun.more.href} target="_blank" rel="noreferrer">
              {sun.more.label} <Arrow /><span className="sr-only"> ({sun.more.spoken ? `${sun.more.spoken}; ` : ''}opens in a new tab)</span>
            </a>
          </div>
        </div>
      </div>
      {/* The Sun belongs to the hero but sits beside it, not inside: on its way to the window's
          corner it has to pass over the header (hooks/useSunDock.ts, styles/hero.css). */}
      <SolarScene playing={playing} zoomed={zoomed} reduced={reduced} onStatus={onStatus} retry={retry} />
    </section>
  );
}
