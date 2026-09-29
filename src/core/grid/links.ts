/**
 * Links: the connections the four-arm model cannot express (B-CONN-08).
 *
 * Every line glyph declares arms toward its four edge neighbours, and two cells
 * connect when both arms meet (B-CONN-03). A diagonal has no such arms: `/`
 * runs corner to corner, so what it touches is a *diagonal* neighbour, and the
 * bend that turns a straight run into it (`╮`, or `.` in ASCII) has an arm that
 * points at an empty cell. Like connectivity, links are never stored
 * (B-CONN-01); they are read off the glyphs here, and only the tracer and the
 * outline check ask for them.
 *
 * The rules are deliberately narrow, because `/` and `.` are also ordinary
 * text. A link needs both sides to agree, exactly as an arm does:
 *
 *   - a slash reaches the two corners it leans toward;
 *   - a line reaches a corner through a **loose** arm — one pointing at a cell
 *     that does not connect back — as long as the line does not also carry on
 *     toward that corner's side;
 *   - `.` and `'` are bends only when a straight run arrives at them and a
 *     diagonal leaves them, and are text otherwise;
 *   - a slash standing on the loose end of a vertical line joins it, provided
 *     the slash carries on diagonally away from the line;
 *   - two slashes leaning opposite ways join when side by side or stacked,
 *     because they share a corner (`/\`, `\/`, and `/` over `\`).
 *
 * Two plain straight lines never link across a corner, even when both ends
 * are loose: that would join a line to whatever happens to end near it.
 */

import { ck, type Cell } from '../geom/cell.ts';
import {
  DIRS,
  E,
  N,
  S,
  W,
  declaredMask,
  dirDelta,
  isAmbiguous,
  isStrongLineChar,
  opposite,
  type Dir,
} from '../charset/charsets.ts';
import { maskOf, type Grid } from './grid.ts';

const RISE = 1;
const FALL = 2;

/** Slashes, by lean: `/` rises to the right, `\` falls. */
const SLASH: Readonly<Record<string, number>> = {
  '/': RISE,
  '╱': RISE,
  '\\': FALL,
  '╲': FALL,
};

/** ASCII bends, by the way their diagonal leaves: `-.` goes down, `-'` up. */
const WEAK_BEND: Readonly<Record<string, Dir>> = {
  '.': S,
  "'": N,
};

/** The lean of a diagonal step: down-right and up-left fall, the others rise. */
function leanOf(dx: number, dy: number): number {
  return Math.sign(dx) === Math.sign(dy) ? FALL : RISE;
}

/** True when the neighbour on side `d` connects back toward (x,y). */
function joined(grid: Grid, x: number, y: number, d: Dir): boolean {
  const { dx, dy } = dirDelta(d);
  return (maskOf(grid, x + dx, y + dy) & opposite(d)) !== 0;
}

/** A line glyph drawn as one straight stroke, edge to edge. */
function isStraight(ch: string | undefined): boolean {
  if (!isStrongLineChar(ch) || isAmbiguous(ch)) return false;
  const m = declaredMask(ch);
  return m === (N | S) || m === (E | W);
}

/** The declared arms of a line glyph that really connect. */
function armsOf(grid: Grid, x: number, y: number, declared: number): number {
  let arms = 0;
  for (const { d } of DIRS) {
    if ((declared & d) !== 0 && joined(grid, x, y, d)) arms |= d;
  }
  return arms;
}

/** Does the cell at (x,y) reach toward its corner at (x+dx, y+dy)? */
function reaches(grid: Grid, x: number, y: number, dx: number, dy: number): boolean {
  const ch = grid.get(ck(x, y));
  if (ch === undefined) return false;

  const lean = SLASH[ch];
  if (lean !== undefined) return lean === leanOf(dx, dy);

  const vertical: Dir = dy > 0 ? S : N;
  const toward: Dir = dx > 0 ? E : W;

  const bend = WEAK_BEND[ch];
  if (bend !== undefined) return bend === vertical && joined(grid, x, y, opposite(toward));

  if (!isStrongLineChar(ch)) return false;
  const declared = declaredMask(ch);
  const arms = armsOf(grid, x, y, declared);

  // A `+` declares every arm, so it only counts as a bend at the end of one
  // run. In the corner of an ASCII box it has two, and reaches nowhere.
  if (isAmbiguous(ch) && arms !== N && arms !== E && arms !== S && arms !== W) return false;

  const loose = declared & ~arms;
  if ((loose & vertical) !== 0 && (arms & toward) === 0) return true;
  return (loose & toward) !== 0 && (arms & vertical) === 0;
}

function diagonalLink(grid: Grid, x: number, y: number, dx: number, dy: number): boolean {
  if (!reaches(grid, x, y, dx, dy) || !reaches(grid, x + dx, y + dy, -dx, -dy)) return false;
  return !(isStraight(grid.get(ck(x, y))) && isStraight(grid.get(ck(x + dx, y + dy))));
}

/** A slash at `s` standing on the loose end of a vertical line `dy` away. */
function slashOnLine(grid: Grid, s: Cell, dy: number): boolean {
  const lean = SLASH[grid.get(ck(s.x, s.y)) ?? ''];
  if (lean === undefined) return false;

  const line = grid.get(ck(s.x, s.y + dy));
  if (!isStrongLineChar(line) || (declaredMask(line) & (dy > 0 ? N : S)) === 0) return false;

  const away = -dy;
  return diagonalLink(grid, s.x, s.y, lean === FALL ? away : -away, away);
}

/** An ASCII bend at `b` with the straight run arriving from `dx`. */
function bendOnLine(grid: Grid, b: Cell, dx: number): boolean {
  const vertical = WEAK_BEND[grid.get(ck(b.x, b.y)) ?? ''];
  if (vertical === undefined) return false;
  if (!joined(grid, b.x, b.y, dx > 0 ? E : W)) return false;
  return diagonalLink(grid, b.x, b.y, -dx, vertical === S ? 1 : -1);
}

/**
 * Two slashes side by side or stacked that lean opposite ways always share a
 * corner: `/\` is a peak, `\/` a trough, and `/` over `\` a point.
 */
function slashesMeet(grid: Grid, a: Cell, b: Cell): boolean {
  const p = SLASH[grid.get(ck(a.x, a.y)) ?? ''];
  const q = SLASH[grid.get(ck(b.x, b.y)) ?? ''];
  return p !== undefined && q !== undefined && p !== q;
}

/** True when two neighbouring cells are linked (see the rules above). */
export function linked(grid: Grid, a: Cell, b: Cell): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;

  if (dx !== 0 && dy !== 0) return diagonalLink(grid, a.x, a.y, dx, dy);
  if (slashesMeet(grid, a, b)) return true;
  if (dx === 0) return slashOnLine(grid, a, dy) || slashOnLine(grid, b, -dy);
  return bendOnLine(grid, a, dx) || bendOnLine(grid, b, -dx);
}

/**
 * The directions in which (x,y) has a **slash** for a neighbour.
 *
 * The one kind of arm that is not stray when it points at a cell that does not
 * point back. A slash declares no arms at all — it joins through a link instead
 * (B-CONN-08) — so an arm aimed at one is not a leftover, it is half of that
 * link, and dropping it breaks the join. A circle's ring is exactly this: the
 * `│` down its side reaches the `\` of its shoulder through a loose arm.
 *
 * Deliberately only the glyph, with none of `linked`'s agreement checks. The
 * question a stamper asks is narrower than the tracer's — not *"are these two
 * joined right now"* but *"is this arm worth keeping"* — and a stamper that
 * demanded a finished link would drop the arm that was about to make one.
 */
export function slashMask(grid: Grid, x: number, y: number): number {
  let mask = 0;
  for (const { d, dx, dy } of DIRS) {
    if ((grid.get(ck(x + dx, y + dy)) ?? '') in SLASH) mask |= d;
  }
  return mask;
}

/**
 * Every neighbour (x,y) is linked to. Empty for the overwhelming majority of
 * cells, so the common case — a line whose every arm is joined, with no
 * slash or ASCII bend involved — is answered without looking any further.
 */
export function links(grid: Grid, x: number, y: number): Cell[] {
  const ch = grid.get(ck(x, y));
  if (ch === undefined) return [];

  if (isStrongLineChar(ch) && !isAmbiguous(ch)) {
    const declared = declaredMask(ch);
    if (armsOf(grid, x, y, declared) === declared) return [];
  } else if (!(ch in SLASH) && !(ch in WEAK_BEND) && !isStrongLineChar(ch)) {
    return [];
  }

  const out: Cell[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const to = { x: x + dx, y: y + dy };
      if (linked(grid, { x, y }, to)) out.push(to);
    }
  }
  return out;
}
