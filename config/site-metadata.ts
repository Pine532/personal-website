import type { HtmlTagDescriptor, Plugin } from 'vite';
import { bareAddress, profile, projects, sun, toolkit } from '../src/content.ts';
import { LARGE_SUN_QUERY, SUN_SOURCE, SUN_VARIANTS, UNUSED_SUN_FILES } from '../src/media.ts';

// Build-time metadata derived from src/content.ts, so search engines, link previews, and
// visitors without JavaScript see the same facts as the page itself.

const SHARE_IMAGE = { path: '/og-image.jpg', type: 'image/jpeg', width: '1200', height: '630' };
const SHARE_IMAGE_ALT = `The name ${profile.name} and a short introduction beside ${sun.shareImage}.`;

/** The few Node functions the build needs. The project has no Node type definitions, so they are declared here. */
type Files = {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: 'utf8'): string;
  rmSync(path: string, options: { force: boolean }): void;
};
type Hashing = { createHash(algorithm: 'sha256'): { update(data: Uint8Array): { digest(encoding: 'hex'): string } } };
const files = (): Promise<Files> => import(/* @vite-ignore */ 'node:fs' as string);
const hashing = (): Promise<Hashing> => import(/* @vite-ignore */ 'node:crypto' as string);

/** src/sun-assets.json: what `npm run assets` last made the stills, the icons, and the link preview from. */
type MadeFrom = { sun?: string; still?: string };
type SunAssets = { stills?: Record<string, string>; icons?: MadeFrom; shareImage?: MadeFrom };

/** Copy as plain text: no-break spaces become ordinary ones. */
const plainText = (text: string) => text.replace(/\u00a0/g, ' ');

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * SITE_URL as "https://host" with no trailing slash, or undefined when it is not set.
 * A value that is not a full http(s) URL stops the build, because every address derived from
 * it (share image, canonical link, sitemap) would be silently wrong.
 */
function siteOrigin(siteUrl: string | undefined) {
  const value = siteUrl?.trim();
  if (!value) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SITE_URL must be a full address such as https://example.com (received "${value}").`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`SITE_URL must start with https:// (received "${value}").`);
  // The site uses root-relative addresses (/media/…, /assets/…), so it has to be served from the root of its host.
  if (url.pathname.replace(/\/+(index\.html)?$/, '') !== '') throw new Error(`SITE_URL must be the root of a host, without a path (received "${value}").`);
  return url.origin;
}

/** "AWS (SageMaker, S3, EKS)" lists as AWS, AWS SageMaker, AWS S3, AWS EKS: one topic per entry. */
function topics(item: string) {
  const [, group, members] = item.match(/^(.+?)\s*\((.+)\)$/) ?? [];
  return group && members ? [group, ...members.split(/,\s*/).map(member => `${group} ${member}`)] : [item];
}

/** schema.org ProfilePage about one Person, the shape search engines document for "about me" pages. */
function profileSchema(origin: string | undefined) {
  const [givenName, additionalName, familyName] = profile.name.split(' ');
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    ...(origin && { url: `${origin}/` }),
    name: profile.name,
    mainEntity: {
      '@type': 'Person',
      ...(origin && { '@id': `${origin}/#person` }),
      name: profile.name,
      alternateName: `${givenName} ${familyName}`,
      givenName,
      additionalName,
      familyName,
      ...(origin && { url: `${origin}/`, image: `${origin}${SHARE_IMAGE.path}` }),
      email: `mailto:${profile.email}`,
      description: plainText(profile.introduction),
      address: { '@type': 'PostalAddress', addressLocality: 'Boston', addressRegion: 'MA', addressCountry: 'US' },
      affiliation: { '@type': 'CollegeOrUniversity', name: profile.education.university, sameAs: 'https://www.bu.edu/' },
      knowsLanguage: profile.spokenLanguages,
      knowsAbout: profile.skills.flatMap(skill => skill.items).flatMap(topics),
      hasCredential: profile.credentials.map(credential => ({
        '@type': 'EducationalOccupationalCredential',
        name: credential.name,
        // "Google · Coursera" names the issuer first, then the platform.
        recognizedBy: { '@type': 'Organization', name: credential.issuer.split(' · ')[0] },
        ...(credential.href && { url: credential.href }),
      })),
      sameAs: [profile.linkedin, profile.github].filter(Boolean),
    },
  };
}

/**
 * A plain, readable page placed inside #root. Crawlers and visitors without JavaScript read it as
 * it is; React replaces it when the site starts; and if the script never arrives, styles/base.css
 * reveals it after a few seconds instead of leaving a black page.
 */
function plainPage() {
  const { education, credentials, earlier } = profile;
  const work = projects.map(project => {
    const figures = project.figures.map(figure => `${escapeHtml(figure.value)} ${escapeHtml(figure.label)}${figure.detail ? ` (${escapeHtml(figure.detail)})` : ''}`).join('; ');
    return `<li><strong>${escapeHtml(project.title)}</strong>. ${escapeHtml(project.organization)}, ${escapeHtml(project.role)}, ${escapeHtml(project.dates)}. ${escapeHtml(project.summary)}${figures ? ` ${figures}.` : ''}</li>`;
  }).join('');
  const certifications = credentials.map(credential => {
    const name = credential.href ? `<a href="${escapeHtml(credential.href)}">${escapeHtml(credential.name)}</a>` : escapeHtml(credential.name);
    return `<li>${name}. ${escapeHtml(credential.issuer)}, ${escapeHtml(credential.date)}.</li>`;
  }).join('');
  const link = (href: string, label: string) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  const contact = [
    link(`mailto:${profile.email}`, profile.email),
    link(profile.linkedin, bareAddress(profile.linkedin)),
    ...(profile.github ? [link(profile.github, bareAddress(profile.github))] : []),
    ...(profile.resumeUrl ? [link(profile.resumeUrl, 'Résumé (PDF)')] : []),
  ];
  const skillLines = toolkit
    .map(skill => `<li>${escapeHtml(skill.area)}: ${escapeHtml(skill.items.join(', '))}.</li>`).join('');
  return `<div class="plain-page">
        <h1>${escapeHtml(profile.name)}</h1>
        <p>${escapeHtml(plainText(profile.introduction))}</p>
        <p>${contact.join(' · ')} · ${escapeHtml(profile.location)}</p>
        <h2>Selected work</h2>
        <ul>${work}</ul>
        <h2>Education</h2>
        <p>${escapeHtml(education.university)}, ${escapeHtml(education.school)}. ${escapeHtml(education.degree)}. Expected ${escapeHtml(education.graduation)}. GPA ${escapeHtml(education.gpa)}.</p>
        <p>Selected coursework: ${escapeHtml(education.courses.join(', '))}. Activities: ${escapeHtml(education.activities.join(', '))}.</p>
        <p>Course project: ${link(education.courseProject.href, education.courseProject.name)}. ${escapeHtml(education.courseProject.summary)}</p>
        <h2>Certifications</h2>
        <ul>${certifications}</ul>
        <h2>Technical toolkit</h2>
        <ul>${skillLines}</ul>
        <h2>Earlier</h2>
        <p>${escapeHtml(earlier.organization)}, ${escapeHtml(earlier.role)}, ${escapeHtml(earlier.dates)}. ${escapeHtml(earlier.summary)}</p>
        <p>${escapeHtml(sun.fallback)}</p>
      </div>`;
}

/** What a static host serves for an address that does not exist. It reuses the built stylesheet. */
function notFoundPage(stylesheet: string | undefined) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#050504" />
    <meta name="robots" content="noindex" />
    <title>Page not found · ${escapeHtml(profile.name)}</title>
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    ${stylesheet ? `<link rel="stylesheet" href="/${stylesheet}" />` : '<style>html { background: #050504; color: #f4f2eb; font-family: sans-serif; }</style>'}
  </head>
  <body>
    <main class="plain-page">
      <h1>Page not found</h1>
      <p>Nothing lives at this address. The whole site is one page.</p>
      <p><a href="/">${escapeHtml(profile.name)}: selected work, about, and contact</a></p>
    </main>
  </body>
</html>
`;
}

/**
 * @param siteUrl The production origin, e.g. https://example.com (set SITE_URL in .env).
 *   Without it the page still builds; it simply has no canonical URL, sitemap, or absolute
 *   share-image address.
 */
export function siteMetadata(siteUrl: string | undefined): Plugin {
  const origin = siteOrigin(siteUrl);
  let root = '.';
  let outDir = 'dist';
  let building = false;
  return {
    name: 'site-metadata',
    configResolved(config) {
      root = config.root;
      outDir = `${config.root}/${config.build.outDir}`;
      building = config.command === 'build';
    },
    // `npm run assets` takes each still from its video's first frame, and the icons and the
    // link-preview image from the selected Sun's large still, and records what it used. A page whose
    // still is not its video's first frame, or which labels one Sun and wears the other's icons, must not
    // be built.
    async buildStart() {
      if (!building) return;
      const { existsSync, readFileSync } = await files();
      const { createHash } = await hashing();
      const sha256 = (path: string) => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : undefined);
      const record = `${root}/src/sun-assets.json`;
      const made: SunAssets = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : {};
      const remedy = 'Run "npm run assets".';
      for (const { source } of [SUN_VARIANTS.large, SUN_VARIANTS.small]) {
        const recorded = made.stills?.[source.replace('/media/', '')];
        if (!recorded || recorded !== sha256(`${root}/public${source}`)) {
          this.error(`The still of public${source} was not taken from the video that is there now. ${remedy}`);
        }
      }
      const still = sha256(`${root}/public${SUN_VARIANTS.large.still}`);
      for (const [what, name] of [['icons', 'the icons were'], ['shareImage', 'the link-preview image was']] as const) {
        const from = made[what];
        if (from?.sun !== SUN_SOURCE) {
          this.error(`src/sun-source.json selects the ${SUN_SOURCE} Sun, but ${name} last made from ${from?.sun ? `the ${from.sun} one` : 'an unrecorded one'}. ${remedy}`);
        }
        if (from.still !== still) this.error(`The Sun's still has changed since ${name} made from it. ${remedy}`);
      }
    },
    // Only the selected Sun's files are published: the other one's videos, stills, and note stay in
    // public/ but are taken out of the build. (The script bundle still holds both sets of labels;
    // the page shows the selected Sun's.)
    async closeBundle() {
      if (!building) return;
      const { rmSync } = await files();
      for (const file of UNUSED_SUN_FILES) rmSync(`${outDir}${file}`, { force: true });
    },
    transformIndexHtml(html, context) {
      const meta = (property: string, content: string): HtmlTagDescriptor => ({ tag: 'meta', attrs: { property, content }, injectTo: 'head' });
      const tags: HtmlTagDescriptor[] = [
        meta('og:description', plainText(profile.introduction)),
        // The image's own properties must follow it: Open Graph attaches them to the image declared before them.
        meta('og:image', `${origin ?? ''}${SHARE_IMAGE.path}`),
        meta('og:image:type', SHARE_IMAGE.type),
        meta('og:image:width', SHARE_IMAGE.width),
        meta('og:image:height', SHARE_IMAGE.height),
        meta('og:image:alt', SHARE_IMAGE_ALT),
        { tag: 'meta', attrs: { name: 'twitter:image:alt', content: SHARE_IMAGE_ALT }, injectTo: 'head' },
        // "<" is escaped so no value from content.ts can ever close the script element.
        { tag: 'script', attrs: { type: 'application/ld+json' }, children: JSON.stringify(profileSchema(origin)).replace(/</g, '\\u003c'), injectTo: 'head' },
      ];
      if (origin) {
        tags.push(
          { tag: 'link', attrs: { rel: 'canonical', href: `${origin}/` }, injectTo: 'head' },
          meta('og:url', `${origin}/`),
        );
      }
      // The hero's first frame is the largest paint, and React renders it too late for the
      // browser's preload scanner to find. The two queries are exact complements, so every
      // viewport preloads the one file src/media.ts will choose.
      const preloadStill = (href: string, media: string): HtmlTagDescriptor => ({ tag: 'link', attrs: { rel: 'preload', as: 'image', href, media, fetchpriority: 'high' }, injectTo: 'head' });
      tags.push(
        preloadStill(SUN_VARIANTS.large.still, LARGE_SUN_QUERY),
        preloadStill(SUN_VARIANTS.small.still, `not all and ${LARGE_SUN_QUERY}`),
      );
      // The name and the introduction open the page in Manrope, so fetch it alongside the stylesheet.
      const font = Object.keys(context.bundle ?? {}).find(file => /manrope-latin-wght-normal.*\.woff2$/.test(file));
      if (font) {
        tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${font}`, crossorigin: '' }, injectTo: 'head' });
      }
      // Without scripting there is nothing to wait for: show the plain page at once.
      tags.push({ tag: 'noscript', children: '<style>#root > .plain-page { visibility: visible; animation: none; }</style>', injectTo: 'head' });
      return { html: html.replace('<!-- plain-page -->', plainPage()), tags };
    },
    generateBundle: {
      // After Vite's own plugins, so the stylesheet is already in the bundle.
      order: 'post',
      handler(_options, bundle) {
        const robots = ['User-agent: *', 'Allow: /', ...(origin ? [`Sitemap: ${origin}/sitemap.xml`] : [])];
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots.join('\n') + '\n' });
        const stylesheet = Object.keys(bundle).find(file => /^assets\/index-.*\.css$/.test(file));
        this.emitFile({ type: 'asset', fileName: '404.html', source: notFoundPage(stylesheet) });
        if (origin) {
          const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n</urlset>\n`;
          this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
        }
      },
    },
  };
}
