/**
 * Editor state, split in two on purpose.
 *
 *  - the grid is the document: undoable, and the only thing that would ever
 *    be saved or synced
 *  - everything else is session state: tool, camera, selection, caret, charset.
 *    Never undoable, never saved (B-SEL-05, B-HIST-05)
 *
 * `apply` is the sole mutation path (B-DOC-04).
 *
 * ── The store holds no decisions ──────────────────────────────────────────
 *
 * Every operation that changes the document — move, resize, type, add a column
 * — is a pure planner in `src/core/ops/` returning a `Plan`, and the action here
 * is the same three lines each time:
 *
 *     const plan = planMove(grid, selection, dx, dy, opts);
 *     get().runPlan(plan, { keepSelection: true });
 *
 * `runPlan` is where a refusal becomes a notice and a diff becomes an undo step.
 * That is what lets the refusal rules (nesting §7, content §5) live in exactly
 * one place each, and what makes "one gesture, one undo step" structural rather
 * than a thing every new operation has to remember (intuitive/plan.md §2).
 */

import { create } from 'zustand';
import {
  boundsOf,
  ck,
  rectContains,
  rectFromCorners,
  unck,
  type Cell,
  type CellKey,
  type Rect,
} from '../../core/geom/cell.ts';
import { applyDiff, createGrid, type CellDiff, type Grid } from '../../core/grid/grid.ts';
import { jumpFrom, strideFrom } from '../../core/grid/jump.ts';
import { strideBy } from '../canvas/steps.ts';
import { CHARSETS, charsetOf, type Charset } from '../../core/charset/charsets.ts';
import { History } from '../../core/history/history.ts';
import {
  fromCells,
  recognize,
  selectAll,
  selectFlow,
  selectWithin,
  type Candidate,
} from '../../core/recognize/recognize.ts';
import {
  candidatesAt,
  defaultIndex,
  nextIndex,
} from '../../core/recognize/rank.ts';
import { objectAt, smallestObjectAt, swallowFrom } from '../../core/recognize/objects.ts';
import { borderKeys, stampBox, eraseCells } from '../../core/stamp/box.ts';
import { stampEllipse } from '../../core/stamp/ellipse.ts';
import { stampPath, stampPolyline, type PathOptions } from '../../core/stamp/path.ts';
import { brushKeys, eraseWithHeal, MAX_BRUSH, MIN_BRUSH } from '../../core/stamp/erase.ts';
import { eraseChar, pasteDiff } from '../../core/stamp/text.ts';
import { stampStroke } from '../../core/stamp/freehand.ts';
import { movedKeys } from '../../core/transform/move.ts';
import { planMove } from '../../core/ops/move.ts';
import { planResize } from '../../core/ops/resize.ts';
import {
  canDivide,
  planAddColumn,
  planAddRow,
  neighbourCell,
  planResizeTrack,
  type Rail,
} from '../../core/ops/lattice.ts';
import { planNewline, planType } from '../../core/ops/typing.ts';
import { endCells, endsOf, planLineEnd, type LineEnd } from '../../core/ops/lineend.ts';
import { containersAt, enclosesArea } from '../../core/derive/contain.ts';
import { travellingWith } from '../../core/derive/gather.ts';
import { labelBoundsOf, textBlockAt } from '../../core/derive/label.ts';
import type { Plan } from '../../core/ops/plan.ts';
import { convertCharset } from '../../core/transform/convert.ts';
import { toText } from '../../core/io/text.ts';
import { DEFAULT_FILENAME, platform } from '../../platform/index.ts';
import {
  clampCamera,
  clampZoom,
  type Camera,
  type OriginMode,
} from '../canvas/camera.ts';
import type { ToolId } from '../tools.ts';

/**
 * The readings of the last click, and which one is showing (B-REC-11).
 * Session state: clicking elsewhere or mutating the document drops it.
 */
export interface Drill {
  key: CellKey;
  index: number;
  list: Candidate[];
}

const history = new History();

/**
 * The block of text at a cell, as a selection.
 *
 * A run of letters on one row is what the recognizer can say from characters
 * alone; a paragraph, or everything written inside a box, is what a person
 * means. `textBlockAt` decides which by asking where the text is.
 */
function textSelection(grid: Grid, at: Cell): Candidate | null {
  const inside = containersAt(grid, at.x, at.y)[0];
  const cells = textBlockAt(grid, inside?.bounds ?? null, at.x, at.y);
  const bounds = boundsOf(cells);
  return bounds === null ? null : { kind: 'text', cells, bounds };
}

/**
 * What the actions menu offers, in the order it shows them.
 *
 * Here rather than in the component because the menu is now driven by the
 * keyboard as well as the pointer (B-UI-11), and "the item at index 1" has to
 * mean the same thing to the key that runs it as to the button that draws it.
 * Two lists would drift the first time one of them gained an entry.
 */
/** A thing the menu can do. */
export interface MenuAction {
  label: string;
  title: string;
  run: (state: EditorState) => void;
  /**
   * What this item is about, lit up on the canvas while it is pointed at.
   * "End 1" and "End 2" mean nothing until you can see which end is which.
   */
  hint?: (state: EditorState) => ReadonlySet<CellKey> | null;
}

/** A thing the menu can open. */
export interface MenuGroup {
  label: string;
  title: string;
  items: readonly MenuNode[];
  hint?: (state: EditorState) => ReadonlySet<CellKey> | null;
}

export type MenuNode = MenuAction | MenuGroup;

export function isGroup(node: MenuNode): node is MenuGroup {
  return 'items' in node;
}

/**
 * What the menu offers, worked out from what is selected.
 *
 * Here rather than in the component because the keyboard drives this menu as
 * well as the pointer (B-UI-11), and "the item at index 1" has to mean the same
 * thing to the key that runs it as to the button that draws it. Two lists would
 * drift the first time one of them gained an entry.
 *
 * A box is offered its lattice; a line is offered its ends and the style it is
 * drawn in. Nothing else has anything to be asked about yet, and a menu that
 * opens on everything to say nothing is worse than one that stays shut.
 */
export function menuFor(state: EditorState): readonly MenuNode[] {
  const { grid, selection } = state;
  if (selection === null) return [];

  if (canDivide(selection)) {
    return [
      { label: 'Add column', title: 'Widen the box by one column', run: (s) => s.addColumn() },
      { label: 'Add row', title: 'Deepen the box by one row', run: (s) => s.addRow() },
    ];
  }

  const ends = endsOf(grid, selection.cells);
  if (ends === null) return [];

  return [
    {
      label: 'Style',
      title: 'Redraw this line in another character set',
      items: Object.values(CHARSETS).map((cs) => ({
        label: cs.label,
        title: `Draw this line with ${cs.label} characters`,
        run: (s: EditorState) => { s.restyleSelection(cs.id); },
      })),
    },
    {
      label: 'Line end',
      title: 'What sits at each end of the line',
      items: ends.map((end, which) => ({
        label: `End ${String(which + 1)}`,
        title: `The end at ${String(end.at.x)}, ${String(end.at.y)}`,
        items: END_KINDS.map((kind) => ({
          label: kind.label,
          title: kind.title,
          run: (s: EditorState) => { s.setLineEnd(which, kind.id); },
          hint: (s: EditorState) =>
            s.selection === null ? null : endCells(s.selection.cells, end.at),
        })),
        // Pointing at the end itself lights it up, which is what makes "End 1"
        // and "End 2" tell each other apart at all.
        hint: (s: EditorState) =>
          s.selection === null ? null : endCells(s.selection.cells, end.at),
      })),
    },
  ];
}

/**
 * The decorations an end can wear.
 *
 * Three so far. *Exactly one* is a bar across the run, written with the weak
 * decoration family (B-LINE-04) rather than with the `|` the notation is
 * conventionally drawn with — `|` is a line glyph, so a wire ending in one
 * would be read straight back as more wire.
 *
 * *Many* — the crow's foot itself — is not here yet for want of a character
 * rather than for want of machinery: the family now exists and takes one more
 * entry, but `<` and `>` are already the ASCII arrowheads, so the glyph it
 * should use is a decision about what lands in the saved `.txt`.
 */
const END_KINDS: ReadonlyArray<{ id: LineEnd; label: string; title: string }> = [
  { id: 'normal', label: 'Normal', title: 'A plain end, with nothing on it' },
  { id: 'arrow', label: 'Arrow', title: 'An arrowhead pointing away from the line' },
  { id: 'one', label: '1 to 1', title: 'A bar across the line: exactly one' },
];

/** Bumped whenever a typing run should start a fresh undo entry. */
let typingRun = 0;

interface ApplyOptions {
  /** Moves keep their selection; everything else clears it (B-SEL-07). */
  keepSelection?: boolean;
  /** Consecutive mutations sharing a run id collapse into one undo step. */
  run?: string;
}

export interface EditorState {
  grid: Grid;
  /** Bumped on every mutation; the renderer watches this, not the Map. */
  revision: number;

  tool: ToolId;
  charsetId: string;
  selection: Candidate | null;
  drill: Drill | null;
  camera: Camera;
  originMode: OriginMode;
  /** Cell under the pointer, for the status bar and hover highlight. */
  hover: Cell | null;
  /** Where typing lands, and the column `Enter` returns to (B-DRAW-11). */
  caret: Cell | null;
  caretHome: number;
  /** Typing pushes the rest of the word right instead of overwriting it. */
  insertMode: boolean;
  brush: number;
  /** Lines follow the shape they are attached to when it moves (B-MAN-11). */
  sticky: boolean;
  /** Vertices of the line being drawn click by click, before it is committed. */
  chain: Cell[] | null;
  /**
   * Which input is aiming the chain, and so what its unplaced last leg follows
   * (B-DRAW-14d). Meaningless while `chain` is null.
   *
   * A pointer merely *resting* on the canvas must not take over a line being
   * drawn with the arrow keys — that is not a gesture, it is where the hand
   * happens to be. Only an act hands the chain over, and both acts place a
   * corner: a click, or a `Space`. Same line the rest of the editor already
   * draws, where a pointer *press* abandons a keyboard draft and a hover does
   * nothing at all.
   */
  chainAim: 'pointer' | 'keyboard';
  /**
   * The keyboard's place on the grid. Never null: every tool has one, and it is
   * what the arrow keys move. The pointer has `hover`; this is its equal for
   * people who are not holding a mouse.
   */
  cursor: Cell;
  /**
   * A shape being drawn from the keyboard: one corner pinned, the cursor the
   * other. Session state — it is a gesture in progress, not a thing in the
   * document, and it dies the moment a pointer says otherwise.
   */
  draft: { kind: 'box' | 'circle'; anchor: Cell } | null;
  /** Where a Shift or Ctrl selection sweep started. */
  sweep: Cell | null;
  /**
   * Object select: Shift and an arrow grow the selection by whole objects
   * rather than by cells (B-SEL-14). Deliberately unshown — it is entered by a
   * double-tap of Shift and left by anything that moves the selection another
   * way, so it never outlives the run of keys that asked for it.
   */
  objectMode: boolean;
  /**
   * The actions menu on the selection. Session state, so it is not undoable and
   * would never sync: it is a thing the pointer is doing, not a thing the
   * document is.
   */
  menuOpen: boolean;
  /**
   * Where the keyboard is in the open menu: one index per level, the last
   * being the highlighted item and the ones before it the groups opened to
   * reach it. `[1, 0]` is "the first item of the second group".
   */
  menuPath: readonly number[];
  /** Cells an item is about, lit up while it is pointed at (B-UI-16). */
  menuHint: ReadonlySet<CellKey> | null;
  canUndo: boolean;
  canRedo: boolean;

  fileName: string;
  dirty: boolean;
  /** Transient note for the status bar: saved, opened, blocked, and so on. */
  notice: string | null;

  charset: () => Charset;
  apply: (diff: CellDiff, opts?: ApplyOptions) => void;

  setTool: (tool: ToolId) => void;
  setCharset: (id: string) => void;
  setCamera: (cam: Camera) => void;
  setSelection: (sel: Candidate | null) => void;
  setHover: (cell: Cell | null) => void;
  setCaret: (cell: Cell | null) => void;
  setBrush: (n: number) => void;
  toggleInsertMode: () => void;
  toggleSticky: () => void;
  setNotice: (text: string | null) => void;

  /** Click-by-click line drawing (B-DRAW-14). */
  addChainPoint: (cell: Cell, from: 'pointer' | 'keyboard') => void;
  commitChain: () => void;
  cancelChain: () => void;

  selectAt: (cell: Cell) => Candidate | null;
  /** A repeat click on the same cell: step to the next reading (B-REC-11). */
  drillAt: (cell: Cell) => Candidate | null;
  /**
   * Add what is under the pointer to the selection, or drop it if it is in
   * already. `component` takes the whole connected thing, `piece` takes only
   * the reading a plain click would (B-SEL-09).
   */
  toggleAt: (cell: Cell, scope: 'piece' | 'component') => void;
  selectRegion: (r: Rect) => Candidate | null;
  selectEverything: () => void;

  drawBox: (r: Rect) => void;
  drawEllipse: (r: Rect) => void;
  drawPath: (from: Cell, to: Cell, opts: PathOptions) => void;
  eraseAt: (cells: Iterable<CellKey>) => void;
  /** A freehand stroke, as the cells the pointer passed through. */
  drawStroke: (samples: readonly Cell[]) => void;

  /** `cells` is the set gathered at pointer-down; omitted, it is derived. */
  moveSelection: (dx: number, dy: number, cells?: ReadonlySet<CellKey>) => void;
  resizeSelection: (to: Rect) => void;
  runPlan: (plan: Plan, opts?: ApplyOptions) => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;

  /** Tab across between a shape and the text written inside it. */
  /**
   * Cross between a shape and what is written in it. Answers whether there was
   * anything to cross to, so the caller can fall back — `Tab` on loose text
   * still has to indent.
   */
  toggleLabel: () => boolean;

  /** Move the keyboard cursor, clamped at the origin. */
  moveCursor: (dx: number, dy: number) => void;
  setCursor: (cell: Cell) => void;
  /** Begin, commit or abandon a shape drawn from the keyboard. */
  startDraft: (kind: 'box' | 'circle') => void;
  commitDraft: () => void;
  cancelDraft: () => void;
  /** Move the cursor and extend a selection to it from the sweep anchor. */
  sweepBy: (dx: number, dy: number, mode: 'flow' | 'area') => void;
  /** `Ctrl`+arrow: to the edge of what is filled, the spreadsheet jump. */
  jumpBy: (dx: number, dy: number) => void;
  /** `Alt`+arrow: a stride, stopping at the first wall across it (B-KEY-19a). */
  strideBy: (dx: number, dy: number) => void;
  /** The same jump, dragging a selection out to where it lands. */
  jumpSweep: (dx: number, dy: number) => void;
  /** `Enter`: switch between the smallest shape here and the whole one. */
  cycleShape: () => void;
  /** `Ctrl`+`Enter`: everything connected, lines and what they lead to included. */
  selectConnected: () => void;
  /** Double-tap Shift: take the smallest object under the keyboard (B-SEL-14). */
  enterObjectMode: () => void;
  /** Push the selection one cell and swallow whatever it reaches (B-SEL-15). */
  growByObjects: (dx: number, dy: number) => void;

  /** Right-click actions on the selection. */
  openMenu: () => void;
  closeMenu: () => void;
  /** Step between the open menu's items at the current level, wrapping. */
  moveMenu: (delta: number) => void;
  /** Open the highlighted group, or run the highlighted item. */
  activateMenu: () => void;
  /** Back out of a submenu; at the top level, close (B-UI-11). */
  leaveMenu: () => void;
  /** Down a row: into the lit group, or off the bottom of the menu (B-UI-11b). */
  descendMenu: () => void;
  /**
   * A click on the item at `path`: a leaf runs, a group opens, and a group
   * already open shuts again — the pointer's way back (B-UI-11b).
   */
  pickMenu: (path: readonly number[]) => void;
  /** The pointer over the item at `path`, or off the menu with `[]` (B-UI-11b). */
  pointMenu: (path: readonly number[]) => void;
  /** Redraw the selection in another character set. */
  restyleSelection: (charsetId: string) => void;
  /** Put a decoration on one of a selected line's ends. */
  setLineEnd: (which: number, end: LineEnd) => void;
  addColumn: () => void;
  addRow: () => void;
  /** Widen or deepen the track beside a separator (tables §7). */
  resizeTrack: (rail: Rail, by: number) => void;
  /** Step the selection to the next cell of its table. False when there is none. */
  selectNeighbourCell: (dx: number, dy: number) => boolean;

  typeAt: (ch: string) => void;
  newline: () => void;
  backspace: () => void;
  moveCaret: (dx: number, dy: number) => void;

  paste: (text: string, at: Cell) => void;
  loadText: (text: string, name: string) => void;

  undo: () => void;
  redo: () => void;
  clearAll: () => void;
  text: () => string;
  selectionText: () => string;
}

export const useEditor = create<EditorState>((set, get) => ({
  grid: createGrid(),
  revision: 0,

  tool: 'select',
  charsetId: 'unicode', // B-CS-01
  selection: null,
  drill: null,
  camera: { ox: 0, oy: 0, zoom: 1 },
  originMode: 'quadrant', // B-PLANE-05
  hover: null,
  caret: null,
  caretHome: 0,
  insertMode: false,
  brush: 1,
  sticky: true, // B-MAN-11
  chain: null,
  chainAim: 'pointer',
  cursor: { x: 0, y: 0 },
  draft: null,
  sweep: null,
  objectMode: false,
  menuOpen: false,
  menuPath: [0],
  menuHint: null,
  canUndo: false,
  canRedo: false,

  fileName: DEFAULT_FILENAME,
  dirty: false,
  notice: null,

  charset: () => charsetOf(get().charsetId),

  apply: (diff, opts) => {
    if (diff.size === 0) return;
    const { grid, revision, selection } = get();

    const inverse = applyDiff(grid, diff);
    if (inverse.size === 0) return;
    history.record(inverse, opts?.run);

    set({
      revision: revision + 1,
      dirty: true,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      selection: opts?.keepSelection === true ? selection : null,
      // Any edit invalidates the readings: they describe cells as they were.
      drill: null,
      // …and the menu, which is anchored to a shape that has just changed.
      menuOpen: false,
    });
  },

  setTool: (tool) => {
    // Leaving the line tool with a chain in progress confirms it, rather than
    // silently throwing away what was drawn (B-DRAW-14).
    if (get().chain !== null) get().commitChain();

    set({
      tool,
      // Select keeps whatever is selected. The text tool keeps it too, but
      // only when it is **a run of text** — that is the one selection the tool
      // can act on, and carrying it is what makes "click the word, press `t`,
      // type" write *between* the characters rather than over them (`typeAt`
      // reads the selection to decide). A box carried into the text tool would
      // mean nothing, so it is dropped as before.
      selection:
        tool === 'select' || (tool === 'text' && get().selection?.kind === 'text')
          ? get().selection
          : null,
      drill: tool === 'select' ? get().drill : null,
      // **A caret exists under the text tool and nowhere else** (B-KEY-21).
      //
      // Select used to hold one too, so that crossing between the two kept
      // what you were writing — which made sense while select also wrote. Now
      // that it does not, a caret left live under select would be a blinking
      // bar that swallows nothing: `b` would still mean box, and the marker
      // would be claiming otherwise. The keyboard's one position (B-UI-10) is
      // drawn as a bar exactly when the mode is the writing one.
      caret: tool === 'text' ? get().caret : null,
      // A half-drawn shape is abandoned, which is the opposite of what the
      // chain above gets and for the opposite reason. A chain is a list of
      // corners each of which was already committed to by a press; a draft is
      // one rectangle that exists only while it is being aimed. Reaching for
      // another tool is a way of saying "not this", so it means Escape.
      draft: null,
      menuOpen: false,
    });
  },

  setCharset: (id) => {
    const { grid, apply } = get();
    const diff = convertCharset(grid, charsetOf(id));
    set({ charsetId: id });
    apply(diff, { keepSelection: true });
  },

  setCamera: (cam) =>
    set({
      camera: clampCamera({ ...cam, zoom: clampZoom(cam.zoom) }, get().originMode),
    }),

  setSelection: (selection) => set({ selection, drill: null, menuOpen: false, objectMode: false }),

  setHover: (hover) => set({ hover }),

  setCaret: (caret) => {
    typingRun++; // a repositioned caret starts a new undo entry
    // One place, two readings. The keyboard has a single position; whether it
    // is drawn as a bar or as a square is a question about what that position
    // is *for*, and never about where it is (B-UI-10).
    set({ caret, caretHome: caret?.x ?? 0, ...(caret === null ? {} : { cursor: caret }) });
  },

  setBrush: (n) => set({ brush: Math.max(MIN_BRUSH, Math.min(MAX_BRUSH, Math.round(n))) }),

  toggleInsertMode: () => set({ insertMode: !get().insertMode }),

  toggleSticky: () => set({ sticky: !get().sticky }),

  setNotice: (notice) => set({ notice }),

  /**
   * Each click drops a corner. Clicking the last one again is a natural way to
   * say "done", so it commits rather than adding a zero-length segment.
   */
  addChainPoint: (cell, from) => {
    const { chain, commitChain } = get();
    if (chain === null) {
      set({ chain: [cell], chainAim: from });
      return;
    }
    const last = chain[chain.length - 1];
    if (last !== undefined && last.x === cell.x && last.y === cell.y) {
      commitChain();
      return;
    }
    // Placing a corner is also how the chain changes hands: start one with
    // `Space` and click, and the pointer has it from there.
    set({ chain: [...chain, cell], chainAim: from });
  },

  /**
   * Finish the run.
   *
   * A chain the keyboard is aiming commits **through the cursor**, because with
   * the arrow keys there is no such thing as an incidental position: every cell
   * the cursor is on was driven to on purpose, and the preview has been drawing
   * that leg all along. `Enter` finishing something other than what is on
   * screen would make the preview a liar, and would leave `Space`-arrows-`Enter`
   * drawing nothing at all.
   *
   * A chain the *pointer* is aiming does not, and for the same reason read the
   * other way: the mouse is resting wherever the hand left it, which is no
   * statement about the drawing. There, a corner is placed by clicking.
   */
  commitChain: () => {
    const { grid, chain, chainAim, cursor, tool, apply } = get();
    set({ chain: null });
    if (chain === null) return;

    const last = chain[chain.length - 1];
    const aimed =
      chainAim === 'keyboard' &&
      last !== undefined &&
      (last.x !== cursor.x || last.y !== cursor.y);

    const points = aimed ? [...chain, cursor] : chain;
    if (points.length < 2) return;

    apply(stampPolyline(grid, points, get().charset(), { headEnd: tool === 'arrow' }));
  },

  cancelChain: () => set({ chain: null }),

  /**
   * A fresh click: work out every reading, show the widest one, and keep the
   * rest so that clicking again can drill inward (B-REC-10).
   */
  selectAt: (cell) => {
    const key = ck(cell.x, cell.y);
    const list = candidatesAt(get().grid, cell.x, cell.y);

    if (list.length === 0) {
      set({ selection: null, drill: null, caret: null });
      return null;
    }
    const index = defaultIndex(list);
    const sel = list[index] ?? null;

    // Clicking a run of text widens it to the whole block it belongs to. Text
    // is the one shape whose *contents* are what you want when you point at
    // it, so the block — not the one run under the pointer — is the thing.
    //
    // It used to put a caret in at the character clicked, straight into an
    // editor. That is gone with select's writing (B-KEY-21): this runs only
    // under select, where a caret would be a bar that swallows nothing, and
    // the text tool never comes through here at all — its click is a plain
    // `setCaret`. Clicking a word and then pressing `t` is the two statements
    // made separately, which is what a mode is for.
    const isText = sel !== null && sel.kind === 'text';
    if (!isText) {
      set({ selection: sel, drill: { key, index, list }, caret: null });
      return sel;
    }

    const block = textSelection(get().grid, cell) ?? sel;
    set({ selection: block, drill: { key, index, list }, caret: null });
    return block;
  },

  /**
   * Tab crosses between a shape and what is written in it.
   *
   * Two things occupy the same place and only one can be selected, so there has
   * to be a way to say "the other one". Tab is the key every form in the world
   * uses to mean "the next thing", and inside a box there are exactly two.
   *
   * It carries the **mode** across with it (B-KEY-21). Crossing *into* the
   * label lands a caret, and a caret means the text tool; crossing back out to
   * the shape means select. Tab is therefore one of the ways into writing, on
   * a par with `t` — which is right, because "write in this box" is exactly
   * what it is for, and making it leave you in select with a live caret would
   * reintroduce the one state this change exists to remove.
   *
   * The tool is set through `set` rather than `setTool` because both ends of
   * the crossing are tools with nothing in flight to unwind — no chain, no
   * draft — and `setTool` would clear the very selection being handed over.
   */
  toggleLabel: () => {
    const { grid, selection, caret } = get();

    // Coming back out of an empty shape. There was no label to select on the
    // way in, so there is no text selection to cross from — the way back is
    // whatever the caret is standing inside.
    if (selection === null) {
      if (caret === null) return false;
      const around = containersAt(grid, caret.x, caret.y)[0];
      if (around === undefined) return false;
      set({ selection: around, drill: null, caret: null, tool: 'select' });
      return true;
    }

    if (selection.kind === 'text') {
      const box = containersAt(grid, selection.bounds.x, selection.bounds.y)[0];
      if (box === undefined) return false;
      set({ selection: box, drill: null, caret: null, tool: 'select' });
      return true;
    }

    const label = labelBoundsOf(grid, selection.bounds);

    // An empty shape has no label to select, and is exactly the shape you most
    // want to write into: Tab put you nowhere, which made "type in this box"
    // the one thing the crossing could not do. Put the caret where the first
    // character would go and let typing make the label.
    //
    // The selection is dropped rather than kept, so that Tab back out has
    // something to mean — with the box still selected there would be no way to
    // tell "about to write in it" from "about to leave it".
    if (label === null) {
      const { x, y, w, h } = selection.bounds;
      if (w <= 2 || h <= 2) return false; // no interior to stand in
      typingRun++;
      const at = { x: x + 1, y: y + 1 };
      set({ selection: null, drill: null, caret: at, cursor: at, caretHome: at.x, tool: 'text' });
      return true;
    }

    typingRun++;
    const block = textSelection(grid, { x: label.x, y: label.y });
    if (block === null) return false;
    const at = { x: label.x, y: label.y };
    set({
      selection: block,
      drill: null,
      caret: at,
      cursor: at,
      caretHome: label.x,
      tool: 'text',
    });
    return true;
  },

  /**
   * Clicking the same cell again steps to the next reading. The first step
   * lands on the *smallest* shape through that cell — which is what makes two
   * boxes sharing an edge individually selectable (B-REC-12).
   */
  drillAt: (cell) => {
    const { drill, selectAt } = get();
    const key = ck(cell.x, cell.y);
    if (drill === null || drill.key !== key) return selectAt(cell);

    const index = nextIndex(drill.list, drill.index);
    const sel = drill.list[index] ?? null;
    set({ selection: sel, drill: { ...drill, index } });
    return sel;
  },

  /** Shift+click: add the shape under the pointer, or drop it if already in (B-SEL-09). */
  toggleAt: (cell, scope) => {
    const { grid, selection } = get();

    // Two different questions, and both get asked in practice.
    //
    // `component` is `recognize`: the whole connected thing, walls, wires and
    // whatever those reach. Right for picking up two boxes and the arrow
    // between them in one gesture.
    //
    // `piece` is the reading a plain click takes — one cell of a table, one of
    // two boxes drawn flush, the line on its own. Right for building a
    // selection out of parts, which the whole-component answer cannot do: once
    // anything is wired to anything, every click hands back the same blob.
    const hit =
      scope === 'component'
        ? recognize(grid, cell.x, cell.y)
        : (candidatesAt(grid, cell.x, cell.y)[0] ?? null);
    if (hit === null) return;

    if (selection === null) {
      set({ selection: hit });
      return;
    }

    const next = new Set(selection.cells);
    const alreadyIn = [...hit.cells].every((k) => next.has(k));
    for (const key of hit.cells) {
      if (alreadyIn) next.delete(key);
      else next.add(key);
    }
    set({ selection: fromCells(next) });
  },

  selectRegion: (r) => {
    const sel = selectWithin(get().grid, r);
    set({ selection: sel });
    return sel;
  },

  selectEverything: () => set({ selection: selectAll(get().grid) }),

  drawBox: (r) => {
    const { grid, apply } = get();
    apply(stampBox(grid, r, get().charset()));
  },

  drawEllipse: (r) => {
    const { grid, apply } = get();
    apply(stampEllipse(grid, r, get().charset()));
  },

  drawPath: (from, to, opts) => {
    const { grid, apply } = get();
    apply(stampPath(grid, from, to, get().charset(), opts));
  },

  eraseAt: (cells) => {
    const { grid, apply } = get();
    apply(eraseWithHeal(grid, cells, get().charset()));
  },

  drawStroke: (samples) => {
    const { grid, apply } = get();
    apply(stampStroke(grid, samples, get().charset()));
  },

  moveSelection: (dx, dy, cells) => {
    const { grid, selection, originMode, sticky } = get();
    if (selection === null) return;

    const plan = planMove(grid, selection, dx, dy, {
      charset: get().charset(),
      sticky,
      clampToOrigin: originMode === 'quadrant',
      ...(cells === undefined ? {} : { cells }),
    });
    get().runPlan(plan, { keepSelection: true });
  },

  /**
   * Apply a plan, or report why it declined.
   *
   * Every operation funnels through here, which is what gives the refusal rules
   * (nesting §7, content §5) exactly one place to be honoured and what makes
   * "one gesture, one undo step" structural rather than a thing each new
   * operation has to remember.
   */
  runPlan: (plan, opts) => {
    if (plan.refused !== undefined) {
      set({ notice: plan.refused });
      return;
    }
    if (plan.diff.size > 0) get().apply(plan.diff, opts);
    if (plan.selection !== undefined) set({ selection: plan.selection });
    if (plan.note !== undefined) set({ notice: plan.note });
  },

  // Moving the keyboard's position with the pointer ends any writing that was
  // happening at the old one. Callers that do want a caret set one immediately
  // after, which is why this can afford to be blunt.
  setCursor: (cursor) => set({ cursor, caret: null, draft: null, sweep: null, objectMode: false }),

  moveCursor: (dx, dy) => {
    const { cursor } = get();
    set({
      objectMode: false,
      cursor: { x: Math.max(0, cursor.x + dx), y: Math.max(0, cursor.y + dy) },
      // Moving without a modifier ends the sweep, so the next Shift-arrow
      // starts a fresh selection rather than resuming an old one.
      sweep: null,
    });
  },

  /**
   * Start drawing from the keyboard. The cursor is one corner and stays the
   * other, so there is nothing to drag and nothing to remember: move, and the
   * shape follows.
   */
  startDraft: (kind) => set({ draft: { kind, anchor: get().cursor }, sweep: null }),

  commitDraft: () => {
    const { draft, cursor } = get();
    if (draft === null) return;

    const r = rectFromCorners(draft.anchor, cursor);
    set({ draft: null });
    if (draft.kind === 'box') get().drawBox(r);
    else get().drawEllipse(r);
  },

  cancelDraft: () => set({ draft: null }),

  /**
   * Sweep a selection out from the anchor to the cursor.
   *
   * Two shapes, because a grid is asked for both: `flow` is the text-editor
   * sweep that runs to the end of a row and wraps onto the next, `area` is the
   * rectangle. The anchor is remembered on the first sweep and held until
   * something else moves the cursor, so a run of Shift-arrows grows one
   * selection rather than seven.
   */
  sweepBy: (dx, dy, mode) => {
    const { grid, cursor, selection, sweep } = get();

    // Anchored where the cursor *was*, not where it is going: the first press
    // of Shift-arrow has to select the cell you were standing on as well as the
    // one you moved to, exactly as it does in a line of prose.
    //
    // With something already selected and no sweep running, the rectangle
    // carries on from **that** instead (B-SEL-20). Press `Enter` to take a
    // shape and then Shift-arrow, and the obvious meaning is "and a bit more";
    // starting afresh at the cursor threw the shape away and left two cells
    // selected. The anchor goes to the corner behind the direction of travel
    // and the cursor to the one ahead, so the run is a sweep like any other and
    // pressing back the other way still shrinks it.
    //
    // …but only while the keyboard is still standing *in* what is selected.
    // A bare arrow ends a sweep by walking out of it (B-SEL-16), and the run
    // after that has to start where the cursor now is rather than reach back
    // to a rectangle left behind.
    const grow =
      mode === 'area' &&
      sweep === null &&
      selection !== null &&
      rectContains(selection.bounds, cursor.x, cursor.y);
    const b = selection?.bounds;

    const from =
      sweep ??
      (grow && b !== undefined
        ? { x: dx >= 0 ? b.x : b.x + b.w - 1, y: dy >= 0 ? b.y : b.y + b.h - 1 }
        : cursor);
    const at =
      grow && b !== undefined
        ? { x: dx >= 0 ? b.x + b.w - 1 : b.x, y: dy >= 0 ? b.y + b.h - 1 : b.y }
        : cursor;
    const to = { x: Math.max(0, at.x + dx), y: Math.max(0, at.y + dy) };

    const sel =
      mode === 'flow'
        ? selectFlow(grid, from, to)
        : selectWithin(grid, rectFromCorners(from, to));

    set({ cursor: to, sweep: from, selection: sel, drill: null, caret: null, objectMode: false });
  },

  /**
   * Jump to the edge of what is filled, carrying the caret if there is one.
   *
   * Reading from `caret ?? cursor` rather than from `cursor` alone keeps the
   * one-position invariant (B-UI-10): the Ctrl branch runs before the caret
   * owns the keyboard, so a jump while writing has to move both or they come
   * apart on the first press.
   */
  jumpBy: (dx, dy) => {
    const { grid, cursor, caret } = get();
    const next = jumpFrom(grid, caret ?? cursor, dx, dy);
    typingRun++; // a moved caret starts a fresh undo entry

    set({
      cursor: next,
      sweep: null,
      objectMode: false,
      ...(caret === null ? {} : { caret: next, caretHome: next.x }),
    });
  },

  /**
   * `Alt`+arrow: a stride, which stops when it reaches a wall (B-KEY-19a).
   *
   * Deliberately the same shape as `jumpBy` above, down to the caret handling,
   * because the two are the same kind of thing — a key that moves the keyboard's
   * one position (B-UI-10) by asking the characters how far it can go. Only the
   * question differs: `Ctrl` asks where the content is, `Alt` asks what is in the
   * way.
   */
  strideBy: (dx, dy) => {
    const { grid, cursor, caret } = get();
    const [sx, sy] = strideBy(dx, dy);
    const next = strideFrom(grid, caret ?? cursor, sx, sy);
    typingRun++;

    set({
      cursor: next,
      sweep: null,
      objectMode: false,
      ...(caret === null ? {} : { caret: next, caretHome: next.x }),
    });
  },

  /**
   * `Ctrl`+`Shift`+arrow: the jump, with the selection dragged out to it.
   *
   * A rectangle rather than reading order, to agree with the plain Shift sweep
   * it is an accelerated version of — the modifier changes how far one press
   * goes, not what shape it makes.
   */
  jumpSweep: (dx, dy) => {
    const { grid, cursor } = get();
    const from = get().sweep ?? cursor;
    const to = jumpFrom(grid, cursor, dx, dy);

    set({
      cursor: to,
      sweep: from,
      selection: selectWithin(grid, rectFromCorners(from, to)),
      drill: null,
      caret: null,
      objectMode: false,
    });
  },

  cycleShape: () => {
    const { grid, cursor, selection } = get();
    const list = candidatesAt(grid, cursor.x, cursor.y);

    // The innermost reading, which is the one a *click* takes — deliberately
    // not `smallestObjectAt`, which sorts by raw cell count. Two boxes drawn
    // flush hold a U-shaped strand one cell smaller than either box, and
    // answering "a line" to a press on a box would be obtuse (B-REC-10).
    const rungs: Candidate[] = [];
    const smallest = list[0];
    if (smallest !== undefined) rungs.push(smallest);

    // The widest reading that is still a **shape**. Widest rather than the
    // whole component, because the component is where the drawing stops being
    // this thing and starts being everything joined to it: one connector and
    // the box at the far end of it come in too. That is `Ctrl`+`Enter`'s job
    // (B-SEL-19), and keeping the two apart is what makes a plain `Enter` safe
    // to lean on — it never reaches past the shape you are standing in.
    const whole = [...list].reverse().find((c) => enclosesArea(c));
    if (whole !== undefined && !sameCells(whole, smallest ?? null)) rungs.push(whole);

    // The rung is read back off the selection, never stored, so anything that
    // changes the selection another way starts again from the smallest.
    const at = rungs.findIndex((c) => sameCells(c, selection));
    const next = (at === -1 ? rungs[0] : rungs[(at + 1) % rungs.length]) ?? null;

    set({ selection: next, drill: null, menuOpen: false, objectMode: false });
  },

  /**
   * `Ctrl`+`Enter`: the whole connected component (B-SEL-19).
   *
   * Everything the characters say is joined up — the shape, the lines running
   * out of it, and whatever those run into. One press rather than a ladder,
   * because there is only one answer to "all of it".
   */
  selectConnected: () => {
    const { grid, cursor, selection } = get();

    // Seeded from what is **already selected** when there is something, so the
    // key reads as "and everything this touches" rather than only "everything
    // under the keyboard". Tracing is per component and seeds already taken are
    // skipped, so a big selection still costs one flood, not one per cell.
    const seeds: Cell[] =
      selection === null ? [cursor] : [...selection.cells].map(unck);

    const out = new Set<CellKey>();
    for (const seed of seeds) {
      if (out.has(ck(seed.x, seed.y))) continue;
      for (const key of objectAt(grid, seed.x, seed.y)) out.add(key);
    }

    // Nothing under the keyboard and nothing selected — which is exactly where
    // clicking a table cell leaves you, since the inside of a cell is blank and
    // a blank cell is not part of anything. Standing in a shape is a good
    // enough way of pointing at it, so take what encloses the cursor.
    if (out.size === 0) {
      const inside = containersAt(grid, cursor.x, cursor.y)[0];
      for (const key of inside?.cells ?? []) {
        const { x, y } = unck(key);
        if (out.has(key)) continue;
        for (const k of objectAt(grid, x, y)) out.add(k);
      }
    }

    set({
      selection: fromCells(out),
      drill: null,
      menuOpen: false,
      objectMode: false,
    });
  },

  /**
   * Double-tap Shift takes the smallest object under the keyboard and puts the
   * arrow keys into object select.
   *
   * The smallest, because that is the one growing can still reach: a press of
   * Shift-arrow swallows outward, and there is no gesture that shrinks. Landing
   * on the table when the cell was meant leaves nowhere to go.
   */
  enterObjectMode: () => {
    const { grid, cursor } = get();
    const object = smallestObjectAt(grid, cursor.x, cursor.y);
    set({
      objectMode: true,
      sweep: null,
      drill: null,
      caret: null,
      ...(object === null ? {} : { selection: object }),
    });
  },

  /**
   * Grow the selection by one cell and take whole whatever that reaches.
   *
   * With nothing selected the region is the single cell the keyboard is on, so
   * the first press behaves like the second and there is no empty case.
   */
  growByObjects: (dx, dy) => {
    const { grid, selection, cursor } = get();
    const region = selection?.bounds ?? { x: cursor.x, y: cursor.y, w: 1, h: 1 };
    set({
      selection: swallowFrom(grid, region, dx, dy),
      drill: null,
      caret: null,
      sweep: null,
    });
  },

  openMenu: () => {
    // Nothing to offer is not a menu. `menuFor` decides, so the view never has
    // to know what a lattice or a line end is.
    const state = get();
    const items = menuFor(state);
    if (items.length === 0) {
      set({ menuOpen: false, menuHint: null });
      return;
    }

    // The highlight is deliberately *kept*. Adding three columns is three
    // rounds of open-and-confirm, and starting from the top each time makes the
    // second and third rounds longer than the first for no reason (B-UI-13).
    //
    // Kept only while it still points at something, though: the menu over a
    // line has nothing in common with the menu over a box, so a path remembered
    // in one is meaningless in the other.
    const path = reaches(items, state.menuPath) ? state.menuPath : [0];
    set({ menuOpen: true, menuPath: path, menuHint: hintFor(state, path) });
  },

  closeMenu: () => set({ menuOpen: false, menuHint: null }),

  moveMenu: (delta) => {
    const { level, path } = levelAt(get());
    if (level.length === 0) return;

    // Wrapping both ways, so holding one arrow reaches everything and there is
    // no dead end to notice.
    const at = path[path.length - 1] ?? 0;
    const step = (((at + delta) % level.length) + level.length) % level.length;
    const next = [...path.slice(0, -1), step];
    set({ menuPath: next, menuHint: hintFor(get(), next) });
  },

  activateMenu: () => {
    const { node, path } = levelAt(get());
    if (node === null) return;

    // A group opens rather than acting; a leaf acts. Same key for both, which
    // is what makes the menu one thing to learn rather than two.
    if (isGroup(node)) {
      const next = [...path, 0];
      set({ menuPath: next, menuHint: hintFor(get(), next) });
      return;
    }

    // Closing first, for the reason the click path closes first: a refusal
    // never reaches `apply`, and a menu left standing over a refusal reads as
    // if nothing was pressed.
    get().closeMenu();
    node.run(get());
  },

  leaveMenu: () => {
    const path = get().menuPath;
    if (path.length <= 1) {
      get().closeMenu();
      return;
    }
    const next = path.slice(0, -1);
    set({ menuPath: next, menuHint: hintFor(get(), next) });
  },

  // The rows are stacked, deepest at the bottom, so down and up walk them:
  // down into the group that is lit, up out of the row you are in. Off either
  // edge the menu is put away — up past the top the way Escape leaves it, and
  // down past a leaf the way down always did (B-UI-11).
  descendMenu: () => {
    const { node } = levelAt(get());
    if (node !== null && isGroup(node)) get().activateMenu();
    else get().closeMenu();
  },

  pickMenu: (path) => {
    const node = nodeAt(get(), path);
    if (node === null) return;

    // A menu item does two things: the thing, and closing the menu. Closing
    // first covers the refusals too, which never reach `apply` and would
    // otherwise leave the menu hanging over nothing having happened.
    if (!isGroup(node)) {
      get().closeMenu();
      node.run(get());
      return;
    }

    // A group whose row is already showing shuts again, which is the pointer's
    // way back: *End 2* clicked a second time returns to choosing an end.
    const current = get().menuPath;
    const open = current.length > path.length && path.every((at, i) => current[i] === at);
    const next = open ? [...path] : [...path, 0];
    set({ menuPath: next, menuHint: hintFor(get(), next) });
  },

  pointMenu: (path) => {
    if (path.length === 0) {
      set({ menuHint: null });
      return;
    }
    // Only the deepest row follows the pointer. Hovering a row above it lights
    // up what that item is about but leaves the rows beneath standing: moving
    // the pointer down to them crosses the row above, and a menu that folded
    // up under the pointer on the way would be one nobody could reach into.
    const current = get().menuPath;
    const deepest =
      path.length === current.length && path.slice(0, -1).every((at, i) => current[i] === at);
    if (deepest) set({ menuPath: path, menuHint: hintFor(get(), path) });
    else set({ menuHint: hintFor(get(), path) });
  },

  restyleSelection: (charsetId) => {
    const { grid, selection } = get();
    if (selection === null) return;

    const cs = charsetOf(charsetId);
    get().runPlan(
      { diff: convertCharset(grid, cs, selection.cells), selection },
      { keepSelection: true },
    );
  },

  setLineEnd: (which, end) => {
    const { grid, selection } = get();
    if (selection === null) return;
    get().runPlan(planLineEnd(grid, selection, which, end, get().charset()), {
      keepSelection: true,
    });
  },

  addColumn: () => {
    const { grid, selection, sticky } = get();
    if (selection === null) return;
    get().runPlan(planAddColumn(grid, selection, { charset: get().charset(), sticky }), {
      keepSelection: true,
    });
  },

  addRow: () => {
    const { grid, selection, sticky } = get();
    if (selection === null) return;
    get().runPlan(planAddRow(grid, selection, { charset: get().charset(), sticky }), {
      keepSelection: true,
    });
  },

  /**
   * The spreadsheet arrow key: step to the next cell rather than dragging this
   * one around. False when the selection is not a cell with a neighbour, which
   * is what lets the caller fall through to nudging — a plain box is a table of
   * one cell, so nothing changes for it.
   */
  selectNeighbourCell: (dx, dy) => {
    const { grid, selection } = get();
    if (selection === null || selection.kind !== 'box') return false;

    const next = neighbourCell(grid, selection.bounds, dx, dy);
    if (next === null) return false;

    set({
      selection: { kind: 'box', cells: new Set(borderKeys(next)), bounds: next },
      drill: null,
      menuOpen: false,
    });
    return true;
  },

  /** Drag a separator to resize the track beside it — the spreadsheet gesture. */
  resizeTrack: (rail, by) => {
    const { grid, sticky } = get();
    get().runPlan(
      planResizeTrack(grid, rail.table, rail.axis, rail.at, by, {
        charset: get().charset(),
        sticky,
      }),
      { keepSelection: true },
    );
  },

  /** Only a closed outline can be resized — anything else has no border to redraw. */
  resizeSelection: (to) => {
    const { grid, selection, sticky } = get();
    if (selection === null) return;

    get().runPlan(
      planResize(grid, selection, to, { charset: get().charset(), sticky }),
      { keepSelection: true },
    );
  },

  duplicateSelection: () => {
    const { grid, selection, apply } = get();
    if (selection === null) return;

    const diff: CellDiff = new Map();
    for (const key of selection.cells) {
      const ch = grid.get(key);
      if (ch === undefined) continue;
      const { x, y } = unck(key);
      diff.set(ck(x + 1, y + 1), ch);
    }
    apply(diff, { keepSelection: true });

    set({
      selection: {
        kind: selection.kind,
        cells: movedKeys(selection.cells, 1, 1),
        bounds: { ...selection.bounds, x: selection.bounds.x + 1, y: selection.bounds.y + 1 },
      },
    });
  },

  deleteSelection: () => {
    const { selection, apply } = get();
    if (selection === null) return;
    apply(eraseCells(selection.cells));
  },

  typeAt: (ch) => {
    const { grid, caret, insertMode, sticky, selection } = get();
    if (caret === null) return;

    // Typing into a run of text that is *selected* inserts, whatever the global
    // mode says. Overwriting is right for labelling a diagram — putting a word
    // where there is space — but once a run is selected the thing on screen is
    // a piece of writing, and every editor in the world writes between the
    // characters of one rather than over them.
    const editing = selection !== null && selection.kind === 'text' && selectionHas(selection, caret);

    // The box may have to grow to keep its border, and that grow belongs in the
    // same diff as the character — one keystroke stays one undo step, and the
    // run still coalesces (content §4, B-DRAW-11b).
    get().runPlan(
      planType(grid, caret, ch, {
        charset: get().charset(),
        insertMode: insertMode || editing,
        sticky,
      }),
      { run: `type:${typingRun}`, keepSelection: editing },
    );

    const next = { x: caret.x + 1, y: caret.y };
    set({ caret: next, cursor: next });
    // The run is a character longer, so the selection has to be read again or
    // the highlight lags one behind what was typed.
    if (editing) set({ selection: recognize(get().grid, caret.x, caret.y), drill: null });
  },

  newline: () => {
    const { grid, caret, caretHome, sticky } = get();
    if (caret === null) return;

    get().runPlan(planNewline(grid, caret, { charset: get().charset(), sticky }), {
      run: `type:${typingRun}`,
    });
    const next = { x: caretHome, y: caret.y + 1 };
    set({ caret: next, cursor: next });
  },

  backspace: () => {
    const { grid, caret, insertMode, selection, apply } = get();
    if (caret === null || caret.x === 0) return;

    // The mirror of typing: inside a selected run the rest of the word closes
    // up behind the deletion rather than leaving a hole in the middle of it.
    const editing = selection !== null && selection.kind === 'text' && selectionHas(selection, caret);

    const x = caret.x - 1;
    apply(eraseChar(grid, x, caret.y, insertMode || editing), {
      run: `type:${typingRun}`,
      keepSelection: editing,
    });
    set({ caret: { x, y: caret.y }, cursor: { x, y: caret.y } });
    if (editing) set({ selection: recognize(get().grid, x, caret.y), drill: null });
  },

  moveCaret: (dx, dy) => {
    const { caret } = get();
    if (caret === null) return;
    typingRun++; // moving the caret ends the current typing run
    const next = { x: Math.max(0, caret.x + dx), y: Math.max(0, caret.y + dy) };
    set({ caret: next, cursor: next, caretHome: next.x });
  },

  /** Import is always lossless and never fails; understanding it is recognition's job. */
  paste: (text, at) => {
    const { apply } = get();
    const diff = pasteDiff(text, Math.max(0, at.x), Math.max(0, at.y));
    if (diff.size === 0) return;

    apply(diff);
    set({ selection: fromCells(new Set(diff.keys())), notice: `Pasted ${diff.size} cells` });
  },

  /** Replace the document wholesale, as one undoable step. */
  loadText: (text, name) => {
    const { grid, apply } = get();
    const diff: CellDiff = new Map();
    for (const key of grid.keys()) diff.set(key, null);
    for (const [key, ch] of pasteDiff(text, 0, 0)) diff.set(key, ch);

    apply(diff);
    set({ fileName: name, dirty: false, notice: `Opened ${name}` });
  },

  undo: () => {
    const { grid, revision } = get();
    if (!history.undo(grid)) return;
    set({
      revision: revision + 1,
      selection: null,
      dirty: true,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  },

  redo: () => {
    const { grid, revision } = get();
    if (!history.redo(grid)) return;
    set({
      revision: revision + 1,
      selection: null,
      dirty: true,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  },

  clearAll: () => {
    const { grid, apply } = get();
    const diff: CellDiff = new Map();
    for (const key of grid.keys()) diff.set(key, null);
    apply(diff);
  },

  text: () => toText(get().grid),

  /**
   * With a selection, copy **what is selected** and nothing else (B-TXT-05).
   *
   * Cropped to the copied cells and masked to them, so a shape whose bounding
   * box happens to contain a neighbour's wall does not hand that wall over
   * too. The set is `travellingWith`, the same one a *move* carries — copying
   * a box brings its label and its children exactly as dragging it would,
   * because "what is this thing" should not have two different answers.
   */
  selectionText: () => {
    const { grid, selection } = get();
    if (selection === null) return toText(grid);

    const cells = travellingWith(grid, selection);
    return toText(grid, boundsOf(cells) ?? selection.bounds, cells);
  },
}));

/** Convenience for hit-testing a selection without importing geom everywhere. */
export function selectionHas(sel: Candidate | null, cell: Cell): boolean {
  return sel !== null && sel.cells.has(ck(cell.x, cell.y));
}

/** True when every step of `path` still lands on something in this menu. */
function reaches(items: readonly MenuNode[], path: readonly number[]): boolean {
  if (path.length === 0) return false;

  let level = items;
  for (let i = 0; i < path.length; i++) {
    const node = level[path[i] ?? -1];
    if (node === undefined) return false;
    if (i === path.length - 1) return true;
    if (!isGroup(node)) return false;
    level = node.items;
  }
  return true;
}

/**
 * Where the menu currently is: the items at that level, and which is lit.
 *
 * Walked from `menuFor` every time rather than stored, for the same reason the
 * selection ladder is: the menu is a view of the selection, and a remembered
 * tree would go stale the moment the selection changed under it.
 */
function levelAt(state: EditorState): {
  level: readonly MenuNode[];
  node: MenuNode | null;
  path: readonly number[];
} {
  const path = state.menuPath;
  let level = menuFor(state);

  for (let i = 0; i < path.length - 1; i++) {
    const step = level[path[i] ?? 0];
    if (step === undefined || !isGroup(step)) return { level, node: null, path };
    level = step.items;
  }
  return { level, node: level[path[path.length - 1] ?? 0] ?? null, path };
}

/** The item at `path`, or null when the path runs off the menu. */
function nodeAt(state: EditorState, path: readonly number[]): MenuNode | null {
  let level = menuFor(state);
  let node: MenuNode | undefined;

  for (const [i, at] of path.entries()) {
    node = level[at];
    if (node === undefined) return null;
    if (i === path.length - 1) break;
    if (!isGroup(node)) return null;
    level = node.items;
  }
  return node ?? null;
}

/** What the item at `path` is about, for the canvas to light up (B-UI-16). */
function hintFor(state: EditorState, path: readonly number[]): ReadonlySet<CellKey> | null {
  return nodeAt(state, path)?.hint?.(state) ?? null;
}

/**
 * Two selections covering exactly the same cells.
 *
 * By cells rather than by `kind` or `bounds`: the same characters read as a
 * `box` and as `cells` are the same selection to a person looking at the
 * screen, and the scale ladder has to agree with what they see.
 */
function sameCells(a: Candidate | null, b: Candidate | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.cells.size !== b.cells.size) return false;
  for (const key of a.cells) {
    if (!b.cells.has(key)) return false;
  }
  return true;
}

// ---- file commands, kept beside the store rather than in a component --------

export async function openDocument(): Promise<void> {
  const file = await platform().openFile();
  if (file === null) return;
  useEditor.getState().loadText(file.text, file.name);
}

export async function saveDocument(as: boolean): Promise<void> {
  const store = useEditor.getState();
  const text = store.text();
  const written = as
    ? await platform().saveFileAs(store.fileName, text)
    : await platform().saveFile(store.fileName, text);

  if (written === null) return;
  useEditor.setState({ fileName: written, dirty: false, notice: `Saved ${written}` });
}

export async function copyDocument(selectionOnly: boolean): Promise<void> {
  const store = useEditor.getState();
  const text = selectionOnly ? store.selectionText() : store.text();
  try {
    await platform().writeClipboard(text);
    useEditor.setState({ notice: selectionOnly ? 'Copied selection' : 'Copied document' });
  } catch {
    // A clipboard write needs a focused document and can simply be refused.
    // Saying so beats an unhandled rejection and a button that looks dead.
    useEditor.setState({ notice: 'Clipboard write blocked by the browser' });
  }
}

/**
 * Paste lands where the keyboard is, and nowhere else (B-TXT-04).
 *
 * It used to prefer the **pointer** — caret, else hover, else the viewport's
 * corner — and that was wrong for a reason the renderer already had written down
 * beside the two markers it draws: *the hover says where the pointer happens to
 * be; the cursor says where the next keystroke will land*. `Ctrl`+`V` is a
 * keystroke. Anchoring it to the mouse made it the one command in the editor that
 * ignored the loud yellow square telling you where it was about to act, and put
 * the characters wherever the hand had left the mouse resting.
 *
 * The three cases collapse into one because the keyboard has only ever had one
 * position (B-UI-10): every write that sets a caret sets the cursor to the same
 * cell, so `caret ?? cursor` was always just `cursor`. The viewport fallback goes
 * with them — the cursor always exists, so there is nothing left to fall back
 * from.
 *
 * A cursor scrolled off screen therefore pastes off screen. That is not new and
 * not specific to pasting: the web build has no camera-follow, so *typing* at an
 * off-screen cursor is equally invisible, and paste now simply behaves the way
 * every other key already does. The terminal scrolls to its cursor each frame and
 * so never shows it at all.
 */
export async function pasteDocument(): Promise<void> {
  try {
    const text = await platform().readClipboard();
    if (text === '') return;
    useEditor.getState().paste(text, useEditor.getState().cursor);
  } catch {
    // Firefox and Safari refuse programmatic clipboard reads; say so rather
    // than failing silently, since Ctrl+V looking broken is worse than a note.
    useEditor.setState({ notice: 'Clipboard read blocked — use the browser paste dialog' });
  }
}

/** Erase what a brush of the current size covers, centred on a cell. */
export function brushAt(cell: Cell): CellKey[] {
  return brushKeys(cell, useEditor.getState().brush);
}

export { MAX_BRUSH, MIN_BRUSH };
