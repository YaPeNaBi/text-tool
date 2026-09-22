/**
 * The route search.
 *
 * The one place in the codebase where an actual algorithm is required. Kept as a
 * pure function over a `Terrain` and a `RouteCosts` so it can be tested against
 * text fixtures like everything else in `core`, and swapped out without
 * disturbing anything that calls it.
 *
 * Three requirements from intuitive/pathfinding.md, each shaping the signature:
 *
 *   1. **It must be a real search.** Greedy walking toward the target fails §2
 *      (a wall with one gap — nothing about the endpoints says where the gap is)
 *      and §3 (a pocket that leads nowhere — the search has to be willing to
 *      move *away* from the target before it can reach it).
 *
 *   2. **It must be able to fail.** §9 has no answer at all, and inventing one
 *      is worse than reporting none. So failure is a return value, never an
 *      exception and never a silently straight line.
 *
 *   3. **It must be bounded.** The plane is unbounded; the search cannot be.
 *      The failure mode of exceeding the budget is "routes like today", which is
 *      acceptable. A hang is not.
 *
 * ── The one design decision worth defending ───────────────────────────────
 *
 * **A node is `(x, y, heading)`, not `(x, y)`.**
 *
 * Carrying the heading is what lets a bend be *priced during* the search rather
 * than penalised afterwards. With it, pathfinding §7 falls out for free. Without
 * it, the search finds a fourteen-cell staircase, and a smoothing pass has to
 * try to unpick it afterwards — which is both more code and worse results,
 * because by then the good route has already been discarded.
 *
 * The cost of the decision is a four-times-larger state space. That is what the
 * expansion cap is for.
 *
 * ── How the caller uses a failure ─────────────────────────────────────────
 *
 *   'budget'  → fall back to the L or Z route. The user sees the old behaviour,
 *               which is fine, rather than nothing, which is not.
 *   'blocked' → no route exists (§9). The caller leaves the connector where it
 *               was and says why, rather than drawing through a wall.
 */

import { DIRS, opposite, type Dir } from '../charset/charsets.ts';
import type { Cell } from '../geom/cell.ts';
import type { RouteBudget, RouteCosts, Terrain } from './cost.ts';

export interface RouteRequest {
  from: Cell;
  /** The direction the first step must take, so the line leaves the right side. */
  fromSide: Dir | null;
  to: Cell;
  /** The direction the last step must take, so an arrow still points at its shape. */
  toSide: Dir;
  terrain: Terrain;
  costs: RouteCosts;
  budget: RouteBudget;
}

export type RouteResult =
  /** Corners, ready for `stampPolyline` — never a cell list; see `verticesOf`. */
  | { ok: true; vertices: Cell[] }
  | { ok: false; reason: 'blocked' | 'budget' };

/** `(x, y, heading)` packed into one number, so the visited maps key cheaply. */
type NodeId = number;

/** Room for coordinates past any document worth routing across. */
const SPAN = 65536;
const HALF = SPAN / 2;

function idOf(x: number, y: number, d: Dir): NodeId {
  return ((x + HALF) * SPAN + (y + HALF)) * 16 + d;
}

interface Node {
  x: number;
  y: number;
  d: Dir;
  from: NodeId | null;
}

/**
 * A binary heap, because the open set is the whole cost of A*.
 *
 * Written out rather than imported: `core` has no dependencies, and a sorted
 * array turns the search quadratic exactly when the search is hard.
 */
class Heap {
  private readonly ids: NodeId[] = [];
  private readonly keys: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: NodeId, key: number): void {
    this.ids.push(id);
    this.keys.push(key);

    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.keys[parent] as number) <= (this.keys[i] as number)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): NodeId {
    const top = this.ids[0] as NodeId;
    const id = this.ids.pop() as NodeId;
    const key = this.keys.pop() as number;

    if (this.ids.length > 0) {
      this.ids[0] = id;
      this.keys[0] = key;

      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let small = i;
        if (left < this.keys.length && (this.keys[left] as number) < (this.keys[small] as number)) {
          small = left;
        }
        if (right < this.keys.length && (this.keys[right] as number) < (this.keys[small] as number)) {
          small = right;
        }
        if (small === i) break;
        this.swap(i, small);
        i = small;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a] as NodeId;
    const key = this.keys[a] as number;
    this.ids[a] = this.ids[b] as NodeId;
    this.keys[a] = this.keys[b] as number;
    this.ids[b] = id;
    this.keys[b] = key;
  }
}

/**
 * Manhattan distance, and deliberately nothing else.
 *
 * The tempting addition is "…plus one bend when the target is off both axes",
 * which is admissible and prunes well. It is also **inconsistent**: stepping
 * onto the target's row drops the estimate by a whole bend while costing one
 * step, so a node can be reached more cheaply after it has already been
 * settled. A* then rewrites that node's parent while other nodes are already
 * pointing through it, and the reconstructed path is no longer a path — it
 * jumps. That surfaced as routes with diagonal "corners", which is not a thing
 * a line on a grid can be.
 *
 * Plain Manhattan is consistent, so first-settled is final and the parents form
 * a tree. The search area is bounded by the budget, so the lost pruning costs
 * far less than the correctness was worth.
 */
function heuristic(x: number, y: number, to: Cell, costs: RouteCosts): number {
  return (Math.abs(to.x - x) + Math.abs(to.y - y)) * costs.step;
}

function inside(area: RouteBudget['area'], x: number, y: number): boolean {
  return x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h;
}

function stepCost(
  terrain: Terrain,
  costs: RouteCosts,
  x: number,
  y: number,
  bend: boolean,
): number {
  let cost = costs.step;
  if (bend) cost += costs.bend;
  // A cell cannot be both: `crossing` is something already drawn there,
  // `hugging` is empty space beside something. Charging both would be charging
  // twice for one cell.
  if (terrain.crossing(x, y)) cost += costs.cross;
  else if (terrain.hugging(x, y)) cost += costs.hug;
  return cost;
}

/**
 * Search for a route.
 *
 * Returns **vertices rather than cells**, which is what lets the result go
 * straight into `stampPolyline` — that already merges junctions, places
 * arrowheads and knows the charset. The router knows about none of it.
 */
export function findRoute(req: RouteRequest): RouteResult {
  const { from, to, toSide, terrain, costs, budget } = req;

  const open = new Heap();
  const nodes = new Map<NodeId, Node>();
  const best = new Map<NodeId, number>();
  const settled = new Set<NodeId>();

  const goalId = idOf(to.x, to.y, toSide);
  const firstDir = (DIRS[0] as { d: Dir }).d;
  const startDir = req.fromSide ?? firstDir;
  const startId = idOf(from.x, from.y, startDir);
  nodes.set(startId, { x: from.x, y: from.y, d: startDir, from: null });
  best.set(startId, 0);
  // Settled before the search begins, for two reasons that are really one: a
  // route has no business running back through its own start, and if it did,
  // relaxing the start would give it a parent — and the parent chain, which
  // `verticesOf` walks to the end, would become a ring.
  settled.add(startId);

  const relax = (x: number, y: number, d: Dir, g: number, parent: NodeId): void => {
    const id = idOf(x, y, d);
    // A settled node is final. Re-parenting one would break the paths already
    // running through it — see `heuristic` for how that goes wrong.
    if (settled.has(id)) return;

    const known = best.get(id);
    if (known !== undefined && known <= g) return;

    best.set(id, g);
    nodes.set(id, { x, y, d, from: parent });
    open.push(id, g + heuristic(x, y, to, costs));
  };

  // The first step is forced when the connector has a side to leave by, so the
  // line departs the way it was drawn to depart. A null `fromSide` is a loose
  // end, free to set off in any direction.
  for (const dir of req.fromSide === null ? DIRS : DIRS.filter((e) => e.d === req.fromSide)) {
    const nx = from.x + dir.dx;
    const ny = from.y + dir.dy;
    if (!inside(budget.area, nx, ny)) continue;

    const isGoal = nx === to.x && ny === to.y;
    if (terrain.blocked(nx, ny) && !isGoal) continue;
    if (isGoal && dir.d !== toSide) continue;

    relax(nx, ny, dir.d, stepCost(terrain, costs, nx, ny, false), startId);
  }

  let expansions = 0;

  while (open.size > 0) {
    const id = open.pop();
    if (settled.has(id)) continue;
    settled.add(id);

    if (id === goalId) return { ok: true, vertices: verticesOf(nodes, id) };
    if (++expansions > budget.maxExpansions) return { ok: false, reason: 'budget' };

    const node = nodes.get(id) as Node;
    const g = best.get(id) as number;

    for (const dir of DIRS) {
      // A route never doubles back: the cell behind is where it came from, and
      // re-entering it can only ever cost more.
      if (dir.d === opposite(node.d)) continue;

      const nx = node.x + dir.dx;
      const ny = node.y + dir.dy;
      if (!inside(budget.area, nx, ny)) continue;

      // The goal sits on the shape's own border, so it is occupied by
      // definition. Every *other* occupied cell is a wall (§1, §8).
      const isGoal = nx === to.x && ny === to.y;
      if (terrain.blocked(nx, ny) && !isGoal) continue;
      // …and it may only be entered from the side the connector attaches to,
      // or an arrow would arrive pointing the wrong way.
      if (isGoal && dir.d !== toSide) continue;

      relax(nx, ny, dir.d, g + stepCost(terrain, costs, nx, ny, dir.d !== node.d), id);
    }
  }
  return { ok: false, reason: 'blocked' };
}

/** Walk the parents back, then keep only the cells where the heading changed. */
function verticesOf(nodes: Map<NodeId, Node>, goal: NodeId): Cell[] {
  const path: Node[] = [];
  let at: NodeId | null = goal;

  while (at !== null) {
    const node: Node | undefined = nodes.get(at);
    if (node === undefined) break;
    path.push(node);
    at = node.from;
  }
  path.reverse();

  const out: Cell[] = [];
  for (let i = 0; i < path.length; i++) {
    const node = path[i] as Node;
    // Both ends are always corners; the middle only where the heading turns.
    if (i === 0 || i === path.length - 1 || (path[i + 1] as Node).d !== node.d) {
      out.push({ x: node.x, y: node.y });
    }
  }
  return out;
}
