/**
 * The keyboard, in one place.
 *
 * Lifted out of `CanvasView` because it is a different kind of thing from the
 * rest of that file: the canvas host is about pixels — sizing, drawing, the
 * pointer's place on the grid — and this is about what a key *means*. Thirty-odd
 * bindings interleaved with a `ResizeObserver` and a `fillText` loop made both
 * harder to read than either is.
 *
 * Nothing here decides anything about the document. Every branch ends in a call
 * on the store, which is what keeps the single mutation path single (B-DOC-04),
 * and what lets the whole keymap be read top to bottom as a list of meanings.
 *
 * The order the branches are written in *is* the precedence, innermost first:
 *
 *     jk          back to select, before anything can read the `k` (B-KEY-23)
 *     Ctrl        tools, undo, the clipboard, the file, the jump
 *     menu        the directions and Enter, while the actions menu is open (B-UI-11)
 *     caret       a live caret owns typing (B-DRAW-11)
 *     chain       a line being drawn owns Enter and Escape (B-DRAW-14)
 *     draft       a shape being drawn owns Enter and Escape
 *     select      the mode letters, hjkl, the arrow keys, and everything else
 *
 * which is the same order Escape already unwinds in.
 *
 * ## Select is a mode (B-KEY-21)
 *
 * It used to write: a printable key typed at the cursor and left a caret
 * behind, so select and text were one tool. That is gone. Select is now the
 * mode you are *in*, and the plain letters are how you leave it — `b` box,
 * `t` text, `c` connect, `s` circle, from the one table the toolbar reads
 * (tools.ts). `Escape`, two taps of `Ctrl`, or `jk` comes back.
 *
 * The trade is the point. Point-and-type cost every letter on the keyboard —
 * which is exactly why tools were on `Ctrl`+digit, a shortcut nobody can guess
 * and the ribbon had to exist to teach. Giving up one gesture bought back
 * twenty-six keys, and the four that got spent are mnemonic.
 *
 * It also makes one rule true that was only nearly true before: **a caret
 * exists in the text mode and nowhere else.** The keyboard's one position
 * (B-UI-10) is a square while you are pointing and a bar while you are
 * writing, and now the mode says which rather than the history of what you
 * last clicked.
 */

import {
  copyDocument,
  openDocument,
  pasteDocument,
  saveDocument,
  useEditor,
} from '../state/store.ts';
import { toolForKey, toolForMode } from '../tools.ts';
import { ARROWS, directionOf, strideBy } from './steps.ts';
import type { Cell } from '../../core/geom/cell.ts';

/**
 * How close two taps of Shift have to be to count as one gesture. The platform
 * has no double-tap notion for a modifier the way it does for a click, so this
 * is ours; a shade longer than a typical double-click, because Shift is pressed
 * with the little finger.
 */
const DOUBLE_TAP_MS = 400;

/**
 * How soon `k` has to follow `j` for the pair to mean "back to select"
 * (B-KEY-23) rather than two letters.
 *
 * Short, because under the text mode the `j` is held back until the window
 * closes, and a letter that appears late is the price of the gesture. Rolled
 * off the home row the pair lands well inside it; typed as a word, `jk` would
 * need a pause, which is the same bargain every editor with this binding makes.
 */
const JK_MS = 300;

/** A key pressed on its own: no Ctrl, Meta or Alt. Shift changes the key itself. */
function bare(ev: KeyboardEvent, key: string): boolean {
  return ev.key === key && !ev.ctrlKey && !ev.metaKey && !ev.altKey;
}

/**
 * Listen for the lifetime of the canvas; hand back the teardown.
 *
 * `cancelGesture` is the one thing the keyboard needs from the view: Escape
 * abandons an in-flight drag, and that drag lives in a ref there because a
 * pointer handler reading it from React state would go stale.
 */
export function installKeyboard(cancelGesture: () => void): () => void {
  /** Whether anything was pressed while Shift was held (B-SEL-14). */
  let shiftUsed = true;
  /** When Shift was last tapped on its own, for the double-tap. */
  let lastShiftTap = 0;
  /** The same two, for Ctrl: two taps of it come back to select (B-KEY-21). */
  let ctrlUsed = true;
  let lastCtrlTap = 0;
  /**
   * Whether the live draft was started by Shift, and so ends when Shift does.
   *
   * A draft started with `Space` must not be committed by a Shift release —
   * that one was begun by a press and is owed an `Enter`. Only the gesture that
   * opened this way closes this way.
   */
  let shiftDraft = false;
  /**
   * A bare `j` pressed outside select, waiting to see whether `k` follows
   * (B-KEY-23).
   *
   * Under the text mode the `j` itself is held back, and `timer` writes it if
   * nothing comes: written and then taken back it would flicker onto the page
   * and leave an undo step behind for a letter nobody meant. Everywhere else
   * the `j` has already done what it does — a step down, or nothing — and only
   * the time is kept.
   */
  let pendingJ: { at: number; timer: ReturnType<typeof setTimeout> | null } | null = null;

  /** Let go of a waiting `j`, writing it if it was held back. */
  const releaseJ = (): void => {
    const held = pendingJ;
    pendingJ = null;
    if (held === null || held.timer === null) return;
    clearTimeout(held.timer);

    // Already out of the text mode — a toolbar click in the meantime — and the
    // letter goes with it rather than landing in a mode that does not write.
    const store = useEditor.getState();
    if (store.tool !== 'text') return;
    if (store.caret === null) store.setCaret(store.cursor);
    useEditor.getState().typeAt('j');
  };

  const typingInInput = (): boolean => {
    const el = document.activeElement;
    if (el === null) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  /** Where a paste lands: the caret, else the pointer, else the viewport corner. */
  const pasteAnchor = (): Cell => {
    const store = useEditor.getState();
    if (store.caret !== null) return store.caret;
    if (store.hover !== null) return store.hover;
    return { x: Math.floor(store.camera.ox), y: Math.floor(store.camera.oy) };
  };

  const onKeyDown = (ev: KeyboardEvent): void => {
    if (typingInInput()) return; // B-KEY-08

    // ---- `jk`: back to select (B-KEY-23) ----
    //
    // Answered before anything else can read the `k`: under text it would be
    // written, under the drawing modes it would only walk. Any other key means
    // the `j` was a letter after all, so it is let go — written, if it was held
    // back — *before* this key is read, and "ja" still comes out "ja".
    if (pendingJ !== null) {
      if (bare(ev, 'k') && Date.now() - pendingJ.at < JK_MS) {
        ev.preventDefault();
        const held = pendingJ;
        pendingJ = null;
        const now = useEditor.getState();
        if (held.timer !== null) {
          clearTimeout(held.timer); // the `j` is never written
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
    const mod = ev.ctrlKey || ev.metaKey;

    // Shift and Ctrl are both modifiers and, tapped twice on their own, both
    // gestures — object select (B-SEL-14) and the way back to select
    // (B-KEY-21). Telling the two readings apart cannot be done on the way
    // down: `Shift`+`ArrowRight` fires a Shift keydown exactly like a tap does,
    // and reading those as taps made every second sweep re-enter the mode and
    // throw away what had been swallowed.
    //
    // A tap is a press that nothing else happened during, so it is decided on
    // the way *up*. All this has to do is record whether anything did — and
    // each modifier counts as something happening to the other, so that
    // `Ctrl`+`Shift`+`S` is never mistaken for a tap of either.
    if (ev.key === 'Shift') {
      if (!ev.repeat) shiftUsed = false;
      ctrlUsed = true;
      return;
    }
    if (ev.key === 'Control' || ev.key === 'Meta') {
      if (!ev.repeat) ctrlUsed = false;
      shiftUsed = true;
      return;
    }
    shiftUsed = true;
    ctrlUsed = true;

    if (mod) {
      const key = ev.key.toLowerCase();

      // Tools live on Ctrl now, so that every plain letter is a letter — the
      // editor has real text in it, and a keyboard where `b` sometimes types
      // and sometimes changes tool is a keyboard you cannot trust. Which
      // key reaches which tool is the toolbar's own table (see tools.ts): the
      // numbered row by digit, and anything past it by a letter. Box keeps a
      // second mnemonic because `B` happened to be free.
      const byKey = toolForKey(key);
      if (byKey !== undefined) {
        ev.preventDefault();
        store.setTool(byKey);
        return;
      }
      if (key === 'b') {
        ev.preventDefault();
        store.setTool('box');
        return;
      }

      // Ctrl and an arrow is the **spreadsheet jump**: to the far wall of
      // the shape you are standing in, or across a gap to the next one. It
      // is one of the most universally learned keys there is and it was
      // spent on a sweep no other program binds there.
      //
      //   Ctrl        jump
      //   Ctrl+Shift  jump, dragging the selection out to it
      //   Ctrl+Alt    the reading-order sweep, moved off the universal key
      const step = ARROWS[ev.key];
      if (step !== undefined) {
        ev.preventDefault();
        const [jx, jy] = step;

        if (ev.shiftKey) {
          store.jumpSweep(jx, jy);
          return;
        }

        // With something selected, Ctrl carries it: one cell, or five with
        // Alt. With nothing selected there is nothing to carry, so the key
        // keeps the meaning it had — the jump, or the reading-order sweep.
        //
        // The exception is a sweep already running. A run of Ctrl+Alt presses
        // has to keep growing one selection rather than make one on the first
        // press and then drag it about on the second, so an open sweep anchor
        // wins over the move.
        const sweeping = ev.altKey && store.sweep !== null;
        if (store.selection !== null && !sweeping) {
          const [mx, my] = ev.altKey ? strideBy(jx, jy) : [jx, jy];
          store.moveSelection(mx, my);
          return;
        }

        if (ev.altKey) store.sweepBy(jx, jy, 'flow');
        else store.jumpBy(jx, jy);
        return;
      }

      if (key === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) store.redo();
        else store.undo();
      } else if (key === 'y') {
        ev.preventDefault();
        store.redo();
      } else if (key === 'c') {
        ev.preventDefault();
        void copyDocument(!ev.shiftKey && store.selection !== null);
      } else if (key === 'v') {
        ev.preventDefault();
        void pasteDocument(pasteAnchor());
      } else if (key === 'a') {
        ev.preventDefault();
        store.setTool('select');
        store.selectEverything();
      } else if (ev.key === 'Enter' && store.tool === 'select') {
        // Ctrl+A takes everything on the page; this takes everything *joined
        // up* — the shape, the lines running out of it, and whatever those run
        // into (B-SEL-19). Its plain `Enter` counterpart deliberately stops at
        // the shape, so the pair is "this thing" and "this thing and all it
        // touches", which is the distinction a diagram actually has.
        //
        // It reaches where Escape cannot: Escape clears a selection only when
        // the keyboard is not writing, since inside a run of text it belongs to
        // the caret. This branch runs above the caret's. The caret is left
        // alone either way.
        //
        // Only under select, because that is the only tool that holds a
        // selection at all: `setTool` drops it for every other one.
        ev.preventDefault();
        store.selectConnected();
      } else if (key === 'e') {
        // The actions menu. It was on plain `Enter`, which `Enter` now needs
        // for the far commoner job of widening the selection — a menu of two
        // items does not earn the most reachable key on the keyboard.
        // `openMenu` still decides whether there is anything to offer.
        ev.preventDefault();
        store.openMenu();
      } else if (key === 'd') {
        ev.preventDefault();
        store.duplicateSelection();
      } else if (key === 'o') {
        ev.preventDefault();
        void openDocument();
      } else if (key === 's') {
        ev.preventDefault();
        void saveDocument(ev.shiftKey);
      } else if (key === '0') {
        ev.preventDefault();
        store.setCamera({ ...store.camera, zoom: 1 }); // B-CAM-07
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        store.setCamera({ ox: 0, oy: 0, zoom: store.camera.zoom });
      }
      return;
    }

    // A bare `j` outside select may be the first half of `jk` (B-KEY-23). Not a
    // held-down one: holding `j` to walk and then tapping `k` to step back is
    // walking, and under text a held `j` is a row of them.
    if (bare(ev, 'j') && !ev.repeat && store.tool !== 'select') {
      if (store.tool === 'text') {
        ev.preventDefault();
        pendingJ = { at: Date.now(), timer: setTimeout(releaseJ, JK_MS) };
        return;
      }
      pendingJ = { at: Date.now(), timer: null };
    }

    // ---- an open menu owns the keyboard (B-UI-11) ----
    //
    // The innermost thing open goes first, which is the order Escape already
    // follows. Only the directions and Enter are taken; everything else --
    // Escape above all -- falls through to mean what it always means.
    //
    // The directions are the arrows and, as everywhere in select, `hjkl`
    // (B-KEY-22): the hand that opened the menu with `e` is on the home row.
    if (store.menuOpen) {
      const dir = directionOf(ev.key, store.tool);
      if (dir !== undefined) {
        ev.preventDefault();
        const [dx, dy] = dir;
        // Sideways steps along a row. Up and down walk the rows, which are
        // stacked deepest at the bottom (B-UI-11b): down into the lit group, up
        // back out of the row you are in — from *End 2*'s decorations back to
        // choosing an end. Off either edge the menu is put away, so down on a
        // plain option still puts it away as it always did.
        if (dx !== 0) store.moveMenu(dx);
        else if (dy > 0) store.descendMenu();
        else store.leaveMenu();
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        store.activateMenu();
        return;
      }
    }

    // ---- a live caret owns the keyboard (B-DRAW-11) ----

    if (store.caret !== null) {
      switch (ev.key) {
        case 'Escape':
          // Out of the writing and back to select in one press, the way every
          // modal editor does it. A caret only ever exists under the text tool
          // now (B-KEY-21), so dismissing it and leaving the mode are the same
          // act — two presses for one thought would be the modality showing
          // through as bookkeeping.
          store.setCaret(null);
          store.setTool('select');
          return;
        case 'Enter':
          ev.preventDefault();
          store.newline();
          return;
        case 'Backspace':
          ev.preventDefault();
          store.backspace();
          return;
        case 'Tab':
          ev.preventDefault();
          // Inside a shape, Tab crosses to the shape — including out of a
          // shape that is still empty, where there is no text selection to
          // recognise and the caret's own container is the way back. Loose on
          // the page there is nothing to cross to, so it indents.
          if (!store.toggleLabel()) store.moveCaret(4, 0);
          return;
        case 'Insert':
          ev.preventDefault();
          store.toggleInsertMode();
          return;
        // The caret walks the text; Shift drags the text itself, the same
        // division as a table cell. Both are "bare key moves you, Shift moves
        // the thing", which is one rule to learn rather than two.
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          ev.preventDefault();
          const dx = ev.key === 'ArrowLeft' ? -1 : ev.key === 'ArrowRight' ? 1 : 0;
          const dy = ev.key === 'ArrowUp' ? -1 : ev.key === 'ArrowDown' ? 1 : 0;

          const sel = store.selection;

          // Alt is a stride while writing too, but only with nothing
          // selected — with a run selected Shift is already what moves it,
          // and two keys for one job is how a keymap starts to rot.
          if (ev.altKey && sel === null) {
            store.strideBy(dx, dy);
            return;
          }
          if (ev.shiftKey && sel !== null) {
            store.moveSelection(dx, dy);
            // Carry the caret by however far the text actually went — a nudge
            // clamps at the origin, and a caret left behind would type into
            // the wrong cell.
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
      if (ev.key.length === 1) {
        ev.preventDefault();
        store.typeAt(ev.key);
      }
      return;
    }

    // A line being drawn corner by corner owns Enter and Escape (B-DRAW-14).
    if (store.chain !== null) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        store.commitChain();
        return;
      }
      if (ev.key === 'Escape') {
        store.cancelChain();
        return;
      }
    }

    // ---- drawing from the keyboard ----
    //
    // Space is the press and Enter is the release. That is the whole model,
    // and it is the same gesture the pointer makes, so the two tools do not
    // have to be learned twice: a box wants two corners, a line wants a
    // corner per press, and both end on Enter.
    //
    // Space no longer pans. It is worth more here than it was there, and
    // middle-drag still pans.
    if (ev.code === 'Space' && !ev.repeat) {
      const t = store.tool;
      if (t === 'box' || t === 'circle') {
        ev.preventDefault();
        store.startDraft(t);
        return;
      }
      if (t === 'line' || t === 'arrow') {
        ev.preventDefault();
        store.addChainPoint(store.cursor, 'keyboard');
        return;
      }
      // Under select there is nothing to draw, so a space is a space and
      // falls through to the writing below.
    }

    if (store.draft !== null && (ev.key === 'Enter' || ev.key === 'Escape')) {
      ev.preventDefault();
      // Escape while Shift is still down: the draft is gone, so the release
      // that follows has nothing left to commit.
      shiftDraft = false;
      if (ev.key === 'Enter') store.commitDraft();
      else store.cancelDraft();
      return;
    }

    // The cursor moves in every tool. With a shape being drafted it drags the
    // free corner; with a chain running it aims the next segment; on its own
    // it is just where the keyboard is.
    //
    // `hjkl` says all of that too, under the drawing modes (B-KEY-22): the
    // point of the home row is that `b` and the box it draws are one gesture,
    // and a step that stopped working the moment the mode changed would have
    // left the hand reaching for the arrows anyway. Text is the exception
    // `VIM_TOOLS` names — there a letter is a letter.
    //
    // Alt strides here on the same terms as everywhere else (B-KEY-19). A
    // drawing tool never holds a selection — `setTool` drops it — so there is
    // nothing to nudge by construction and the stride is all Alt can mean:
    // five cells of cursor, or five cells of the corner being dragged.
    const drawStep = store.tool === 'select' ? undefined : directionOf(ev.key, store.tool);
    if (drawStep !== undefined) {
      ev.preventDefault();
      const [dx, dy] = drawStep;

      // Shift and an arrow — or Shift and `hjkl`, the same key twice — draws a
      // box in **one** gesture: the first press pins the corner the cursor is
      // standing on, the rest stretch it, and letting go of Shift is the
      // release (B-DRAW-15).
      //
      // Space and Enter still do the same job, and neither replaces the other.
      // That pair is a gesture you decide to start; this one you simply
      // perform — Shift is already under the little finger, and holding it is
      // itself the statement that a shape is being drawn. It is the keyboard's
      // answer to press-drag-release, right down to being over when the hand
      // relaxes.
      if (ev.shiftKey && store.tool === 'box' && store.draft === null) {
        store.startDraft('box');
        shiftDraft = true;
      }
      // A stride stops at a wall (B-KEY-19a), which is worth as much to a corner
      // being dragged as to the keyboard on its own: it is how a new box is lined
      // up against one that is already there.
      if (ev.altKey) store.strideBy(dx, dy);
      else store.moveCursor(dx, dy);
      return;
    }

    // ---- select is a mode, and a plain letter leaves it (B-KEY-21) ----
    //
    // `b` box · `t` text · `c` connect · `s` circle, read off the same table
    // the toolbar and the `Ctrl` keys come from (tools.ts), so the letter on a
    // button and the letter that works are one fact.
    //
    // Only from select, and only bare. Under any other tool these are just
    // letters with nothing to do — which is the point of a mode: `b` means box
    // *here*, and the way back to here is `Escape` or two taps of `Ctrl`.
    // Alt is excluded because `Alt`+arrow is the nudge and `Alt`+letter is the
    // window manager's.
    if (store.tool === 'select' && !ev.altKey) {
      const mode = toolForMode(ev.key);
      if (mode !== undefined) {
        ev.preventDefault();
        store.setTool(mode);
        // The writing mode is entered *at the keyboard*, not at whatever was
        // clicked last. `hjkl` to the cell, `t`, and type — with no caret the
        // text tool would be waiting for a click, which is the one thing the
        // hand on the home row is not about to do.
        if (mode === 'text') useEditor.getState().setCaret(store.cursor);
        return;
      }

      // `e` is `Ctrl`+`E` without the `Ctrl` (B-UI-11): select does not write,
      // so the letter is free here, and the menu is the one thing select has to
      // offer that was still a chord away. `openMenu` decides, as it does for
      // the chord, whether there is anything to open.
      if (ev.key === 'e') {
        ev.preventDefault();
        store.openMenu();
        return;
      }
    }

    // Arrows, and `hjkl` for the same four directions (B-KEY-22). Taken
    // together rather than as two branches, because every modifier below has
    // to mean the same thing on both — they are one key with two spellings.
    //
    // Only select reaches here: the drawing modes were answered above, and the
    // rest have no `hjkl` at all.
    const dir = directionOf(ev.key, store.tool);

    // Four things a direction can mean in select mode, and the modifier says
    // which:
    //
    //   Shift  sweep a rectangle — or whole objects, in object select
    //   Alt    nudge whatever is selected
    //   bare   step to the next cell of a table, or else move the cursor
    //
    // Ctrl is the fourth — the jump, and the reading-order sweep — and is
    // handled with the other Ctrl keys above, because that branch runs first.
    // It is also the one that has no `hjkl` spelling, the browser having taken
    // `Ctrl`+`L` and `Ctrl`+`J`.
    if (dir !== undefined) {
      ev.preventDefault();
      const [dx, dy] = dir;

      if (ev.shiftKey) {
        // Same key, two meanings, and the mode says which: a rectangle of
        // cells by default, whole objects once Shift has been tapped twice.
        // Both are Shift because both answer "extend the selection", which
        // is what Shift means everywhere; the double tap only changes the
        // unit it extends by.
        if (store.objectMode) store.growByObjects(dx, dy);
        else store.sweepBy(dx, dy, 'area');
        return;
      }
      if (ev.altKey) {
        // Nudge what is selected; with nothing selected there is nothing to
        // nudge, so the stride falls to the keyboard itself rather than the
        // key doing nothing at all.
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

    switch (ev.key) {
      case 'Tab':
        ev.preventDefault();
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
      // whole one — a table cell and its table, one of two flush boxes and the
      // pair (B-SEL-19). It stops at the shape: a connector and the box on the
      // far end of it are `Ctrl`+`Enter`, above.
      //
      // This is the keyboard's answer to clicking and clicking again, and it
      // is why the actions menu moved to `Ctrl`+`E` — widening a selection is
      // the thing a hand on the keyboard wants constantly, and a two-item menu
      // is not.
      case 'Enter':
        ev.preventDefault();
        store.cycleShape();
        return;
      case 'Escape':
        // The menu is the innermost thing open, so it goes first — the same
        // order the gesture and the selection already follow. Inside a submenu
        // it backs out one level rather than all the way, which is the same
        // "undo the last step" Escape means everywhere else.
        if (store.menuOpen) {
          store.leaveMenu();
          return;
        }
        cancelGesture();
        // …and one more rung on the same ladder: out of the mode and back to
        // select (B-KEY-21). It is below the chain and the draft, which have
        // their own Escape above, so a half-drawn line is abandoned by the
        // first press and the mode left by the second — one press undoes one
        // thing, which is what Escape has always meant here.
        if (store.tool !== 'select') {
          store.setTool('select');
          return;
        }
        store.setSelection(null);
        return;
      case 'Delete':
      case 'Backspace':
        ev.preventDefault();
        store.deleteSelection();
        return;
      default:
        break;
    }

    // ---- writing, with no caret placed first ----
    //
    // Under the **text tool only**, a printable key writes at the keyboard
    // cursor and leaves a caret behind, so the second character onwards is
    // ordinary typing (the caret branch above owns it) and Enter, Backspace
    // and the arrow keys mean what they always mean.
    //
    // This used to hold under select as well, which is what made select and
    // text one tool. It is now what makes them two: entering the text mode is
    // the statement that the next keystroke is a character rather than a
    // command, and without that statement a letter is a command (B-KEY-21).
    // The branch survives for the case of arriving by the toolbar button
    // rather than by `t`, where nothing has placed a caret yet — without it
    // the tool would sit there waiting for a click.
    if (store.tool === 'text' && ev.key.length === 1) {
      ev.preventDefault();
      store.setCaret(store.cursor);
      useEditor.getState().typeAt(ev.key);
    }
  };

  const onKeyUp = (ev: KeyboardEvent): void => {
    if (typingInInput()) return; // B-KEY-08

    // Two taps of Ctrl are the way back to select (B-KEY-21), read on the way
    // up for the same reason Shift's are: `Ctrl`+`S` fires a Ctrl keydown
    // exactly as a tap does, and only the release knows whether anything
    // happened in between.
    //
    // Escape does this too and is the one most people will reach for. This is
    // for the hand that never leaves the home row — `Ctrl` is under the little
    // finger, where `Escape` is a stretch, and a modal editor is worth nothing
    // if getting back to the mode you live in is the most awkward key on the
    // board.
    if (ev.key === 'Control' || ev.key === 'Meta') {
      if (ctrlUsed) return;
      const now = Date.now();
      if (now - lastCtrlTap < DOUBLE_TAP_MS) {
        lastCtrlTap = 0;
        useEditor.getState().setTool('select');
      } else {
        lastCtrlTap = now;
      }
      return;
    }

    if (ev.key !== 'Shift') return;

    // Letting go is the release of the box gesture above. It is checked before
    // the tap test rather than after, because the arrows that drew the box are
    // exactly what stops this being a tap — the two readings of Shift are told
    // apart by what happened while it was held, and this is one of them.
    //
    // A draft that has since been abandoned — by Escape, by another tool, by a
    // mouse press — leaves nothing to commit, and `commitDraft` says so.
    if (shiftDraft) {
      shiftDraft = false;
      useEditor.getState().commitDraft();
      return;
    }

    // A clean tap: Shift went down and came back up with nothing between.
    if (shiftUsed) return;

    const now = Date.now();
    if (now - lastShiftTap < DOUBLE_TAP_MS) {
      lastShiftTap = 0;
      useEditor.getState().enterObjectMode();
    } else {
      lastShiftTap = now;
    }
  };

  // A press of the pointer is something happening too: a `j` held back under
  // the text mode is written where the caret was, before the click can move
  // it, rather than turning up wherever the click put it.
  const onPointerDown = (): void => {
    releaseJ();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('pointerdown', onPointerDown, true);
    if (pendingJ !== null && pendingJ.timer !== null) clearTimeout(pendingJ.timer);
  };
}
