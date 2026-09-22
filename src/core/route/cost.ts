/**
 * What a route is charged for.
 *
 * The interesting part of pathfinding here is not the search — that is textbook
 * A* — but the **price list**. Every scenario in intuitive/pathfinding.md is
 * really an argument about one of these numbers, and getting them wrong produces
 * routes that are optimal and unreadable.
 *
 * The clearest evidence is pathfinding §7: two routes of *exactly fourteen
 * cells*, one with eight bends and one with one. Cell count cannot tell them
 * apart, so a bend has to cost several cells' worth of distance or the router
 * will happily draw staircases.
 */

import { ck, type Cell, type CellKey } from '../geom/cell.ts';
import { DIRS } from '../charset/charsets.ts';
import type { Grid } from '../grid/grid.ts';

/** The price list. See intuitive/pathfinding.md, "What this implies about cost". */
export interface RouteCosts {
  /** Each cell travelled. The baseline everything else is priced against. */
  step: number;
  /**
   * Each change of direction. Must be worth several cells: §7 shows two routes
   * of identical length where only the bend count distinguishes them.
   */
  bend: number;
  /**
   * Each cell run flush against a shape. Small on purpose — enough to prefer
   * breathing room (§10), not enough to refuse the only way through (§4).
   */
  hug: number;
  /**
   * Crossing an existing line. Legal, and sometimes unavoidable, but a crossing
   * is a small lie about a diagram either way: readers see junctions (§6).
   */
  cross: number;
}

export const DEFAULT_COSTS: RouteCosts = {
  step: 1,
  bend: 10,
  hug: 2,
  cross: 30,
};

/**
 * What the router is allowed to know about a cell.
 *
 * Deliberately narrow: the search never sees the grid, only these three
 * questions, so terrain can be faked wholesale in tests.
 */
export interface Terrain {
  /**
   * Occupied by something that must not be written over. On a character grid
   * "route through" and "damage" are the same act (§1, §8), so this is the one
   * infinite cost.
   */
  blocked(x: number, y: number): boolean;
  /** An existing line the route could cross, at a price. */
  crossing(x: number, y: number): boolean;
  /** Adjacent to a shape — passable, but charged for (§10). */
  hugging(x: number, y: number): boolean;
}

/**
 * The obstacle map.
 *
 * `ignore` is what the route is allowed to touch: the cells it is attaching to,
 * and its own previous run where that has not already been lifted. Without it
 * the route would be blocked by its own endpoints.
 *
 * **Everything else occupied is an obstacle.** There is no annotation layer to
 * route above: text counts (§8), and so does a stray character. On a character
 * grid "route through" and "damage" are the same act.
 *
 * ── Why nothing is reported as a crossing ─────────────────────────────────
 *
 * §6 would allow a route to cross *another connector* at a stiff price, while
 * §1 and §8 forbid passing through a shape or a word at any price. Telling the
 * two apart from the characters alone is the whole difficulty: a box's wall and
 * a connector's shaft are the same `│`, and the only thing that distinguishes
 * them is whether the run closes on itself somewhere out of sight.
 *
 * Rather than guess, this terrain reports no crossings at all, so a route goes
 * *around* another line — which is what §6's own ideal picture does. The search
 * honours `crossing` and prices it, so a terrain that can tell the difference
 * can be dropped in later without touching the search. What is lost is only the
 * case where crossing is the *only* way through: that route now fails, and the
 * caller falls back to the straight line it would have drawn anyway.
 */
export function terrainFor(
  grid: Grid,
  opts: { ignore: ReadonlySet<CellKey> },
): Terrain {
  const occupied = (x: number, y: number): boolean =>
    grid.has(ck(x, y)) && !opts.ignore.has(ck(x, y));

  return {
    blocked: occupied,
    crossing: () => false,
    hugging(x, y) {
      // Only an empty cell can be hugging something; an occupied one is
      // blocked, and asking twice about it would double-charge.
      if (occupied(x, y)) return false;
      for (const dir of DIRS) {
        if (occupied(x + dir.dx, y + dir.dy)) return true;
      }
      return false;
    },
  };
}

/**
 * Where the search may look: the endpoints' bounding box, expanded.
 *
 * The margin is what buys room to go *around* something rather than only
 * between the two ends — §3's pocket is escaped by going over the top, which
 * leaves the endpoints' own box entirely.
 */
export function budgetFor(from: Cell, to: Cell, margin = DEFAULT_MARGIN): RouteBudget {
  const left = Math.max(0, Math.min(from.x, to.x) - margin);
  const top = Math.max(0, Math.min(from.y, to.y) - margin);
  const right = Math.max(from.x, to.x) + margin;
  const bottom = Math.max(from.y, to.y) + margin;

  return {
    area: { x: left, y: top, w: right - left + 1, h: bottom - top + 1 },
    maxExpansions: DEFAULT_MAX_EXPANSIONS,
  };
}

/** Where a route may search. Bounded, because the plane is not (§ requirement 3). */
export interface RouteBudget {
  /** Endpoints' bounding box, expanded by a margin. */
  area: { x: number; y: number; w: number; h: number };
  /** Hard ceiling on nodes expanded; exceeding it is a failure, not a hang. */
  maxExpansions: number;
}

export const DEFAULT_MARGIN = 8;
export const DEFAULT_MAX_EXPANSIONS = 20_000;

export type { Cell };
