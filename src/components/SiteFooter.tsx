import { useEffect, useState } from 'react';
import { profile } from '../content';
import type { SunMotion } from '../hooks/useSunMotion';
import { subscribeSuns } from '../sunPlace';
import { Arrow, Playback } from './icons';

/** `motion` is the visitor's say over the Sun's motion (hooks/useSunMotion.ts): the control here is
    the third of its handles. */
export function SiteFooter({ motion }: { motion: SunMotion }) {
  // Whether the closing box's footage is up (sunPlace.ts). Its still does not move, so until the
  // footage is up there is nothing here to stop.
  const [footage, setFootage] = useState(false);
  useEffect(() => subscribeSuns(({ closing }) => setFootage(!!closing?.footage)), []);

  return (
    <footer className="site-footer section-shell">
      <div className="site-footer-inner">
        <p className="footer-identity" translate="no">{profile.name} <span translate="yes">{profile.field}</span></p>
        {/* Where the window is too short to keep its header there is no control up there, and the
            hero's is the whole page away from the Sun that closes it. This one is beside that Sun:
            the header's control again, the glyph alone, named for what pressing it will do.
            styles/contact.css shows it in those windows alone, and it is offered only while that
            Sun's footage is up. A visitor who has never had motion on has nothing here to stop, and
            is not offered it. */}
        {motion.asked && footage && (
          <button type="button" className="footer-motion" aria-label={motion.label} onClick={motion.toggle}>
            <Playback paused={!motion.playing} />
          </button>
        )}
        <a className="back-to-top" href="#top">Back to top <Arrow direction="up" /></a>
      </div>
    </footer>
  );
}
