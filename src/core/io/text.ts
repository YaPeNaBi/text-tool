/**
 * Text output.
 *
 * The document is already characters, so export is a crop and a join
 * (B-TXT-01). There is no render pass that could diverge from what is on
 * screen (B-TXT-02).
 */

import { boundsOf, ck, type CellKey, type Rect } from '../geom/cell.ts';
import type { Grid } from '../grid/grid.ts';

/**
 * The document as text, optionally cropped — and optionally masked.
 *
 * `only` limits the output to a set of cells, leaving everything else in the
 * region blank. A rectangle is the wrong unit for "what is selected": a line
 * bent round a corner has a bounding box full of other people's characters,
 * and copying those would hand back things the user never picked (B-TXT-05).
 */
export function toText(
  grid: Grid,
  region?: Rect,
  only?: ReadonlySet<CellKey>,
): string {
  const bounds = region ?? boundsOf(grid.keys());
  if (bounds === null) return '';

  const rows: string[] = [];
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    let row = '';
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      const key = ck(x, y);
      row += (only === undefined || only.has(key) ? grid.get(key) : undefined) ?? ' ';
    }
    rows.push(row.replace(/\s+$/, ''));
  }
  return rows.join('\n');
}

/** Read text into a grid diff at the given origin. One char, one cell. */
export function fromText(text: string, originX = 0, originY = 0): Map<string, string> {
  const out = new Map<string, string>();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((line, row) => {
    const expanded = line.replace(/\t/g, '    ');
    for (let col = 0; col < expanded.length; col++) {
      const ch = expanded[col];
      if (ch === undefined || ch === ' ') continue;
      out.set(ck(originX + col, originY + row), ch);
    }
  });
  return out;
}
