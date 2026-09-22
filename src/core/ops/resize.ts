/**
 * Resizing a shape — and the only place in the editor that says no.
 *
 * Two rules from two documents turn out to be one rule:
 *
 *   nesting §7 — a resize may not close over a child
 *   content §5 — a resize never destroys what it encloses
 *
 * Both are *"a resize never destroys what it encloses"*, child or label alike,
 * so both are one check in one function.
 *
 * ── Why this refuses when nothing else does ───────────────────────────────
 *
 * Dragging a child out of its container is allowed (nesting §5); shrinking a
 * container over that same child is not. The difference is not the damage, it
 * is who aimed at it. There, the user acted on the child and the consequence
 * was the child's. Here the user acts on the parent and the consequence lands
 * on something they never touched.
 *
 * **Damage the user did not aim at is the thing to prevent.**
 */

import { ck, unck, type Cell, type CellKey, type Rect } from '../geom/cell.ts';
import type { Charset } from '../charset/charsets.ts';
import { rectStrictlyInside } from '../geom/cell.ts';
import type { Grid } from '../grid/grid.ts';
import type { Candidate } from '../recognize/recognize.ts';
import { isResizable } from '../recognize/recognize.ts';
import { componentsInside, enclosesArea } from '../derive/contain.ts';
import { alignmentOf, labelBoundsOf, realignLabel } from '../derive/label.ts';
import { borderKeys, MIN_BOX } from '../stamp/box.ts';
import { candidatesAt } from '../recognize/rank.ts';
import { ellipseCells } from '../stamp/ellipse.ts';
import { findConnectors, rerouteDiff } from '../route/connectors.ts';
import { resizeBoxDiff } from '../transform/resize.ts';
import { merge, nothing, refuse, type Plan } from './plan.ts';

export interface ResizeOptions {
  charset: Charset;
  /** Lines attached to the shape are redrawn to follow it (B-MAN-12). */
  sticky?: boolean;
}

/** The cells a closed outline occupies at a given size. */
export function outlineOf(bounds: Rect, kind: Candidate['kind']): Set<CellKey> {
  return kind === 'ellipse' ? ellipseCells(bounds) : new Set(borderKeys(bounds));
}

/**
 * Plan a resize.
 *
 * The check comes **before** any diff is built, because a refused plan must
 * change nothing at all — that is the whole point of refusing.
 */
export function planResize(
  grid: Grid,
  selection: Candidate,
  to: Rect,
  opts: ResizeOptions,
): Plan {
  if (!isResizable(selection)) return nothing();

  const from = selection.bounds;
  if (to.x === from.x && to.y === from.y && to.w === from.w && to.h === from.h) {
    return nothing();
  }

  // Everything wholly inside must still be wholly inside afterwards. This one
  // test covers both a child shape and the shape's own label, because
  // `componentsInside` does not distinguish them.
  for (const part of componentsInside(grid, from)) {
    if (!rectStrictlyInside(to, part.bounds)) {
      return refuse('Cannot shrink past the contents — move or shorten them first');
    }
  }

  const kind = selection.kind === 'ellipse' ? 'ellipse' : 'box';
  const redraw = resizeBoxDiff(grid, from, to, opts.charset, kind);
  const diffs = [redraw];

  // Keep the label sitting the way it was put (content §9).
  const label = labelBoundsOf(grid, from);
  if (label !== null) {
    diffs.push(realignLabel(grid, from, to, alignmentOf(from, label)));
  }

  let note: string | undefined;
  if (opts.sticky !== false) {
    const connectors = findConnectors(grid, selection.cells);
    const landed = outlineOf(to, selection.kind);
    const routed = rerouteDiff(grid, landed, connectors, merge(...diffs), opts.charset);
    diffs.push(routed.diff);
    note = routed.note;
  }

  const diff = merge(...diffs);
  const cells = outlineOf(to, selection.kind);
  return {
    diff,
    selection: { kind: selection.kind, cells, bounds: to },
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * Dragging one side of a shape away from it — a resize, not a move.
 *
 * Select a box's right-hand wall on its own and drag it two cells right, and a
 * plain move does exactly what it was asked: the wall and its two corners go,
 * and the top and bottom runs stay the length they were. The box comes apart:
 *
 *     ┌───────────────┐        ┌───────────────  ┐
 *     │               │   →    │                 │
 *     └───────────────┘        └───────────────  ┘
 *
 * Every character of that is what "move these cells" means, and none of it is
 * what anybody dragging the side of a box wants. A side is not a thing in its
 * own right; it is where a shape *ends*, and moving where a shape ends is a
 * resize. So this recognises the case before the move happens and hands it to
 * `planResize`, which already knows how to redraw a border, refuse to crush
 * what is inside, keep the label placed and drag the connectors along.
 *
 * ── Tables come free ──────────────────────────────────────────────────────
 *
 * `resizeBoxDiff` erases the old *outline* and stamps a new one, so anything
 * interior is left exactly where it was. For a table that means the dividers
 * stay put and the track against the wall you dragged is the one that changes
 * width — the same answer dragging the separator gives, arrived at from the
 * other side. Nothing here knows whether it is looking at a table.
 *
 * ── What is deliberately not a side ───────────────────────────────────────
 *
 * The selection has to be the **whole** edge and nothing else: every cell of
 * that column or row, exactly as wide or tall as the shape. Half a wall is a
 * piece of a drawing someone is rearranging on purpose, and quietly turning
 * that into a resize would take away the only way to do it. A ring is excluded
 * by the same test without needing to be named — an ellipse's leftmost column
 * is two cells, never its full height.
 *
 * ── The side stays selected ───────────────────────────────────────────────
 *
 * `planResize` hands back the shape it resized, which is right when a handle
 * was dragged and wrong here: it would leave the *box* selected, so the second
 * pull — of the pointer or of an arrow key — would move the whole shape rather
 * than carry on stretching it. One unit, and then something else entirely.
 *
 * So the plan is handed back with the side selected where the side now is. A
 * gesture you can immediately repeat is the difference between dragging an edge
 * and nudging a box once.
 */
export function planSideDrag(
  grid: Grid,
  selection: Candidate,
  dx: number,
  dy: number,
  opts: ResizeOptions,
): Plan | null {
  // One axis at a time, and only a line of cells can be a side.
  if ((dx !== 0) === (dy !== 0)) return null;
  const sel = selection.bounds;
  if (sel.w !== 1 && sel.h !== 1) return null;
  if (selection.cells.size !== Math.max(sel.w, sel.h)) return null;

  const seed: Cell | undefined = [...selection.cells].map(unck)[0];
  if (seed === undefined) return null;

  for (const shape of candidatesAt(grid, seed.x, seed.y)) {
    // It has to be a **shape**, and that has to be asked rather than assumed.
    // A side is where a shape ends; an open path has no sides, only a bounding
    // box that any of its runs may happen to sit along the edge of. A U-shaped
    // connector between two boxes is exactly that — its bottom run *is* the
    // full width of its bounds, so this read it as an edge and "resized" it,
    // stamping a whole rectangle where there had only ever been a wire:
    //
    //     └──┬────┘   └───┬───┘        └──┬────┴────────┴───┬───┘
    //        │            │        →        │             │
    //        └────────────┘                 └─────────────┘
    //
    // — a top edge appearing out of nothing, welded onto both boxes.
    if (!enclosesArea(shape)) continue;

    const edge = edgeOf(shape.bounds, sel);
    if (edge === null) continue;

    const to = movedEdge(shape.bounds, edge, dx, dy);
    if (to === null) continue;

    // The shape is redrawn from its bounds, so the reading only has to agree
    // about where it is — `cells` from the recogniser may include dividers.
    const outline: Candidate = {
      kind: 'box',
      cells: new Set(borderKeys(shape.bounds)),
      bounds: shape.bounds,
    };

    const plan = planResize(grid, outline, to, opts);
    if (plan.refused !== undefined) return plan;
    return { ...plan, selection: sideOf(to, edge) };
  }
  return null;
}

/** The side itself, where it has ended up — so the drag can be continued. */
function sideOf(bounds: Rect, edge: 'n' | 's' | 'e' | 'w'): Candidate {
  const cells = new Set<CellKey>();

  if (edge === 'e' || edge === 'w') {
    const x = edge === 'e' ? bounds.x + bounds.w - 1 : bounds.x;
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) cells.add(ck(x, y));
    return { kind: 'cells', cells, bounds: { x, y: bounds.y, w: 1, h: bounds.h } };
  }

  const y = edge === 's' ? bounds.y + bounds.h - 1 : bounds.y;
  for (let x = bounds.x; x < bounds.x + bounds.w; x++) cells.add(ck(x, y));
  return { kind: 'cells', cells, bounds: { x: bounds.x, y, w: bounds.w, h: 1 } };
}

/** Which side of `bounds` the selection is, if it is exactly one of them. */
function edgeOf(bounds: Rect, sel: Rect): 'n' | 's' | 'e' | 'w' | null {
  if (sel.w === 1 && sel.h === bounds.h && sel.y === bounds.y) {
    if (sel.x === bounds.x) return 'w';
    if (sel.x === bounds.x + bounds.w - 1) return 'e';
  }
  if (sel.h === 1 && sel.w === bounds.w && sel.x === bounds.x) {
    if (sel.y === bounds.y) return 'n';
    if (sel.y === bounds.y + bounds.h - 1) return 's';
  }
  return null;
}

/** The shape once that side has moved. Null when it would collapse or leave the plane. */
function movedEdge(b: Rect, edge: 'n' | 's' | 'e' | 'w', dx: number, dy: number): Rect | null {
  const to =
    edge === 'e'
      ? { ...b, w: b.w + dx }
      : edge === 'w'
        ? { ...b, x: b.x + dx, w: b.w - dx }
        : edge === 's'
          ? { ...b, h: b.h + dy }
          : { ...b, y: b.y + dy, h: b.h - dy };

  if (to.w < MIN_BOX || to.h < MIN_BOX) return null;
  if (to.x < 0 || to.y < 0) return null;
  return to;
}
