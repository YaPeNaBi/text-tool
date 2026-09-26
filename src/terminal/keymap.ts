/**
 * The keyboard, for the terminal.
 *
 * The counterpart of `canvas/keymap.ts`, and it is deliberately a second file
 * rather than the same one behind an adapter. The two share their *vocabulary* —
 * the four directions, the `hjkl` spelling, the size of an `Alt` stride, all in
 * `canvas/steps.ts` — and they share every store call they end in, which is what
 * keeps the single mutation path single (B-DOC-04). What they cannot share is the
 * part that made a shim tempting: a tty reports a strictly smaller set of events
 * than a browser does, so three bindings have to be answered differently rather
 * than answered late. Faking a `keyup` that never happens would have put that
 * difference somewhere nobody would think to look for it.
 *
 * The precedence is the web keymap's, in the same order and for the same
 * reasons — innermost first, which is the order Escape unwinds in:
 *
 *     jk          back to select, before anything can read the `k` (B-KEY-23)
 *     Ctrl        tools, undo, the clipboard, the file, the jump
 *     shell       the function keys: this window, not the document
 *     menu        the four keys an open actions menu answers (B-UI-11)
 *     caret       a live caret owns typing (B-DRAW-11)
 *     chain       a line being drawn owns Enter and Escape (B-DRAW-14)
 *     draft       a shape being drawn owns Enter and Escape
 *     select      the mode letters, hjkl, the arrow keys, and everything else
 *
 * Read it beside `canvas/keymap.ts`; where the two differ, `SUBSTITUTES` below
 * says why.
 */

import {
  copyDocument,
  openDocument,
  pasteDocument,
  saveDocument,
  useEditor,
} from '../app/state/store.ts';
import { CHARSETS } from '../core/charset/charsets.ts';
import { ARROWS, directionOf, strideBy } from '../app/canvas/steps.ts';
import { TOOLS, toolForKey, toolForMode } from '../app/tools.ts';
import type { Cell } from '../core/geom/cell.ts';
import type { Press } from './keys.ts';

/**
 * Every binding that differs from the web keymap, and what forced it.
 *
 * Kept as one table rather than as comments scattered down the file, because the
 * honest question about a second keymap is "how far has it drifted?" and the
 * answer should be somewhere it can be counted. Six rows, five of them forced by
 * what a tty physically cannot report (see `keys.ts`) and one by what the web
 * cannot report either.
 *
 * `ribbon-items.ts` reads the same substitutions through its `terminal` field, so
 * the band on screen shows the key that actually works here rather than the one
 * that works in a browser.
 */
export const SUBSTITUTES: readonly { web: string; here: string; why: string }[] = [
  {
    web: 'Ctrl+1…7 — pick a tool',
    here: '1…7 from select',
    why: 'Control codes only cover the letters; Ctrl and a digit has no encoding.',
  },
  {
    web: 'Shift Shift — select by object',
    here: 'o from select',
    why: 'A bare modifier sends nothing at all, so the double tap cannot be seen.',
  },
  {
    web: 'Ctrl Ctrl — back to select',
    here: 'Esc, or jk',
    why: 'The same: no bare modifier, no release. Both of these already did it.',
  },
  {
    web: 'Shift+arrows — draw a box, release to keep it',
    here: 'Shift+arrows, then Enter',
    why: 'There is no key release to commit on, so the draft ends the way Space started one does.',
  },
  {
    web: 'Ctrl+Enter — everything joined to it',
    here: 'g from select',
    why: 'A terminal sends a plain carriage return for Ctrl+Enter; the modifier is lost.',
  },
  {
    web: 'Ctrl+Shift+S / Ctrl+Shift+C',
    here: 'Alt+S / Alt+C',
    why: 'Shift on a control code is unrepresentable — Ctrl+S and Ctrl+Shift+S are one byte.',
  },
];

/**
 * How soon `k` has to follow `j` for the pair to mean "back to select"
 * (B-KEY-23) rather than two letters. The web keymap's number, for the same
 * reason it picked it: rolled off the home row the pair lands well inside this,
 * and typed as a word `jk` would need a pause.
 */
const JK_MS = 300;

/** What the shell owns, and the keyboard has to be able to reach. */
export interface Shell {
  /** Escape abandons a mouse drag in flight; that drag lives in the shell. */
  cancelGesture: () => void;
  /** Leave, after asking about unsaved work. */
  quit: () => void;
  /** Show or hide the key band, which is worth five rows of canvas. */
  toggleBand: () => void;
}

/** A press with nothing held down. Shift is folded into the key itself. */
function bare(press: Press, key: string): boolean {
  return press.key === key && !press.ctrl && !press.alt;
}

export interface Keyboard {
  handle(press: Press): void;
  stop(): void;
}

export function createKeymap(shell: Shell): Keyboard {
  /**
   * A bare `j` pressed outside select, waiting to see whether `k` follows
   * (B-KEY-23).
   *
   * The web keymap's exact structure, including the part that looks fussy: under
   * the text mode the `j` is *held back* until the window closes, because a
   * letter written and then taken back would flicker onto the page and leave an
   * undo step behind for a keystroke nobody meant. Everywhere else the `j` has
   * already done what it does — a step down, or nothing — and only the time is
   * kept.
   */
  let pendingJ: { at: number; timer: ReturnType<typeof setTimeout> | null } | null = null;

  const releaseJ = (): void => {
    const heldJ = pendingJ;
    pendingJ = null;
    if (heldJ === null || heldJ.timer === null) return;
    clearTimeout(heldJ.timer);

    const store = useEditor.getState();
    if (store.tool !== 'text') return;
    if (store.caret === null) store.setCaret(store.cursor);
    useEditor.getState().typeAt('j');
  };

  /** Where a paste lands: the caret, else the pointer, else the viewport corner. */
  const pasteAnchor = (): Cell => {
    const store = useEditor.getState();
    if (store.caret !== null) return store.caret;
    if (store.hover !== null) return store.hover;
    return { x: Math.floor(store.camera.ox), y: Math.floor(store.camera.oy) };
  };

  /**
   * The whole-document charset, cycled.
   *
   * A shell key rather than a document one, and it has no web counterpart to
   * match: there the charset is a dropdown in the toolbar, and a dropdown is the
   * one widget a character grid cannot draw. `F2` because it belongs with the
   * other two keys that are about this window rather than about the diagram.
   */
  const cycleCharset = (): void => {
    const store = useEditor.getState();
    const ids = Object.keys(CHARSETS);
    const at = ids.indexOf(store.charsetId);
    const next = ids[(at + 1) % ids.length];
    if (next === undefined) return;
    store.setCharset(next);
    store.setNotice(`Charset: ${CHARSETS[next]?.label ?? next}`);
  };

  const handle = (press: Press): void => {
    const { key } = press;

    // ---- `jk`: back to select (B-KEY-23) ----
    //
    // Answered before anything else can read the `k`: under text it would be
    // written, under the drawing modes it would only walk. Any other key means
    // the `j` was a letter after all, so it is let go — written, if it was held
    // back — *before* this key is read, and "ja" still comes out "ja".
    if (pendingJ !== null) {
      if (bare(press, 'k') && Date.now() - pendingJ.at < JK_MS) {
        const heldJ = pendingJ;
        pendingJ = null;
        const now = useEditor.getState();
        if (heldJ.timer !== null) {
          clearTimeout(heldJ.timer); // the `j` is never written
        } else {
          // Under the drawing modes the `j` walked the cursor a cell down, and
          // `k` walks it back, so the pair leaves it where it was — and a draft
          // or a chain aimed where it was before the gesture began.
          const back = directionOf('k', now.tool);
          if (back !== undefined) now.moveCursor(back[0], back[1]);
        }
        useEditor.getState().setTool('select');
        return;
      }
      releaseJ();
    }

    const store = useEditor.getState();

    // ---- Ctrl ----
    //
    // The web keymap's branch, less the digits it cannot receive and the two
    // chords that lose their Shift on the way through a tty. Everything that
    // *can* arrive means what it means in the browser, down to Ctrl+C being copy
    // rather than the interrupt a terminal usually makes of it — raw mode hands
    // it over, and a keymap that quietly reassigned it would be a keymap this
    // build could not be checked against.
    if (press.ctrl) {
      if (key === 'x') {
        shell.quit();
        return;
      }

      // Only the lettered tools; a digit never gets this far. `toolForKey` is
      // still the one table the toolbar and the band read (tools.ts).
      const byKey = toolForKey(key);
      if (byKey !== undefined) {
        store.setTool(byKey);
        return;
      }
      if (key === 'b') {
        store.setTool('box');
        return;
      }

      // Ctrl and an arrow is the **spreadsheet jump**: to the far wall of the
      // shape you are standing in, or across a gap to the next one.
      //
      //   Ctrl        jump
      //   Ctrl+Shift  jump, dragging the selection out to it
      //   Ctrl+Alt    the reading-order sweep
      const step = ARROWS[key];
      if (step !== undefined) {
        const [jx, jy] = step;
        if (press.shift) {
          store.jumpSweep(jx, jy);
          return;
        }
        // With something selected, Ctrl carries it: one cell, or a stride with
        // Alt. With nothing selected there is nothing to carry, so the key keeps
        // the meaning it had. The exception is a sweep already running, which has
        // to keep growing one selection rather than start dragging it about.
        const sweeping = press.alt && store.sweep !== null;
        if (store.selection !== null && !sweeping) {
          const [mx, my] = press.alt ? strideBy(jx, jy) : [jx, jy];
          store.moveSelection(mx, my);
          return;
        }
        if (press.alt) store.sweepBy(jx, jy, 'flow');
        else store.jumpBy(jx, jy);
        return;
      }

      switch (key) {
        case 'z':
          store.undo();
          return;
        case 'y':
          store.redo();
          return;
        case 'c':
          void copyDocument(store.selection !== null);
          return;
        case 'v':
          void pasteDocument(pasteAnchor());
          return;
        case 'a':
          store.setTool('select');
          store.selectEverything();
          return;
        case 'e':
          store.openMenu();
          return;
        case 'd':
          store.duplicateSelection();
          return;
        case 'o':
          void openDocument();
          return;
        case 's':
          void saveDocument(false);
          return;
        default:
          return;
      }
    }

    // ---- Alt: the two chords whose Shift a tty cannot carry ----
    if (press.alt && !press.ctrl) {
      if (key.toLowerCase() === 's') {
        void saveDocument(true);
        return;
      }
      if (key.toLowerCase() === 'c') {
        void copyDocument(false);
        return;
      }
      // Alt and an arrow is the nudge, and falls through to the branches below
      // that already read it. Alt and any other letter is the window manager's.
    }

    // ---- the shell's own keys ----
    //
    // Function keys, because they are the only ones on the board that are
    // plainly not document content: two of these three have no counterpart in
    // the web build at all, and putting them on letters would have meant taking
    // letters away from a mode that is about to write with them.
    switch (key) {
      case 'F1':
        shell.toggleBand();
        return;
      case 'F2':
        cycleCharset();
        return;
      case 'F3':
        store.toggleSticky();
        store.setNotice(
          useEditor.getState().sticky ? 'Connectors follow shapes' : 'Connectors stay put',
        );
        return;
      default:
        break;
    }

    // ---- an open menu owns the keyboard (B-UI-11) ----
    //
    // The innermost thing open goes first, which is the order Escape follows.
    // Only the four keys the menu answers are taken; everything else — Escape
    // above all — falls through to mean what it always means.
    if (store.menuOpen) {
      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        store.moveMenu(key === 'ArrowRight' ? 1 : -1);
        return;
      }
      // Down rather than a second Escape, because the menu sits under the shape
      // as often as over it: down is "put it away", the direction it came from.
      if (key === 'ArrowDown') {
        store.closeMenu();
        return;
      }
      if (key === 'Enter') {
        store.activateMenu();
        return;
      }
    }

    // A bare `j` outside select may be the first half of `jk` (B-KEY-23).
    //
    // Unlike the browser there is no `repeat` flag to consult, so a *held* `j`
    // arrives as a run of ordinary presses. Each one opens a fresh window and
    // the one before it is released on the way — which is the same outcome the
    // web reaches by checking `repeat`: walking stays walking, and only a `k`
    // that lands inside the window turns the last of them into the gesture.
    if (bare(press, 'j') && store.tool !== 'select') {
      if (store.tool === 'text') {
        pendingJ = { at: Date.now(), timer: setTimeout(releaseJ, JK_MS) };
        return;
      }
      pendingJ = { at: Date.now(), timer: null };
    }

    // ---- a live caret owns the keyboard (B-DRAW-11) ----

    if (store.caret !== null) {
      switch (key) {
        case 'Escape':
          // Out of the writing and back to select in one press. A caret only
          // exists under the text tool (B-KEY-21), so dismissing it and leaving
          // the mode are the same act.
          store.setCaret(null);
          store.setTool('select');
          return;
        case 'Enter':
          store.newline();
          return;
        case 'Backspace':
          store.backspace();
          return;
        case 'Tab':
          // Inside a shape, Tab crosses to the shape — including out of one that
          // is still empty. Loose on the page there is nothing to cross to, so
          // it indents.
          if (!store.toggleLabel()) store.moveCaret(4, 0);
          return;
        case 'Insert':
          store.toggleInsertMode();
          return;
        // The caret walks the text; Shift drags the text itself, the same
        // division as a table cell.
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const dx = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
          const dy = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
          const sel = store.selection;

          if (press.alt && sel === null) {
            store.strideBy(dx, dy);
            return;
          }
          if (press.shift && sel !== null) {
            store.moveSelection(dx, dy);
            // Carry the caret by however far the text actually went — a nudge
            // clamps at the origin, and a caret left behind would type into the
            // wrong cell.
            const after = useEditor.getState().selection;
            if (after !== null) {
              const by = { x: after.bounds.x - sel.bounds.x, y: after.bounds.y - sel.bounds.y };
              store.setCaret({ x: store.caret.x + by.x, y: store.caret.y + by.y });
            }
            return;
          }
          store.moveCaret(dx, dy);
          return;
        }
        default:
          break;
      }
      if ([...key].length === 1) store.typeAt(key);
      return;
    }

    // A line being drawn corner by corner owns Enter and Escape (B-DRAW-14).
    if (store.chain !== null) {
      if (key === 'Enter') {
        store.commitChain();
        return;
      }
      if (key === 'Escape') {
        store.cancelChain();
        return;
      }
    }

    // ---- drawing from the keyboard ----
    //
    // Space is the press and Enter is the release — the same gesture the pointer
    // makes, so the two tools do not have to be learned twice.
    if (key === ' ' && !press.ctrl && !press.alt) {
      const t = store.tool;
      if (t === 'box' || t === 'circle') {
        store.startDraft(t);
        return;
      }
      if (t === 'line' || t === 'arrow') {
        store.addChainPoint(store.cursor, 'keyboard');
        return;
      }
      // Under select there is nothing to draw, so a space is a space.
    }

    if (store.draft !== null && (key === 'Enter' || key === 'Escape')) {
      if (key === 'Enter') store.commitDraft();
      else store.cancelDraft();
      return;
    }

    // The cursor moves in every tool. With a shape being drafted it drags the
    // free corner; with a chain running it aims the next segment; on its own it
    // is just where the keyboard is. `hjkl` says all of that too, under the
    // drawing modes (B-KEY-22).
    const drawStep = store.tool === 'select' ? undefined : directionOf(key, store.tool);
    if (drawStep !== undefined) {
      const [dx, dy] = drawStep;

      // Shift and an arrow still *starts* the box (B-DRAW-15) — what it cannot
      // do here is end it, there being no release to end on. So the gesture
      // becomes the one Space starts: draw with Shift held or not, and press
      // Enter to keep it. The draft on screen is identical either way, which is
      // what makes this a smaller difference than it first looks.
      if (press.shift && store.tool === 'box' && store.draft === null) store.startDraft('box');
      // A stride stops at a wall (B-KEY-19a), which is worth as much to a corner
      // being dragged as to the keyboard on its own: it is how a new box is lined
      // up against one that is already there.
      if (press.alt) store.strideBy(dx, dy);
      else store.moveCursor(dx, dy);
      return;
    }

    // ---- select is a mode, and a plain letter leaves it (B-KEY-21) ----

    if (store.tool === 'select' && !press.alt) {
      // The numbered row, by its bare digit. `Ctrl`+digit is what the web binds
      // and what the toolbar prints, and a terminal cannot receive it — but
      // select does not write, so the digits are free here in a way they are not
      // in a browser, where the same keys have to stay available to a page that
      // might. Off `TOOLS`, so a tool that joins the row is reachable the same
      // day its button appears.
      // Only the row itself: the tools past it are lettered, and `Ctrl` reaches
      // those here perfectly well.
      const byDigit = /^[0-9]$/.test(key) ? TOOLS.find((t) => t.key === key) : undefined;
      if (byDigit !== undefined) {
        store.setTool(byDigit.id);
        if (byDigit.id === 'text') useEditor.getState().setCaret(store.cursor);
        return;
      }

      const mode = toolForMode(key);
      if (mode !== undefined) {
        store.setTool(mode);
        // The writing mode is entered *at the keyboard*, not at whatever was
        // clicked last: `hjkl` to the cell, `t`, and type.
        if (mode === 'text') useEditor.getState().setCaret(store.cursor);
        return;
      }

      // The two gestures a tty cannot see, on letters instead. Both are only
      // reachable from select in the web build too, so nothing is being taken
      // from a mode that wanted the letter.
      if (key === 'o') {
        store.enterObjectMode();
        return;
      }
      if (key === 'g') {
        store.selectConnected();
        return;
      }
      if (key === '?') {
        shell.toggleBand();
        return;
      }
    }

    // Arrows, and `hjkl` for the same four directions (B-KEY-22) — one key with
    // two spellings, so every modifier has to mean the same on both.
    //
    //   Shift  sweep a rectangle — or whole objects, in object select
    //   Alt    nudge whatever is selected
    //   bare   step to the next cell of a table, or else move the cursor
    const dir = directionOf(key, store.tool);
    if (dir !== undefined) {
      const [dx, dy] = dir;

      if (press.shift) {
        // Same key, two meanings, and the mode says which: a rectangle of cells
        // by default, whole objects once object select is on.
        if (store.objectMode) store.growByObjects(dx, dy);
        else store.sweepBy(dx, dy, 'area');
        return;
      }
      if (press.alt) {
        // Nudge what is selected; with nothing selected there is nothing to
        // nudge, so the stride falls to the keyboard itself.
        if (store.selection === null) store.strideBy(dx, dy);
        else store.moveSelection(dx, dy);
        return;
      }
      if (store.selectNeighbourCell(dx, dy)) {
        const sel = useEditor.getState().selection;
        if (sel !== null) store.setCursor({ x: sel.bounds.x, y: sel.bounds.y });
        return;
      }
      store.moveCursor(dx, dy);
      return;
    }

    switch (key) {
      case 'Tab':
        store.toggleLabel();
        return;
      // Brush size only means anything to the eraser, and `[` and `]` are
      // characters a diagram wants. The tool that uses them keeps them.
      case '[':
        if (store.tool !== 'erase') break;
        store.setBrush(store.brush - 1);
        return;
      case ']':
        if (store.tool !== 'erase') break;
        store.setBrush(store.brush + 1);
        return;
      case 'Insert':
        store.toggleInsertMode();
        return;
      // Enter switches between the smallest shape under the keyboard and the
      // whole one (B-SEL-19) — the keyboard's answer to clicking and clicking
      // again, which is why the actions menu is on Ctrl+E.
      case 'Enter':
        store.cycleShape();
        return;
      case 'Escape':
        // The menu is the innermost thing open, so it goes first. Inside a
        // submenu it backs out one level rather than all the way.
        if (store.menuOpen) {
          store.leaveMenu();
          return;
        }
        shell.cancelGesture();
        // …and one more rung on the same ladder: out of the mode and back to
        // select (B-KEY-21). One press undoes one thing.
        if (store.tool !== 'select') {
          store.setTool('select');
          return;
        }
        store.setSelection(null);
        return;
      case 'Delete':
      case 'Backspace':
        store.deleteSelection();
        return;
      default:
        break;
    }

    // ---- writing, with no caret placed first ----
    //
    // Under the **text tool only**, a printable key writes at the keyboard cursor
    // and leaves a caret behind, so the second character onwards is ordinary
    // typing and Enter, Backspace and the arrows mean what they always mean.
    if (store.tool === 'text' && [...key].length === 1) {
      store.setCaret(store.cursor);
      useEditor.getState().typeAt(key);
    }
  };

  return {
    handle,
    stop: () => {
      if (pendingJ !== null && pendingJ.timer !== null) clearTimeout(pendingJ.timer);
      pendingJ = null;
    },
  };
}
