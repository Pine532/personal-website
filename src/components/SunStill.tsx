import { useLayoutEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { sunPictured } from '../light';
import { sunVariant } from '../media';

/**
 * The Sun's still: the first frame of the footage. It stays invisible until all of it has
 * arrived, so a slow connection never paints part of the Sun (styles/hero.css). A still that
 * fails to load stays invisible too: an empty sky, never a broken-image box. The Sun lights the
 * page only from the frame its still is shown in (light.ts), and never if the still never comes.
 */
export function SunStill({ className, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  const image = useRef<HTMLImageElement>(null);
  const [whole, setWhole] = useState(false);
  const variant = sunVariant();

  // A layout effect, so a still that has already loaded is shown in the same paint.
  useLayoutEffect(() => {
    const still = image.current;
    if (!still) return;
    const show = () => setWhole(true);
    if (still.complete) {
      if (still.naturalWidth > 0) show();
      return;
    }
    still.addEventListener('load', show);
    return () => still.removeEventListener('load', show);
  }, []);

  // In the commit that shows the still, so the light starts to come in as the Sun appears.
  useLayoutEffect(() => {
    if (whole) sunPictured();
  }, [whole]);

  return (
    <img
      {...props}
      ref={image}
      className={className ? `sun-still ${className}` : 'sun-still'}
      data-whole={whole}
      src={variant.still}
      width={variant.pixels}
      height={variant.pixels}
      alt=""
    />
  );
}
