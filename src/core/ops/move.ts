/**
 * Moving something, and everything that goes with it.
 *
 * Where most of the intuitive rules meet: the cascade from nesting, the label
 * from content, and the whole of sticky connectors. It replaces the logic that
 * used to sit inline in `store.moveSelection`, which is how the store gets to
 * stop containing decisions and go back to being a mutation path.
 */

import {
  boundsOf,
  ck,
  rectShifted,
  unck,
  type Cell,
  type CellKey,
  type Rect,
} from '../geom/cell.ts';
import { glyphFor, type Charset } from '../charset/charsets.ts';
import {
  applyDiff,
  maskOf,
  neighbourMask,
  type CellDiff,
  type Grid,
} from '../grid/grid.ts';
import type { Candidate } from '../recognize/recognize.ts';
import { enclosesArea, isClosed } from '../derive/contain.ts';
import { travellingWith } from '../derive/gather.ts';
import { sharedCells } from '../derive/shared.ts';
import { stampBox } from '../stamp/box.ts';
import { stampEllipse } from '../stamp/ellipse.ts';
import { findConnectors, rerouteDiff } from '../route/connectors.ts';
import { moveDiff } from '../transform/move.ts';
import { merge, nothing, type Plan } from './plan.ts';
import { planSideDrag } from './resize.ts';

export interface MoveOptions {
  charset: Charset;
  /** Lines attached to what is moving are redrawn to follow it (B-MAN-11). */
  sticky?: boolean;
  /** Quadrant mode clamps at the origin instead of refusing (B-PLANE-04). */
  clampToOrigin?: boolean;
  /**
   * Cells to move. Pass the set gathered at pointer-down — it cannot change
   * mid-gesture, and re-deriving it per frame would trace components on every
   * pointer event. Omitted, it is derived here.
   */
  cells?: ReadonlySet<CellKey>;
}

/** Everything a drag needs to know, worked out once when the gesture starts. */
export interface MoveSubject {
  /** The shape plus everything wholly inside it. */
  cells: Set<CellKey>;
  /** Bounds of the above, which is what clamps against the origin. */
  bounds: Rect;
  /** True when more than the shape itself is coming along. */
  carries: boolean;
}

/**
 * Gather once, at pointer-down.
 *
 * The set of things travelling cannot change mid-gesture, because the document
 * does not change mid-gesture (B-MAN-02). Deriving it here rather than inside
 * `planMove` is what keeps a drag cheap, and it lets the selection highlight
 * show what is about to move *before* it moves.
 */
export function subjectOf(grid: Grid, selection: Candidate): MoveSubject {
  const cells = travellingWith(grid, selection);
  return {
    cells,
    bounds: boundsOf(cells) ?? selection.bounds,
    carries: cells.size > selection.cells.size,
  };
}

/**
 * Whether this is a thing a connector can be attached **to** (B-MAN-11f).
 *
 * Two kinds of selection have connectors, and they are the two a line can run
 * *into* rather than *along*:
 *
 *   - a **shape**, which a line stops at. `enclosesArea` rather than
 *     `isClosed`, because a box with a line through its wall reads as `cells`
 *     and is still a box (nesting §9), and a marquee dragged round a whole box
 *     is still a shape being moved;
 *   - **text**, which has no connectivity at all, so an arrow aimed at a word
 *     is a genuine attachment and follows the word when it moves.
 *
 * What is left is cells made of line glyphs that do not enclose anything —
 * a run swept out of the middle of a line. Those have no connectors, because
 * what continues at either end is not something attached to what you picked
 * up: it is **the rest of the same line**. Re-routing it re-anchors one half
 * onto whatever the other half happened to touch:
 *
 *     ┌──────────┐              ┌──────────┤┐
 *     └─────┬────┘      →       └──────────┘│
 *           │     │                    │  ──┘
 *           └─────┘                    └──┴──
 *
 * — the left leg dragged onto the box, the right leg left sprouting `┴` where
 * an old run crossed a new one, and every further drag adding more. Moving a
 * piece of a line moves that piece, which is all it ever claimed to do.
 */
function takesConnectors(grid: Grid, selection: Candidate): boolean {
  if (enclosesArea(selection)) return true;

  for (const key of selection.cells) {
    const { x, y } = unck(key);
    if (maskOf(grid, x, y) !== 0) return false;
  }
  return true;
}

/**
 * Plan a move.
 *
 * The steps are each a rule:
 *
 *   1. gather the cascade                        nesting §2, content §2
 *   2. clamp at the origin, never refuse         B-PLANE-04
 *   3. lift and drop
 *   4. re-route what was attached                sticky §1–§3, §5
 *   5. one diff                                  B-HIST-02
 *
 * What is deliberately absent is as important:
 *
 *   - **no call to `containerAt`** — the cascade runs downward and never up
 *     (nesting §3), guaranteed by having no way to ask;
 *   - **no refusal** — a drag may take a child out of a container and may bring
 *     one in, and neither is resisted (nesting §4, §5). Containment is inferred
 *     rather than declared, so the editor has no standing to insist on it.
 *     Overlap is likewise allowed and destructive, because undo is the answer
 *     (content §6);
 *   - **no shape is moved to make room** — that promise belongs to routing, and
 *     routing may only ever move the connector.
 */
export function planMove(
  grid: Grid,
  selection: Candidate,
  dx: number,
  dy: number,
  opts: MoveOptions,
): Plan {
  // A whole side of a shape is not a thing to be carried about; it is where
  // that shape ends, so dragging it resizes rather than tears (B-MAN-15).
  const side = planSideDrag(grid, selection, dx, dy, {
    charset: opts.charset,
    ...(opts.sticky === undefined ? {} : { sticky: opts.sticky }),
  });
  if (side !== null) return side;

  const cells = opts.cells ?? travellingWith(grid, selection);
  const bounds = boundsOf(cells) ?? selection.bounds;

  let ddx = dx;
  let ddy = dy;
  if (opts.clampToOrigin !== false) {
    ddx = Math.max(ddx, -bounds.x);
    ddy = Math.max(ddy, -bounds.y);
  }
  if (ddx === 0 && ddy === 0) return nothing();

  // Find the connectors *first*. Their cells are about to be lifted, so the
  // shape must not be redrawn against a grid that still holds the old line —
  // that is what turns a border cell into a spurious `┼`.
  const connectors =
    opts.sticky === false || !takesConnectors(grid, selection)
      ? []
      : findConnectors(grid, cells);
  const lifted = new Set<CellKey>();
  for (const c of connectors) {
    for (const key of c.cells) lifted.add(key);
  }

  const moved = detach(grid, selection, cells, ddx, ddy, opts.charset, lifted);
  const diffs: CellDiff[] = [moved];

  let note: string | undefined;
  if (connectors.length > 0) {
    const landed = new Set<CellKey>();
    for (const key of cells) {
      const { x, y } = unck(key);
      landed.add(ck(x + ddx, y + ddy));
    }
    const routed = rerouteDiff(grid, landed, connectors, moved, opts.charset);
    diffs.push(routed.diff);
    note = routed.note;
  }

  return {
    diff: merge(...diffs),
    selection: shiftedSelection(selection, ddx, ddy),
    ...(note === undefined ? {} : { note }),
  };
}

/** Redraw a closed outline, whichever kind it is. */
function stampShape(grid: Grid, r: Rect, kind: string, cs: Charset): CellDiff {
  return kind === 'ellipse' ? stampEllipse(grid, r, cs) : stampBox(grid, r, cs);
}

/**
 * Lift a shape away from whatever it was drawn flush against (sticky §7.2).
 *
 * A closed shape is always **redrawn** at its destination rather than carried
 * glyph for glyph, because its border may be wearing marks that belong to
 * things it is leaving behind:
 *
 *   - a `├` where a line was drawn into it, which should become `│` once that
 *     line is re-routed;
 *   - a `┬` where another box was drawn flush against it (sticky §7.2).
 *
 * And where the shape *shares* cells with a neighbouring closed shape, those
 * cells have to **stay**, re-derived for whoever is left, or the neighbour ends
 * up with a hole where its wall used to be.
 *
 * A neighbour is a neighbour: not a wire to re-route, not a part to carry.
 */
function detach(
  grid: Grid,
  selection: Candidate,
  cells: ReadonlySet<CellKey>,
  dx: number,
  dy: number,
  cs: Charset,
  lifted: ReadonlySet<CellKey> = new Set(),
): CellDiff {
  // An open shape is only ever translated: there is no canonical outline to
  // redraw it from, and its glyphs are all it is.
  if (!isClosed(selection)) return moveDiff(grid, cells, dx, dy);

  // Asked about the whole travelling set, not just the outline. A divided box
  // reads as several rectangles sharing walls, and asking about the outline
  // alone reports its own dividers as a neighbour leaning on it — so half the
  // box would stay behind to avoid damaging itself.
  const shared = sharedCells(grid, cells);

  // Lift everything except what the neighbour still needs.
  const lift: CellDiff = new Map();
  for (const key of cells) {
    if (!shared.has(key)) lift.set(key, null);
  }

  // Drop the contents verbatim; the outline itself is redrawn below.
  const carried: CellDiff = new Map();
  for (const key of cells) {
    if (selection.cells.has(key)) continue;
    const ch = grid.get(key);
    if (ch === undefined) continue;
    const { x, y } = unck(key);
    carried.set(ck(x + dx, y + dy), ch);
  }

  const after: Grid = new Map(grid);
  // Anything the caller is about to erase -- the old connector runs -- must be
  // gone before the outline is redrawn, or it merges with what it is replacing.
  for (const key of lifted) after.delete(key);
  applyDiff(after, lift);

  // Re-derive the cells left behind: a `┬` that has lost its westward arm is a
  // `┌`, and a cell that has lost everything was never the neighbour's after
  // all, so it goes.
  const repair: CellDiff = new Map();
  for (const key of shared) {
    const { x, y } = unck(key);
    const mask = neighbourMask(after, x, y);
    repair.set(key, mask === 0 ? null : glyphFor(mask, cs));
  }
  applyDiff(after, repair);
  applyDiff(after, carried);

  const outline = stampShape(after, rectShifted(selection.bounds, dx, dy), selection.kind, cs);
  return merge(lift, repair, carried, outline);
}

/** The same shape, one step over. Re-recognising would be slower and no truer. */
function shiftedSelection(selection: Candidate, dx: number, dy: number): Candidate {
  const cells = new Set<CellKey>();
  for (const key of selection.cells) {
    const { x, y } = unck(key);
    cells.add(ck(x + dx, y + dy));
  }
  return {
    kind: selection.kind,
    cells,
    bounds: rectShifted(selection.bounds, dx, dy),
  };
}

/** The preview a drag shows before it commits: the same diff, uncommitted. */
export function previewMove(
  grid: Grid,
  selection: Candidate,
  from: Cell,
  to: Cell,
  opts: MoveOptions,
): CellDiff {
  return planMove(grid, selection, to.x - from.x, to.y - from.y, opts).diff;
}
