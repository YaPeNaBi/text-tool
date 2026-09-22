/**
 * What is written inside a shape (content §1).
 *
 * Almost every box in a real diagram has something in it, and the editor has
 * treated that text as unrelated characters that happen to share a region — so
 * moving a box left its own label behind.
 *
 * A label is *text strictly inside a closed shape's bounds*. Strictly, because a
 * note beside a box is a note about the diagram, not a caption on the shape, and
 * dragging the shape must not steal it (content §2).
 *
 * Derived every time, like everything else here. Never stored.
 */

import { boundsOf, ck, unck, type CellKey, type Rect } from '../geom/cell.ts';
import { maskOf, type CellDiff, type Grid } from '../grid/grid.ts';

/** How a label sits within its shape. Recovered from the characters, never stored. */
export type Alignment = 'left' | 'centre' | 'right';

/**
 * Text cells strictly inside `bounds`.
 *
 * Line cells are excluded: they belong to whatever shape *they* are part of,
 * not to this one.
 */
export function labelOf(grid: Grid, bounds: Rect): Set<CellKey> {
  const out = new Set<CellKey>();

  for (let y = bounds.y + 1; y < bounds.y + bounds.h - 1; y++) {
    for (let x = bounds.x + 1; x < bounds.x + bounds.w - 1; x++) {
      const key = ck(x, y);
      if (!grid.has(key)) continue;
      if (maskOf(grid, x, y) !== 0) continue;
      out.add(key);
    }
  }
  return out;
}

/** The label's bounding box, or null when the shape is empty. */
export function labelBoundsOf(grid: Grid, bounds: Rect): Rect | null {
  return boundsOf(labelOf(grid, bounds));
}

/**
 * How the label was placed, recovered from the blank runs either side of it.
 *
 * Equal within one cell means it was centred; otherwise it was put against a
 * side. This exists so a resize can keep the *relationship* rather than the
 * absolute offset (content §9) — a centred label that stops being centred when
 * its box grows looks obviously broken.
 */
export function alignmentOf(shape: Rect, text: Rect): Alignment {
  const left = text.x - (shape.x + 1);
  const right = shape.x + shape.w - 2 - (text.x + text.w - 1);

  if (Math.abs(left - right) <= 1) return 'centre';
  return left <= right ? 'left' : 'right';
}

/** Where a run of `width` cells starts, to sit `align` inside `shape`. */
export function alignedX(shape: Rect, width: number, align: Alignment): number {
  const first = shape.x + 1;
  const room = shape.w - 2;
  if (align === 'left') return first;
  if (align === 'right') return first + Math.max(0, room - width);
  return first + Math.max(0, Math.floor((room - width) / 2));
}

/**
 * Move a label from one shape to another, keeping how it was aligned.
 *
 * Used by resize. Returns the cells to clear and the cells to write, as one
 * diff, so it can be merged into whatever else the operation is doing.
 */
export function realignLabel(
  grid: Grid,
  from: Rect,
  to: Rect,
  align: Alignment,
): CellDiff {
  const diff: CellDiff = new Map();
  const text = labelBoundsOf(grid, from);
  if (text === null) return diff;

  const dx = alignedX(to, text.w, align) - text.x;
  const dy = to.y + 1 - (from.y + 1);
  if (dx === 0 && dy === 0) return diff;

  const cells = labelOf(grid, from);
  for (const key of cells) diff.set(key, null);
  for (const key of cells) {
    const comma = key.indexOf(',');
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    diff.set(ck(x + dx, y + dy), grid.get(key) as string);
  }
  return diff;
}

/**
 * How far a block of text may run before we stop following it.
 * Long enough for any prose a diagram holds, short enough not to hang.
 */
const BLOCK_REACH = 4096;

/** The run of text through this cell: the letters beside it on its own row. */
function runThrough(grid: Grid, x: number, y: number): Set<CellKey> {
  const out = new Set<CellKey>();
  const text = (cx: number): boolean => grid.has(ck(cx, y)) && maskOf(grid, cx, y) === 0;
  if (!text(x)) return out;

  out.add(ck(x, y));
  for (let cx = x - 1; cx >= 0 && text(cx); cx--) out.add(ck(cx, y));
  for (let cx = x + 1; cx - x < BLOCK_REACH && text(cx); cx++) out.add(ck(cx, y));
  return out;
}

/**
 * The whole block of text a character belongs to (content §1).
 *
 * A run of letters on one row is what the recognizer reports, because that is
 * what it can say about characters alone. It is rarely what a person means. Two
 * lines stacked one above the other are a paragraph; three lines inside a box
 * are that box's label. Selecting the middle one on its own and leaving the
 * others behind is the sort of answer that is technically defensible and
 * useless.
 *
 * So a block is grown two ways, and which one applies is decided by where the
 * text is rather than by a mode:
 *
 *   - **inside a shape**, the block is everything written inside it — the label,
 *     which already has a meaning here and already travels with the shape;
 *   - **loose on the page**, the block is the run plus any run directly above or
 *     below that shares a column with it. Sharing a column is what makes it the
 *     same paragraph; a word further along the line is a separate thought.
 */
export function textBlockAt(grid: Grid, bounds: Rect | null, x: number, y: number): Set<CellKey> {
  if (bounds !== null) return labelOf(grid, bounds);

  const block = runThrough(grid, x, y);
  if (block.size === 0) return block;

  let frontier = [...block];
  for (let step = 0; step < BLOCK_REACH && frontier.length > 0; step++) {
    const next: CellKey[] = [];

    for (const key of frontier) {
      const at = unck(key);
      for (const dy of [-1, 1]) {
        const ny = at.y + dy;
        if (ny < 0) continue;
        for (const k of runThrough(grid, at.x, ny)) {
          if (block.has(k)) continue;
          block.add(k);
          next.push(k);
        }
      }
    }
    frontier = next;
  }
  return block;
}
