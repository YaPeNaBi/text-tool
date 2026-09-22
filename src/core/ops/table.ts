/**
 * The thirteen things people want to do to a table.
 *
 * Every one of them is `(spec, args) → spec`. None of them touches a character.
 * That is the entire trick, and it is why the largest-looking item on the
 * roadmap is a week rather than a month:
 *
 *     read     matchTable(grid, cells, bounds) → spec
 *     change   one of the functions below       → spec'
 *     write    erase the old region, stampTable(spec')
 *
 * The plan for each is therefore identical, and lives in one shared helper
 * rather than thirteen copies:
 *
 *   planTableEdit(grid, spec, edit: (s: TableSpec) => TableSpec, cs, note): Plan
 *       erase `tableBounds(spec)`, stamp the edited spec, merge into one diff,
 *       attach the note. One undo step, however many cells moved.
 *
 * ── The operations (intuitive/tables.md) ──────────────────────────────────
 *
 * Structural — these reflow the lattice:
 *
 *   insertRow(spec, at: number): TableSpec                          §3
 *   deleteRow(spec, at: number): TableSpec                          §4
 *   insertColumn(spec, at: number, width?: number): TableSpec       §5
 *   deleteColumn(spec, at: number): TableSpec                       §6
 *   resizeColumn(spec, col: number, width: number): TableSpec       §7
 *   fitColumn(spec, col: number): TableSpec                         §8
 *
 * Content-only — these rewrite text without moving a single border:
 *
 *   reorderRows(spec, from: number, to: number): TableSpec          §9
 *   sortBy(spec, col: number, dir: 'asc' | 'desc'): TableSpec       §10
 *   alignColumn(spec, col: number, align: Alignment): TableSpec     §11
 *
 * Interchange:
 *
 *   toCsv(spec): string                                             §12
 *   fromCsv(text: string, origin: Cell): TableSpec                  §12
 *
 * And two that are really other operations, listed so they are not forgotten:
 *
 *   moveTable   — `ops/move.ts` already handles it once the table is a
 *                 recognised candidate; nothing to write here.
 *   selectRow / selectColumn — `recognize/table.ts` returns the rects; the
 *                 selection is ordinary.
 *
 * ── Rules that live here ──────────────────────────────────────────────────
 *
 * **No silent reflow (tables §13).** Every operation on this page rewrites cells
 * far from the pointer. Each must set `Plan.note` — *"Inserted row 3 — 12 cells
 * rewritten"* — because a change the user cannot see the extent of is a change
 * they cannot trust.
 *
 * **Sorting needs a header, and cannot store one.** `sortBy` must not sort the
 * header row, and `headerRows` is the one property `matchTable` refuses to
 * guess. So `sortBy` asks once per table, and the answer lives in session state
 * — never in the document.
 *
 * **Deleting a row is not just deleting cells.** Its top border is shared with
 * the row above, so exactly one of the two separators survives. Working on the
 * spec rather than the characters is what makes that a non-issue: delete the
 * entry, re-stamp, and the shared borders come out right because the stamper's
 * merge rules already handle them.
 *
 * ── Interchange is worth more than it looks ───────────────────────────────
 *
 * `toCsv` and `fromCsv` are the cheapest items here and possibly the most
 * valuable: they are what connects this editor to the spreadsheet the data
 * actually lives in. Paste a block of tab-separated text and it should offer to
 * become a table with columns sized to their widest value — which is
 * `fromCsv` followed by `fitWidths`, both of which exist for other reasons.
 */

export {};
