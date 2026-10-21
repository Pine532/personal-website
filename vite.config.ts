import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { siteMetadata } from './config/site-metadata.ts';
import { storyLengths } from './config/story-lengths.ts';

export default defineConfig(({ mode }) => {
  // SITE_URL is optional: set it in .env once the site has a domain.
  const { SITE_URL } = loadEnv(mode, '.', 'SITE_');
  return { plugins: [react(), siteMetadata(SITE_URL), storyLengths()] };
});
