/**
 * Tables: cells → spec. The matcher half of the pair in `stamp/table.ts`.
 *
 * This is the missing piece that all thirteen table operations wait on. Asked
 * what is under the pointer in a table today, the recognizer answers honestly
 * and uselessly — this is real output, not a caricature:
 *
 *     click a top border (3,0):  Box 9×3 | Box 9×5 | Box 9×7 | Box 9×9 |
 *                                Box 16×3 | Box 16×5 | Box 16×7 | Box 21×3 |
 *                                Cells 21×9
 *
 * Every one of those rectangles genuinely exists in the characters. Not one of
 * them is a **row**, a **column** or a **cell**, and the thing the user actually
 * clicked is somewhere in that list, unnamed.
 *
 * ── Planned API (intuitive/plan.md, phase 4) ──────────────────────────────
 *
 *   matchTable(grid, cells: ReadonlySet<CellKey>, bounds: Rect): TableSpec | null
 *
 *   1. The component is already traced by the time we are called.
 *   2. Find the **separators**: columns spanning the full height of `bounds`,
 *      and rows spanning its full width, made entirely of line cells.
 *   3. Check they partition `bounds` into a complete lattice — a rectangle at
 *      every intersection, no gaps, no cells left over.
 *   4. Read each cell's text with `labelOf` and hand back a `TableSpec`.
 *
 *   Return **null** at the first thing that does not fit. Ragged tables, merged
 *   cells and missing separators are all legal ASCII (tables §13); when the
 *   matcher cannot read one, the answer is to fall back to the shapes we do
 *   understand, never to "repair" the drawing.
 *
 *   tableAt(grid, x, y): TableSpec | null
 *       Convenience: trace from a seed, then `matchTable`.
 *
 *   rowRect / columnRect(spec, index): Rect
 *       So that "select a row" (tables §2) has something to select.
 *
 * ── Ranking (edit to rank.ts, not this file) ──────────────────────────────
 *
 * The table candidate is ranked **below individual cells and above the
 * whole-component fallback**, so drilling outward reads:
 *
 *     cell → row → table
 *
 * which is what tables §2 asks for and what makes the nine-reading list above
 * turn into three useful ones.
 *
 * That ordering is also the mitigation for the matcher's main hazard: two boxes
 * drawn flush look like a 1×2 table. Requiring at least two separators on one
 * axis rules out most of it, and ranking the table below the cells means a wrong
 * guess is one click away from the right answer rather than being forced on the
 * user.
 */

export {};
