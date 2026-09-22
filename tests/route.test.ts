/**
 * The ten scenarios in intuitive/pathfinding.md, pinned.
 *
 * The search is a pure function over a `Terrain`, so these fixtures are drawn as
 * text and read back as text — no grid, no glyphs, no store. `#` is a wall, `.`
 * is open, `A` and `B` mark the two ends.
 */

import { describe, expect, it } from 'vitest';
import { E, N, S, W, type Dir } from '../src/core/charset/charsets.ts';
import type { Cell } from '../src/core/geom/cell.ts';
import { DEFAULT_COSTS, budgetFor, type Terrain } from '../src/core/route/cost.ts';
import { findRoute, type RouteResult } from '../src/core/route/astar.ts';
import { UNICODE } from '../src/core/charset/charsets.ts';
import { applyDiff, createGrid, type Grid } from '../src/core/grid/grid.ts';
import { stampBox } from '../src/core/stamp/box.ts';
import { stampPath } from '../src/core/stamp/path.ts';
import { toText } from '../src/core/io/text.ts';
import { recognize, type Candidate } from '../src/core/recognize/recognize.ts';
import { candidatesAt, defaultIndex } from '../src/core/recognize/rank.ts';
import { planMove } from '../src/core/ops/move.ts';

/** A terrain drawn as text. Every `#` is a wall; everything else is open. */
function terrainOf(rows: readonly string[]): Terrain {
  const wall = (x: number, y: number): boolean => (rows[y] ?? '').charAt(x) === '#';
  return {
    blocked: wall,
    crossing: () => false,
    hugging(x, y) {
      if (wall(x, y)) return false;
      return wall(x + 1, y) || wall(x - 1, y) || wall(x, y + 1) || wall(x, y - 1);
    },
  };
}

interface Scene {
  terrain: Terrain;
  rows: readonly string[];
  a: Cell;
  b: Cell;
}

function sceneOf(rows: readonly string[]): Scene {
  const find = (ch: string): Cell => {
    for (let y = 0; y < rows.length; y++) {
      const x = (rows[y] as string).indexOf(ch);
      if (x >= 0) return { x, y };
    }
    throw new Error(`no ${ch} in the scene`);
  };
  return { terrain: terrainOf(rows), rows, a: find('A'), b: find('B') };
}

function route(scene: Scene, fromSide: Dir | null, toSide: Dir): RouteResult {
  return findRoute({
    from: scene.a,
    fromSide,
    to: scene.b,
    toSide,
    terrain: scene.terrain,
    costs: DEFAULT_COSTS,
    budget: budgetFor(scene.a, scene.b),
  });
}

/**
 * Every cell the vertices pass through, so a route can be checked cell by cell.
 *
 * A corner belongs to both of its segments, so it is emitted once — otherwise
 * every count here silently includes the bend count too.
 */
function cellsOf(vertices: readonly Cell[]): Cell[] {
  const first = vertices[0];
  if (first === undefined) return [];

  const out: Cell[] = [{ x: first.x, y: first.y }];
  for (let i = 0; i < vertices.length - 1; i++) {
    const from = vertices[i] as Cell;
    const to = vertices[i + 1] as Cell;
    if (from.x !== to.x && from.y !== to.y) {
      throw new Error(`vertices ${JSON.stringify(from)}→${JSON.stringify(to)} are not axis-aligned`);
    }
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);

    let { x, y } = from;
    while (x !== to.x || y !== to.y) {
      x += dx;
      y += dy;
      out.push({ x, y });
    }
  }
  return out;
}

/** The scene with the route drawn over it, for eyeballing a failure. */
export function drawn(scene: Scene, vertices: readonly Cell[]): string {
  const grid = scene.rows.map((r) => r.split(''));
  for (const c of cellsOf(vertices)) {
    const row = grid[c.y];
    if (row !== undefined && (row[c.x] === '.' || row[c.x] === undefined)) row[c.x] = 'o';
  }
  return grid.map((r) => r.join('')).join('\n');
}

function bends(vertices: readonly Cell[]): number {
  return Math.max(0, vertices.length - 2);
}

describe('§1 something squarely in the way', () => {
  const scene = sceneOf([
    '..............',
    'A....####....B',
    '.....#..#.....',
    '.....#..#.....',
    '.....####.....',
    '..............',
  ]);

  it('goes around rather than through', () => {
    const result = route(scene, E, E);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const c of cellsOf(result.vertices)) {
      expect(scene.terrain.blocked(c.x, c.y), `entered ${c.x},${c.y}`).toBe(false);
    }
  });

  it('and arrives from the side it was told to', () => {
    const result = route(scene, E, E);
    if (!result.ok) throw new Error('no route');

    const cells = cellsOf(result.vertices);
    const last = cells[cells.length - 1] as Cell;
    const before = cells[cells.length - 2] as Cell;
    expect(last).toEqual(scene.b);
    expect(before.x).toBe(scene.b.x - 1); // came in heading east
  });
});

describe('§2 a wall with one gap', () => {
  it('finds the opening nothing about the endpoints pointed to', () => {
    const scene = sceneOf([
      '#############',
      '#...........#',
      'A....##.....B',
      '#....##.....#',
      '#....##.....#',
      '#############',
    ]);

    const result = route(scene, E, E);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cells = cellsOf(result.vertices);
    // The only way past is row 1, above the wall — and it is found without
    // anything about A or B pointing at it.
    expect(cells.some((c) => c.y === 1)).toBe(true);
    for (const c of cells) {
      expect(scene.terrain.blocked(c.x, c.y), `entered ${c.x},${c.y}`).toBe(false);
    }
    // Where it climbs is a free choice between equal routes — up early or up
    // late costs the same four bends — so only the crossing itself is pinned.
    expect(bends(result.vertices)).toBe(4);
  });
});

describe('§3 a pocket that leads nowhere', () => {
  it('is willing to move away from the target to get around it', () => {
    // The mouth is at (4,3), facing A, and the pocket closes at x=11. B sits
    // beyond it with a clear approach of its own.
    const scene = sceneOf([
      '................',
      '....########....',
      '....#......#....',
      'A..........#...B',
      '....#......#....',
      '....########....',
      '................',
    ]);

    const result = route(scene, E, E);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The mouth of the pocket faces A and closes behind it, so a greedy walk
    // goes in and stops. Nothing in the route may be inside the pocket.
    for (const c of cellsOf(result.vertices)) {
      const insidePocket = c.x > 4 && c.x < 11 && c.y > 1 && c.y < 5;
      expect(insidePocket, `entered the pocket at ${c.x},${c.y}`).toBe(false);
    }
  });
});

describe('§4 threading a one-cell gap', () => {
  it('takes the only way through when that is all there is', () => {
    const scene = sceneOf([
      '####################',
      '#..................#',
      'A......####........#',
      '#......####........#',
      '#..................#',
      '#......####........#',
      '#......####.......B#',
      '####################',
    ]);

    const result = route(scene, E, E);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const c of cellsOf(result.vertices)) {
      expect(scene.terrain.blocked(c.x, c.y)).toBe(false);
    }
  });

  it('and does not refuse a cramped route to buy clearance it cannot afford', () => {
    // Row 4 is a one-cell slot between two walls; rows 1 and 7 are wide open.
    // Going round costs two bends — twenty — against four hugged cells at two
    // apiece. The doc asks for a penalty "enough to prefer breathing room, not
    // enough to refuse the only way through", and this is which side of that
    // line the default prices fall on.
    const scene = sceneOf([
      '####################',
      '#..................#',
      '#......####........#',
      '#......####........#',
      'A..................B',
      '#......####........#',
      '#......####........#',
      '#..................#',
      '####################',
    ]);

    const result = route(scene, E, E);
    if (!result.ok) throw new Error('no route');

    expect(bends(result.vertices)).toBe(0);
    expect(cellsOf(result.vertices).every((c) => c.y === 4)).toBe(true);
  });
});

describe('§7 shortest, or fewest turns?', () => {
  it('takes the one-bend route over the staircase of the same length', () => {
    const scene = sceneOf([
      'A.........',
      '..........',
      '..........',
      '..........',
      '..........',
      '.........B',
    ]);

    const result = route(scene, S, E);
    if (!result.ok) throw new Error('no route');

    // Any monotone staircase is the same number of cells. Only the bend price
    // rules them out, and the arrival side fixes which single corner is used.
    expect(bends(result.vertices)).toBe(1);
  });

  it('a straight shot has no corners at all', () => {
    const scene = sceneOf(['A........B']);
    const result = route(scene, E, E);
    if (!result.ok) throw new Error('no route');
    expect(bends(result.vertices)).toBe(0);
  });
});

describe('§9 no route exists', () => {
  it('reports being blocked rather than drawing through the wall', () => {
    const scene = sceneOf([
      '..........',
      '..#####...',
      'A.#...#...',
      '..#.B.#...',
      '..#...#...',
      '..#####...',
      '..........',
    ]);

    const result = route(scene, E, E);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('blocked');
  });

  it('and a budget it cannot meet is a different answer from no route at all', () => {
    const scene = sceneOf(['A........B']);
    const result = findRoute({
      from: scene.a,
      fromSide: E,
      to: scene.b,
      toSide: E,
      terrain: scene.terrain,
      costs: DEFAULT_COSTS,
      budget: { ...budgetFor(scene.a, scene.b), maxExpansions: 2 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('budget');
  });
});

describe('§10 room to breathe', () => {
  it('leaves a cell of clearance when the space is there', () => {
    const scene = sceneOf([
      '.............',
      'A...####.....',
      '....####.....',
      '....####.....',
      '....####....B',
      '.............',
    ]);

    const result = route(scene, E, E);
    if (!result.ok) throw new Error('no route');

    // Going around the top costs one bend more than hugging the wall all the
    // way down, but hugging is charged per cell and there are four of them.
    const hugged = cellsOf(result.vertices).filter((c) =>
      scene.terrain.hugging(c.x, c.y),
    ).length;
    expect(hugged).toBeLessThan(4);
  });
});

describe('the shape of the answer', () => {
  it('is corners, not cells, so it can be stamped directly', () => {
    const scene = sceneOf([
      'A....',
      '.....',
      '....B',
    ]);
    const result = route(scene, S, E);
    if (!result.ok) throw new Error('no route');

    // A single elbow is three points, however many cells it covers.
    expect(result.vertices.length).toBe(3);
    expect(result.vertices[0]).toEqual(scene.a);
    expect(result.vertices[result.vertices.length - 1]).toEqual(scene.b);
  });

  it('leaves by the side it is told to, even when that is the long way round', () => {
    const scene = sceneOf([
      '.........',
      '.A......B',
      '.........',
    ]);

    // B is due east, but the line must leave westward.
    const result = route(scene, W, E);
    if (!result.ok) throw new Error('no route');

    const cells = cellsOf(result.vertices);
    expect((cells[1] as Cell).x).toBe(scene.a.x - 1);
  });

  it('a loose end may set off in any direction', () => {
    const scene = sceneOf([
      '.........',
      '.A......B',
      '.........',
    ]);
    const result = route(scene, null, E);
    if (!result.ok) throw new Error('no route');
    expect(bends(result.vertices)).toBe(0);
  });
});

describe('the price list is the behaviour', () => {
  it('a free bend turns the router into a staircase machine', () => {
    const scene = sceneOf([
      'A.........',
      '..........',
      '..........',
      '..........',
      '..........',
      '.........B',
    ]);

    const cheap = findRoute({
      from: scene.a,
      fromSide: S,
      to: scene.b,
      toSide: E,
      terrain: scene.terrain,
      costs: { ...DEFAULT_COSTS, bend: 0 },
      budget: budgetFor(scene.a, scene.b),
    });
    if (!cheap.ok) throw new Error('no route');

    // Same length, many more corners — which is exactly §7's complaint, and
    // why the default price for a bend is ten cells rather than none.
    expect(bends(cheap.vertices)).toBeGreaterThan(1);

    const dear = route(scene, S, E);
    if (!dear.ok) throw new Error('no route');
    expect(bends(dear.vertices)).toBe(1);
    expect(cellsOf(cheap.vertices).length).toBe(cellsOf(dear.vertices).length);
  });
});

describe('N and S are honoured as arrival sides too', () => {
  it('arrives from above when told to', () => {
    const scene = sceneOf([
      '.....',
      '.A...',
      '.....',
      '...B.',
      '.....',
    ]);
    const result = route(scene, S, S);
    if (!result.ok) throw new Error('no route');

    const cells = cellsOf(result.vertices);
    const before = cells[cells.length - 2] as Cell;
    expect(before).toEqual({ x: scene.b.x, y: scene.b.y - 1 });
  });

  it('and from below', () => {
    const scene = sceneOf([
      '.....',
      '...B.',
      '.....',
      '.A...',
      '.....',
    ]);
    const result = route(scene, N, N);
    if (!result.ok) throw new Error('no route');

    const cells = cellsOf(result.vertices);
    const before = cells[cells.length - 2] as Cell;
    expect(before).toEqual({ x: scene.b.x, y: scene.b.y + 1 });
  });
});

/**
 * The router where it actually runs: a connector being re-routed by a move.
 *
 * Everything above tests the search against invented terrain. These test the
 * thing the user sees, which is a line that stopped going through boxes.
 */
describe('a connector that has to find its way', () => {
  function wired(bx: number, by: number): Grid {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: bx, y: by, w: 7, h: 3 }, UNICODE));
    applyDiff(
      grid,
      stampPath(grid, { x: 7, y: 1 }, { x: bx, y: 1 }, UNICODE, { headEnd: true }),
    );
    return grid;
  }

  function clicked(grid: Grid, x: number, y: number): Candidate {
    const list = candidatesAt(grid, x, y);
    const picked = list[defaultIndex(list)];
    if (picked === undefined) throw new Error('nothing there');
    return picked;
  }

  it('goes around a box rather than through it (§1)', () => {
    const grid = wired(30, 0);
    // A shape squarely between the two, once the far box drops below it.
    applyDiff(grid, stampBox(grid, { x: 14, y: 4, w: 8, h: 5 }, UNICODE));
    const obstacle = [...(recognize(grid, 14, 4)?.cells ?? [])];

    applyDiff(grid, planMove(grid, clicked(grid, 33, 0), 0, 8, { charset: UNICODE }).diff);

    // Every cell of the obstacle is still exactly what it was.
    for (const key of obstacle) {
      expect('┌┐└┘─│'.includes(grid.get(key) ?? ''), `${key} was written over`).toBe(true);
    }
    expect(toText(grid)).not.toContain('┼');
  });

  it('goes around a word rather than over it (§8)', () => {
    const grid = wired(30, 0);
    const note = 'invariant note';
    [...note].forEach((ch, i) => grid.set(`${12 + i},5`, ch));

    applyDiff(grid, planMove(grid, clicked(grid, 33, 0), 0, 4, { charset: UNICODE }).diff);
    expect(toText(grid)).toContain(note);
  });

  it('keeps the plain elbow when nothing is in the way', () => {
    const grid = wired(13, 0);
    applyDiff(grid, planMove(grid, clicked(grid, 16, 0), 0, 4, { charset: UNICODE }).diff);

    // Unchanged from before there was a router: among equally priced routes the
    // search has no way to prefer the one a person would draw, so it is not
    // asked when the simple answer fits.
    expect(toText(grid)).toBe(
      [
        '┌─────┐',
        '│     ├──┐',
        '└─────┘  │',
        '         │',
        '         │   ┌─────┐',
        '         └──▶│     │',
        '             └─────┘',
      ].join('\n'),
    );
  });

  it('follows anyway, and says so, when there is no way through (§9)', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 1, y: 1, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 20, y: 1, w: 7, h: 3 }, UNICODE));
    applyDiff(
      grid,
      stampPath(grid, { x: 8, y: 2 }, { x: 20, y: 2 }, UNICODE, { headEnd: true }),
    );
    // Wall the left box in on every side but the one its connector leaves by.
    for (let x = 0; x <= 8; x++) {
      grid.set(`${x},0`, '#');
      grid.set(`${x},4`, '#');
    }
    for (let y = 0; y <= 4; y++) grid.set(`0,${y}`, '#');
    grid.set('8,1', '#');
    grid.set('8,3', '#');

    // Straight down: the side the connector would have to reach is the walled
    // one, and there is no way round to it.
    const plan = planMove(grid, clicked(grid, 23, 1), -16, 10, { charset: UNICODE });
    expect(plan.note).toBe('No clear route — the line goes straight there');

    applyDiff(grid, plan.diff);

    // The line still follows the box, straight through the wall it cannot get
    // around. A connector that stops following its shape is a worse answer than
    // one that overlaps something: an enclosed shape has no clear route by
    // definition, and dragging a box into another box is an ordinary thing to
    // do. The arrowhead is at the box, not back where the box used to be.
    const head = [...grid.entries()].find(([, ch]) => ch === '▼' || ch === '▶');
    expect(head).toBeDefined();
    expect(Number((head as [string, string])[0].split(',')[1])).toBeGreaterThan(5);
  });

  it('and picks routing back up the moment there is a way through again', () => {
    const grid = createGrid();
    applyDiff(grid, stampBox(grid, { x: 0, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(grid, stampBox(grid, { x: 20, y: 0, w: 7, h: 3 }, UNICODE));
    applyDiff(
      grid,
      stampPath(grid, { x: 7, y: 1 }, { x: 20, y: 1 }, UNICODE, { headEnd: true }),
    );
    // A wall the route must get around, once the far box drops below it.
    applyDiff(grid, stampBox(grid, { x: 10, y: 4, w: 6, h: 6 }, UNICODE));

    const sel = clicked(grid, 23, 0);
    const away = planMove(grid, sel, 0, 8, { charset: UNICODE });

    // Nothing was remembered from the blocked case above: this is a different
    // document, so the router simply answers again.
    expect(away.note).toBeUndefined();
    applyDiff(grid, away.diff);
    expect(toText(grid)).not.toContain('┼');
  });
});
