/**
 * Containment, worked out from the characters (nesting §1).
 *
 * A box drawn inside another box is the most common structure in real diagrams,
 * and the editor has never had a concept of it. This module gives it one —
 * **without storing anything**. Containment is a spatial fact: recomputed every
 * time it is needed and thrown away, which is what keeps a drawn diagram and a
 * pasted one behaving identically.
 *
 * The moment any of this gets cached, that equivalence breaks, and it is the
 * foundation the whole editor rests on. See intuitive/nesting.md §10.
 */

import {
  ck,
  rectContains,
  rectStrictlyInside,
  unck,
  type Cell,
  type CellKey,
  type Rect,
} from '../geom/cell.ts';
import { DIRS } from '../charset/charsets.ts';
import { connected, type Grid } from '../grid/grid.ts';
import { recognize, type Candidate } from '../recognize/recognize.ts';
import { candidatesAt } from '../recognize/rank.ts';
import { borderKeys } from '../stamp/box.ts';

/** Shapes with an inside: the ones that can hold anything. */
export function isClosed(c: Candidate): boolean {
  return c.kind === 'box' || c.kind === 'ellipse';
}

/**
 * True when this selection encloses an area, whatever the matcher called it.
 *
 * Needed because a container stops being *recognised* as a box the moment a
 * connector crosses its wall: the `┼` joins the two, so the trace returns one
 * blob and `recognize` reports `cells`. The container is still a container —
 * every cell of its outline is right there — and it should still carry what is
 * inside it (nesting §9).
 *
 * So the test is about the characters rather than the label: is the complete
 * border of the bounds present in the selection?
 */
export function enclosesArea(c: Candidate): boolean {
  if (isClosed(c)) return true;
  if (c.bounds.w <= 2 || c.bounds.h <= 2) return false;

  for (const key of borderKeys(c.bounds)) {
    if (!c.cells.has(key)) return false;
  }
  return true;
}

/**
 * Every component lying **wholly** inside `bounds` — boxes, circles, lines,
 * words, anything.
 *
 * "Wholly" is the load-bearing word, and it is what separates the two things a
 * container has to treat differently:
 *
 *   - a component entirely inside is **content**, and travels with the container
 *   - a component crossing the border is a **connector**, and gets re-routed
 *     instead (nesting §9)
 *
 * One scan answers both, and it answers them at any depth: a grandchild is
 * inside its grandparent's bounds too, so nothing here needs to recurse.
 */
export function componentsInside(grid: Grid, bounds: Rect): Candidate[] {
  const found: Candidate[] = [];
  const seen = new Set<CellKey>();

  for (let y = bounds.y + 1; y < bounds.y + bounds.h - 1; y++) {
    for (let x = bounds.x + 1; x < bounds.x + bounds.w - 1; x++) {
      const key = ck(x, y);
      if (seen.has(key) || !grid.has(key)) continue;

      const shape = recognize(grid, x, y);
      if (shape === null) {
        seen.add(key);
        continue;
      }
      for (const k of shape.cells) seen.add(k);

      // Reaches outside, so it is something passing through rather than
      // something held.
      if (rectStrictlyInside(bounds, shape.bounds)) found.push(shape);
    }
  }
  return found;
}

/**
 * The shape's own inner walls — the dividers of a lattice.
 *
 * A third category, and the one the editor had no name for. Something found
 * inside a shape is one of:
 *
 *   - **content**, lying wholly inside, which travels with it — a label, a
 *     child box (nesting §2, content §2);
 *   - **a connector**, which leaves through a wall and gets re-routed rather
 *     than carried (nesting §9);
 *   - **a divider**, which touches a wall but never leaves — and is therefore
 *     neither. It is part of the shape.
 *
 * `componentsInside` cannot see the third, because it asks whether a component
 * lies *strictly* inside and a divider never does. Nor can `findConnectors`,
 * which rejects anything meeting the shape twice. So a divided box lost its
 * dividers the moment it moved: they were carried by nobody.
 *
 * Found by walking inward from the border and refusing to step outside the
 * bounds, which is what makes the answer immune to the awkward case: a box
 * with an arrow merged into its wall is one connected component reaching far
 * outside itself, and tracing that component would either take the arrow along
 * or give up. Walking with the walls as a fence takes neither view — it simply
 * never goes there.
 */
export function dividersInside(grid: Grid, shape: Candidate): Set<CellKey> {
  const out = new Set<CellKey>();
  const { bounds } = shape;
  if (bounds.w < 3 || bounds.h < 3) return out;

  const seen = new Set<CellKey>(shape.cells);
  const queue: Cell[] = [...shape.cells].map(unck);

  while (queue.length > 0) {
    const cell = queue.pop() as Cell;
    for (const dir of DIRS) {
      const x = cell.x + dir.dx;
      const y = cell.y + dir.dy;
      if (!rectContains(bounds, x, y)) continue; // the walls are the fence

      const key = ck(x, y);
      if (seen.has(key)) continue;
      if (!connected(grid, cell.x, cell.y, dir)) continue;

      seen.add(key);
      out.add(key);
      queue.push({ x, y });
    }
  }
  return out;
}

/**
 * Every closed shape inside, at any depth.
 *
 * Already transitive and needs no recursion to be so: a grandchild lies inside
 * its grandparent's bounds as surely as a child does, and `componentsInside`
 * sees both in one scan.
 */
export function descendantsOf(grid: Grid, bounds: Rect): Candidate[] {
  return componentsInside(grid, bounds).filter(isClosed);
}

/**
 * The closed shapes *immediately* inside — the ones no other descendant holds.
 *
 * Only needed when the nesting *levels* matter. The cascade does not care:
 * `travellingWith` takes everything inside regardless of depth, which is why
 * moving a container is one scan rather than a walk down a tree.
 */
export function childrenOf(grid: Grid, bounds: Rect): Candidate[] {
  const all = descendantsOf(grid, bounds);
  return all.filter(
    (shape) => !all.some((other) => other !== shape && rectStrictlyInside(other.bounds, shape.bounds)),
  );
}

/** How far a ray will look for a wall before giving up. */
export const CONTAINER_REACH = 240;

/**
 * The smallest closed shape strictly containing this cell, or null.
 *
 * Found by casting a ray westward and tracing whatever it hits, which is far
 * cheaper than scanning the document and is right whenever the container has a
 * left wall — i.e. always, for a closed shape.
 *
 * Note who must **not** call this: `ops/move.ts`. The cascade runs downward and
 * never up (nesting §3), and the surest way to guarantee that is for the move
 * planner to have no way of asking what it is inside. This exists for typing
 * (which may grow its container) and for settling a drop.
 */
/**
 * Every closed shape strictly containing this cell, tightest first.
 *
 * `containerAt` asks `recognize`, which answers with the whole connected
 * component — and inside a table every wall is one component, read as `cells`
 * and so not closed at all. A caret in a table cell therefore has no container,
 * which is exactly the case that needs one most.
 *
 * `candidatesAt` enumerates the readings *through* a cell rather than around
 * it, so it sees the cell, the row, and the table alike. Casting the same ray
 * west and asking it instead gives the whole nest: `[0]` is the table cell the
 * caret is in, and the last is the table.
 *
 * Note **contains**, not *strictly* contains. A caret that has run to the end of
 * its box is sitting on the wall, and that is the exact moment the box needs to
 * know it is a container — asking strictly would answer "nothing encloses you"
 * on the one keystroke where the answer matters.
 */
export function containersAt(grid: Grid, x: number, y: number): Candidate[] {
  const found: Candidate[] = [];
  const seen = new Set<string>();

  for (let cx = x - 1; cx >= 0 && x - cx <= CONTAINER_REACH; cx--) {
    if (!grid.has(ck(cx, y))) continue;

    for (const shape of candidatesAt(grid, cx, y)) {
      if (!isClosed(shape)) continue;
      if (!rectContains(shape.bounds, x, y)) continue;

      const { x: bx, y: by, w, h } = shape.bounds;
      const id = `${bx},${by},${w},${h}`;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(shape);
    }
  }
  return found.sort((a, b) => a.cells.size - b.cells.size);
}

export function containerAt(grid: Grid, x: number, y: number): Candidate | null {
  const seen = new Set<CellKey>();
  let best: Candidate | null = null;

  for (let cx = x - 1; cx >= 0 && x - cx <= CONTAINER_REACH; cx--) {
    const key = ck(cx, y);
    if (!grid.has(key) || seen.has(key)) continue;

    const shape = recognize(grid, cx, y);
    if (shape === null) {
      seen.add(key);
      continue;
    }
    for (const k of shape.cells) seen.add(k);

    if (!isClosed(shape)) continue;
    if (!rectStrictlyInside(shape.bounds, { x, y, w: 1, h: 1 })) continue;

    // Keep looking: an outer wall lies further west, and we want the innermost.
    if (best === null || shape.cells.size < best.cells.size) best = shape;
  }
  return best;
}
