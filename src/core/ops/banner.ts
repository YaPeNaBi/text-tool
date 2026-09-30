/**
 * Turning a run of text into huge letters, and editing them afterwards.
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
 * nothing could: there is no sidecar and no metadata (B-TXT-06). What makes it
 * editable anyway is that the picture can be **read back** (`text/unbanner.ts`),
 * so the word is recovered on demand rather than remembered.
 *
 * That is why every edit here goes through `renderBanner` on the *whole* string
 * rather than appending or trimming glyphs in place. Adding a letter to `HELL`
 * is rendering `HELLO`, not drawing an `O` after the `L` and hoping the tracking
 * matches — so the spacing, the multi-line leading and the trimming are whatever
 * the renderer says they are, and an edited banner is indistinguishable from one
 * that was drawn that way to begin with (B-FONT-04).
 *
 * ── Where it lands, and what it lands on ──────────────────────────────────
 *
 * At the selection's own top-left corner, growing right and down. Five rows of
 * letters where there was one row of text will cover whatever was underneath,
 * and that is the occlusion the whole design already accepts (B-MAN-03) rather
 * than a case this op gets to be clever about. The preview exists so it is
 * covered *visibly* — you see what is about to go under before it does.
 */

import { boundsOf, ck, type Cell, type CellKey } from '../geom/cell.ts';
import type { CellDiff, Grid } from '../grid/grid.ts';
import { toText } from '../io/text.ts';
import type { Candidate } from '../recognize/recognize.ts';
import { renderBanner, type BannerStyle } from '../text/banner.ts';
import { refuse, type Plan } from './plan.ts';

/** A blank row between the lines of a multi-line banner, so they read apart. */
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

/** Every line of `text`, rendered and stacked with a blank row between. */
function rowsFor(text: string, style: BannerStyle): string[] {
  const rows: string[] = [];
  for (const line of text.split('\n')) {
    const drawn = renderBanner(line, style);
    // An empty line still takes its height: pressing Enter twice should leave a
    // gap you can see, not collapse into one.
    const block = drawn.length === 0 ? Array.from({ length: style.height }, () => '') : drawn;
    if (rows.length > 0) for (let g = 0; g < LEADING; g++) rows.push('');
    rows.push(...block);
  }
  return rows;
}

/**
 * Render `text` at `origin`, clearing `replacing` first.
 *
 * The one place a banner is written, whether it is being created from a run of
 * text or re-rendered after a keystroke. `replacing` is cleared in the same diff
 * because the new letters are a different shape from the old ones: any cell of
 * the previous rendering the new one does not happen to cover would otherwise be
 * left behind as debris inside it — which is exactly what a backspace is.
 */
export function planBannerAt(
  origin: Cell,
  text: string,
  style: BannerStyle,
  replacing: ReadonlySet<CellKey>,
): Plan {
  const rows = rowsFor(text, style);
  const diff: CellDiff = new Map();
  for (const key of replacing) diff.set(key, null);

  rows.forEach((row, dy) => {
    [...row].forEach((chr, dx) => {
      if (chr === ' ') return;
      diff.set(ck(origin.x + dx, origin.y + dy), chr);
    });
  });

  const written = new Set<CellKey>();
  for (const [key, value] of diff) if (value !== null) written.add(key);

  const box = boundsOf(written);
  if (box === null) {
    // Everything was erased and nothing drawn: the last letter has just been
    // backspaced away. A diff that only erases is still a perfectly good diff.
    return { diff, selection: null };
  }

  // Selected **as a banner**, not as a heap of cells, and that is the difference
  // between the feature working and not. Choosing a font leaves you holding the
  // thing you just made, so `t` and then typing carries straight on in the same
  // font — where a `cells` reading would have been dropped on the way into the
  // writing mode and left a caret typing small letters over the big ones.
  //
  // Said here rather than re-read from the grid because this function already
  // knows the answer exactly: it just drew it.
  return {
    diff,
    selection: {
      kind: 'banner',
      cells: written,
      bounds: box,
      banner: { styleId: style.id, text },
    },
  };
}

/** The `Font` menu: a run of ordinary text, set in huge letters. */
export function planBanner(grid: Grid, selection: Candidate, style: BannerStyle): Plan {
  const lines = linesOf(grid, selection.cells).map((l) => l.trim());
  const text = lines.join('\n').replace(/^\n+|\n+$/g, '');

  // A selection of nothing but spaces has no letters to make big. Saying so
  // beats an empty diff, which reads as the menu item being broken — the menu
  // closes either way, and a menu that closes having done nothing and said
  // nothing is indistinguishable from one that failed.
  if (text.trim() === '') return refuse('Nothing to set in a font');

  const plan = planBannerAt(
    { x: selection.bounds.x, y: selection.bounds.y },
    text,
    style,
    selection.cells,
  );
  const rows = rowsFor(text, style).length;
  return rows > selection.bounds.h + 2
    ? { ...plan, note: `${String(rows)} rows tall — check what it covers` }
    : plan;
}

/** The cells `text` would occupy if drawn at `origin` in this style. */
function cellsFor(origin: Cell, text: string, style: BannerStyle): Set<CellKey> {
  const out = new Set<CellKey>();
  rowsFor(text, style).forEach((row, dy) => {
    [...row].forEach((chr, dx) => {
      if (chr !== ' ') out.add(ck(origin.x + dx, origin.y + dy));
    });
  });
  return out;
}

/**
 * A banner with its text changed: typing, backspacing, or a new line.
 *
 * Takes the whole new string rather than an edit to apply, because that is the
 * only way the result is guaranteed to be a *renderable* banner — one the reader
 * will recognise again next keystroke. An in-place edit that got the tracking
 * wrong by a column would produce something that no longer parses, and the next
 * key would find no banner to type into.
 *
 * What gets cleared is worked out from the **old text**, not from what happens to
 * be selected. The two differ as soon as there is a second line: a multi-line
 * banner is read back one line at a time — each line is its own band of rows with
 * a blank one between — so the selection covers the line under the pointer while
 * the rendering covers all of them. Clearing only the selection would leave the
 * tail of every other line behind the moment one of them got shorter.
 *
 * A banner edited down to nothing leaves a diff that only erases, which is the
 * honest end state: there is no invisible banner to keep typing into.
 */
export function planBannerEdit(
  origin: Cell,
  style: BannerStyle,
  was: string,
  text: string,
): Plan {
  return planBannerAt(origin, text, style, cellsFor(origin, was, style));
}
