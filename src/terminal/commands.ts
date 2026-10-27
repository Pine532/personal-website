import { profile, projects } from '../content';
import { SUN_SOURCE } from '../media';
import { completions, formatPath, nodeAt, resolvePath, root, type FsDir, type FsNode, type Path } from './fs';

// What the terminal does with a line (components/Terminal.tsx): parses it, runs each command, and
// answers with blocks to print and actions for the page to take. Nothing here touches the page.

export type Tone = 'plain' | 'muted' | 'accent' | 'dir' | 'error' | 'heading';
export type Line = { text: string; tone?: Tone };
export type Item = { name: string; dir: boolean; description?: string };
export type Block =
  | { kind: 'lines'; lines: Line[] }
  | { kind: 'listing'; items: Item[]; long: boolean }
  /** The name in block letters: the whole name, and the initials for a narrow terminal. */
  | { kind: 'banner'; wide: string; narrow: string };
export type Action =
  | { type: 'scroll'; target: string }
  | { type: 'visit'; href: string }
  | { type: 'sun'; command: 'play' | 'pause' | 'toggle' }
  | { type: 'clear' };
export type Result = { blocks: Block[]; actions: Action[]; cwd: Path };

export const USER = 'owen';
export const HOST = 'sun';
/** What the Sun in the corner is, in a line (src/media.ts says which one is shown). */
const SUN_LINE = SUN_SOURCE === 'simulated'
  ? 'one simulated Sun, rendered in Python, turning once every 16 s'
  : 'the Sun as NASA’s Solar Dynamics Observatory saw it, at 304 Å, in an eight-second loop';
/** "owen@sun ~/projects %". */
export const prompt = (cwd: Path) => `${USER}@${HOST} ${formatPath(cwd)} %`;

const line = (text: string, tone?: Tone): Line => (tone ? { text, tone } : { text });
const lines = (...items: (Line | string)[]): Block => ({ kind: 'lines', lines: items.map(item => (typeof item === 'string' ? line(item) : item)) });
const error = (text: string): Block => lines(line(text, 'error'));

type Context = { cwd: Path; history: string[] };
type Outcome = { blocks?: Block[]; actions?: Action[]; cwd?: Path; failed?: boolean };
type Command = { usage: string; about: string; run: (args: string[], context: Context) => Outcome };

// Block letters, 5 wide and 7 tall, for the banner `whoami` prints: only the letters the name needs.
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};
/** `text` in block letters, one string with line breaks. Letters without a glyph are left out. */
export function blockLetters(text: string) {
  const glyphs = [...text.toUpperCase()].map(character => GLYPHS[character]).filter((glyph): glyph is string[] => !!glyph);
  return Array.from({ length: 7 }, (_, row) => glyphs.map(glyph => glyph[row]!.replace(/#/g, '█').replace(/\./g, ' ')).join('  ').trimEnd()).join('\n');
}
const initials = profile.name.split(' ').map(word => word[0]).join('');

/** Splits a line into words, keeping quoted phrases whole. */
function words(input: string) {
  const found: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(pattern)) found.push(match[1] ?? match[2] ?? match[3] ?? '');
  return found;
}

function listing(node: FsNode, long: boolean): Block {
  const items = node.kind === 'dir' ? node.children : [node];
  return { kind: 'listing', long, items: items.map(child => ({ name: child.name, dir: child.kind === 'dir', description: child.description })) };
}

function tree(node: FsDir, prefix = ''): string[] {
  return node.children.flatMap((child, index) => {
    const last = index === node.children.length - 1;
    const branch = `${prefix}${last ? '└── ' : '├── '}${child.name}${child.kind === 'dir' ? '/' : ''}`;
    return child.kind === 'dir' ? [branch, ...tree(child, `${prefix}${last ? '    ' : '│   '}`)] : [branch];
  });
}

/** The project `name` means: by id, by its short name, by its organization, or by the directory the shell is in. */
function projectNamed(name: string, cwd: Path) {
  if (name === '.' || name === './') return projects.find(project => project.id === cwd[1] && cwd[0] === 'projects') ?? null;
  const wanted = name.toLowerCase().replace(/\/$/, '').replace(/^~\/projects\/|^projects\//, '');
  return projects.find(project => [project.id, project.short, project.organization].some(label => label.toLowerCase() === wanted || label.toLowerCase().startsWith(wanted) && wanted.length >= 4)) ?? null;
}

const SECTIONS: Record<string, string> = { top: '#top', home: '#top', work: '#work', projects: '#work', about: '#about', contact: '#contact' };
const PLACES: Record<string, string | null> = {
  resume: profile.resumeUrl, 'resume.pdf': profile.resumeUrl, cv: profile.resumeUrl,
  github: profile.github, linkedin: profile.linkedin, email: `mailto:${profile.email}`, mail: `mailto:${profile.email}`,
};

const COMMANDS: Record<string, Command> = {
  help: {
    usage: 'help', about: 'this list',
    run: () => ({ blocks: [lines(
      line('Commands', 'heading'),
      ...Object.entries(COMMANDS).filter(([, command]) => command.about).map(([, command]) => `  ${command.usage.padEnd(18)} ${command.about}`),
      '',
      line('Tab completes names. ↑ and ↓ recall commands. Ctrl+L clears.', 'muted'),
    )] }),
  },
  ls: {
    usage: 'ls [-l] [path]', about: 'list what is here',
    run: (args, { cwd }) => {
      const long = args.some(arg => /^-\w*l/.test(arg));
      const paths = args.filter(arg => !arg.startsWith('-'));
      if (paths.length === 0) return { blocks: [listing(nodeAt(cwd) ?? root, long)] };
      const blocks: Block[] = [];
      let failed = false;
      for (const path of paths) {
        const node = nodeAt(resolvePath(cwd, path));
        if (!node) {
          blocks.push(error(`ls: ${path}: No such file or directory`));
          failed = true;
        } else {
          if (paths.length > 1) blocks.push(lines(line(`${path}:`, 'muted')));
          blocks.push(listing(node, long));
        }
      }
      return { blocks, failed };
    },
  },
  cd: {
    usage: 'cd <path>', about: 'go into a directory (cd .. goes up, cd alone goes home)',
    run: ([target], { cwd }) => {
      const path = resolvePath(cwd, target ?? '~');
      const node = nodeAt(path);
      if (!node) return { blocks: [error(`cd: no such file or directory: ${target}`)], failed: true };
      if (node.kind !== 'dir') return { blocks: [error(`cd: not a directory: ${target}`)], failed: true };
      return { cwd: path };
    },
  },
  cat: {
    usage: 'cat <file>', about: 'print a file',
    run: (args, { cwd }) => {
      if (args.length === 0) return { blocks: [error('cat: name a file, for example cat about.txt')], failed: true };
      const blocks: Block[] = [];
      let failed = false;
      for (const arg of args) {
        const node = nodeAt(resolvePath(cwd, arg));
        if (!node) {
          blocks.push(error(`cat: ${arg}: No such file or directory`));
          failed = true;
        } else if (node.kind === 'dir') {
          blocks.push(error(`cat: ${arg}: Is a directory`));
          failed = true;
        } else if (node.binary) {
          blocks.push(lines(line(`cat: ${arg}: binary file. Try: open ${node.name}`, 'muted')));
        } else {
          blocks.push(lines(...node.lines.flatMap(text => text.split('\n')).map(text => (/^#+ /.test(text) ? line(text.replace(/^#+ /, ''), 'heading') : /^open \S+\s+→/.test(text) ? line(text, 'muted') : text))));
        }
      }
      return { blocks, failed };
    },
  },
  open: {
    usage: 'open <name>', about: 'go to a project or section on the page; open resume.pdf, github, linkedin',
    run: ([target], { cwd }) => {
      if (!target) return { blocks: [error('open: name a project, a section (work, about, contact) or a file')], failed: true };
      const key = target.toLowerCase().replace(/\/$/, '');
      const project = projectNamed(target, cwd);
      if (project) return { blocks: [lines(line(`Opening ${project.short}…`, 'muted'))], actions: [{ type: 'scroll', target: `#${project.id}` }] };
      if (SECTIONS[key]) return { blocks: [lines(line(`Opening ${key}…`, 'muted'))], actions: [{ type: 'scroll', target: SECTIONS[key] }] };
      const place = PLACES[key];
      if (place) return { blocks: [lines(line(`Opening ${key} in a new tab…`, 'muted'))], actions: [{ type: 'visit', href: place }] };
      const node = nodeAt(resolvePath(cwd, target));
      if (node?.opens) {
        const onPage = node.opens.startsWith('#');
        return { blocks: [lines(line(onPage ? `Opening ${node.name}…` : `Opening ${node.name} in a new tab…`, 'muted'))], actions: [onPage ? { type: 'scroll', target: node.opens } : { type: 'visit', href: node.opens }] };
      }
      if (node) return { blocks: [error(`open: ${target} is nowhere on the page; try cat ${target}`)], failed: true };
      return { blocks: [error(`open: ${target}: No such file, project or section`)], failed: true };
    },
  },
  tree: {
    usage: 'tree', about: 'everything here, as a tree',
    run: (_args, { cwd }) => {
      const node = nodeAt(cwd) ?? root;
      return node.kind === 'dir' ? { blocks: [lines(formatPath(cwd), ...tree(node))] } : { blocks: [lines(node.name)] };
    },
  },
  pwd: { usage: 'pwd', about: 'where you are', run: (_args, { cwd }) => ({ blocks: [lines(formatPath(cwd))] }) },
  whoami: {
    usage: 'whoami', about: 'who this is',
    run: () => ({ blocks: [{ kind: 'banner', wide: blockLetters(profile.name), narrow: blockLetters(initials) }, lines(line(profile.introduction.replace(/ /g, ' '), 'muted'))] }),
  },
  neofetch: {
    usage: 'neofetch', about: 'the system, at a glance',
    run: () => ({ blocks: [lines(
      line(`${USER}@${HOST}`, 'accent'),
      line('─'.repeat(USER.length + HOST.length + 1), 'muted'),
      `Name       ${profile.name}`,
      `School     ${profile.education.university}, ${profile.education.degree}`,
      `Graduates  ${profile.education.graduation}`,
      `Location   ${profile.location}`,
      `Projects   ${projects.length}`,
      `Languages  ${profile.skills[0]?.items.join(', ')}`,
      `Shell      zsh (well, a web page)`,
      `Star       ${SUN_LINE}`,
    )] }),
  },
  history: { usage: 'history', about: 'what you have typed', run: (_args, { history }) => ({ blocks: [lines(...history.map((entry, index) => `${String(index + 1).padStart(4)}  ${entry}`))] }) },
  clear: { usage: 'clear', about: 'clear the screen', run: () => ({ actions: [{ type: 'clear' }] }) },
  echo: { usage: 'echo <words>', about: 'say it back', run: args => ({ blocks: [lines(args.join(' '))] }) },
  date: { usage: 'date', about: 'the time where you are', run: () => ({ blocks: [lines(new Date().toString())] }) },
  sun: {
    usage: 'sun [pause|play]', about: 'stop or start the Sun in the corner',
    run: ([what]) => {
      const command = what === 'pause' || what === 'stop' || what === 'off' ? 'pause' : what === 'play' || what === 'start' || what === 'on' ? 'play' : what ? null : 'toggle';
      if (!command) return { blocks: [error(`sun: ${what}: try sun pause or sun play`)], failed: true };
      return { blocks: [lines(line(`The Sun in the corner: ${SUN_LINE}.`, 'muted'))], actions: [{ type: 'sun', command }] };
    },
  },
  // Answered, not listed in help.
  exit: { usage: 'exit', about: '', run: () => ({ blocks: [lines(line('logout', 'muted'), 'Just kidding. Scroll on.')] }) },
  logout: { usage: 'logout', about: '', run: () => COMMANDS.exit!.run([], { cwd: [], history: [] }) },
  sudo: { usage: 'sudo', about: '', run: () => ({ blocks: [error(`${USER} is not in the sudoers file. This incident will be reported.`)], failed: true }) },
  rm: { usage: 'rm', about: '', run: () => ({ blocks: [error('rm: read-only file system')], failed: true }) },
  mv: { usage: 'mv', about: '', run: () => ({ blocks: [error('mv: read-only file system')], failed: true }) },
  touch: { usage: 'touch', about: '', run: () => ({ blocks: [error('touch: read-only file system')], failed: true }) },
  mkdir: { usage: 'mkdir', about: '', run: () => ({ blocks: [error('mkdir: read-only file system')], failed: true }) },
  vim: { usage: 'vim', about: '', run: () => ({ blocks: [lines(line('No editors here. cat is all you need.', 'muted'))] }) },
  vi: { usage: 'vi', about: '', run: () => COMMANDS.vim!.run([], { cwd: [], history: [] }) },
  nano: { usage: 'nano', about: '', run: () => COMMANDS.vim!.run([], { cwd: [], history: [] }) },
  emacs: { usage: 'emacs', about: '', run: () => COMMANDS.vim!.run([], { cwd: [], history: [] }) },
  man: { usage: 'man', about: '', run: ([name]) => ({ blocks: [lines(line(name && COMMANDS[name]?.about ? `${COMMANDS[name]!.usage}: ${COMMANDS[name]!.about}` : 'What manual page do you want? Try help.', 'muted'))] }) },
  ll: { usage: 'll', about: '', run: (args, context) => COMMANDS.ls!.run(['-l', ...args], context) },
  less: { usage: 'less', about: '', run: (args, context) => COMMANDS.cat!.run(args, context) },
  more: { usage: 'more', about: '', run: (args, context) => COMMANDS.cat!.run(args, context) },
  head: { usage: 'head', about: '', run: (args, context) => COMMANDS.cat!.run(args, context) },
};

/** The commands help lists. */
export const COMMAND_NAMES = Object.keys(COMMANDS);

/** Runs one line: commands joined by && stop at the first failure, by ; carry on. */
export function run(input: string, context: Context): Result {
  const result: Result = { blocks: [], actions: [], cwd: context.cwd };
  const parts = input.split(/\s*(&&|;)\s*/);
  let skip = false;
  for (let index = 0; index < parts.length; index += 2) {
    const joiner = parts[index - 1];
    if (joiner === ';') skip = false;
    if (skip) continue;
    const [name, ...args] = words(parts[index] ?? '');
    if (!name) continue;
    const command = COMMANDS[name];
    const outcome: Outcome = command
      ? command.run(args, { cwd: result.cwd, history: context.history })
      : { blocks: [error(`zsh: command not found: ${name}`)], failed: true };
    result.blocks.push(...(outcome.blocks ?? []));
    result.actions.push(...(outcome.actions ?? []));
    if (outcome.cwd) result.cwd = outcome.cwd;
    if (outcome.failed) skip = true;
  }
  return result;
}

/** What Tab could make of the line: command names for its first word, paths after it. */
export function complete(input: string, cwd: Path) {
  const beforeCursor = input.replace(/^\s+/, '');
  const parts = beforeCursor.split(/\s+/);
  const partial = parts.at(-1) ?? '';
  if (parts.length <= 1) return COMMAND_NAMES.filter(name => COMMANDS[name]!.about && name.startsWith(partial));
  const command = parts[0];
  if (command === 'open') {
    const names = [...projects.map(project => project.id), ...Object.keys(SECTIONS), ...Object.keys(PLACES).filter(key => PLACES[key])];
    const found = names.filter(name => name.startsWith(partial));
    return found.length ? found : completions(cwd, partial);
  }
  return completions(cwd, partial);
}

/** Commands worth offering as buttons where there is no keyboard, for where the shell is now. */
export function suggestions(cwd: Path): string[] {
  if (cwd[0] === 'projects' && cwd.length === 2) return ['cat README.md', 'open .', 'ls -l', 'cd ..'];
  if (cwd[0] === 'projects') return ['ls -l', `cd ${projects[0]!.id}`, 'cat freewheel/README.md', 'cd ..'];
  if (cwd[0] === 'skills') return ['ls', 'cat languages.txt', 'cd ..'];
  return ['help', 'ls -l', 'cd projects', 'cat about.txt', 'open freewheel', 'whoami'];
}
