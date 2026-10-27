import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { complete, prompt, run, suggestions, type Action, type Block } from '../terminal/commands';
import type { Path } from '../terminal/fs';

// One line of the terminal's history: the command typed at a prompt (null for output that no
// command produced, the greeting), where the shell was, and what came back.
type Entry = { id: number; cwd: Path; command: string | null; blocks: Block[] };

// The terminal opens by typing its first command itself, a character at a time.
const BOOT_COMMAND = 'ls';
const TYPING_MS = 85;
const BOOT_PAUSE_MS = 320;
const REDUCED = '(prefers-reduced-motion: reduce)';

/**
 * A shell over the filesystem in src/terminal/fs.ts: ls, cd, cat, open and the rest
 * (src/terminal/commands.ts). It types `ls` by itself when it appears, then waits. Typing anywhere
 * on the page while the terminal is in view goes into it; on a screen without a keyboard the buttons
 * under it run commands. Tab completes, the arrows recall, Ctrl+L clears. What the page should do
 * with a command (scroll to a project, open a link, stop the Sun) is handed to `onAction`.
 */
export function Terminal({ onAction }: { onAction: (action: Action) => void }) {
  const inputId = useId();
  const screen = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The latest handler, so nothing here has to be rebuilt when the page's changes.
  const act = useRef(onAction);
  act.current = onAction;
  const cwd = useRef<Path>([]);
  const history = useRef<string[]>([]);
  // Where ↑ and ↓ are in the history, and the line that was being typed before they were pressed.
  const recall = useRef<{ index: number; draft: string } | null>(null);
  const ids = useRef(0);
  const booting = useRef(true);
  const skipBoot = useRef<() => void>(() => {});
  const [entries, setEntries] = useState<Entry[]>([]);
  const [path, setPath] = useState<Path>([]);
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  const [booted, setBooted] = useState(false);

  const nextId = () => ids.current++;
  const setLine = (next: string) => {
    setValue(next);
    setCaret(next.length);
  };

  /** Runs a line as if Enter had been pressed on it. */
  const submit = useCallback((line: string) => {
    const command = line.trim();
    const at = cwd.current;
    if (!command) {
      setEntries(previous => [...previous, { id: nextId(), cwd: at, command: '', blocks: [] }]);
      return;
    }
    history.current.push(command);
    recall.current = null;
    const result = run(command, { cwd: at, history: history.current });
    cwd.current = result.cwd;
    setPath(result.cwd);
    const entry: Entry = { id: nextId(), cwd: at, command, blocks: result.blocks };
    setEntries(previous => (result.actions.some(action => action.type === 'clear') ? (result.blocks.length ? [{ ...entry, command: null }] : []) : [...previous, entry]));
    for (const action of result.actions) if (action.type !== 'clear') act.current(action);
  }, []);

  // The opening: a greeting, then the first command typed out, unless motion is not wanted.
  useEffect(() => {
    let over = false;
    const greeting: Entry = { id: nextId(), cwd: [], command: null, blocks: [{ kind: 'lines', lines: [{ text: `Last login: ${new Date().toDateString()} on ${location.hostname || 'localhost'}`, tone: 'muted' }] }] };
    setEntries([greeting]);
    const finish = () => {
      if (over) return;
      over = true;
      booting.current = false;
      setLine('');
      submit(BOOT_COMMAND);
      setBooted(true);
    };
    if (matchMedia(REDUCED).matches) {
      finish();
      return;
    }
    let typed = 0;
    const timer = window.setInterval(() => {
      typed += 1;
      setLine(BOOT_COMMAND.slice(0, typed));
      if (typed >= BOOT_COMMAND.length) {
        window.clearInterval(timer);
        window.setTimeout(finish, BOOT_PAUSE_MS);
      }
    }, TYPING_MS);
    skipBoot.current = () => {
      window.clearInterval(timer);
      finish();
    };
    return () => {
      window.clearInterval(timer);
      over = true;
    };
  }, [submit]);

  // The newest line stays in view.
  useLayoutEffect(() => {
    const element = screen.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [entries, value]);

  // Typing anywhere on the page, with the terminal in view and nothing else taking the keys, types
  // here. Not the space bar, which scrolls the page; no command starts with a space.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1 || event.key === ' ') return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const element = screen.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      if (box.top > window.innerHeight * 0.8 || box.bottom < window.innerHeight * 0.2) return;
      event.preventDefault();
      input.current?.focus({ preventScroll: true });
      if (booting.current) {
        skipBoot.current();
        return;
      }
      recall.current = null;
      setValue(previous => previous + event.key);
      setCaret(previous => previous + 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const syncCaret = () => setCaret(input.current?.selectionStart ?? value.length);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    recall.current = null;
    setValue(event.target.value);
    setCaret(event.target.selectionStart ?? event.target.value.length);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (booting.current) {
      skipBoot.current();
      return;
    }
    submit(value);
    setLine('');
  };

  const tabComplete = () => {
    const options = complete(value, cwd.current);
    if (options.length === 0) return;
    const partial = value.split(/\s+/).at(-1) ?? '';
    const head = value.slice(0, value.length - partial.length);
    if (options.length === 1) {
      const only = options[0]!;
      setLine(`${head}${only}${only.endsWith('/') ? '' : ' '}`);
      return;
    }
    let common = options[0]!;
    for (const option of options) while (!option.startsWith(common)) common = common.slice(0, -1);
    if (common.length > partial.length) {
      setLine(head + common);
      return;
    }
    const items = options.map(option => ({ name: option.replace(/\/$/, '').replace(/^.*\//, ''), dir: option.endsWith('/') }));
    setEntries(previous => [...previous, { id: nextId(), cwd: cwd.current, command: value, blocks: [{ kind: 'listing', items, long: false }] }]);
  };

  const recallHistory = (direction: -1 | 1) => {
    const list = history.current;
    if (list.length === 0) return;
    const state = recall.current ?? { index: list.length, draft: value };
    const index = Math.max(0, Math.min(list.length, state.index + direction));
    recall.current = { ...state, index };
    setLine(index === list.length ? state.draft : list[index]!);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Tab on an empty line is the keyboard's way on through the page, not a completion.
    if (event.key === 'Tab' && (event.shiftKey || value.trim() === '')) return;
    if (booting.current) {
      if (event.key.length === 1 || event.key === 'Enter') skipBoot.current();
      event.preventDefault();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      tabComplete();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      recallHistory(-1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      recallHistory(1);
    } else if (event.ctrlKey && event.key === 'l') {
      event.preventDefault();
      setEntries([]);
    } else if (event.ctrlKey && event.key === 'c') {
      event.preventDefault();
      setEntries(previous => [...previous, { id: nextId(), cwd: cwd.current, command: `${value}^C`, blocks: [] }]);
      setLine('');
    } else if (event.ctrlKey && event.key === 'u') {
      event.preventDefault();
      setLine('');
    }
  };

  // A click on the screen brings the keyboard here, unless the visitor is selecting text to copy.
  const focusInput = () => {
    if (getSelection()?.toString()) return;
    input.current?.focus({ preventScroll: true });
  };

  const runButton = (command: string) => {
    if (booting.current) skipBoot.current();
    submit(command);
  };

  return (
    <section className="terminal" aria-label="Terminal">
      <div className="terminal-bar label">
        <span>{`owen@sun — zsh`}</span>
        <span className="muted terminal-hint">Type help · Tab completes · ↑ recalls</span>
      </div>
      <div ref={screen} className="terminal-screen" onClick={focusInput}>
        <div className="terminal-log" role="log" aria-live="polite">
          {entries.map(entry => (
            <div key={entry.id} className="terminal-entry">
              {entry.command !== null && (
                <div className="terminal-echo"><span className="t-prompt">{prompt(entry.cwd)}</span> <span className="t-cmd">{entry.command}</span></div>
              )}
              <Blocks blocks={entry.blocks} />
            </div>
          ))}
        </div>
        <form className="terminal-line" onSubmit={onSubmit}>
          <span className="t-prompt" aria-hidden="true">{prompt(path)}</span>
          <span className="terminal-input-wrap">
            <span className="terminal-mirror" aria-hidden="true">
              {value.slice(0, caret)}<span className="terminal-caret">{value[caret] ?? ' '}</span>{value.slice(caret + 1)}
            </span>
            <input
              ref={input}
              id={inputId}
              className="terminal-input"
              value={value}
              onChange={onChange}
              onKeyDown={onKeyDown}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              onSelect={syncCaret}
              aria-label="Command line"
              aria-describedby={`${inputId}-hint`}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              readOnly={!booted}
            />
          </span>
        </form>
        <span id={`${inputId}-hint`} className="sr-only">Type a command such as help, ls, cd projects or cat about.txt, then press Enter. Tab completes names; the up arrow recalls earlier commands.</span>
      </div>
      <div className="terminal-chips" role="group" aria-label="Commands to run">
        {suggestions(path).map(command => (
          <button key={command} type="button" className="terminal-chip" onClick={() => runButton(command)}>{command}</button>
        ))}
      </div>
    </section>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((block, index) => {
    if (block.kind === 'lines') {
      return (
        <div key={index} className="terminal-lines">
          {block.lines.map((line, at) => <span key={at} className={line.tone ? `t-${line.tone}` : undefined}>{line.text}{'\n'}</span>)}
        </div>
      );
    }
    if (block.kind === 'listing') {
      return (
        <ul key={index} className="terminal-listing" data-long={block.long}>
          {block.items.map(item => (
            <li key={item.name}>
              <span className={item.dir ? 't-dir' : undefined}>{item.name}{item.dir ? '/' : ''}</span>
              {block.long && item.description && <span className="t-muted">{item.description}</span>}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <pre key={index} className="terminal-banner" aria-hidden="true">
        <span className="terminal-banner-wide">{block.wide}</span>
        <span className="terminal-banner-narrow">{block.narrow}</span>
      </pre>
    );
  });
}
