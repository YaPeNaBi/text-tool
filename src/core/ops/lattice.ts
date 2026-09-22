/**
 * Adding a column or a row to a box.
 *
 * The first step toward tables (M14), and deliberately not the last one. There
 * is no `TableSpec` here, no lattice matcher and no thirteen operations —
 * `stamp/table.ts`, `recognize/table.ts` and `ops/table.ts` are still the plan
 * for those. This is the two things a person wants first, built out of what
 * already exists, so that a table can be *drawn* before it can be *read*.
 *
 * ── Grow, rather than divide ──────────────────────────────────────────────
 *
 * "Add" means there is more afterwards than there was before, so the box widens
 * by one column and nothing already inside it moves. Splitting the existing
 * interior in half instead would halve every column already there, and on a
 * character grid a column halved twice holds nothing at all. It would also make
 * the operation destructive, which nothing here is except a drop.
 *
 * The new column is as wide as the last one, so clicking twice gives three
 * even columns rather than a diminishing series.
 *
 * ── The stamper already knows how to do this ─────────────────────────────
 *
 * Growing the box is one call to `stampBox` over the larger rect, because the
 * stamper merges its own geometry with whatever connectivity is already in the
 * grid (B-DRAW-07). The old right-hand wall is interior to the new rect, so it
 * is not redrawn and simply stays where it is; the two cells where it meets the
 * top and bottom edges *are* on the new border, and pick up the old wall's arm
 * as they are restamped:
 *
 *     ┌──────┐         ┌──────┬──────┐        ┐ + S  =  ┬
 *     │      │   ──▶   │      │      │        ┘ + N  =  ┴
 *     └──────┘         └──────┴──────┘
 *
 * So the divider is not drawn by this file at all. It is the wall that was
 * already there, reinterpreted — which is the whole spirit of a document that
 * keeps no model.
 */

import { boundsOf, ck, unck, type Cell, type CellKey, type Rect } from '../geom/cell.ts';
import { E, N, S, W, glyphFor, type Charset } from '../charset/charsets.ts';
import { applyDiff, cloneWithout, maskOf, type CellDiff, type Grid } from '../grid/grid.ts';
import type { Candidate } from '../recognize/recognize.ts';
import { enclosesArea } from '../derive/contain.ts';
import { trace } from '../recognize/trace.ts';
import { borderKeys, stampBox } from '../stamp/box.ts';
import { stampPath } from '../stamp/path.ts';
import { moveDiff } from '../transform/move.ts';
import { findConnectors, rerouteDiff } from '../route/connectors.ts';
import { merge, nothing, refuse, type Plan } from './plan.ts';

export interface LatticeOptions {
  charset: Charset;
  /** Lines attached to the box are redrawn to follow its new wall (B-MAN-12). */
  sticky?: boolean;
}

/** A new column or row is never narrower than this, however tight the box. */
const MIN_TRACK = 1;

/**
 * Where the columns divide, read across one row of the box.
 *
 * On the top edge a `┬` is a column boundary and a plain `─` is not, which is
 * the same thing a person reads looking at the picture. Read across an inner
 * rail instead and the question becomes "does this column carry on *through*
 * this row" — `┼` says yes, `┴` says the column stops here. That distinction is
 * what lets a new row copy the row above it rather than the top of the table.
 *
 * Nothing is stored and nothing is traced: one pass along one row answers it.
 */
export function columnEdges(grid: Grid, r: Rect, atY: number = r.y): number[] {
  const out: number[] = [];
  for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
    if ((maskOf(grid, x, atY) & S) !== 0) out.push(x);
  }
  return out;
}

/** The same question down one column, where a row boundary is a `├` or a `┼`. */
export function rowEdges(grid: Grid, r: Rect, atX: number = r.x): number[] {
  const out: number[] = [];
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
    if ((maskOf(grid, atX, y) & E) !== 0) out.push(y);
  }
  return out;
}

/** The rail the last track starts at: the last divider, or the border itself. */
function lastRail(edges: number[], start: number): number {
  return edges.length === 0 ? start : (edges[edges.length - 1] as number);
}

/** How wide the last column is, which is how wide the next one should be. */
function lastTrack(edges: number[], start: number, end: number): number {
  return Math.max(MIN_TRACK, end - lastRail(edges, start) - 1);
}

/** A divider to draw through the new track, so the lattice stays complete. */
interface Divider {
  from: Cell;
  to: Cell;
}

/**
 * Grow the box and hand back one diff.
 *
 * Note what is *not* here: no re-alignment of the label. `planResize` re-centres
 * a label because the shape it sits in changed size, but a new column does not
 * change the column the label is in — it is still where it was put, and moving
 * it would be the operation overreaching.
 */
function planGrow(
  grid: Grid,
  selection: Candidate,
  to: Rect,
  rails: readonly Divider[],
  opts: LatticeOptions,
  note: string,
  /** Row growth only: push everything under `below` down by `by`. */
  push?: { below: number; by: number },
): Plan {
  // A new row takes up space that something else may be standing in, and
  // growing over it would be the operation destroying what it never asked
  // about. So everything strictly below the wall moves down by exactly what
  // the box gains: the box grows into the ground it vacates, and whatever was
  // under it keeps its distance from the wall — including a connector hanging
  // off that wall, which stays attached without being re-routed at all.
  const shifted =
    push === undefined
      ? { diff: new Map<CellKey, string | null>(), count: 0 }
      : shiftBelow(grid, push.below, push.by);
  const shove = shifted.diff;
  const moved = new Set(shove.keys());

  // The wall the connectors were attached to is about to move out from under
  // them, and the box grows over the ground they stood on. So they are found
  // first and the new border is stamped against a grid with their old runs
  // already gone — otherwise the wall lands on a shaft still sitting there and
  // merges with it, and what should be a plain `│` comes out a `┼`.
  //
  // A connector lying wholly below that wall is left out: it is being carried
  // by the push, and re-routing something that has already moved correctly is
  // how one gesture turns into two answers fighting each other.
  const all = opts.sticky === false ? [] : findConnectors(grid, selection.cells);
  const connectors = all.filter((c) => !carriedBy(c.cells, moved));

  const lifted = new Set<CellKey>();
  for (const c of connectors) {
    for (const key of c.cells) lifted.add(key);
  }

  const after = cloneWithout(grid, lifted);
  applyDiff(after, shove);
  const grown = stampBox(after, to, opts.charset);
  applyDiff(after, grown);

  // Carry the neighbouring band's dividers through the new track, drawn against
  // the grown box so each one merges into the walls it lands on: a `┴` that
  // gains a southward arm is a `┼`, and the new outer wall it reaches becomes a
  // `┤`. Same stamper, same merging rules as a line drawn by hand.
  const diffs: CellDiff[] = [shove, grown];
  for (const rail of rails) {
    const drawn = stampPath(after, rail.from, rail.to, opts.charset);
    applyDiff(after, drawn);
    diffs.push(drawn);
  }

  let stranded: string | undefined;
  if (connectors.length > 0) {
    const routed = rerouteDiff(
      grid,
      new Set(borderKeys(to)),
      connectors,
      merge(...diffs),
      opts.charset,
    );
    diffs.push(routed.diff);
    stranded = routed.note;
  }

  // No silent reflow (tables §13): a push rewrites cells far from the pointer,
  // and how far it reached is not optional.
  const said =
    shifted.count === 0 ? note : `${note} · ${String(shifted.count)} cells pushed down`;

  return {
    diff: merge(...diffs),
    selection: { kind: 'box', cells: new Set(borderKeys(to)), bounds: to },
    // A connector left stranded is the more urgent thing to say.
    note: stranded ?? said,
  };
}

/**
 * Everything strictly below `below`, moved down by `by`.
 *
 * Cells rather than whole objects, which is what "insert a row" means
 * everywhere else: the page below the wall comes down as one, so anything
 * standing under the box keeps its distance from it and its alignment with its
 * neighbours. The one thing this cannot do is take half of something — a shape
 * that straddles the wall has its lower half moved and its upper half left,
 * which is why the wall is the box's own bottom edge and not an arbitrary line.
 */
function shiftBelow(
  grid: Grid,
  below: number,
  by: number,
): { diff: CellDiff; count: number } {
  if (by <= 0) return { diff: new Map(), count: 0 };

  const cells = new Set<CellKey>();
  for (const key of grid.keys()) {
    if (unck(key).y > below) cells.add(key);
  }
  return { diff: moveDiff(grid, cells, 0, by), count: cells.size };
}

/** True when every cell of a connector is one the push has already carried. */
function carriedBy(cells: ReadonlySet<CellKey>, moved: ReadonlySet<CellKey>): boolean {
  for (const key of cells) {
    if (!moved.has(key)) return false;
  }
  return cells.size > 0;
}

/**
 * The rectangle this selection *is*, if it is one.
 *
 * Asked as a question about the cells rather than about the matcher's label,
 * because `kind === 'box'` is a much narrower thing than it looks. A click
 * lands on one and the keyboard almost never does: sweep a table with
 * `Shift`+arrow, take it with object select, or step out to it with
 * `Ctrl`+`Enter`, and every one of those answers `cells` — the trace is one
 * component with dividers in it, which no rectangle matcher will claim. The
 * menu was therefore reachable with the mouse and unreachable without it, for
 * a selection that is a bordered rectangle by every test except its name.
 *
 * `enclosesArea` is that test: every cell of its own bounding box's border is
 * present (nesting §9). A circle is excluded by name because it passes that
 * and still has no lattice to extend; anything else circle-shaped fails the
 * geometry anyway, its corners being empty.
 */
function boxBounds(selection: Candidate): Rect | null {
  if (selection.kind === 'ellipse') return null;
  if (!enclosesArea(selection)) return null;
  return boundsOf(selection.cells) ?? selection.bounds;
}

export function planAddColumn(
  grid: Grid,
  selection: Candidate,
  opts: LatticeOptions,
): Plan {
  const r = boxBounds(selection);
  if (r === null) return refuse('Only a box can take a column');

  const right = r.x + r.w - 1;
  const edges = columnEdges(grid, r);
  const width = lastTrack(edges, r.x, right);
  const to = { ...r, w: r.w + width + 1 };

  // The new column is divided the way the column beside it is — read down that
  // column's own left rail, not down the box's left edge, so it copies its
  // neighbour rather than the first column of the table.
  const rails = rowEdges(grid, r, lastRail(edges, r.x)).map((y) => ({
    from: { x: right, y },
    to: { x: to.x + to.w - 1, y },
  }));

  return planGrow(grid, selection, to, rails, opts, `Column added, ${width} wide`);
}

export function planAddRow(
  grid: Grid,
  selection: Candidate,
  opts: LatticeOptions,
): Plan {
  const r = boxBounds(selection);
  if (r === null) return refuse('Only a box can take a row');

  const bottom = r.y + r.h - 1;
  const edges = rowEdges(grid, r);
  const height = lastTrack(edges, r.y, bottom);
  const to = { ...r, h: r.h + height + 1 };

  // Likewise: the row above decides how the new row is divided, read across
  // that row's own top rail.
  const rails = columnEdges(grid, r, lastRail(edges, r.y)).map((x) => ({
    from: { x, y: bottom },
    to: { x, y: to.y + to.h - 1 },
  }));

  const by = to.h - r.h;
  return planGrow(grid, selection, to, rails, opts, `Row added, ${height} tall`, {
    below: bottom,
    by,
  });
}

/**
 * What the menu asks before offering the two items at all.
 *
 * The same question the planners ask, so the menu cannot offer something they
 * would then refuse.
 */
export function canDivide(selection: Candidate | null): boolean {
  return selection !== null && boxBounds(selection) !== null;
}

/**
 * Resizing a track — the spreadsheet gesture, and the one place three different
 * requests turn out to be the same operation.
 *
 * Drag a separator right and the column to its left gets wider; type past the
 * end of a cell and that same column has to widen to fit; type past the end of
 * a plain box and the box has to grow. All three are: **take everything from
 * this rail rightward and shift it, then fill in what was left behind.**
 *
 * The plain box is not a special case of the table, it is the *same* case — a
 * box is a table with one column, and its right border is that column's rail.
 * Nothing here asks which of the two it is dealing with.
 *
 * ── What goes in the gap ──────────────────────────────────────────────────
 *
 * The new cells take their character from the rail they came from: a rail cell
 * that connects sideways is part of a horizontal run — a top border, a bottom
 * border, a row separator — so the gap continues that run. A rail cell that
 * does not is a wall between two content rows, so the gap is blank.
 *
 * That one test spells every row correctly without knowing what any of them
 * are for.
 */
export function planResizeTrack(
  grid: Grid,
  table: Rect,
  axis: 'column' | 'row',
  rail: number,
  by: number,
  opts: LatticeOptions,
): Plan {
  const along = axis === 'column';
  const far = along ? table.x + table.w - 1 : table.y + table.h - 1;
  const near = along ? table.x : table.y;

  // A track must keep an interior. Narrowing stops at one cell rather than
  // letting a column collapse into its own wall.
  const room = rail - near - 1;
  const delta = Math.max(by, MIN_TRACK - room);
  if (delta === 0) return nothing();

  const at = (a: number, b: number): CellKey => (along ? ck(a, b) : ck(b, a));
  const cross = along
    ? { from: table.y, to: table.y + table.h - 1 }
    : { from: table.x, to: table.x + table.w - 1 };

  const diff: CellDiff = new Map();

  // Whatever is standing where the shape is about to be gets pushed along
  // rather than written over. Order matters and is the whole of it: every
  // erase first, then every write, so clearing a neighbour's old cell cannot
  // rub out the new wall that has just been put there.
  const pushed = delta > 0 ? standingInTheWay(grid, table, along, delta) : new Set<CellKey>();

  // Clear the whole band that is about to be rewritten, in both directions —
  // widening leaves a gap behind, narrowing leaves one at the far end.
  for (let c = cross.from; c <= cross.to; c++) {
    for (let a = Math.min(rail, rail + delta); a <= far; a++) diff.set(at(a, c), null);
  }
  for (const key of pushed) diff.set(key, null);

  // Shift what was there.
  for (let c = cross.from; c <= cross.to; c++) {
    for (let a = rail; a <= far; a++) {
      const ch = grid.get(at(a, c));
      if (ch !== undefined) diff.set(at(a + delta, c), ch);
    }
  }
  for (const key of pushed) {
    const p = unck(key);
    diff.set(
      along ? ck(p.x + delta, p.y) : ck(p.x, p.y + delta),
      grid.get(key) as string,
    );
  }

  // Fill the gap the shift opened, one column or row at a time.
  const sideways = along ? E | W : N | S;
  if (delta > 0) {
    for (let c = cross.from; c <= cross.to; c++) {
      const { x, y } = unck(at(rail, c));
      const runs = (maskOf(grid, x, y) & sideways) !== 0;
      for (let k = 0; k < delta; k++) {
        diff.set(at(rail + k, c), runs ? glyphFor(sideways, opts.charset) : null);
      }
    }
  }

  const to: Rect = along
    ? { ...table, w: table.w + delta }
    : { ...table, h: table.h + delta };

  const diffs: CellDiff[] = [diff];
  let note: string | undefined;

  if (opts.sticky !== false) {
    const outline = new Set(borderKeys(table));
    const connectors = findConnectors(grid, outline);
    if (connectors.length > 0) {
      const routed = rerouteDiff(grid, new Set(borderKeys(to)), connectors, diff, opts.charset);
      diffs.push(routed.diff);
      note = routed.note;
    }
  }

  return {
    diff: merge(...diffs),
    selection: { kind: 'box', cells: new Set(borderKeys(to)), bounds: to },
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * How far a line runs in one direction, in cells. Stops at the last cell that
 * still reaches onward, so it lands on the corner rather than past it.
 */
function walk(grid: Grid, x: number, y: number, dx: number, dy: number, arm: number): number {
  let cx = x;
  let cy = y;
  for (let step = 0; step < RAIL_REACH; step++) {
    if ((maskOf(grid, cx, cy) & arm) === 0) break;
    cx += dx;
    cy += dy;
  }
  return dx !== 0 ? cx : cy;
}

/** No table is wider or deeper than this, and a runaway walk is worse than a miss. */
const RAIL_REACH = 4096;

/**
 * True when the cell a rail's walk stopped at is a bar running **across** it.
 *
 * A separator is a separator because it divides something. Checking only that
 * it sits between the table's sides is not enough: a line dropped from a box's
 * bottom wall passes that test and is no separator at all — it is a wire
 * hanging in open space, and its far end is a loose end rather than a wall.
 *
 *     ┌─────────┐        the `│` below is inside the wall's span, so it read
 *     └────┬────┘        as a column rail; grabbing it resized a table that
 *          │             does not exist, and clicking it could not select the
 *          │             line, because the press was a drag before it was ever
 *          │             a click.
 *
 * Requiring a crossbar at **both** ends is what tells the two apart, and it is
 * the same question the eye asks: is there a wall there, or does it just stop?
 */
function capped(grid: Grid, x: number, y: number, arms: number): boolean {
  return (maskOf(grid, x, y) & arms) === arms;
}

/** A separator a pointer is on, and the table it belongs to. */
export interface Rail {
  table: Rect;
  axis: 'column' | 'row';
  /** The x of a column separator, or the y of a row one. */
  at: number;
}

/**
 * The separator under the pointer, if there is one.
 *
 * Interior rails only. The outer border is left to the resize handles, which
 * already own it — and dragging the edge of a table to change its size means
 * something different from dragging a column to change its width.
 */
export function railAt(grid: Grid, x: number, y: number): Rail | null {
  // Cheap rejection first. This is asked on every pointer move so that the
  // cursor can change before the drag starts, and `candidatesAt` traces a whole
  // component — far too much to spend on the blank cells that are most of any
  // document. A rail runs straight through, so anything that does not is out
  // before a single cell is traced.
  const mask = maskOf(grid, x, y);
  const runsDown = (mask & (N | S)) === (N | S);
  const runsAcross = (mask & (E | W)) === (E | W);
  if (!runsDown && !runsAcross) return null;

  // The table is found by **walking the rail to its ends and then walking the
  // border it lands on**, which costs a perimeter of `maskOf` calls and no
  // tracing at all. Asking the recognizer instead was correct and took two
  // milliseconds a hover, which is most of a frame spent choosing a cursor.
  //
  // The walk is also what rejects a wall that only looks like a rail. Follow a
  // box's own right-hand border up to its `┐` and the walk east stops at once,
  // so the "rail" turns out to sit *on* the edge it would have to be inside —
  // and the outer edge belongs to the resize handles, not to this.
  if (runsDown) {
    const top = walk(grid, x, y, 0, -1, N);
    const bottom = walk(grid, x, y, 0, 1, S);
    const left = walk(grid, x, top, -1, 0, W);
    const right = walk(grid, x, top, 1, 0, E);
    if (x > left && x < right && capped(grid, x, top, E | W) && capped(grid, x, bottom, E | W)) {
      return { table: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }, axis: 'column', at: x };
    }
  }
  if (runsAcross) {
    const left = walk(grid, x, y, -1, 0, W);
    const right = walk(grid, x, y, 1, 0, E);
    const top = walk(grid, left, y, 0, -1, N);
    const bottom = walk(grid, left, y, 0, 1, S);
    if (y > top && y < bottom && capped(grid, left, y, N | S) && capped(grid, right, y, N | S)) {
      return { table: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }, axis: 'row', at: y };
    }
  }
  return null;
}

/**
 * The table a cell belongs to, found by walking the cell's own walls outward.
 *
 * A cell's top edge is either the table's top border or a row separator, and
 * both run the full width; its left edge is either the table's side or a column
 * separator, and both run the full height. So two walks from one corner give
 * the whole table without tracing anything.
 */
export function tableOf(grid: Grid, cell: Rect): Rect {
  const left = walk(grid, cell.x, cell.y, -1, 0, W);
  const right = walk(grid, cell.x + cell.w - 1, cell.y, 1, 0, E);
  const top = walk(grid, left, cell.y, 0, -1, N);
  const bottom = walk(grid, left, cell.y, 0, 1, S);
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/**
 * The cell next to this one, in a table — the spreadsheet arrow key.
 *
 * Null when there is no such cell, which is what makes a plain box fall through
 * to being nudged: a box is a table of one cell, so it has no neighbours and
 * arrow keys mean what they always meant.
 */
export function neighbourCell(grid: Grid, cell: Rect, dx: number, dy: number): Rect | null {
  const table = tableOf(grid, cell);
  const right = table.x + table.w - 1;
  const bottom = table.y + table.h - 1;

  // A column boundary shows as an arm heading down from the cell's own top
  // edge; a row boundary as an arm heading right from its left edge. Both hold
  // whether the edge is a separator or the table's own border.
  if (dx !== 0) {
    const from = dx > 0 ? cell.x + cell.w - 1 : cell.x;
    if (dx > 0 ? from >= right : from <= table.x) return null;

    for (let x = from + dx; x >= table.x && x <= right; x += dx) {
      if ((maskOf(grid, x, cell.y) & S) === 0) continue;
      const near = Math.min(from, x);
      return { x: near, y: cell.y, w: Math.abs(x - from) + 1, h: cell.h };
    }
    return null;
  }

  const from = dy > 0 ? cell.y + cell.h - 1 : cell.y;
  if (dy > 0 ? from >= bottom : from <= table.y) return null;

  for (let y = from + dy; y >= table.y && y <= bottom; y += dy) {
    if ((maskOf(grid, cell.x, y) & E) === 0) continue;
    const near = Math.min(from, y);
    return { x: cell.x, y: near, w: cell.w, h: Math.abs(y - from) + 1 };
  }
  return null;
}

/**
 * The word a loose character belongs to: the text cells beside it on its row.
 *
 * Stops at anything with connectivity, so a word written up against a wall is
 * the word and not the wall.
 */
function wordAt(grid: Grid, x: number, y: number): Set<CellKey> {
  const out = new Set<CellKey>([ck(x, y)]);
  const text = (cx: number): boolean => grid.has(ck(cx, y)) && maskOf(grid, cx, y) === 0;

  for (let cx = x - 1; text(cx); cx--) out.add(ck(cx, y));
  for (let cx = x + 1; text(cx); cx++) out.add(ck(cx, y));
  return out;
}

/**
 * What a growing shape would actually collide with, and what those collide with
 * in turn.
 *
 * **Only things in the way move.** The first version pushed everything past the
 * shape's far edge, which kept the picture intact but shoved diagrams that were
 * nowhere near it. What matters is contact: a neighbour three cells away is not
 * touched by a two-cell growth, and one cell away is.
 *
 * So this starts from the strip the shape is about to occupy and grows the
 * answer by contact. Whatever overlaps that strip moves; wherever it lands
 * becomes part of the strip; repeat. A queue of shoves, which is what pushing a
 * row of things along actually is.
 *
 * Two things are deliberately excluded. **Whole components only** — something
 * straddling the far edge is already overlapping the shape, and moving half of
 * it is worse than the collision it was meant to avoid. And **nothing is pulled
 * back when the shape shrinks**: growing would destroy what is in the way, so
 * pushing prevents damage, while shrinking destroys nothing, so closing the gap
 * afterwards would be tidying — and tidying that happens without being asked is
 * how a tool starts to feel possessed (content §4).
 */
function standingInTheWay(
  grid: Grid,
  table: Rect,
  along: boolean,
  delta: number,
): Set<CellKey> {
  const far = along ? table.x + table.w - 1 : table.y + table.h - 1;

  // Every component clear of the far edge, gathered once. Text traces as
  // nothing — it has no connectivity to follow — so a word has to be gathered
  // by adjacency instead. Letter by letter would tear it: the shove reaches the
  // first three letters of a four-letter word, they move, and the fourth is
  // left behind because it was never in the strip and never in their way.
  const groups: Array<Set<CellKey>> = [];
  const seen = new Set<CellKey>();

  for (const key of grid.keys()) {
    if (seen.has(key)) continue;
    const at = unck(key);

    const comp = trace(grid, at.x, at.y).cells;
    const group = comp.size === 0 ? wordAt(grid, at.x, at.y) : comp;
    for (const k of group) seen.add(k);

    let clear = true;
    for (const k of group) {
      const p = unck(k);
      if ((along ? p.x : p.y) <= far) {
        clear = false;
        break;
      }
    }
    if (clear) groups.push(group);
  }

  // The strip the shape is about to stand in.
  const claimed = new Set<CellKey>();
  const cross = along
    ? { from: table.y, to: table.y + table.h - 1 }
    : { from: table.x, to: table.x + table.w - 1 };

  for (let c = cross.from; c <= cross.to; c++) {
    for (let k = 1; k <= delta; k++) {
      claimed.add(along ? ck(far + k, c) : ck(c, far + k));
    }
  }

  const out = new Set<CellKey>();
  const moved = new Set<number>();

  for (let pass = 0; pass < groups.length; pass++) {
    let shoved = false;

    for (let i = 0; i < groups.length; i++) {
      if (moved.has(i)) continue;
      const group = groups[i] as Set<CellKey>;

      let hit = false;
      for (const k of group) {
        if (claimed.has(k)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;

      moved.add(i);
      shoved = true;
      for (const k of group) {
        out.add(k);
        // Where it lands is where the next thing gets shoved from.
        const p = unck(k);
        claimed.add(along ? ck(p.x + delta, p.y) : ck(p.x, p.y + delta));
      }
    }
    if (!shoved) break;
  }
  return out;
}
