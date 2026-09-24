/**
 * Sticky connectors (M7, B-MAN-11).
 *
 * Move a box and the arrows pointing at it should follow. Nothing in the
 * document says "this arrow belongs to that box" — there are no objects and no
 * ids — so attachment is worked out the same way everything else is: from the
 * characters and where they sit.
 *
 * A connector is a line or arrow with one end touching the shape being moved
 * and the other end somewhere else. On the move it is erased and redrawn from
 * its free end to the shape's new side, which is why this is *re-routing* and
 * not translation: the far end stays exactly where it was.
 *
 * ── Planned split (intuitive/plan.md, phases 1 and 3) ─────────────────────
 *
 * This file currently does three jobs. Two of them are leaving:
 *
 *   → `derive/attach.ts`   finding what is attached: `findConnectors`,
 *                          `strandOutside`, `approachFrom`, `attachedSide`,
 *                          `shapeBehind`
 *   → `route/sides.ts`     choosing where it lands: `sideFacing`, `anchorOn`,
 *                          plus the unbuilt `assignAnchors` (sticky §3)
 *
 * What stays is orchestration: erase, decide, draw, merge. `routeVertices` also
 * stays but becomes the *fallback* — `route/astar.ts` is asked first, and its
 * L/Z answer is what we use when the search exceeds its budget.
 */

import { boundsOf, ck, unck, type Cell, type CellKey } from '../geom/cell.ts';
import {
  DIRS,
  E,
  N,
  S,
  W,
  arrowDir,
  dirDelta,
  opposite,
  type Charset,
  type Dir,
} from '../charset/charsets.ts';
import {
  applyDiff,
  cloneWithout,
  connected,
  maskOf,
  type CellDiff,
  type Grid,
} from '../grid/grid.ts';
import { links } from '../grid/links.ts';
import { findRoute } from './astar.ts';
import { DEFAULT_COSTS, budgetFor, terrainFor, type Terrain } from './cost.ts';
import { segmentize } from '../recognize/segmentize.ts';
import { matchEllipse, matchPath } from '../recognize/recognize.ts';
import { enclosesArea } from '../derive/contain.ts';
import { eraseWithHeal } from '../stamp/erase.ts';
import { stampPolyline } from '../stamp/path.ts';

export interface Connector {
  /** Every cell of the line, the attached end included. */
  cells: Set<CellKey>;
  /** The cell of the connector that touches the shape. */
  anchor: Cell;
  /** Which way from the anchor the shape lies. */
  approach: Dir;
  /** The far end. It stays put unless it too is attached to something. */
  free: Cell;
  /** Which way from the far end *its* shape lies, when it has one. */
  freeApproach: Dir | null;
  /**
   * The shape holding the far end, when there is one. Its attachment point is
   * allowed to slide around it — what must never happen is the end coming
   * adrift altogether.
   */
  freeShape: Set<CellKey> | null;
  /** True when the attached end carries an arrowhead. */
  headed: boolean;
  /** True when the *far* end carries one, so redrawing keeps it. */
  headedAtFree: boolean;
}

/** More than this attached to one shape and re-routing stops being helpful. */
export const MAX_CONNECTORS = 12;

/**
 * Cells that belong to the line rather than to the shape.
 * Walks outward from `start` without ever stepping onto the shape.
 */
function strandOutside(
  grid: Grid,
  start: Cell,
  shape: ReadonlySet<CellKey>,
): Set<CellKey> {
  const out = new Set<CellKey>([ck(start.x, start.y)]);
  const queue: Cell[] = [start];

  const visit = (next: Cell): void => {
    const key = ck(next.x, next.y);
    if (shape.has(key) || out.has(key)) return;
    out.add(key);
    queue.push(next);
  };

  while (queue.length > 0) {
    const cell = queue.pop() as Cell;
    for (const dir of DIRS) {
      if (connected(grid, cell.x, cell.y, dir)) visit({ x: cell.x + dir.dx, y: cell.y + dir.dy });
    }
    // A circle behind the connector is only whole through its links (B-CONN-08).
    for (const next of links(grid, cell.x, cell.y)) visit(next);
  }
  return out;
}

/**
 * How far a connector may be walked. Beyond this it is not a connector, and a
 * walk that will not stop is worse than one that gives up.
 */
const MAX_STRAND_STEPS = 4096;

/** Where this cell leads next: outside the shape, and not already walked. */
function stepsFrom(
  grid: Grid,
  from: Cell,
  shape: ReadonlySet<CellKey>,
  seen: ReadonlySet<CellKey>,
): Cell[] {
  const out: Cell[] = [];
  for (const dir of DIRS) {
    const next: Cell = { x: from.x + dir.dx, y: from.y + dir.dy };
    if (shape.has(ck(next.x, next.y)) || seen.has(ck(next.x, next.y))) continue;
    if (!connected(grid, from.x, from.y, dir)) continue;
    out.push(next);
  }
  return out;
}

/** How many ways this cell leads, the shape being moved not counted. */
function branchesAt(grid: Grid, c: Cell, shape: ReadonlySet<CellKey>): number {
  let n = 0;
  for (const dir of DIRS) {
    if (shape.has(ck(c.x + dir.dx, c.y + dir.dy))) continue;
    if (connected(grid, c.x, c.y, dir)) n++;
  }
  return n;
}

/** A connector, and whatever stopped the walk that found it. */
interface Strand {
  cells: Set<CellKey>;
  /** The junction the walk stopped at, or null when the line simply ended. */
  junction: Cell | null;
}

/**
 * The connector itself, **walked** as a path rather than flooded.
 *
 * `strandOutside` cannot tell a connector from what it has merged into, and a
 * connector merged into a border is not an exotic case — it is what you get by
 * dragging an arrow from the edge of a box, and it is what half the hand-drawn
 * ASCII diagrams in the world already look like:
 *
 *     ┌──────┐            ┌──────┐
 *     │      ├───────────▶│      │        the `├` is a real junction
 *     └──────┘            └──────┘
 *
 * Flooding out of the right-hand box walks the shaft, arrives at that `├`, and
 * carries on around the left-hand box — so the component is not a simple path,
 * the connector is discarded, and nothing follows the move. Every sticky
 * connector test passed throughout, because every fixture drew the line one
 * cell clear of the border, where no junction is made.
 *
 * Walking stops one cell short of the junction instead. That leaves the shape
 * beyond it for `shapeBehind` to pick up, which is exactly where the far end
 * belonged: a connector between two shapes, not a connector welded to one.
 *
 * Null when the line forks on its own account — there is no single free end to
 * re-route then, and guessing at one would move content the user never touched.
 */
function walkStrand(grid: Grid, start: Cell, shape: ReadonlySet<CellKey>): Strand | null {
  const cells = new Set<CellKey>([ck(start.x, start.y)]);
  let cur = start;

  for (let step = 0; step < MAX_STRAND_STEPS; step++) {
    const onward = stepsFrom(grid, cur, shape, cells);
    if (onward.length === 0) return { cells, junction: null };
    if (onward.length > 1) return null;

    const next = onward[0] as Cell;
    if (branchesAt(grid, next, shape) > 2) return { cells, junction: next };

    cells.add(ck(next.x, next.y));
    cur = next;
  }
  return null;
}

/**
 * True when these cells hold a shape with an inside.
 *
 * The gate on narrowing a strand: stopping at a junction is only justified when
 * what lies beyond it is something a connector can sensibly be attached *to*.
 *
 * Both matchers are needed. `enclosesArea` asks whether the border of the
 * bounding box is all present, which is right for a box — and right even when
 * that box is wearing the `├` of the connector we are asking about — but a
 * circle never fills the corners of its own bounding box, so it has to be
 * recognised as the ring it is.
 */
function isShape(cells: ReadonlySet<CellKey> | null): boolean {
  if (cells === null) return false;
  const bounds = boundsOf(cells);
  if (bounds === null) return false;
  if (matchEllipse(cells, bounds)) return true;
  return enclosesArea({ kind: 'cells', cells: new Set(cells), bounds });
}

/**
 * Is this cell attached to the shape — and if so, from which side?
 *
 * Attachment is looser than connection on purpose. A line drawn up to a box
 * usually does *not* join it: the box's `│` offers no eastward arm, so the two
 * only touch. What matters is that the line **runs into** the shape, which is
 * a question about the line's own direction, not a mutual agreement.
 */
function approachFrom(grid: Grid, cell: Cell, shape: ReadonlySet<CellKey>): Dir | null {
  const key = ck(cell.x, cell.y);

  for (const dir of DIRS) {
    if (!shape.has(ck(cell.x + dir.dx, cell.y + dir.dy))) continue;

    // An arrowhead aimed at it. These deliberately stop one cell short
    // (B-DRAW-10a), so they never connect, but they are plainly attached.
    if (arrowDir(grid.get(key)) === dir.d) return dir.d;

    // Or a line whose own connectivity heads that way — whether or not the
    // border happens to reach back.
    if ((maskOf(grid, cell.x, cell.y) & dir.d) !== 0) return dir.d;
  }
  return null;
}

/**
 * Which way something else sits next to this end.
 *
 * Deliberately looser than `approachFrom`: a line drawn up against a border
 * often only *touches* it rather than joining it, and for routing purposes
 * touching is attachment enough.
 */
function attachedSide(grid: Grid, cell: Cell, own: ReadonlySet<CellKey>): Dir | null {
  for (const dir of DIRS) {
    const key = ck(cell.x + dir.dx, cell.y + dir.dy);
    if (own.has(key)) continue;
    if (maskOf(grid, cell.x + dir.dx, cell.y + dir.dy) !== 0) return dir.d;
  }
  return null;
}

/**
 * Whatever sits on the far side of the connector's loose end.
 *
 * Traced without stepping back onto the connector, so a line that has merged
 * into a box yields the box rather than everything joined to it. Null when the
 * end is loose, or when the trace wanders back into the shape being moved —
 * in either case the end should simply stay where it is.
 */
function shapeBehind(
  grid: Grid,
  free: Cell,
  side: Dir | null,
  own: ReadonlySet<CellKey>,
  moving: ReadonlySet<CellKey>,
): Set<CellKey> | null {
  if (side === null) return null;

  const { dx, dy } = dirDelta(side);
  const start: Cell = { x: free.x + dx, y: free.y + dy };
  if (moving.has(ck(start.x, start.y))) return null;

  const cells = strandOutside(grid, start, own);
  for (const key of cells) {
    if (moving.has(key)) return null;
  }
  return cells.size === 0 ? null : cells;
}

/**
 * Lines attached to `shape`, each traced away from it.
 *
 * Only simple paths qualify. Something that branches has no single free end to
 * re-route, and guessing at one would move content the user never selected.
 */
export function findConnectors(grid: Grid, shape: ReadonlySet<CellKey>): Connector[] {
  const found: Connector[] = [];
  const claimed = new Set<CellKey>();

  for (const key of shape) {
    const { x, y } = unck(key);

    for (const dir of DIRS) {
      const cell: Cell = { x: x + dir.dx, y: y + dir.dy };
      const outside = ck(cell.x, cell.y);
      if (shape.has(outside) || claimed.has(outside)) continue;
      if (maskOf(grid, cell.x, cell.y) === 0 && arrowDir(grid.get(outside)) === null) {
        continue;
      }

      const approach = approachFrom(grid, cell, shape);
      if (approach === null) continue;

      const flooded = strandOutside(grid, cell, shape);
      for (const c of flooded) claimed.add(c);

      // The flood is the whole connected component, which is the connector
      // itself right up until the connector merged into something at its far
      // end — from here that reads as one branching blob. Walk the line when
      // that happens and stop at the junction, so the connector is the
      // connector again and the shape behind it is a shape.
      let cells = flooded;
      let narrowed = false;
      if (matchPath(grid, segmentize(grid, flooded)) === null) {
        const strand = walkStrand(grid, cell, shape);
        if (strand === null || strand.junction === null) continue;
        cells = strand.cells;
        narrowed = true;
      }

      const graph = segmentize(grid, cells);
      if (matchPath(grid, graph) === null) continue; // branches: leave it alone

      // A connector meets the shape at exactly one place. Anything touching it
      // twice is a neighbour leaning on it — two boxes sharing an edge read as
      // an open path once the shared column is excluded — and re-routing that
      // would tear apart something the user never selected.
      let touches = 0;
      for (const key of cells) {
        if (approachFrom(grid, unck(key), shape) !== null) touches++;
      }
      if (touches !== 1) continue;

      // The free end is the other loose end of the path.
      const ends: Cell[] = [];
      for (const [k, degree] of graph.degree) {
        if (degree <= 1) ends.push(unck(k));
      }
      const free = ends.find((e) => e.x !== cell.x || e.y !== cell.y);
      if (free === undefined) continue;

      const freeApproach = attachedSide(grid, free, cells);
      const freeShape = shapeBehind(grid, free, freeApproach, cells, shape);

      // Cutting a strand short is only honest when the far end really did merge
      // into a *shape*. A line crossing another line stops the walk just as a
      // border does, and re-anchoring a connector onto a passing rail would be
      // an invention — so that case is left exactly as it was: alone.
      if (narrowed && !isShape(freeShape)) continue;

      found.push({
        cells,
        anchor: cell,
        approach,
        free,
        freeApproach,
        freeShape,
        headed: arrowDir(grid.get(outside)) !== null,
        headedAtFree: arrowDir(grid.get(ck(free.x, free.y))) !== null,
      });
      if (found.length >= MAX_CONNECTORS) return found;
    }
  }
  return found;
}

function isHorizontal(d: Dir): boolean {
  return d === E || d === W;
}

function centreOf(cells: ReadonlySet<CellKey>): Cell {
  const bounds = boundsOf(cells);
  if (bounds === null) return { x: 0, y: 0 };
  return { x: bounds.x + (bounds.w - 1) / 2, y: bounds.y + (bounds.h - 1) / 2 };
}

/**
 * Which side of `self` should face `other` (B-MAN-11f).
 *
 * Returns the *approach*: the direction from the attachment cell back toward
 * the shape. Preserving the original side instead is the single biggest source
 * of connectors that look dragged rather than drawn — move a box directly
 * below its neighbour and a preserved east side gives a pointless detour out
 * to the right and back, where a person would simply leave through the bottom.
 */
export function sideFacing(self: Cell, other: Cell): Dir {
  const dx = other.x - self.x;
  const dy = other.y - self.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? W : E;
  return dy >= 0 ? N : S;
}

/**
 * The cell a connector should attach to on a given side, nearest `toward`.
 *
 * Works off the shape's own cells rather than its bounding box, so a circle
 * attaches at the widest part of its curve rather than out in the empty corner
 * of the rectangle around it. Corners are avoided where there is any choice:
 * a line meeting a box exactly at its `┌` reads as a mistake.
 *
 * Given the grid, a circle's slashes are never chosen — a slash has no arm for
 * the line to join, so the line would overwrite it — and a cell holding the
 * ring together across a diagonal (a bend, B-CONN-08) only when nothing else
 * faces that way.
 */
export function anchorOn(
  shape: ReadonlySet<CellKey>,
  approach: Dir,
  toward: Cell,
  grid?: Grid,
): Cell | null {
  const bounds = boundsOf(shape);
  if (bounds === null) return null;

  const { dx, dy } = dirDelta(approach);
  const right = bounds.x + bounds.w - 1;
  const bottom = bounds.y + bounds.h - 1;

  let best: Cell | null = null;
  let bestScore = Infinity;

  for (const key of shape) {
    const { x, y } = unck(key);
    const cx = x - dx;
    const cy = y - dy;
    if (cx < 0 || cy < 0) continue;
    if (shape.has(ck(cx, cy))) continue; // must sit outside the shape

    const linkedTo = grid === undefined ? [] : links(grid, x, y);
    if (grid !== undefined && linkedTo.length > 0 && maskOf(grid, x, y) === 0) continue;
    const holdsDiagonal = linkedTo.some((c) => c.x !== x && c.y !== y);

    const atCorner =
      (x === bounds.x || x === right) && (y === bounds.y || y === bottom);
    const score =
      Math.abs(cx - toward.x) +
      Math.abs(cy - toward.y) +
      (atCorner ? 1000 : 0) +
      (holdsDiagonal ? 500 : 0);

    if (score < bestScore) {
      bestScore = score;
      best = { x: cx, y: cy };
    }
  }
  return best;
}

/**
 * Where a connector's last cell goes: against the shape, or on it.
 *
 * A **line** joins what it reaches. The border grows a `┬`, `┴`, `├` or `┤`
 * where the two meet, exactly as it does when the line is drawn there by hand —
 * and drawing it there by hand is the obvious gesture, so a re-route that
 * stopped one cell short left the picture changing under the user for no reason
 * they could see.
 *
 * An **arrow** does not, because its head has to stay visible. Merging it into
 * the wall would replace the `▶` with a `┤` and lose which way it pointed
 * (B-DRAW-10a).
 *
 * Note this deliberately re-creates the case that used to defeat attachment: a
 * merged line is part of the shape's connected component. That is safe now only
 * because finding a connector is a walk that stops at the junction rather than a
 * flood that swallows it — the two changes belong together, and undoing the
 * walk would break this.
 */
function meetingPoint(anchor: Cell, approach: Dir, headed: boolean): Cell {
  if (headed) return anchor;
  const { dx, dy } = dirDelta(approach);
  return { x: anchor.x + dx, y: anchor.y + dy };
}

/**
 * The last leg must run along the approach direction, or an arrow that used to
 * point at the shape would end up pointing past it. A horizontal approach means
 * the vertical travel has to happen first.
 */
function elbowFor(approach: Dir): 'h-first' | 'v-first' {
  return isHorizontal(approach) ? 'v-first' : 'h-first';
}

/**
 * The corners the re-routed line should turn at.
 *
 * When only one end is anchored, an L is enough. When **both** ends are — the
 * usual box-to-arrow-to-box — an L cannot satisfy them: leaving one box
 * sideways and arriving at the other sideways needs a middle leg. That is the
 * Z route, and it is why the far end stays attached to its own shape instead
 * of quietly detaching when the near one moves.
 */
export function routeVertices(
  free: Cell,
  freeApproach: Dir | null,
  anchor: Cell,
  approach: Dir,
): Cell[] {
  if (free.x === anchor.x || free.y === anchor.y) return [free, anchor];

  // Only the moved end is anchored: one elbow, placed to keep the arrival
  // direction right.
  if (freeApproach === null || isHorizontal(freeApproach) !== isHorizontal(approach)) {
    const corner: Cell = isHorizontal(approach)
      ? { x: free.x, y: anchor.y }
      : { x: anchor.x, y: free.y };
    return [free, corner, anchor];
  }

  // Both ends leave along the same axis, so the line has to step across in
  // the middle.
  if (isHorizontal(approach)) {
    const mid = Math.round((free.x + anchor.x) / 2);
    return [free, { x: mid, y: free.y }, { x: mid, y: anchor.y }, anchor];
  }
  const mid = Math.round((free.y + anchor.y) / 2);
  return [free, { x: free.x, y: mid }, { x: anchor.x, y: mid }, anchor];
}

/** What a re-route produced, and anything the user needs told about it. */
export interface Reroute {
  diff: CellDiff;
  /** Set when a connector had no clear route and was drawn straight anyway. */
  note?: string;
}

/** One connector's answer, worked out before anything is written. */
interface Planned {
  c: Connector;
  approach: Dir;
  vertices: Cell[];
}

/** Does this run of corners touch anything it would damage? */
function isClear(vertices: readonly Cell[], terrain: Terrain): boolean {
  for (let i = 0; i < vertices.length - 1; i++) {
    const from = vertices[i] as Cell;
    const to = vertices[i + 1] as Cell;
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);

    let { x, y } = from;
    for (;;) {
      if (terrain.blocked(x, y)) return false;
      if (x === to.x && y === to.y) break;
      x += dx;
      y += dy;
    }
  }
  return true;
}

/**
 * A route from one end to the other: the plain one if it fits, a searched one
 * if it does not.
 *
 * **The L or Z is tried first, and kept when nothing is in the way.** Not as an
 * optimisation — though it is one — but because it is the shape a person draws,
 * and among routes of equal cost the search has no way to know that. Two elbows
 * placed two cells apart cost exactly the same; only one of them is the picture
 * in the design document. Searching first and accepting whichever equal-priced
 * answer came off the heap first would redraw every connector in the editor to
 * no purpose.
 *
 * So the search is for the case it was built for: when the simple route would
 * run through something. Then, and only then, the price list decides the shape.
 *
 * Neither kind of failure stops the connector following its shape:
 *
 *   'budget'  → give up searching and draw the plain route. That is the
 *               behaviour this editor had before there was a router, which is
 *               a poor answer but never a hang and never nothing.
 *   'blocked' → there is no way through at all (§9). Draw the plain route too,
 *               and say so.
 *
 * ── Why "no route" does not mean "do not move the line" ───────────────────
 *
 * pathfinding §9 asks for a visible refusal, and the first version obliged: the
 * connector was left exactly where it was. Then someone dragged a box *into*
 * another box — an ordinary thing to do — and watched every arrow attached to
 * it stay behind. An enclosed shape has no clear route by definition, so the
 * refusal fired on the most normal gesture there is.
 *
 * A line that stops following its box is a worse answer than a line that
 * overlaps something. Routing is a courtesy the editor pays when it can, not a
 * precondition for the connector existing, so a blocked route falls back to the
 * plain one and the note explains why the picture is untidy. Drag the box back
 * out and there is a clear route again, so routing resumes on its own — nothing
 * is remembered, because nothing about this is stored.
 */
function routeThrough(
  after: Grid,
  from: Cell,
  fromApproach: Dir | null,
  to: Cell,
  approach: Dir,
): { vertices: Cell[]; routed: boolean } {
  // The two ends are the only occupied cells the route may occupy: one is the
  // wall it leaves, the other the wall it lands on.
  const ignore = new Set<CellKey>([ck(from.x, from.y), ck(to.x, to.y)]);
  const terrain = terrainFor(after, { ignore });

  const plain = routeVertices(from, fromApproach, to, approach);
  if (isClear(plain, terrain)) return { vertices: plain, routed: true };

  const found = findRoute({
    from,
    // The route leaves *away* from the shape it starts on, which is the
    // opposite of the direction that shape lies in.
    fromSide: fromApproach === null ? null : opposite(fromApproach),
    to,
    toSide: approach,
    terrain,
    costs: DEFAULT_COSTS,
    budget: budgetFor(from, to),
  });

  if (found.ok) return { vertices: found.vertices, routed: true };
  return { vertices: plain, routed: false };
}

/**
 * One diff carrying every re-route, to be merged with whatever changed the
 * shape, so the whole thing stays a single undo step (B-HIST-02).
 *
 * `moved` is where the shape's cells **end up**, which is all this needs to
 * know — so the same function serves a move and a resize. `mutation` is the
 * diff that puts them there.
 */
export function rerouteDiff(
  grid: Grid,
  moved: ReadonlySet<CellKey>,
  connectors: readonly Connector[],
  mutation: CellDiff,
  cs: Charset,
): Reroute {
  const out: CellDiff = new Map();
  if (connectors.length === 0) return { diff: out };

  const movedCentre = centreOf(moved);

  // Plan against a grid with every old run already gone and the shape where it
  // ends up, so a route is never blocked by the very line it is replacing.
  const clear = new Set<CellKey>();
  for (const c of connectors) {
    for (const key of c.cells) clear.add(key);
  }
  const after: Grid = cloneWithout(grid, clear);
  applyDiff(after, mutation);

  const planned: Planned[] = [];
  let stranded = 0;

  for (const c of connectors) {
    // Both ends pick the side that faces the other, from where the shapes
    // have *ended up* rather than where they began (B-MAN-11f).
    const farCentre = c.freeShape === null ? c.free : centreOf(c.freeShape);
    const approach = sideFacing(movedCentre, farCentre);
    const anchor = anchorOn(moved, approach, farCentre, after);
    if (anchor === null || anchor.x < 0 || anchor.y < 0) continue;

    let free = c.free;
    let freeApproach = c.freeApproach;
    if (c.freeShape !== null) {
      freeApproach = sideFacing(farCentre, movedCentre);
      free = anchorOn(c.freeShape, freeApproach, movedCentre, after) ?? c.free;
      // Only an end that has a shape to join can join it; a loose end is left
      // exactly where it was.
      free = meetingPoint(free, freeApproach, c.headedAtFree);
    }
    const meet = meetingPoint(anchor, approach, c.headed);
    if (meet.x === free.x && meet.y === free.y) continue;

    const routed = routeThrough(after, free, freeApproach, meet, approach);
    if (!routed.routed) stranded++;
    planned.push({ c, approach, vertices: routed.vertices });
  }

  // Lift the old lines *and mend what they were joined to*.
  const lifted = new Set<CellKey>();
  for (const p of planned) {
    for (const key of p.c.cells) lifted.add(key);
  }
  const lift = eraseWithHeal(grid, lifted, cs);

  // Lifting the old line must not erase the shape that has just arrived on it.
  // When a box is dragged *closer*, the space its connector used to occupy is
  // exactly where the box now stands, and blanking those cells would punch a
  // hole through it. Nor may a mend land on a cell the shape has just vacated.
  // Either way the mutation has first claim on every cell it touches.
  for (const [key, value] of lift) {
    if (mutation.has(key)) continue;
    out.set(key, value);
  }

  // Draw against what will actually be there, so each route merges with the
  // walls it meets and with any route drawn before it.
  const canvas: Grid = new Map(grid);
  applyDiff(canvas, lift);
  applyDiff(canvas, mutation);

  for (const p of planned) {
    const drawn = stampPolyline(canvas, p.vertices, cs, {
      elbow: elbowFor(p.approach),
      headEnd: p.c.headed,
      headStart: p.c.headedAtFree,
    });
    applyDiff(canvas, drawn);
    for (const [key, value] of drawn) out.set(key, value);
  }

  return stranded === 0
    ? { diff: out }
    : {
        diff: out,
        note:
          stranded === 1
            ? 'No clear route — the line goes straight there'
            : `${stranded} lines had no clear route — they go straight there`,
      };
}
