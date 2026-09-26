/**
 * The terminal shell.
 *
 * What `index.html` is to the web build and `src-tauri/main.rs` is to the desktop
 * one: the thing that owns the window, starts the app inside it, and puts it away
 * again afterwards. Everything below it is shared — the store, the recognizer,
 * every stamper, the ribbon's own table of rows — and this file adds no editing
 * behaviour of its own. It has four jobs:
 *
 *   1. Take the terminal over, and give it back. Raw mode, the alternate screen,
 *      mouse reporting, the cursor's shape. Every one of those is a mode the
 *      terminal keeps until it is told otherwise, which is why the teardown is
 *      wired to a crash as well as to a quit — a program that exits leaving a tty
 *      in raw mode has broken the shell that launched it.
 *   2. Route input. Bytes to `keys.ts`, presses to `keymap.ts`, clicks to
 *      `pointer.ts` — or to the dialog, while one is open.
 *   3. Draw a frame when something has changed, and not otherwise.
 *   4. Be the platform's file dialog (`LinePrompt`), because the bottom row of
 *      this screen is the only dialog a terminal has.
 *
 * It runs straight from TypeScript source — no build step, no bundle. That is
 * why `ribbon-items.ts` is a `.ts` and not a `.tsx`, and why every import in the
 * codebase carries its file extension.
 */

import { writeSync } from 'node:fs';
import { COLORS, NOTICE_MS } from '../app/canvas/palette.ts';
import { saveDocument, useEditor } from '../app/state/store.ts';
import { installPlatform, platform } from '../platform/index.ts';
import { createTerminalAdapter } from '../platform/terminal/index.ts';
import {
  ALT_SCREEN_OFF,
  ALT_SCREEN_ON,
  CURSOR_DEFAULT,
  CURSOR_SHOW,
  MOUSE_OFF,
  MOUSE_ON,
  RESET,
  Screen,
  WRAP_OFF,
  WRAP_ON,
} from './ansi.ts';
import { follow, layoutOf, paint, type Prompt } from './frame.ts';
import { createDecoder, type Press } from './keys.ts';
import { createKeymap } from './keymap.ts';
import { createPointer } from './pointer.ts';

const USAGE = `ascii writer — a diagram editor whose document is plain text

  npm run tui [--] [file.txt]

  file.txt   open it, or start a new document with that name
  --no-band  start with the key band hidden
  --help     this

  Inside: F1 shows every key for the current mode. Ctrl+X leaves.
`;

/**
 * How big the window is, from whichever of the three sources knows.
 *
 * `process.stdout.rows` is the answer almost always. It is not always *an*
 * answer: a pty opened by something that was not itself on a terminal reports
 * zero rather than nothing, which `??` sails straight past and which then asks
 * the renderer for a screen no rows tall. `COLUMNS` and `LINES` are the
 * conventional fallback and the reason this is testable at all — a harness can
 * set them where it cannot set a window size.
 *
 * 80×24 last, being the floor every terminal has agreed on since 1978.
 */
function size(): { width: number; height: number } {
  const num = (v: number | string | undefined): number | undefined => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return {
    width: num(process.stdout.columns) ?? num(process.env['COLUMNS']) ?? 80,
    height: num(process.stdout.rows) ?? num(process.env['LINES']) ?? 24,
  };
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return;
  }

  // Without a tty there is no raw mode, no cursor to place and no screen to take
  // over — and the failure would otherwise be a stream of escape codes into
  // whatever the output was redirected to.
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write(
      'The terminal build needs a terminal: stdin and stdout must both be a tty.\n' +
        'Run it directly rather than through a pipe.\n',
    );
    process.exitCode = 1;
    return;
  }

  let band = !args.includes('--no-band');
  const argPath = args.find((a) => !a.startsWith('-'));

  const { width, height } = size();
  const screen = new Screen(width, height, COLORS.bg);
  const pointer = createPointer();

  /**
   * The dialog on the bottom row, and who is waiting for its answer.
   *
   * `confirm` is the difference between the two kinds: a line to edit, or a
   * single key that settles it. Both are the same row and the same promise, which
   * is what lets the quit check and the platform's file dialog share every line
   * of this.
   */
  let dialog:
    | (Prompt & { confirm: boolean; resolve: (answer: string | null) => void })
    | null = null;
  /** Set once the teardown has run, so it cannot run twice on the way out. */
  let restored = false;
  let frameQueued = false;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- taking the terminal, and giving it back -----------------------------

  const takeOver = (): void => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    // `WRAP_OFF` matters more than it looks: a character written to the last
    // column of a wrapping terminal drags the cursor onto the next line, which
    // turns the bottom row of the canvas into a scroll.
    process.stdout.write(ALT_SCREEN_ON + WRAP_OFF + MOUSE_ON);
  };

  /**
   * Give the terminal back, with a write that cannot be lost.
   *
   * `writeSync` rather than `process.stdout.write`, and that is the whole reason
   * this is three lines instead of one. A stream write is queued, and the two
   * moments this function has to work in are the two that never drain a queue:
   * inside an `exit` handler, and just before `process.exit`. Getting it wrong
   * does not fail loudly — it leaves the user's shell in raw mode on the
   * alternate screen, with no echo and no prompt, which looks like the terminal
   * itself has broken.
   */
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    try {
      writeSync(
        1,
        MOUSE_OFF + CURSOR_DEFAULT + CURSOR_SHOW + RESET + WRAP_ON + ALT_SCREEN_OFF,
      );
    } catch {
      /* the terminal has gone (a closed window, a dropped ssh) — nothing to give back */
    }
  };

  /**
   * Put the terminal back, then go.
   *
   * `process.exit` rather than letting the loop empty, because it cannot empty: a
   * registered signal handler holds a reference to the loop for as long as it is
   * registered, so a program that waits to be let go politely waits for ever.
   * That is safe here only because `restore` writes synchronously — the two facts
   * belong together and are why neither is a one-liner.
   */
  const leave = (code = 0): void => {
    keyboard.stop();
    decoder.stop();
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    restore();
    process.exit(code);
  };

  // ---- drawing --------------------------------------------------------------

  const render = (): void => {
    frameQueued = false;
    const layout = layoutOf(screen.width, screen.height, band);
    follow(layout);

    const cursor = paint({ screen, layout, drag: pointer.drag, prompt: dialog });
    process.stdout.write(screen.frame(cursor));

    // Transient outcomes clear themselves (B-UI-09), on the same timer the web
    // toolbar uses. Re-armed rather than stacked, so a second notice arriving
    // before the first has faded gets its own full two seconds.
    const store = useEditor.getState();
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = null;
    if (store.notice !== null) {
      noticeTimer = setTimeout(() => {
        noticeTimer = null;
        useEditor.getState().setNotice(null);
      }, NOTICE_MS);
    }
  };

  /**
   * Ask for a frame, at most one per turn of the loop.
   *
   * A single keystroke can change the store several times — `setTool` then
   * `setCaret`, a plan that applies a diff and then clears a selection — and each
   * one notifies. Coalescing means one frame per input rather than four, which is
   * the difference between a held arrow key scrolling smoothly and stuttering.
   */
  const schedule = (): void => {
    if (frameQueued) return;
    frameQueued = true;
    setImmediate(render);
  };

  // ---- the dialog on the bottom row ----------------------------------------

  /**
   * The platform's file dialog (`LinePrompt`), and the quit check.
   *
   * One at a time, and a second request while one is open is refused rather than
   * queued: there is one bottom row, and two dialogs fighting over it would be a
   * worse answer than "not now".
   */
  const ask = (
    question: string,
    initial: string,
    hint: string,
    confirm = false,
  ): Promise<string | null> => {
    if (dialog !== null) return Promise.resolve(null);
    return new Promise((resolve) => {
      dialog = { question, value: initial, hint, confirm, resolve };
      schedule();
    });
  };

  const answer = (value: string | null): void => {
    const open = dialog;
    dialog = null;
    schedule();
    open?.resolve(value);
  };

  /** While a dialog is open it owns every key, the way an open menu does. */
  const dialogKey = (press: Press, open: NonNullable<typeof dialog>): void => {
    if (press.key === 'Escape') {
      answer(null);
      return;
    }
    if (press.key === 'Enter') {
      answer(open.value);
      return;
    }
    if (press.key === 'Backspace') {
      open.value = open.value.slice(0, -1);
      schedule();
      return;
    }
    if (press.ctrl && press.key === 'u') {
      open.value = '';
      schedule();
      return;
    }
    // A confirm has no line to edit: the first key that means something answers
    // it, and anything else is ignored rather than typed into a field that is not
    // there.
    if (open.confirm) {
      const k = press.key.toLowerCase();
      if (k === 'y' || k === 'n') answer(k);
      return;
    }
    if (!press.ctrl && !press.alt && [...press.key].length === 1) {
      open.value += press.key;
      schedule();
    }
  };

  // ---- quitting -------------------------------------------------------------

  /**
   * Leaving, and the one question worth asking on the way out.
   *
   * A document is characters and nothing else, so losing it is losing everything;
   * a confirm is cheap against that. `Escape` at the question stays in the
   * editor, and a save that is itself cancelled stays too — the point of asking
   * was not to get an answer but to not lose the work.
   */
  const quit = (): void => {
    if (!useEditor.getState().dirty) {
      leave();
      return;
    }
    void ask(
      `Save ${useEditor.getState().fileName} before leaving?`,
      '',
      'y / n / Esc stays',
      true,
    ).then(
      async (said) => {
        if (said === null) return;
        if (said === 'n') {
          leave();
          return;
        }
        await saveDocument(false);
        if (useEditor.getState().dirty) {
          useEditor.getState().setNotice('Not saved — still here');
          return;
        }
        leave();
      },
    );
  };

  // ---- input ----------------------------------------------------------------

  const keyboard = createKeymap({
    cancelGesture: () => {
      pointer.cancel();
    },
    quit,
    toggleBand: () => {
      band = !band;
      // Every row on screen moves, so the diff has nothing useful to say about
      // any of them.
      screen.resize(screen.width, screen.height);
      schedule();
    },
  });

  const decoder = createDecoder((input) => {
    const layout = layoutOf(screen.width, screen.height, band);

    if (input.kind === 'key') {
      if (dialog !== null) dialogKey(input.press, dialog);
      else keyboard.handle(input.press);
    } else if (dialog !== null) {
      // A click while a dialog is open would move a cursor nobody can see.
    } else if (input.kind === 'mouse') {
      pointer.press(input.click, layout.view);
    } else {
      pointer.scroll(input.wheel, layout.view);
    }
    schedule();
  });

  // ---- wiring ---------------------------------------------------------------

  process.stdin.on('data', (chunk: Buffer) => {
    decoder.feed(chunk);
  });

  process.stdout.on('resize', () => {
    const next = size();
    screen.resize(next.width, next.height);
    schedule();
  });

  // Anything that changes the document or the session redraws it — which is how
  // an answer that arrives late, from a file write or a clipboard helper, gets on
  // screen without the shell having to know it was waiting for one.
  useEditor.subscribe(schedule);

  // A tty left in raw mode is a broken shell, so the restore is wired to every
  // way this process can end rather than only to the one it is supposed to.
  process.on('SIGTERM', () => { leave(0); });
  process.on('SIGHUP', () => { leave(0); });
  process.on('exit', restore);
  process.on('uncaughtException', (err: unknown) => {
    restore();
    process.stderr.write(`ascii writer stopped: ${String(err)}\n`);
    if (err instanceof Error && err.stack !== undefined) process.stderr.write(`${err.stack}\n`);
    process.exit(1);
  });

  takeOver();

  // The platform, built here and handed down: the bottom row of this screen is
  // the only file dialog a terminal has, and the shell is the only thing that can
  // draw on it (see `LinePrompt`).
  const adapter = createTerminalAdapter(() => (question, initial) =>
    ask(question, initial, 'Enter · Esc cancels'),
  );
  installPlatform(adapter);

  void (argPath === undefined ? Promise.resolve(null) : adapter.adopt(argPath)).then((opened) => {
    // A path named on the command line is *adopted*, not written to: Save knows
    // where to go afterwards without the file having been touched on the way in.
    if (opened !== null) useEditor.getState().loadText(opened.text, opened.name);
    render();

    // Said once, after the first frame is up. Asking the platform what it cannot
    // do means probing for a clipboard helper, which spawns processes — worth a
    // moment of someone's attention, not worth a moment of blank screen.
    setTimeout(() => {
      const missing = platform().limitation;
      if (missing !== null) useEditor.getState().setNotice(missing);
    }, 50);
  });
}

main();
