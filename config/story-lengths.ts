import { createServer, type Plugin } from 'vite';

// The length of each scene's opening story is written twice. The scene works it out from its own timing
// (the `story` of its module, src/components/visuals/types.ts), and src/components/visuals/scenes.ts
// repeats it, because the page must make the room the story is scrolled through before the scene's code
// has arrived. A build in which the two differ would scroll a story at the wrong pace and move the page
// when the scene loads, so it is stopped here, with the figure to write.

type Scenes = {
  scenes: Record<string, () => Promise<{ default: { story: number } }>>;
  stories: Record<string, number>;
};

/** Stops the build unless every scene's story is as long as scenes.ts says, to the hundredth of a second. */
export function storyLengths(): Plugin {
  let root = '.';
  return {
    name: 'story-lengths',
    apply: 'build',
    configResolved(config) {
      root = config.root;
    },
    async buildStart() {
      // The scenes are TypeScript modules with imports of their own; a server of Vite's, never listening, loads them.
      // It is told not to look for dependencies to bundle ahead of time: nothing here is served to a browser,
      // and the search would leave a folder of its work in node_modules/.vite at every build.
      const loader = await createServer({ root, configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
      const wrong: string[] = [];
      try {
        const { scenes, stories } = (await loader.ssrLoadModule('/src/components/visuals/scenes.ts')) as Scenes;
        for (const id of new Set([...Object.keys(scenes), ...Object.keys(stories)])) {
          const load = scenes[id];
          const written = stories[id];
          if (!load) wrong.push(`"${id}" has a story length but no scene`);
          else if (written === undefined) wrong.push(`"${id}" has a scene but no story length`);
          else {
            const { story } = (await load()).default;
            if (!(Math.abs(story - written) < 0.005)) wrong.push(`"${id}" is written as ${written} s, and its scene's story lasts ${Math.round(story * 100) / 100} s`);
          }
        }
      } finally {
        await loader.close();
      }
      if (wrong.length > 0) this.error(`The story lengths in src/components/visuals/scenes.ts do not match the scenes: ${wrong.join('; ')}.`);
    },
  };
}
