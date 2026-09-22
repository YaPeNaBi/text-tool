/**
 * Which side a connector leaves from, and where on that side.
 *
 * Two of these three functions already exist in `route/connectors.ts` and move
 * here so that side-choice stops being buried inside re-route orchestration. The
 * third is the last unbuilt rule from intuitive/sticky-connectors.md.
 *
 * ── Moving here unchanged ─────────────────────────────────────────────────
 *
 *   sideFacing(self: Cell, other: Cell): Dir                        sticky §2
 *       Which side of `self` should face `other`, as an *approach*: the
 *       direction from the attachment cell back toward the shape.
 *
 *       This is the rule that stopped connectors looking dragged rather than
 *       drawn. Preserving the original side instead gives the dog-leg in
 *       sticky §2.1 — a box moved directly below its neighbour reached out to
 *       the right and back, where a person would simply leave through the
 *       bottom.
 *
 *   anchorOn(shape, approach: Dir, toward: Cell): Cell | null
 *       Where on that side. Works off the shape's own cells rather than its
 *       bounding box, so a circle attaches at the widest part of its curve
 *       instead of out in an empty corner, and avoids corner cells where there
 *       is any choice — a line meeting a box exactly at its `┌` reads as a
 *       mistake.
 *
 * ── The new one (intuitive/plan.md, phase 3) ──────────────────────────────
 *
 *   assignAnchors(
 *     shape: ReadonlySet<CellKey>,
 *     requests: ReadonlyArray<{ id: string; toward: Cell }>,
 *   ): Map<string, { approach: Dir; anchor: Cell }>
 *
 *       **sticky §3 — keep the arrangement.** Several connectors reaching one
 *       shape must each get their *own* cell, and the ones that arrived from
 *       above should still arrive from above.
 *
 *       Today each connector calls `anchorOn` independently, so two arrows from
 *       similar directions are handed the same cell and merge into a `├`.
 *       Pathfinding §5 shows the result: two arrows that have become one, which
 *       is not a cosmetic problem — the diagram now states something false.
 *
 *       Sketch: bucket the requests by `sideFacing`, then within each side sort
 *       by the perpendicular coordinate of `toward` and deal them out along that
 *       side, keeping the original order. Spread from the middle outward so a
 *       lone connector still lands centrally. If a side runs out of cells,
 *       overflow to the next side round rather than doubling up — two arrows
 *       sharing a cell is the one outcome that must not happen.
 */

export {};
