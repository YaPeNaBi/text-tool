/**
 * What is attached to a shape (sticky §6).
 *
 * This module is a **move, not new work**: it will absorb `findConnectors` and
 * its helpers — `strandOutside`, `approachFrom`, `attachedSide`, `shapeBehind` —
 * from `route/connectors.ts` unchanged.
 *
 * The split is worth making because *finding* what is attached is a derivation
 * over the characters, while *deciding where it should go* is routing. Today
 * both live in one file, and every routing change has to be read past the
 * attachment logic to be understood.
 *
 * The rule that lives here, and must survive the move intact:
 *
 *   **Attachment is looser than connection.** A line drawn up to a box usually
 *   does *not* join it — the box's `│` offers no eastward arm — so the two only
 *   touch. What matters is that the line *runs into* the shape, which is a
 *   question about the line's own direction rather than a mutual agreement.
 *   Requiring agreement would miss the most common case in the whole editor.
 *
 * And the guard that keeps it from over-reaching:
 *
 *   **A connector meets its shape exactly once.** Anything touching twice is a
 *   neighbour leaning on it — two boxes sharing an edge read as an open path
 *   once the shared column is excluded — and re-routing that would tear apart
 *   something the user never selected.
 *
 * ── Planned API (intuitive/plan.md, phase 1) ──────────────────────────────
 *
 *   findConnectors(grid: Grid, shape: ReadonlySet<CellKey>): Connector[]
 *       Moves here verbatim, along with the `Connector` type.
 *
 *   connectorsOfAll(grid: Grid, shapes: ReadonlySet<CellKey>): Connector[]
 *       New, and needed by the cascade: when a container moves, the lines
 *       attached to its *children* must move too. Runs the above over the whole
 *       gathered set and drops any connector that lies entirely within it —
 *       a line between two children of the same container is being carried, not
 *       re-routed.
 */

export {};
