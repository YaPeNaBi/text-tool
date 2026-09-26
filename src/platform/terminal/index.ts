/**
 * Terminal platform: real files through `node:fs`, and no dialogs at all.
 *
 * The third implementation of the boundary, and the one that proves it was worth
 * drawing: nothing above `platform/` changed to gain a terminal build. Where the
 * web has a file picker and the desktop has a native one, this has a row at the
 * bottom of the screen — which the shell draws, because the shell owns the tty
 * (see `LinePrompt`). Everything else is the same three operations.
 *
 * Two things are genuinely different here rather than merely differently
 * spelled, and both are reported through `limitation` rather than papered over:
 *
 *   - **Reading the system clipboard is not something a terminal can do.** There
 *     is no API for it. `OSC 52` can *write* to the clipboard and most terminals
 *     now honour that, but the paste half needs the terminal to answer back and
 *     almost none will. So reads go through whichever helper the machine has —
 *     `wl-paste`, `xclip`, `xsel`, `pbpaste`, PowerShell — and fall back to a
 *     clipboard kept in this process, which is what makes copy-then-paste inside
 *     one session work even on a machine with no helper installed.
 *
 *   - **Recents are per-run.** There is no `localStorage`, and inventing a
 *     dotfile is a decision about someone else's home directory. The list lives
 *     in memory and starts empty: it is a convenience, and a convenience that
 *     writes to disk uninvited is not one.
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  DEFAULT_FILENAME,
  type LinePrompt,
  type OpenedFile,
  type PlatformAdapter,
} from '../adapter.ts';

/**
 * What this platform can do that the interface has no word for.
 *
 * One method, and it is about startup rather than about editing: `tui diagram.txt`
 * has to leave Save pointing at that file. Doing it through `saveFile` would
 * write the document back over itself before the user had touched it, which is a
 * surprising thing for opening a file to do — so adopting a path is its own
 * operation, and it only ever reads.
 */
export interface TerminalPlatform extends PlatformAdapter {
  adopt(path: string): Promise<OpenedFile>;
}

interface Helper {
  read: readonly string[];
  write: readonly string[];
}

/**
 * The clipboard helpers worth trying, in order.
 *
 * `wl-paste` before `xclip` because a Wayland session usually has both installed
 * and only the first one talks to the compositor that is actually running.
 */
const HELPERS: readonly Helper[] = [
  { read: ['wl-paste', '--no-newline'], write: ['wl-copy'] },
  { read: ['xclip', '-selection', 'clipboard', '-o'], write: ['xclip', '-selection', 'clipboard'] },
  { read: ['xsel', '--clipboard', '--output'], write: ['xsel', '--clipboard', '--input'] },
  { read: ['pbpaste'], write: ['pbcopy'] },
  {
    read: ['powershell', '-NoProfile', '-Command', 'Get-Clipboard'],
    write: ['powershell', '-NoProfile', '-Command', '$input | Set-Clipboard'],
  },
];

let probed = false;
let helper: Helper | null = null;

/**
 * Which helper this machine has, found by running one.
 *
 * By running rather than by looking at `$DISPLAY` or `process.platform`, because
 * the case that guessing gets wrong is the common one: a `DISPLAY` that is set
 * but dead, or a Mac with `xclip` from Homebrew and no X server behind it.
 *
 * Probed lazily — on the first copy or paste, never at startup. Five commands
 * that each have to time out is a quarter of a second of a blank screen, paid by
 * every run to answer a question most runs never ask.
 */
function clipboardHelper(): Helper | null {
  if (probed) return helper;
  probed = true;
  for (const h of HELPERS) {
    const [cmd, ...args] = h.read;
    if (cmd === undefined) continue;
    try {
      execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'], timeout: 2000 });
      helper = h;
      return helper;
    } catch {
      /* not installed, or no session to talk to — try the next one */
    }
  }
  return null;
}

/**
 * Hand the clipboard to the terminal emulator itself (OSC 52).
 *
 * Done *as well as* the helper rather than instead of it, because the two fail in
 * opposite situations: a helper needs software installed locally, and this needs
 * the terminal to allow it. Over SSH, where no helper on the far end can reach
 * the clipboard you are actually going to paste into, this is the only one of the
 * two that works at all.
 */
function osc52(text: string): void {
  if (!process.stdout.isTTY) return;
  process.stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
}

/**
 * A document is a text file, and a text file ends in a newline.
 *
 * The grid does not carry one — `toText` joins rows, it does not terminate them —
 * so it is added on the way out and taken off on the way back in. Without the
 * round trip, opening and saving a file repeatedly would grow a blank line each
 * time, which `fromText` would then read as a row of nothing.
 */
function terminate(text: string): string {
  return text === '' ? '' : `${text}\n`;
}

function unterminate(text: string): string {
  return text.replace(/\n$/, '');
}

/**
 * `ask` is passed as a getter rather than as the function itself so that
 * `platform()` can build this adapter before the shell has drawn anything —
 * the store reaches for `platform()` the first time anything is saved, and the
 * order those two happen in should not decide whether there is a dialog.
 */
export function createTerminalAdapter(ask: () => LinePrompt | null): TerminalPlatform {
  /** The file this document came from, so Save has somewhere to go. */
  let path: string | null = null;
  const recents: string[] = [];
  /** The in-process clipboard: always written, read when nothing better exists. */
  let local = '';

  const remember = (p: string): void => {
    const at = recents.indexOf(p);
    if (at >= 0) recents.splice(at, 1);
    recents.unshift(p);
    recents.length = Math.min(recents.length, 8);
  };

  /**
   * Ask for a path, or refuse honestly.
   *
   * A terminal with no prompt installed cannot open a file it was not started
   * with. Saying so through the ordinary "cancelled" return keeps the store's
   * file commands untouched: they already handle a user who changed their mind,
   * and this is indistinguishable from one.
   */
  const askPath = async (question: string, initial: string): Promise<string | null> => {
    const prompt = ask();
    if (prompt === null) return null;
    const answer = await prompt(question, initial);
    if (answer === null) return null;
    const trimmed = answer.trim();
    return trimmed === '' ? null : resolve(trimmed);
  };

  const write = async (target: string, text: string): Promise<string> => {
    await writeFile(target, terminate(text), 'utf8');
    path = target;
    remember(target);
    return basename(target);
  };

  return {
    id: 'terminal',

    // A getter, so the probe above happens when someone asks what is missing
    // rather than while the first frame is still being composed.
    get limitation(): string | null {
      return clipboardHelper() === null
        ? 'No clipboard helper found — Ctrl+V pastes what this session copied. ' +
            'Install wl-clipboard, xclip or xsel for the system clipboard.'
        : null;
    },

    canSaveInPlace: () => path !== null,

    async adopt(argPath) {
      const target = resolve(argPath);
      let text = '';
      try {
        text = unterminate(await readFile(target, 'utf8'));
      } catch (err) {
        // A path that is not there yet is a new document that already has a
        // name, which is what every editor does with `editor newfile.txt`.
        // Anything else — a directory, a permission — is real and should be seen.
        if ((err as { code?: string }).code !== 'ENOENT') throw err;
      }
      path = target;
      remember(target);
      return { name: basename(target), text };
    },

    async openFile(): Promise<OpenedFile | null> {
      const target = await askPath('Open', path ?? '');
      if (target === null) return null;

      const text = unterminate(await readFile(target, 'utf8'));
      path = target;
      remember(target);
      return { name: basename(target), text };
    },

    async saveFile(name, text) {
      if (path === null) return this.saveFileAs(name, text);
      return write(path, text);
    },

    async saveFileAs(name, text) {
      const target = await askPath('Save as', path ?? (name === '' ? DEFAULT_FILENAME : name));
      if (target === null) return null;
      return write(target, text);
    },

    async readClipboard() {
      const h = clipboardHelper();
      if (h === null) return local;
      const [cmd, ...args] = h.read;
      if (cmd === undefined) return local;
      try {
        return execFileSync(cmd, args, { encoding: 'utf8', timeout: 2000 });
      } catch {
        // It answered when probed and does not now. The session copy is a better
        // answer than an exception the user has no way to act on.
        return local;
      }
    },

    async writeClipboard(text) {
      local = text;
      osc52(text);

      const h = clipboardHelper();
      if (h === null) return;
      const [cmd, ...args] = h.write;
      if (cmd === undefined) return;
      try {
        execFileSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 2000 });
      } catch {
        /* OSC 52 and the session copy above both still stand */
      }
    },

    async recentFiles() {
      return recents.map((p) => basename(p));
    },

    onMenuCommand() {
      /* a terminal has no menu bar to command from */
    },
  };
}
