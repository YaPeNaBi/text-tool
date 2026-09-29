/**
 * The actions menu on a selection.
 *
 * Anchored in **cell** coordinates rather than to the pointer, so it sits over
 * the shape it acts on and follows it if the camera moves. That also means the
 * store keeps no pixels: it holds which items are open and which is highlighted,
 * and where the menu goes is worked out here from the selection and the camera —
 * the same two things the renderer uses to draw the selection outline.
 *
 * Opened by a right-click, by `e` in select or by `Ctrl`+`E`, and navigable
 * either way round (B-UI-11). What it offers lives in the store, so that "the
 * item at index 1" means one thing.
 *
 * ── Levels, drawn as rows ─────────────────────────────────────────────────
 *
 * A group opens a second row beneath the first rather than a panel beside it.
 * Rows keep the whole path on screen at once — you can see that you are in
 * *Line end ▸ End 2* without having to remember it — and they leave the shape
 * itself unobscured, which a cascade going sideways would not.
 *
 * The pointer walks them the way the keys do (B-UI-11b): a click opens a group
 * and a second click on it shuts it again, a click on anything in a row above
 * goes back to that row, and a right-click anywhere on the menu backs out one
 * row — the gesture that opened it, undone a step at a time.
 */

import {
  isGroup,
  menuClear,
  menuFor,
  useEditor,
  windowOf,
  type MenuNode,
} from '../state/store.ts';
import { cellToScreenX, cellToScreenY, metricsFor } from '../canvas/camera.ts';

/** Clear of the shape's outline, so the menu never covers what it acts on. */
const GAP = 8;

/** Below this the menu would sit off the top of the canvas, so it flips under. */
const HEADROOM = 48;

/** The rows on screen: the top level, then each group opened from it. */
function rowsFor(items: readonly MenuNode[], path: readonly number[]): readonly MenuNode[][] {
  const rows: MenuNode[][] = [[...items]];
  let level = items;

  for (let i = 0; i < path.length - 1; i++) {
    const step = level[path[i] ?? 0];
    if (step === undefined || !isGroup(step)) break;
    rows.push([...step.items]);
    level = step.items;
  }
  return rows;
}

export function ShapeMenu(): React.JSX.Element | null {
  const open = useEditor((s) => s.menuOpen);
  const selection = useEditor((s) => s.selection);
  const camera = useEditor((s) => s.camera);
  const path = useEditor((s) => s.menuPath);
  const pickMenu = useEditor((s) => s.pickMenu);
  const pointMenu = useEditor((s) => s.pointMenu);
  const leaveMenu = useEditor((s) => s.leaveMenu);

  if (!open || selection === null) return null;

  const items = menuFor(useEditor.getState());
  if (items.length === 0) return null;

  const rows = rowsFor(items, path);
  const m = metricsFor(camera.zoom);
  const { x, y, h } = menuClear(useEditor.getState());
  const top = cellToScreenY(y, camera, m);
  const above = top >= HEADROOM;

  return (
    <div
      className={above ? 'shape-menu above' : 'shape-menu'}
      style={{
        left: Math.max(0, cellToScreenX(x, camera, m)),
        top: above ? top - GAP : top + h * m.cellH + GAP,
      }}
      onPointerLeave={() => pointMenu([])}
      onContextMenu={(ev) => {
        ev.preventDefault();
        leaveMenu();
      }}
    >
      {rows.map((row, depth) => {
        // Only as much of the row as fits beside the shape (B-UI-17). The
        // highlight stays in the middle and the row slides under it, so the
        // arrow keys still move one item per press.
        const shown = windowOf(row, path[depth] ?? 0);
        return (
        <div className="shape-menu-row" key={depth}>
          {shown.before && <span className="more edge" aria-hidden>‹</span>}
          {shown.items.map((item, i) => {
            const at = shown.from + i;
            const here = [...path.slice(0, depth), at];
            const lit = path.length > depth && path[depth] === at;
            // Open: its own row is showing beneath, so a click shuts it.
            const open = lit && path.length > depth + 1;
            return (
              <button
                key={item.label}
                className={lit ? 'here' : undefined}
                aria-current={lit}
                aria-expanded={isGroup(item) ? open : undefined}
                onClick={() => pickMenu(here)}
                onPointerEnter={() => pointMenu(here)}
                title={item.title}
              >
                {item.label}
                {isGroup(item) && <span className="more">{open ? '▾' : '▸'}</span>}
              </button>
            );
          })}
          {shown.after && <span className="more edge" aria-hidden>›</span>}
        </div>
        );
      })}
    </div>
  );
}
