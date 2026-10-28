import type { SceneModule } from './types';

type Loader = () => Promise<{ default: SceneModule }>;

/** Each project's scene, by the project's id in src/content.ts. Loaded only when its panel is near. */
export const scenes: Record<string, Loader> = {
  freewheel: () => import('./freewheel'),
  'build-repair-agent': () => import('./buildRepair'),
  comcast: () => import('./comcast'),
  'terrier-motorsport': () => import('./precharge'),
  'rocket-propulsion': () => import('./thruster'),
};

/** The length of each scene's opening story, in seconds: its module's own `story`, repeated here so the
    page knows how far to scroll through it before the module has arrived (styles/work.css turns it into
    a distance). The two must agree to the hundredth: the build loads every scene and stops if one does
    not (config/story-lengths.ts), and in development the panel says so (./VisualFrame.tsx). */
export const stories: Record<string, number> = {
  freewheel: 5.8,
  'build-repair-agent': 9.19,
  comcast: 6.6,
  'terrier-motorsport': 7.28,
  'rocket-propulsion': 3.35,
};
