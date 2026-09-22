/**
 * The actions menu on a selection.
 *
 * Anchored in **cell** coordinates rather than to the pointer, so it sits over
 * the shape it acts on and follows it if the camera moves. That also means the
 * store keeps no pixels: it holds which items are open and which is highlighted,
 * and where the menu goes is worked out here from the selection and the camera —
 * the same two things the renderer uses to draw the selection outline.
 *
 * Opened by a right-click or by `Ctrl`+`E`, and navigable either way round: the
 * pointer hovers, the arrow keys step (B-UI-11). What it offers lives in the
 * store, so that "the item at index 1" means one thing.
 *
 * ── Levels, drawn as rows ─────────────────────────────────────────────────
 *
 * A group opens a second row beneath the first rather than a panel beside it.
 * Rows keep the whole path on screen at once — you can see that you are in
 * *Line end ▸ End 2* without having to remember it — and they leave the shape
 * itself unobscured, which a cascade going sideways would not.
 */

import { isGroup, menuFor, useEditor, type MenuNode } from '../state/store.ts';
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
  const closeMenu = useEditor((s) => s.closeMenu);
  const aimMenu = useEditor((s) => s.aimMenu);

  if (!open || selection === null) return null;

  const items = menuFor(useEditor.getState());
  if (items.length === 0) return null;

  const rows = rowsFor(items, path);
  const m = metricsFor(camera.zoom);
  const { x, y, h } = selection.bounds;
  const top = cellToScreenY(y, camera, m);
  const above = top >= HEADROOM;

  // A menu item does two things: the thing, and closing the menu. Doing the
  // second here rather than in each action covers the refusals too, which
  // never reach `apply` and so would otherwise leave the menu hanging.
  const run = (at: readonly number[]) => (): void => {
    const state = useEditor.getState();
    let level: readonly MenuNode[] = menuFor(state);
    let node: MenuNode | undefined;

    for (const step of at) {
      node = level[step];
      if (node === undefined) return;
      if (isGroup(node)) level = node.items;
    }
    if (node === undefined) return;

    // A group opens; only a leaf acts, and only a leaf closes.
    if (isGroup(node)) {
      aimMenu(at);
      return;
    }
    closeMenu();
    node.run(state);
  };

  return (
    <div
      className={above ? 'shape-menu above' : 'shape-menu'}
      style={{
        left: Math.max(0, cellToScreenX(x, camera, m)),
        top: above ? top - GAP : top + h * m.cellH + GAP,
      }}
      onPointerLeave={() => aimMenu([])}
    >
      {rows.map((row, depth) => (
        <div className="shape-menu-row" key={depth}>
          {row.map((item, at) => {
            const here = [...path.slice(0, depth), at];
            const lit = path.length > depth && path[depth] === at;
            return (
              <button
                key={item.label}
                className={lit ? 'here' : undefined}
                aria-current={lit}
                onClick={run(here)}
                onPointerEnter={() => aimMenu(here)}
                title={item.title}
              >
                {item.label}
                {isGroup(item) && <span className="more">▸</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
