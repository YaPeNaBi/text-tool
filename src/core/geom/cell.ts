/**
 * Cell coordinates and rectangles.
 *
 * The plane is a quadrant: (0,0) is the top-left corner, x grows right,
 * y grows down (B-PLANE-01, B-PLANE-02).
 */

export interface Cell {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cell keys are `"x,y"`. Strings keep the document a plain Map. */
export type CellKey = string;

export function ck(x: number, y: number): CellKey {
  return `${x},${y}`;
}

export function unck(key: CellKey): Cell {
  const i = key.indexOf(',');
  return { x: Number(key.slice(0, i)), y: Number(key.slice(i + 1)) };
}

/** Rectangle spanning two corner cells, inclusive of both. */
export function rectFromCorners(a: Cell, b: Cell): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** True when (x,y) lies on the rectangle's border rather than its interior. */
export function rectOnBorder(r: Rect, x: number, y: number): boolean {
  if (!rectContains(r, x, y)) return false;
  return x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1;
}

/** Number of cells on a rectangle's border. */
export function borderCellCount(r: Rect): number {
  if (r.w <= 0 || r.h <= 0) return 0;
  if (r.w === 1) return r.h;
  if (r.h === 1) return r.w;
  return 2 * r.w + 2 * r.h - 4;
}

/** The centre of a rectangle, which may fall between cells. */
export function centreOf(r: Rect): { x: number; y: number } {
  return { x: r.x + (r.w - 1) / 2, y: r.y + (r.h - 1) / 2 };
}

/**
 * True when `inner` lies wholly within `outer` with a gap on every side.
 *
 * Strictly matters: a shape sharing an edge with another is a neighbour, not a
 * child. It is the same rule that stops a sticky connector re-routing a box
 * that merely leans on another.
 */
export function rectStrictlyInside(outer: Rect, inner: Rect): boolean {
  return (
    inner.x > outer.x &&
    inner.y > outer.y &&
    inner.x + inner.w < outer.x + outer.w &&
    inner.y + inner.h < outer.y + outer.h
  );
}

export function rectShifted(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

export function boundsOf(keys: Iterable<CellKey>): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;

  for (const k of keys) {
    const { x, y } = unck(k);
    any = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!any) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
