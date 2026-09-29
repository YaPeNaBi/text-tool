/**
 * Turning a run of text into huge letters.
 *
 * The planner behind the `Font` menu: read what is selected, render it through a
 * `BannerStyle`, and hand back one diff that takes the old characters out and
 * puts the new ones in. Like every other op it is pure and returns a `Plan`, so
 * one choice from the menu is one undo step (B-HIST-02) — which matters more
 * here than usual, undo being the only way back to the small version.
 *
 * ── It is a transform, not a property ─────────────────────────────────────
 *
 * The document is characters and nothing else, so a banner is not *text wearing
 * a font*; it is a picture of that text. Nothing records what it used to say and
 * nothing could: there is no sidecar and no metadata (B-TXT-06). Choosing a font
 * twice therefore renders the picture of the picture, which is why the menu is
 * built to be previewed and why `Ctrl`+`Z` is the way back.
 *
 * ── Where it lands, and what it lands on ──────────────────────────────────
 *
 * At the selection's own top-left corner, growing right and down. Five rows of
 * letters where there was one row of text will cover whatever was underneath,
 * and that is the occlusion the whole design already accepts (B-MAN-03) rather
 * than a case this op gets to be clever about. The preview exists so it is
 * covered *visibly* — you see what is about to go under before it does.
 */

import { boundsOf, ck, type CellKey } from '../geom/cell.ts';
import type { CellDiff, Grid } from '../grid/grid.ts';
import { toText } from '../io/text.ts';
import type { Candidate } from '../recognize/recognize.ts';
import { renderBanner, type BannerStyle } from '../text/banner.ts';
import { refuse, type Plan } from './plan.ts';

/** A blank row between the lines of a multi-line selection, so they read apart. */
const LEADING = 1;

/**
 * The selected text, line by line.
 *
 * Masked to the selection rather than cropped to its bounding box (B-TXT-05):
 * a text block's bounds can take in characters belonging to something else, and
 * rendering those into the banner would be inventing words nobody selected.
 */
function linesOf(grid: Grid, cells: ReadonlySet<CellKey>): string[] {
  const bounds = boundsOf(cells);
  if (bounds === null) return [];
  return toText(grid, bounds, cells).split('\n');
}

export function planBanner(
  grid: Grid,
  selection: Candidate,
  style: BannerStyle,
): Plan {
  const bounds = selection.bounds;
  const lines = linesOf(grid, selection.cells);
  const rows: string[] = [];

  for (const line of lines) {
    const drawn = renderBanner(line.trim(), style);
    if (drawn.length === 0) continue;
    if (rows.length > 0) for (let g = 0; g < LEADING; g++) rows.push('');
    rows.push(...drawn);
  }

  // A selection of nothing but spaces has no letters to make big. Saying so
  // beats an empty diff, which reads as the menu item being broken — the menu
  // closes either way, and a menu that closes having done nothing and said
  // nothing is indistinguishable from one that failed.
  if (rows.length === 0) return refuse('Nothing to set in a font');

  const diff: CellDiff = new Map();
  // Out with the old first: the banner is a different shape from the text, and
  // any cell of the original it does not happen to cover would otherwise be left
  // behind as debris inside the new letters.
  for (const key of selection.cells) diff.set(key, null);

  rows.forEach((row, dy) => {
    [...row].forEach((chr, dx) => {
      if (chr === ' ') return;
      diff.set(ck(bounds.x + dx, bounds.y + dy), chr);
    });
  });

  const written = new Set<CellKey>();
  for (const [key, value] of diff) if (value !== null) written.add(key);

  const box = boundsOf(written);
  return {
    diff,
    selection: box === null ? null : { kind: 'cells', cells: written, bounds: box },
    ...(rows.length > bounds.h + 2
      ? { note: `${String(rows.length)} rows tall — check what it covers` }
      : {}),
  };
}
