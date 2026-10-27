import { bareAddress, profile, projects, toolkit, type CaseStudy } from '../content';

// The filesystem the terminal walks (components/Terminal.tsx). It is read-only and built once from
// src/content.ts, so every file says what the page says: ~/projects/<id>/README.md is a project's
// case in brief, ~/about.txt the biography, ~/contact.txt the ways to reach Owen, and so on. A file
// that stands for something on the page or elsewhere says where `open` takes it (`opens`).

export type FsFile = {
  kind: 'file';
  name: string;
  lines: string[];
  /** Shown beside the name by `ls -l`. */
  description?: string;
  /** A file the terminal cannot print (the résumé): `open` takes it somewhere instead. */
  binary?: boolean;
  /** Where `open` takes it: a place on the page ("#id") or an address. */
  opens?: string;
};
export type FsDir = { kind: 'dir'; name: string; children: FsNode[]; description?: string; opens?: string };
export type FsNode = FsFile | FsDir;
/** A place in the filesystem: the names from the root down. The root itself is []. */
export type Path = string[];

const file = (name: string, lines: string[], extra: Partial<Omit<FsFile, 'kind' | 'name' | 'lines'>> = {}): FsFile => ({ kind: 'file', name, lines, ...extra });
const dir = (name: string, children: FsNode[], extra: Partial<Omit<FsDir, 'kind' | 'name' | 'children'>> = {}): FsDir => ({ kind: 'dir', name, children, ...extra });
const slug = (text: string) => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function readme(project: CaseStudy) {
  const figures = project.figures.map(figure => `${figure.value.padEnd(8)} ${figure.label}${figure.detail ? ` (${figure.detail})` : ''}`);
  return [
    `# ${project.title}`,
    `${project.organization} — ${project.role}`,
    project.location ? `${project.dates} · ${project.location}` : project.dates,
    '',
    project.summary,
    ...(figures.length ? ['', ...figures] : []),
    '',
    `open ${project.id}   → the full case on the page`,
  ];
}

function notes(project: CaseStudy) {
  const lines: string[] = [];
  if (project.comparison) {
    lines.push(`## ${project.comparison.caption}`, project.comparison.columns.join(' | '));
    for (const row of project.comparison.rows) lines.push(row.join(' | '));
    lines.push('');
  }
  for (const detail of project.details) lines.push(`## ${detail.heading}`, ...detail.paragraphs, '');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function projectDir(project: CaseStudy) {
  const children: FsNode[] = [
    file('README.md', readme(project), { description: 'the case in brief', opens: `#${project.id}` }),
    file('facts.txt', project.facts.map(fact => `${fact.label}: ${fact.text}`), { description: 'problem, contribution, result' }),
  ];
  if (project.tools.length) children.push(file('tools.txt', project.tools, { description: 'what it was built with' }));
  if (project.details.length || project.comparison) children.push(file('notes.md', notes(project), { description: 'case notes', opens: `#case-${project.id}` }));
  if (project.links.length) children.push(file('links.txt', project.links.map(link => `${link.label}  ${link.href}`), { description: 'where to read more' }));
  return dir(project.id, children, { description: `${project.role} · ${project.dates}`, opens: `#${project.id}` });
}

const { education, credentials, earlier } = profile;

export const root: FsDir = dir('~', [
  dir('projects', projects.map(projectDir), { description: `${projects.length} projects, newest first`, opens: '#work' }),
  dir('skills', toolkit.map(skill => file(`${slug(skill.area)}.txt`, skill.items, { description: skill.area })), { description: 'the toolkit, one file per area', opens: '#about' }),
  file('about.txt', profile.biography.flatMap((paragraph, index) => (index ? ['', paragraph] : [paragraph])), { description: 'who I am', opens: '#about' }),
  file('education.txt', [
    `${education.university}, ${education.school}`,
    `${education.degree} · expected ${education.graduation} · GPA ${education.gpa}`,
    '',
    `Selected coursework: ${education.courses.join(', ')}`,
    `Activities: ${education.activities.join(', ')}`,
    '',
    `Course project: ${education.courseProject.name}`,
    education.courseProject.summary,
    education.courseProject.href,
  ], { description: 'Boston University', opens: '#about' }),
  file('certifications.txt', credentials.map(credential => `${credential.name} — ${credential.issuer}, ${credential.date}${credential.href ? `\n  ${credential.href}` : ''}`), { description: `${credentials.length} credentials`, opens: '#about' }),
  file('earlier.txt', [`${earlier.organization} — ${earlier.role}`, `${earlier.dates} · ${earlier.location}`, '', earlier.summary], { description: 'before BU', opens: '#about' }),
  file('contact.txt', [
    `email     ${profile.email}`,
    `linkedin  ${bareAddress(profile.linkedin)}`,
    ...(profile.github ? [`github    ${bareAddress(profile.github)}`] : []),
    `location  ${profile.location}`,
    '',
    'open contact   → the links on the page',
  ], { description: 'how to reach me', opens: '#contact' }),
  ...(profile.resumeUrl ? [file('resume.pdf', [], { description: 'PDF; open resume.pdf', binary: true, opens: profile.resumeUrl })] : []),
]);

/** The place `input` names from `cwd`: "~" and "/" start from the root, ".." goes up (and no further than the root, as a shell's does). */
export function resolvePath(cwd: Path, input: string): Path {
  const absolute = input.startsWith('~') || input.startsWith('/');
  const path: Path = absolute ? [] : [...cwd];
  for (const part of input.replace(/^~\/?|^\/+/, '').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') path.pop();
    else path.push(part);
  }
  return path;
}

/** What is at `path`, or null where there is nothing. */
export function nodeAt(path: Path): FsNode | null {
  let node: FsNode = root;
  for (const part of path) {
    if (node.kind !== 'dir') return null;
    const next: FsNode | undefined = node.children.find(child => child.name === part);
    if (!next) return null;
    node = next;
  }
  return node;
}

/** "~", "~/projects", "~/projects/freewheel". */
export const formatPath = (path: Path) => ['~', ...path].join('/');

/** The names in `cwd` that could complete `partial` ("pro" → "projects/", "projects/fr" → "projects/freewheel/"). */
export function completions(cwd: Path, partial: string) {
  const slash = partial.lastIndexOf('/');
  const head = slash >= 0 ? partial.slice(0, slash + 1) : '';
  const tail = slash >= 0 ? partial.slice(slash + 1) : partial;
  const node = nodeAt(resolvePath(cwd, head || '.'));
  if (!node || node.kind !== 'dir') return [];
  return node.children.filter(child => child.name.startsWith(tail)).map(child => `${head}${child.name}${child.kind === 'dir' ? '/' : ''}`);
}
