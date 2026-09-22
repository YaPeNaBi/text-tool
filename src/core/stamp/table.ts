/**
 * Tables: spec → cells.
 *
 * A table looks like the largest item on the roadmap and is actually the
 * smallest, because it collapses onto the spine the project already has. Every
 * shape in this editor is a **stamper/matcher pair** — one function that draws
 * it, one that recognises it — and a table is no different, only one level up:
 *
 *     stampTable(spec)  → cells        this file
 *     matchTable(cells) → spec         recognize/table.ts
 *     spec → spec                      ops/table.ts, thirteen small functions
 *
 * That third line is the whole reason this works. Insert a row, delete a column,
 * sort, align, widen — none of them touch a character. Each is a few lines of
 * array manipulation on a `TableSpec`, after which the region is re-stamped.
 *
 * ── The spec is derived, never stored ─────────────────────────────────────
 *
 * `TableSpec` is read out of the characters when an operation begins and thrown
 * away when it ends. It is emphatically **not** a model the text is rendered
 * from (tables §13). The moment a table has an identity that outlives a
 * gesture, a pasted table and a drawn one stop behaving identically — and that
 * equivalence is what the entire editor is built on.
 */

import type { Cell } from '../geom/cell.ts';
import type { Alignment } from '../derive/label.ts';

/**
 * Everything needed to draw a table, and everything recoverable from one.
 *
 * `widths` are box widths with borders shared, matching how adjacent boxes
 * already merge: a column of width 9 next to one of width 8 occupies 16 cells,
 * not 17.
 */
export interface TableSpec {
  origin: Cell;
  /** Per column, including both borders. Length defines the column count. */
  widths: number[];
  /** Row-major cell text. Every row must have `widths.length` entries. */
  rows: string[][];
  /** Per column; defaults to left. Numbers usually want `right` (tables §11). */
  align?: Alignment[];
  /**
   * How many leading rows are headers, for sorting (tables §10).
   *
   * This is the one piece of table state that cannot be recovered reliably from
   * the characters — a heavier separator under row one is a hint, not a
   * guarantee. It therefore must not be invented: `matchTable` leaves it
   * undefined, and the *sort* operation asks the user once rather than guessing.
   */
  headerRows?: number;
}

/**
 * ── Planned API (intuitive/plan.md, phase 4) ──────────────────────────────
 *
 *   stampTable(grid: Grid, spec: TableSpec, cs: Charset): CellDiff
 *       Draws the lattice and the text. Implemented as one `stampBox` per cell
 *       at shared offsets, which is exactly how the worked examples in
 *       intuitive/tables.md were generated — the junctions (`┬ ┼ ┴ ├ ┤`) fall
 *       out of the existing merge rules rather than needing a table-specific
 *       glyph table.
 *
 *   tableBounds(spec: TableSpec): Rect
 *       Where it will land, for erasing the old region first.
 *
 *   cellRect(spec: TableSpec, row: number, col: number): Rect
 *       One cell's rectangle. Used for hit-testing and for the caret.
 *
 *   fitWidths(spec: TableSpec, min?: number): number[]
 *       Column widths that fit their widest value. This is table §8 — typing
 *       more than fits widens the column and every row follows — and it is the
 *       same rule as content §4 one level up: *typing may grow the thing it is
 *       inside rather than destroy it.*
 */

export {};
