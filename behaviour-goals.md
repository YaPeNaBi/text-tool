# Behaviour Goals

Precise definition of how the editor behaves. Every behaviour has a stable ID (`B-<AREA>-<n>`) so tests and commits can cite it.

**Status tags**
- `[v0]` — implemented in the current build
- `[next]` — next milestone, specified but not built
- `[planned]` — specified, scheduled later
- `[open]` — behaviour deliberately undecided, listed so it isn't decided by accident

Where a behaviour says **MUST**, it is an invariant and should have a test. **SHOULD** is a strong default that may be overridden by a setting.

Each section names the files that implement it and the tests that pin it, so a
behaviour ID leads straight to code.

---

## 1. Coordinate plane

**Implemented in:** [core/geom/cell.ts](src/core/geom/cell.ts) · [app/canvas/camera.ts](src/app/canvas/camera.ts)
**Pinned by:** [e2e/editor.spec.ts](e2e/editor.spec.ts) (B-PLANE-04)

| ID | Status | Behaviour |
|---|---|---|
| B-PLANE-01 | `[v0]` | The plane is a **quadrant**: the only valid cells are `x ≥ 0, y ≥ 0`. `(0,0)` is the **top-left** corner, as in a spreadsheet. |
| B-PLANE-02 | `[v0]` | `x` increases rightward, `y` increases downward. Both are integers. |
| B-PLANE-03 | `[v0]` | The plane is **unbounded** to the right and downward. There is no maximum column or row. |
| B-PLANE-04 | `[v0]` | No operation may produce a cell with a negative coordinate. Moves and nudges that would cross an edge MUST clamp at `0` rather than being rejected — the shape slides along the boundary instead of refusing to move. |
| B-PLANE-05 | `[v0]` | Origin mode is a document-level setting with values `quadrant` (default) and `infinite`. Only `quadrant` is reachable from the UI in v0. |
| B-PLANE-06 | `[planned]` | `infinite` mode permits negative coordinates in all four directions, with no clamping. Everything else behaves identically. |

## 2. Camera & navigation

**Implemented in:** [app/canvas/camera.ts](src/app/canvas/camera.ts) · [app/canvas/CanvasView.tsx](src/app/canvas/CanvasView.tsx) (wheel and key handling) · [app/canvas/renderer.ts](src/app/canvas/renderer.ts) (B-CAM-06)

| ID | Status | Behaviour |
|---|---|---|
| B-CAM-01 | `[v0]` | The camera origin is expressed in cells and MUST NOT go below `(0,0)` in quadrant mode. Scrolling up or left stops at the origin. |
| B-CAM-02 | `[v0]` | Wheel scrolls vertically; a trackpad's own horizontal delta is passed through unchanged. `Ctrl`+wheel scrolls **horizontally** — a diagram runs off the right-hand edge far more often than it wants resizing, so the commoner want takes the commoner modifier. |
| B-CAM-03 | `[v0]` | `Shift`+wheel zooms, clamped to `0.5×`–`3.0×`, anchored on the pointer so the cell under the cursor stays put. `Ctrl`+wheel is intercepted whatever it is bound to, so the browser's own zoom never fires over the canvas. |
| B-CAM-04 | `[v0]` | Holding `Space` switches to pan; dragging then moves the camera. Middle-mouse drag pans without `Space`. |
| B-CAM-05 | `[v0]` | Cell size derives from **runtime-measured** font metrics, never hardcoded, so the grid stays correct across platforms and font stacks. |
| B-CAM-06 | `[v0]` | The renderer only iterates cells inside the viewport. Document size MUST NOT affect frame cost. |
| B-CAM-07 | `[v0]` | `Ctrl`+`0` resets zoom to 100%; `Ctrl`+`Home` returns the camera to the origin. |

## 3. Document & cells

**Implemented in:** [core/grid/grid.ts](src/core/grid/grid.ts) · [app/state/store.ts](src/app/state/store.ts) (the single `apply`)
**Enforced by:** [eslint.config.js](eslint.config.js) — boundary 2 forbids `applyDiff` outside the store (B-DOC-04)
**Pinned by:** [tests/stamp.test.ts](tests/stamp.test.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-DOC-01 | `[v0]` | The document is a sparse map from cell coordinate to a **single character**. Nothing else is stored per cell. |
| B-DOC-02 | `[v0]` | An absent key and a space character are equivalent for rendering, but writing a space MUST delete the key rather than store it, so the map never accumulates blanks. |
| B-DOC-03 | `[v0]` | Every mutation is a `CellDiff` — a map from key to a character or `null` (erase). |
| B-DOC-04 | `[v0]` | All mutations MUST pass through the single store method `apply(diff)`. No component may write to the grid directly. This is enforced by lint. |
| B-DOC-05 | `[v0]` | `apply` returns the inverse diff, which is what the history stack stores. Undo is therefore exact by construction. |
| B-DOC-06 | `[v0]` | The document holds no shape objects, no ids, and no z-order. Structure is recovered by recognition (§6), never stored. |

## 4. Character sets

**Implemented in:** [core/charset/charsets.ts](src/core/charset/charsets.ts) (the tables) · [core/transform/convert.ts](src/core/transform/convert.ts) (the document-wide switch)
**Pinned by:** [tests/shapes.test.ts](tests/shapes.test.ts) · [tests/stamp.test.ts](tests/stamp.test.ts) · [e2e/editor.spec.ts](e2e/editor.spec.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-CS-01 | `[v0]` | Two charsets ship: `unicode` (`─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`) and `ascii` (`- | +`). **`unicode` is the default.** |
| B-CS-01a | `[v0]` | Each charset also declares its four arrowheads: `▲ ▶ ▼ ◀` for `unicode`, `^ > v <` for `ascii`. |
| B-CS-02 | `[v0]` | The active charset determines glyphs for **newly drawn** cells only. |
| B-CS-03 | `[v0]` | Switching charset converts the whole document as a single undoable command. |
| B-CS-04 | `[v0]` | Conversion MUST be lossless for line cells: connectivity is derived from each glyph and its neighbours, then re-emitted in the target charset. Unicode→ASCII→Unicode MUST be an identity round-trip on line cells. |
| B-CS-04a | `[v0]` | Arrowheads convert too, keeping the direction they point. A `v` that is only a letter (B-CONN-07) MUST NOT be converted. |
| B-CS-05 | `[v0]` | Conversion MUST NOT touch text cells. |
| B-CS-06 | `[v0]` | Five packs ship: `unicode`, `rounded` (`╭ ╮ ╰ ╯`), `heavy` (`┏ ┓ ┗ ┛ ━ ┃`), `double` (`╔ ╗ ╚ ╝ ═ ║`) and `ascii`. Each is one table, and every pair round-trips losslessly. |

### 4.1 Connectivity derivation

**Implemented in:** [core/charset/charsets.ts](src/core/charset/charsets.ts) (`DECLARED`, `ARROWS`) · [core/grid/grid.ts](src/core/grid/grid.ts) (`maskOf`, `connected`)

| ID | Status | Behaviour |
|---|---|---|
| B-CONN-01 | `[v0]` | Connectivity is **never stored**. It is derived on demand from a glyph plus its four neighbours. |
| B-CONN-02 | `[v0]` | Each known line glyph declares which of N/E/S/W it can connect to. `─` is E\|W, `┌` is S\|E, and so on. |
| B-CONN-03 | `[v0]` | Two adjacent cells are connected only if **both** declare a connection toward each other. A `─` sitting beside a `│` is not connected. |
| B-CONN-04 | `[v0]` | Ambiguous glyphs (`+`, `┼`) declare all four directions, then narrow to the directions where a neighbour actually connects back. This is what lets ASCII art be understood without stored metadata. |
| B-CONN-05 | `[v0]` | If an ambiguous glyph has no connecting neighbours, it falls back to its declared mask rather than vanishing. |
| B-CONN-06 | `[v0]` | Unknown glyphs are **text**: connectivity `0`. They are never traced through. |
| B-CONN-07 | `[v0]` | Arrowheads are **weak** glyphs. An arrowhead connects backwards toward its shaft, and *only* when a line glyph is really there pointing back at it. With nothing behind it, an arrowhead is text — which is what stops the `v` in "level" from being read as part of a diagram. |

## 5. Drawing

Every tool is a pure `parameters → CellDiff` function in `src/core/stamp/`; the
gesture that feeds it lives in `CanvasView.tsx`.

| Tool | Stamper | Gesture |
|---|---|---|
| Box | [stamp/box.ts](src/core/stamp/box.ts) | `CanvasView.tsx` drag kind `box` |
| Circle | [stamp/ellipse.ts](src/core/stamp/ellipse.ts) | drag kind `circle` |
| Line / arrow | [stamp/path.ts](src/core/stamp/path.ts) | drag kind `path`, or the `chain` in [store.ts](src/app/state/store.ts) |
| Eraser | [stamp/erase.ts](src/core/stamp/erase.ts) | drag kind `erase` |
| Text | [stamp/text.ts](src/core/stamp/text.ts) | caret in [store.ts](src/app/state/store.ts) |

**Pinned by:** [tests/stamp.test.ts](tests/stamp.test.ts) · [tests/tools.test.ts](tests/tools.test.ts) · [tests/shapes.test.ts](tests/shapes.test.ts) · [e2e/editor.spec.ts](e2e/editor.spec.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-DRAW-01 | `[v0]` | The box tool draws on drag: press anchors one corner, drag sizes the rectangle, release commits. |
| B-DRAW-02 | `[v0]` | Drawing direction is free — any corner may be the anchor. |
| B-DRAW-03 | `[v0]` | Minimum box size is 2×2. A drag smaller than that commits nothing. |
| B-DRAW-04 | `[v0]` | While dragging, the rectangle is a **preview overlay**. The document is untouched until release, so one drag is exactly one undo step. |
| B-DRAW-05 | `[v0]` | `Escape` during a drag cancels it and leaves the document unchanged. |
| B-DRAW-06 | `[v0]` | Only the border is drawn. The interior is never filled or cleared — content inside a new box survives. |
| B-DRAW-07 | `[v0]` | When a stamped cell lands on an existing line cell, the two connectivities are **merged**, not overwritten. A vertical line crossing a horizontal one yields `┼`, and a box edge meeting an existing line yields the correct `├ ┤ ┬ ┴`. |
| B-DRAW-08 | `[v0]` | Merging also considers line cells **adjacent to** the stamp, so a box drawn against an existing line connects to it. |
| B-DRAW-09 | `[v0]` | Stamping over a **text** cell overwrites it. Text does not merge. |
| B-DRAW-10 | `[v0]` | Line and arrow tools, drawn as orthogonal paths with at most one elbow, obeying the same merge rules. The elbow follows the longer axis by default; holding `Alt` during the drag takes the other one. |
| B-DRAW-10a | `[v0]` | An arrowhead aimed at a cell that already holds a line glyph stops **one cell short** rather than overwriting it, so an arrow drawn into a box points at the border instead of punching a hole in it. |
| B-DRAW-10b | `[v0]` | An arrowhead is written verbatim and does **not** merge with what was under it. Everything else on the path merges per B-DRAW-07. |
| B-DRAW-11 | `[v0]` | Text tool: click places a caret, typing writes cells, `Enter` returns to the caret's start column one row down. `Backspace` steps back and erases, `Tab` moves four cells right, arrow keys move the caret, `Escape` dismisses it. |
| B-DRAW-11a | `[v0]` | Typing has two modes, toggled with `Insert` and shown in the status bar. **Overwrite** (default) replaces the cell under the caret. **Insert** shifts the contiguous run of occupied cells to the right of the caret one cell further right, stopping at the first blank — so typing inside a box never pushes its border along. |
| B-DRAW-11b | `[v0]` | A continuous run of typing is **one** undo step. Moving the caret, changing tool, or any other mutation closes the run. |
| B-DRAW-12 | `[v0]` | Eraser tool, with a draggable square brush sized 1–9 by `[` and `]`. One drag is one undo step. |
| B-DRAW-12a | `[v0]` | Erasing **mends** the line cells that bordered what it removed: an arm that no longer leads anywhere is dropped, so a `┬` whose stem is gone becomes `─`. A cell that would be left with no connectivity at all keeps its glyph rather than disappearing, so a deliberate stub survives. |
| B-DRAW-13 | `[v0]` | Circle tool: drag draws the ellipse inscribed in the dragged rectangle, obeying the same merge rules. Minimum size 3×3; below 5×5 there is no room to curve and it comes out rectangular. |
| B-DRAW-14 | `[v0]` | **Lines are drawn corner by corner.** A click starts one; each further click places a corner and the line continues from there. `Enter`, a right-click, or switching tool confirms it; `Escape` abandons it. The whole run is stamped as one diff, so it is one undo step. |
| B-DRAW-14a | `[v0]` | Clicking the last corner again confirms, rather than adding a zero-length segment. |
| B-DRAW-14b | `[v0]` | Dragging still draws a single segment in one gesture, which is quicker when that is all you want. |
| B-DRAW-14c | `[v0]` | A run that crosses itself yields a junction glyph at the crossing. Connectivity is accumulated per cell, not per step, so the two passes agree instead of overwriting one another. |
| B-DRAW-14d | `[v0]` | **A chain is aimed by the input that is drawing it**, not by whichever one is over the canvas. Started with `Space`, its unplaced last leg follows the **arrow keys** and a pointer merely resting on the grid does not move it; started with a click, it follows the pointer. The chain changes hands only when the other input places a corner — a click, or a `Space` — which is the same line the editor already draws between a pointer *press* (abandons a keyboard draft) and a hover (does nothing). |
| B-DRAW-14e | `[v0]` | `Enter` on a chain the **keyboard** is aiming commits **through the cursor**, so the line drawn is the line previewed and `Space`-arrows-`Enter` is a complete gesture. It does not do so for a chain the **pointer** is aiming: the mouse rests wherever the hand left it, which is no statement about the drawing, so there a corner is placed by clicking. A cursor already sitting on the last placed corner adds nothing, so placing the end with `Space` first still behaves exactly as it did. |
| B-DRAW-13a | `[v0]` | The circle outline MUST be a **single 4-connected ring**. Keeping the boundary of the filled ellipse would step diagonally at the shoulders, which on a grid is not connected — it would look broken and could never be traced as one shape. The ring is therefore built as a closed rectilinear path: the horizontal step between two rows belongs to the wider row, and every row also owns its own left and right edge cell. |
| B-DRAW-15 | `[v0]` | **A box can be drawn in one gesture from the keyboard.** Under the box tool, holding `Shift` and pressing an arrow pins the corner the cursor is on and stretches the box from it; releasing `Shift` commits it. `Escape`, or picking another tool, abandons it. This does not replace B-DRAW-15a — it is the version that needs no decision to start, the keyboard's answer to press-drag-release. |
| B-DRAW-15a | `[v0]` | `Space` starts a box or circle at the cursor and `Enter` commits it; the arrow keys size either. A draft begun this way is owed an `Enter` and is **not** ended by a `Shift` release, so the two gestures never finish each other's work. |
| B-DRAW-15b | `[v0]` | Switching tool abandons a draft rather than confirming it — the opposite of B-DRAW-14, because a chain is corners already committed to one press at a time while a draft is one rectangle that exists only while it is aimed. |
| B-DRAW-16 | `[v0]` | **Freehand.** `Ctrl`+`Q`, or the button in the line tool's band. A drag records the **cells the pointer was in** — sampled per cell, since two events inside one cell are one place — and the gaps between samples are filled so a fast drag is a line rather than dots. The grid is 4-connected, so a diagonal becomes a staircase, each step spent on the axis with further to go. The walk is then stamped like any polyline: connectivity accumulates per cell, so a stroke that crosses itself gets a `┼` (B-DRAW-14c) and a stroke drawn into a box joins it. One stroke is one undo step. |

## 6. Recognition

The core of the product. Pure function: `recognize(grid, seed) → Candidate`.

| Stage | File |
|---|---|
| ① trace — connected component | [recognize/trace.ts](src/core/recognize/trace.ts) |
| ② segmentize — run graph | [recognize/segmentize.ts](src/core/recognize/segmentize.ts) |
| ③ match — box, ellipse, path, arrow, text, fallback | [recognize/recognize.ts](src/core/recognize/recognize.ts) |
| ④ rank — every reading, ordered, for drill-through | [recognize/rank.ts](src/core/recognize/rank.ts) |

Each matcher is the mirror of a stamper: `matchEllipse` asks whether the cells are
exactly what [stamp/ellipse.ts](src/core/stamp/ellipse.ts) would draw for the same
bounds, which is what keeps the pair honest about each other.

**Pinned by:** [tests/recognize.test.ts](tests/recognize.test.ts) · [tests/shapes.test.ts](tests/shapes.test.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-REC-01 | `[v0]` | Recognition is a **pure function** of the grid and a seed cell. No state, no DOM, no dependence on how the content was created. |
| B-REC-02 | `[v0]` | Recognition MUST behave identically for content that was drawn, pasted, or loaded from a file. There is no privileged provenance. |
| B-REC-03 | `[v0]` | **Trace:** breadth-first walk from the seed across connected line cells (per B-CONN-03), producing one connected component. |
| B-REC-04 | `[v0]` | Tracing is capped at 20 000 cells. Beyond the cap it degrades to a plain cell-set selection rather than hanging. |
| B-REC-05 | `[v0]` | **Box matcher:** a component whose cells are exactly the perimeter of their own bounding box, at least 2×2, is a box. Exactly — no missing cells, no cells off the perimeter. |
| B-REC-06 | `[v0]` | **Fallback:** any component that matches nothing is selected as a raw cell set. Recognition never fails and never returns nothing for a non-empty cell. |
| B-REC-07 | `[v0]` | Seeding on an **empty** cell yields no selection. Seeding on a text cell selects its text run (B-REC-08a). *Changed from v0's original wording, which returned nothing for text.* |
| B-REC-08 | `[v0]` | **Polyline** and **arrow** matchers: a component that never branches and has exactly two loose ends is a path. An arrowhead on either end makes it an arrow rather than a line. A component with a junction, or a closed loop that is not a rectangle, falls back to a cell set. |
| B-REC-08a | `[v0]` | **Text matcher:** the run of ordinary characters around the seed, on one row, bounded by blanks or by anything belonging to a line. |
| B-REC-09 | `[v0]` | **Run-graph decomposition** before matching — nodes at endpoints/corners/junctions, edges as straight runs — so matchers see tens of elements rather than thousands of cells. |
| B-REC-10 | `[v0]` | **Candidate ranking:** every closed outline through the seed — rectangle *or* ellipse — plus the strand through it, ordered most specific first, then smallest. The whole component is always last, so it is the widest reading. |
| B-REC-10a | `[v0]` | An outline only counts when the component genuinely *draws* it: every cell present **and** connected along it. Presence alone is far too generous — a circle crossing a box leaves a character at every position of some smaller rectangle, and a `┘` cannot serve as the middle of a left edge because it has no southward arm. |
| B-REC-10b | `[v0]` | A closed shape outranks an open one **regardless of size**. Two boxes sharing an edge contain a U-shaped strand one cell smaller than the left box, and answering a click on a box with a line would be obtuse. |
| B-REC-10c | `[v0]` | **Strand:** how far the run graph can be walked from the seed without passing *through* a junction. This is what makes a line that has merged into a box selectable on its own. Junction cells are included as its endpoints. |
| B-REC-11 | `[v0]` | **Drill-through:** a fresh click selects the **most specific** reading — clicking a box selects that box. Clicking the same cell again widens: enclosing shape, then whole component, wrapping round. The status bar shows the depth as `n/total`. Dragging still moves or resizes; only a click that does not move drills, including a click that lands on a resize handle. |
| B-REC-12 | `[v0]` | Nested and edge-sharing shapes MUST each be reachable through drill-through — boxes, circles, and lines alike, not only rectangles. |
| B-REC-13 | `[planned]` | Interior text is attached to a recognised closed shape and moves with it. |
| B-REC-14 | `[v0]` | **Ellipse matcher:** a component is an ellipse when it is exactly the ring the circle stamper would draw for its own bounding box. |
| B-REC-15 | `[v0]` | Ranking is bounded: at most 24 candidate edges per axis, 20 000 rectangles tested, and 8 candidates returned. Hitting a cap MUST degrade to fewer readings, never to a hang. |
| B-REC-16 | `[open]` | Whether a line *touching* a box is offered as part of the box candidate, or only ever as a separate one. |

## 7. Selection

**Implemented in:** [app/state/store.ts](src/app/state/store.ts) (`selectAt`, `drillAt`, `toggleAt`, and the `drill` session field) · [app/canvas/CanvasView.tsx](src/app/canvas/CanvasView.tsx) (which press means what)
**Pinned by:** [e2e/editor.spec.ts](e2e/editor.spec.ts) · [tests/shapes.test.ts](tests/shapes.test.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-SEL-01 | `[v0]` | Clicking a line cell with the select tool selects its recognised shape. |
| B-SEL-02 | `[v0]` | Clicking empty space clears the selection. |
| B-SEL-03 | `[v0]` | Dragging from empty space draws a **marquee**; on release, every non-empty cell intersecting it becomes a cell-set selection. |
| B-SEL-04 | `[v0]` | A selection is a set of cell keys plus a bounding box plus its recognised kind. It holds no reference to document state. |
| B-SEL-05 | `[v0]` | Selection lives in session state, never in the document. Undo MUST NOT restore a past selection, and selection MUST NOT be saved or (later) synced. |
| B-SEL-06 | `[v0]` | Once selected, the interpretation is **sticky** — pinned for the whole interaction. Recognition never re-runs mid-drag. |
| B-SEL-06a | `[v0]` | Stickiness is for the **drag**. A press that goes nowhere is a click, and reads the cell again: on the cell the last click answered for it steps outward (B-REC-11), and anywhere else inside a selection it did not itself make it starts fresh — which is what lets a click narrow a whole diagram down to the one line under the pointer. A press that *did* just select must not also drill, or every single click would land one reading past the one it asked for. |
| B-SEL-07 | `[v0]` | Any mutation other than moving the selection itself clears the selection. |
| B-SEL-08 | `[v0]` | `Escape` clears the selection. |
| B-SEL-19 | `[v0]` | **`Enter` switches between the smallest shape under the keyboard and the whole one** — a table cell and its table, one of two flush boxes and the pair. It stops at the *shape*: the widest reading that still encloses an area, never the whole connected component. A connector and the box on the far end of it are a different question. |
| B-SEL-19a | `[v0]` | **`Ctrl`+`Enter` takes everything joined up** — the shape, the lines running out of it, and whatever those run into. One press, not a ladder: there is only one answer to "all of it". |
| B-SEL-19b | `[v0]` | The rung is **read back off the current selection**, never stored, so anything that changes the selection another way starts again from the smallest. Where the smallest and the whole shape are the same cells — a shape touching nothing — the ladder is one rung and `Enter` settles rather than flickering. |
| B-SEL-19c | `[v0]` | Neither touches the document. `Delete` remains the key that erases. Both are under `select` only, that being the one tool that holds a selection. |
| B-SEL-19d | `[v0]` | `Ctrl`+`Enter` grows from **what is already selected** when there is a selection, so it reads as "and everything this touches". With nothing selected and nothing under the keyboard — which is exactly where clicking a table cell leaves you, the inside of a cell being blank — it takes the shape the cursor is standing **inside**. |
| B-SEL-20 | `[v0]` | **`Shift`+arrow adds cells to what is already selected.** With a selection and no sweep running, the rectangle carries on from the selection instead of starting afresh at the cursor: the anchor goes to the corner behind the direction of travel and the cursor to the one ahead, so it stays an ordinary sweep and pressing back the other way still shrinks it. Only while the keyboard is still standing **inside** the selection — a bare arrow walks out of it (B-SEL-16) and gives up that right. |
| B-SEL-09 | `[v0]` | `Shift`+click adds the shape under the pointer to the selection, or removes it when every one of its cells is already selected. A combined selection is a cell set. |
| B-SEL-09a | `[v0]` | `Shift`+click takes the whole **component**; `Ctrl`+click (or `Cmd`) takes only the **piece** under the pointer — the reading a plain click would take. Both add to the selection, and both drop what is already wholly in it. The piece form is what makes a selection buildable out of parts: once anything is wired to anything, the whole-component answer hands back the same blob from every cell. |
| B-SEL-10 | `[v0]` | `Ctrl`+`A` selects everything. |
| B-SEL-11 | `[v0]` | **The select tool does not write.** *Rescinded.* It used to: a printable key typed at the keyboard cursor and left a caret behind, which made select and text one tool. That cost every plain letter on the keyboard, which is why tools lived on `Ctrl`+digit — a shortcut nobody can guess. Select is now a **mode** (B-KEY-21) and the letters are how you leave it. Clicking a run of text takes the **whole block** and leaves no caret; `t` opens it for editing, at the character clicked, because every press moves the cursor. |
| B-SEL-12 | `[v0]` | **A caret exists under `text` and nowhere else.** It used to survive the crossing between `select` and `text`, which made sense while select also wrote; a bar under select would now be claiming a keystroke it will not get. What *does* cross is a **text selection**: carried into `text` so that "click the word, press `t`, type" still writes between the characters rather than over them (`typeAt` reads the selection to decide). Any other selection is dropped, as before. |
| B-SEL-17 | `[v0]` | `Tab` crosses **into an empty shape** as well as one with a label: with nothing written to select, the caret goes to the first interior cell and typing makes the label. The selection is dropped on the way in, so that `Tab` back out has something to mean — the caret's own container is the way back. A shape with no interior at all (2 wide or 2 tall) is left alone. `toggleLabel` answers whether it crossed, so `Tab` on loose text still indents. |
| B-SEL-17a | `[v0]` | **`Tab` carries the mode across with it** (B-KEY-21). Crossing *into* the label lands a caret, and a caret means `text`; crossing back out to the shape means `select`. `Tab` is therefore one of the two ways into writing, on a par with `t` — which is right, because "write in this box" is exactly what it is for. Leaving it in `select` with a live caret would reintroduce the one state B-KEY-21 exists to remove. |
| B-SEL-14 | `[v0]` | **Object select.** Two taps of `Shift` on its own take the **smallest** object under the keyboard cursor and put the arrow keys into object select. Smallest because growing is the only gesture there is — landing on the table when the cell was meant leaves nowhere to go. Ties break in reading order, top before left. A tap is a press that nothing else happened during, decided on the key **up**: `Shift`+arrow fires a Shift keydown exactly as a tap does, so reading taps on the way down would make every second sweep re-enter the mode. |
| B-SEL-15 | `[v0]` | In object select, `Shift`+arrow **pushes the selection's region one cell** — `1 × height` sideways, `width × 1` up or down — and swallows **whole** every object that region now touches, repeating until the region stops growing. The region is kept rather than re-derived from the cells, which is what lets it reach across an air gap: it grows into empty space holding its height until it finally touches something, then takes all of it. A selection edge therefore never lands halfway through a box. |
| B-SEL-16 | `[v0]` | Object select is **not shown**. It is left by anything that picks a selection another way — a bare arrow, a click, `Escape`, a tool change — so it never outlives the run of keys that asked for it. |
| B-SEL-13 | `[v0]` | **Settled: the text tool is the writing mode.** It was listed `[open]` while it was a strict subset of select, kept only because a modal "I am writing" might be worth something to someone. B-KEY-21 answers the question the other way round — writing is *only* reachable through it, and it is select that no longer overlaps. |

## 8. Manipulation

**Implemented in:** [core/transform/move.ts](src/core/transform/move.ts) · [core/transform/resize.ts](src/core/transform/resize.ts) · [core/route/connectors.ts](src/core/route/connectors.ts) (B-MAN-11) · [app/state/store.ts](src/app/state/store.ts)
**Pinned by:** [tests/tools.test.ts](tests/tools.test.ts) · [tests/connectors.test.ts](tests/connectors.test.ts) · [e2e/editor.spec.ts](e2e/editor.spec.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-MAN-01 | `[v0]` | Dragging inside a selection moves it. The pointer's cell offset drives the move, so the grab point stays under the cursor. |
| B-MAN-02 | `[v0]` | While moving, the result is a preview overlay computed from the **unmodified** document. The document is written once, on release. |
| B-MAN-03 | `[v0]` | **Occlusion is gesture-scoped.** Because every frame recomputes from the original document, dragging a shape across other content and back leaves that content intact. Only the final resting position overwrites anything. |
| B-MAN-04 | `[v0]` | Overwriting at the final position is permanent and not recoverable except by undo. The grid has no memory of what sat underneath. This is an accepted consequence of the character-grid model. |
| B-MAN-05 | `[v0]` | A move is one undo step. |
| B-MAN-06 | `[v0]` | Moved cells keep their glyphs verbatim; a move does not re-run junction merging at the destination — **except** where B-MAN-13 applies. |
| B-MAN-13 | `[v0]` | **Detaching neighbours.** Cells a moving shape shares with a neighbouring closed shape MUST stay behind and be re-derived for whoever is left, and the mover MUST be redrawn at its destination rather than carried glyph for glyph. Two boxes drawn edge-to-edge therefore come apart as two whole boxes rather than one torn one (sticky §7.2). The shared column belongs to both shapes and to neither, so carrying it away leaves a hole and leaving it behind lands an open shape; only doing both is correct. |
| B-MAN-14 | `[v0]` | Moving a shape carries everything **wholly inside** its bounds, at any depth, as one undo step — child shapes, their labels, and its own (nesting §2, content §2). Anything crossing the boundary is a connector and is re-routed instead. The cascade runs downward only: a child never drags its parent. |
| B-MAN-15 | `[v0]` | **A side dragged away from its shape resizes it**, rather than being carried off as cells. Selecting a box's right wall alone and moving it two cells right used to leave the top and bottom runs the length they were — every character of which is what "move these cells" means, and none of which is what dragging the side of a box is for. A side is where a shape *ends*, so moving it goes through `planResize`: the border is redrawn, the contents are refused if they would be crushed, the label keeps its placement and the connectors follow. **Tables come free**, because `resizeBoxDiff` replaces only the outline — the dividers stay put and the track against the wall you dragged is the one that changes width, which is the answer dragging its separator gives, reached from the other side. The selection MUST be the **whole** edge and nothing else: half a wall is a piece of a drawing being rearranged on purpose, and turning that into a resize would take away the only way to do it. The plan hands back **the side**, where the side now is, rather than the shape it resized — so the pull can be repeated straight away, by pointer or by arrow key, out and back in again. Handing back the shape (which is right for a resize handle) would leave the box selected, and the second pull would move it instead. |
| B-MAN-15a | `[v0]` | Only a **shape** has sides. An open path has no sides, just a bounding box that one of its runs may happen to lie along the edge of — a U-shaped connector between two boxes has its bottom run spanning the full width of its own bounds, which read as a south edge and "resized" the wire into a rectangle, welding a phantom top edge across both boxes. The candidate must enclose an area before any of its edges count. |
| B-TBL-05 | `[v0]` | **Adding a row pushes what is under it down.** Everything strictly below the box's bottom wall moves down by exactly what the box gains, so the box grows into the ground it vacates and whatever stood under it keeps its distance and its alignment. A connector hanging from that wall is carried by the push rather than re-routed — it has already moved correctly, and doing both would be two answers fighting. The extent is reported (tables §13). Adding a **column** does not push: it reaches sideways into empty space. Cells are moved, not whole objects, so a shape straddling the wall would have its lower half taken — which is why the wall is the box's own edge and not an arbitrary line. |
| B-MAN-07 | `[v0]` | Arrow keys nudge the selection by one cell, clamped per B-PLANE-04. Each nudge is its own undo step. |
| B-MAN-08 | `[v0]` | `Delete` / `Backspace` erases the selected cells and clears the selection. |
| B-MAN-09 | `[v0]` | Resize handles on recognised **closed outlines** — boxes and circles — at the four corners and the four edge midpoints, as cells. The border is **redrawn** at the new size, not scaled, using the same stamper that drew it. A corner moves both its edges; an edge midpoint moves one. Size is clamped to 2×2 and to the quadrant. A grab point resizes; anywhere else on the shape moves. An edge shorter than 5 gives up its midpoint, and a 2-wide or 2-tall shape has no handles at all, so every shape always has somewhere to grab in order to move it. |
| B-MAN-10 | `[v0]` | `Ctrl`+`D` duplicates the selection, offset by one cell down and right, and selects the copy. |
| B-MAN-11 | `[v0]` | **Sticky connectors:** on move, lines attached to the moved shape are re-routed orthogonally to follow it. The re-route is part of the *same* diff as the move, so one gesture is still one undo step. Toggled by `Sticky` in the toolbar. |
| B-MAN-11a | `[v0]` | A line is **attached** when it runs into the shape — its own connectivity heads that way — or when an arrowhead is aimed at it. Mutual connection is not required: a line drawn up to a `│` only touches it, because that border offers no sideways arm. |
| B-MAN-11b | `[v0]` | A connector MUST meet the shape at exactly one cell, and MUST be a simple path. Anything touching twice is a neighbour leaning on it — two boxes sharing an edge read as an open path once the shared column is excluded — and re-routing that would destroy something the user never selected. |
| B-MAN-11c | `[v0]` | The **far end does not move**. It is re-routed *from* there, which is what distinguishes this from translating the line. |
| B-MAN-11d | `[v0]` | When both ends are anchored, the route is a **Z**: one elbow cannot leave one shape sideways and arrive at the other sideways, so the line steps across in the middle. With only one end anchored, an L is enough, oriented so the arrival direction is preserved and an arrowhead still points at what it pointed at. |
| B-MAN-11e | `[v0]` | At most 12 connectors per shape. Beyond that, re-routing stops helping. |
| B-MAN-11f | `[v0]` | **Only a shape or a run of text carries connectors.** Cells made of line glyphs that enclose nothing — a run swept out of the middle of a line — have none, because what continues at either end is not attached to what was picked up: it is *the rest of the same line*. Re-routing it re-anchored one half onto whatever the other half happened to touch, and left `┴` junctions where a new run crossed one it had abandoned, one more with every drag. Text is included because it has no connectivity of its own, so an arrow aimed at a word is a real attachment and still follows it. |
| B-MAN-12 | `[v0]` | Resizing a shape re-routes its connectors too, on the same terms as a move. |

## 9. History

**Implemented in:** [core/history/history.ts](src/core/history/history.ts) · recorded from [app/state/store.ts](src/app/state/store.ts)`.apply`
**Pinned by:** [tests/tools.test.ts](tests/tools.test.ts) · [e2e/editor.spec.ts](e2e/editor.spec.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-HIST-01 | `[v0]` | Undo and redo operate on `CellDiff`s. Applying a diff returns its inverse, so history needs no per-command undo logic. |
| B-HIST-02 | `[v0]` | One user gesture — one drag, one nudge, one charset switch, one run of typing — is exactly one history entry. Consecutive mutations sharing a run id are folded into the entry that describes the state before the whole run. |
| B-HIST-03 | `[v0]` | `Ctrl`+`Z` undoes; `Ctrl`+`Y` and `Ctrl`+`Shift`+`Z` redo. |
| B-HIST-04 | `[v0]` | Any new mutation clears the redo stack. |
| B-HIST-05 | `[v0]` | History MUST NOT capture camera, tool, charset selection, or selection state. |
| B-HIST-06 | `[v0]` | History depth is capped at 200 entries. |

## 10. Text output

**Implemented in:** [core/io/text.ts](src/core/io/text.ts) (`toText`) · [core/stamp/text.ts](src/core/stamp/text.ts) (`pasteDiff`) · clipboard via [platform/](src/platform)
**Pinned by:** [tests/tools.test.ts](tests/tools.test.ts) · [tests/stamp.test.ts](tests/stamp.test.ts)

| ID | Status | Behaviour |
|---|---|---|
| B-TXT-01 | `[v0]` | `toText()` trims to the content's bounding box, joins rows with `\n`, and right-trims each row. Empty documents yield an empty string. |
| B-TXT-02 | `[v0]` | Export is exact: what is on the grid is what is emitted. There is no separate render pass that could diverge. |
| B-TXT-03 | `[v0]` | The toolbar copies as text; `Ctrl`+`C` copies, and `Ctrl`+`Shift`+`C` forces the whole document even when something is selected. |
| B-TXT-04 | `[v0]` | `Ctrl`+`V` imports text one character per cell, tabs expanded to spaces, and selects what landed. Import is always lossless and never fails; understanding the content is left to recognition. It lands at the caret, else under the pointer, else at the viewport's top-left cell. *The last two are a refinement of the original "or at the origin", which put content off-screen whenever the view was scrolled.* |
| B-TXT-05 | `[v0]` | Copying with an active selection copies **what is selected**, cropped to it and masked to it. A rectangle is the wrong unit: a line bent round a corner has a bounding box full of other people's characters, and handing those over would copy things the user never picked. The set is the one a **move** carries, so a box brings its label and its children exactly as dragging it would — "what is this thing" must not have two different answers. `Ctrl`+`Shift`+`C` copies the whole document regardless. |
| B-TXT-06 | `[v0]` | `.txt` is the native save format. No sidecar, no metadata, no hidden state. |
| B-TXT-07 | `[v0]` | A clipboard operation the browser refuses MUST report that in the status area rather than failing silently. Firefox and Safari deny programmatic clipboard reads. |

## 10.1 Files

Everything here goes through one `PlatformAdapter`; no other module may touch a
file, a dialog or the clipboard.

**Interface:** [platform/adapter.ts](src/platform/adapter.ts)
**Implementations:** [platform/web/](src/platform/web) (File System Access, download fallback) · [platform/desktop/](src/platform/desktop) (Tauri)
**Chosen at startup by:** [platform/index.ts](src/platform/index.ts)
**Commands:** `openDocument`, `saveDocument`, `copyDocument`, `pasteDocument` in [app/state/store.ts](src/app/state/store.ts)
**Enforced by:** [eslint.config.js](eslint.config.js) — boundary 3 forbids the app from importing a concrete implementation

| ID | Status | Behaviour |
|---|---|---|
| B-FILE-01 | `[v0]` | `Ctrl`+`O` opens a `.txt` file, replacing the document as **one** undoable step. |
| B-FILE-02 | `[v0]` | `Ctrl`+`S` saves. Where the platform can write in place it does so silently; where it cannot it falls back to Save As. `Ctrl`+`Shift`+`S` always asks. |
| B-FILE-03 | `[v0]` | The status bar shows the current file name and marks it `•` while there are unsaved changes. |
| B-FILE-04 | `[v0]` | On the web, Chrome and Edge write back to the opened file; Firefox and Safari download a copy instead. The adapter states this limitation rather than pretending the write happened. |
| B-FILE-05 | `[v0]` | Recently opened names are remembered per platform. Reopening one in a click is desktop-only — a browser cannot re-acquire a file handle without a picker. |
| B-FILE-06 | `[planned]` | Autosave. |

## 11. Keyboard map

**Implemented in:** [app/canvas/keymap.ts](src/app/canvas/keymap.ts), one `keydown` listener · the table of tools and their keys in [app/tools.ts](src/app/tools.ts)
**Pinned by:** [e2e/editor.spec.ts](e2e/editor.spec.ts)

| ID | Status | Keys |
|---|---|---|
| B-KEY-21 | `[v0]` | **Select is a mode, and a bare letter leaves it.** `b` box · `t` text · `c` connect (the line tool) · `s` circle — from `select` only, and bare. Under any other mode those are letters with nothing to do; the way back is `Escape` or **two taps of `Ctrl`**. The letters come from the same table as the toolbar buttons and the `Ctrl` keys ([tools.ts](src/app/tools.ts)), so a tool that gains a letter gains its button hint and its ribbon row in the same edit. `c` is *connect* rather than *circle* because the line tool is the one reached constantly, and because it leaves `hjkl` whole (B-KEY-22). Tools not in the four — arrow, eraser, freehand — keep their `Ctrl` key and their button, a mode with no letter being better than a letter nobody can guess. **This is the trade B-SEL-11 was rescinded for:** point-and-type cost all twenty-six letters, which is why tools were on `Ctrl`+digit in the first place. |
| B-KEY-21a | `[v0]` | Two taps of `Ctrl` are read on the key **up**, exactly as the `Shift` double-tap is (B-SEL-14): `Ctrl`+`S` fires a `Ctrl` keydown indistinguishable from a tap, and only the release knows whether anything happened in between. Each modifier counts as something happening to the other, so `Ctrl`+`Shift`+`S` is never mistaken for a tap of either. `Meta` counts as `Ctrl`, that being the same key on a Mac. It exists alongside `Escape` for the hand that never leaves the home row — `Ctrl` is under the little finger, and a modal editor is worth nothing if returning to the mode you live in is the most awkward reach on the board. |
| B-KEY-22 | `[v0]` | **`hjkl` walks the grid, under `select` only.** The same four directions as the arrow keys, and `Shift` and `Alt` mean on them exactly what they mean on the arrows — sweep and nudge — because they are one key with two spellings, not a second scheme. `Ctrl` is the exception and stays on the arrows: `Ctrl`+`L` is the address bar and `Ctrl`+`J` the downloads pane, and a jump that silently does not happen is worse than one key to reach for. The point is not brevity but that a hand resting here can reach `b`, `t`, `c` and `s` without moving — a keymap that made you leave for every step would be modal in name only. |
| B-KEY-01 | `[v0]` | **Rescinded.** Bare `V`/`B`/`C`/`L`/`A`/`T`/`E` were the original tool keys; they were given up when select learned to write (B-SEL-11) and tools moved to `Ctrl`+digit. B-KEY-21 brings four of them back, from select, with `c` and `s` swapped for the reasons given there. |
| B-KEY-02 | `[v0]` | `Escape` cancel drag, else dismiss caret **and leave the writing mode**, else abandon the chain or draft, else **return to select**, else clear selection. One press undoes one thing, innermost first — so a half-drawn line is abandoned by the first press and the mode left by the second. Dismissing a caret and leaving `text` are a single rung, not two, because a caret only exists in that mode (B-SEL-12): two presses for one thought would be the modality showing through as bookkeeping. |
| B-KEY-03 | `[v0]` | `Delete` / `Backspace` erase selection |
| B-KEY-04 | `[v0]` | Arrow keys nudge the selection, or move the caret when one is live |
| B-KEY-05 | `[v0]` | `Ctrl`+`Z` undo · `Ctrl`+`Y` / `Ctrl`+`Shift`+`Z` redo |
| B-KEY-06 | `[v0]` | `Ctrl`+`C` copy · `Ctrl`+`Shift`+`C` copy whole document · `Ctrl`+`V` paste |
| B-KEY-07 | `[v0]` | `Space` (held) pan |
| B-KEY-08 | `[v0]` | Shortcuts MUST be inert while focus is in a text input. |
| B-KEY-09 | `[v0]` | `Ctrl`+`A` select all · `Ctrl`+`D` duplicate |
| B-KEY-10 | `[v0]` | `Ctrl`+`O` open · `Ctrl`+`S` save · `Ctrl`+`Shift`+`S` save as |
| B-KEY-11 | `[v0]` | `Ctrl`+`0` reset zoom · `Ctrl`+`Home` back to the origin |
| B-KEY-12 | `[v0]` | `[` / `]` eraser brush size, **only while the eraser is the active tool** — they are characters a diagram wants, and every other tool lets them through to be typed · `Insert` insert vs overwrite typing |
| B-KEY-17 | `[v0]` | `Shift`+arrow sweeps a **rectangle**; `Ctrl`+`Alt`+arrow sweeps in **reading order**. Shift carries the rectangle because Shift means "extend the selection" everywhere and the rectangle is the commoner want on a grid — see B-SEL-15 for what Shift does once object select is on. |
| B-KEY-20 | `[v0]` | **`Ctrl`+arrow carries a selection** one cell, and `Ctrl`+`Alt`+arrow a whole stride (B-KEY-19). With **nothing selected** both keep the meaning they had — the jump (B-KEY-18) and the reading-order sweep — so navigation is only ever displaced while there is something to move. One exception: a sweep already running wins over the move, or a run of `Ctrl`+`Alt` presses would make a selection on the first press and drag it about on the second. `Ctrl`+`Shift`+arrow is unaffected and still sweeps out to the jump. |
| B-KEY-19 | `[v0]` | `Alt`+arrow **nudges the selection**; with **nothing selected** it moves the keyboard itself by a **stride** — **ten cells across, five down** — clamped at the origin. The two numbers are one distance: a cell is about twice as tall as it is wide (8×17 at 100%), so 10×8 against 5×17 is 80px against 85px, and one key covers the same ground whichever way it is pressed. Alt already means "move the thing" — with no thing, it moves you, and the coarse step fills the gap in the range: a bare arrow is one cell and `Ctrl` is a jump to wherever content happens to be, so neither crosses open space at a rate you can count in. It applies in **every tool**: a drawing tool never holds a selection (`setTool` drops it), so there the stride is all Alt can mean — five cells of cursor, or five cells of the corner a draft is dragging. It applies while writing too, but only with nothing selected: a selected run is already moved by `Shift`+arrow, and two keys for one job is how a keymap rots. |
| B-KEY-18 | `[v0]` | `Ctrl`+arrow is the **spreadsheet jump**: standing on a filled cell whose neighbour is filled, it rides the run to its last filled cell; otherwise it crosses the blanks to the next filled cell. With nothing to jump to the answer depends on which way you are going, because the plane is a quadrant with two walls and two open sides (B-PLANE-01): **left or up takes the wall** (`x = 0`, `y = 0`), exactly as a spreadsheet runs to column A; **right or down moves one cell**, since the plane is unbounded that way (B-PLANE-03) and a jump a thousand cells into empty space would strand the view. A wall already reached is not left. `Ctrl`+`Shift`+arrow does the same jump with the selection dragged out to it, as a rectangle, to agree with the plain `Shift` sweep it accelerates. |
| B-KEY-18a | `[v0]` | **A junction is somewhere to stop.** Riding a run ends at the first cell carrying an arm that leaves the line of travel — north or south when going sideways, east or west when going up or down. A wall with a line joining it is not one run but two stretches of wall with somewhere to be in between; riding past made the one cell you most want, where the connector meets the shape, the one cell this key could not reach, and a table's dividers unreachable for the same reason. Tested after stepping, so a junction already stood on is one you can leave. |
| B-KEY-16 | `[v0]` | **Rescinded with B-SEL-11.** A printable key under `select` now writes nothing; `Space` under `select` likewise draws nothing and writes nothing. Writing at the keyboard cursor with no caret placed first survives under `text` alone, for the case of arriving by the toolbar button rather than by `t` — without it the tool would sit waiting for a click. |
| B-KEY-13 | `[v0]` | `Alt` while *dragging* a line or arrow flips the elbow |
| B-KEY-14 | `[v0]` | A live caret owns the keyboard: printable keys type rather than switching tool. |
| B-KEY-15 | `[v0]` | A line being drawn owns `Enter` (confirm) and `Escape` (abandon); right-click confirms too. |

## 12. Feedback

**Implemented in:** [app/canvas/renderer.ts](src/app/canvas/renderer.ts) (everything drawn on the canvas) · [app/components/StatusBar.tsx](src/app/components/StatusBar.tsx) · [app/components/Toolbar.tsx](src/app/components/Toolbar.tsx)

| ID | Status | Behaviour |
|---|---|---|
| B-UI-01 | `[v0]` | The status bar always shows the cursor's cell coordinate, the document's cell count, the zoom level, and the current selection's kind and size. |
| B-UI-02 | `[v0]` | The cell under the cursor is highlighted. |
| B-UI-03 | `[v0]` | The selection is drawn as a tinted region with an outlined bounding box, above the content. |
| B-UI-04 | `[v0]` | The origin edges (`x=0`, `y=0`) are drawn more strongly than the grid, so the plane's corner is unmistakable. |
| B-UI-05 | `[v0]` | The cursor shape reflects the active mode: crosshair to draw, text over the caret tool, move over a selection, a resize arrow over a handle, grab while panning. |
| B-UI-06 | `[v0]` | The status bar names the recognised interpretation — `Box 11×5`, `Arrow 6 cells`, `Text 5 chars`. Drill-through depth is still owed, along with drill-through itself (B-REC-11). |
| B-UI-07 | `[v0]` | The caret blinks, and holds steady while typing. |
| B-UI-12 | `[v0]` | **The ribbon.** Under the row that picks the tool, a band showing that tool's own controls — grouped, captioned, and labelled with the keys that reach them. It shows **state as well as shortcuts**: overwrite versus insert, the eraser's brush size, whether object select is on. Its height MUST NOT change, between tools or as a value inside it grows; a band that resizes moves the canvas down under the pointer and the document appears to jump (the failure B-UI-09's toolbar is already fixed against). Nothing in it is clickable — every entry is reachable by the key it names. |
| B-UI-12a | `[v0]` | Select's band leads with **Modes** — the four letters that leave it, generated from [tools.ts](src/app/tools.ts) so they cannot drift from the buttons — and every other mode carries the way **back** to select. A modal editor's worst failure is stranding someone in a mode they cannot name, so the exit is on screen wherever it applies, rather than only in the mode they would have to leave in order to read about it. Insert-versus-overwrite moved off select's band with select's writing: it is a fact about typing, and typing has its own mode now. |
| B-UI-12b | `[open]` | Select's band is **wider than a 1280px window** and the rightmost groups are clipped (`overflow: hidden`). This predates the Modes group — it was already ~1414px against 1280 — but Modes makes it ~1692px, and what falls off the edge is now *Objects* and *Act*. Wrapping would break the fixed height B-UI-12 requires, so the fix is either fewer rows per mode or a second band, and that is a design decision rather than a tidy-up. |
| B-UI-13 | `[v0]` | The actions menu **remembers its highlight** between openings. Adding three columns is three rounds of open-and-confirm, and starting from the top each time makes the later rounds longer than the first for no reason. |
| B-UI-15 | `[v0]` | A separator is only a separator when a **crossbar caps both its ends**. Sitting between the table's sides is not enough: a line dropped from a box's bottom wall passes that test and is no separator at all, and treating it as one made a press on it a track-drag before it could ever be a click — so the line could not be selected. |
| B-UI-16 | `[v0]` | **The actions menu is a tree, and what it offers depends on what is selected.** A box is offered its lattice; a line is offered its two ends and the character set it is drawn in. A group opens a further **row beneath** the last rather than a panel beside it, so the whole path stays on screen and the shape itself stays uncovered. `Enter` opens a group or runs an item — one key for both; `Escape` backs out one level and closes at the top. Nothing to offer is not a menu: it does not open. |
| B-UI-16a | `[v0]` | Pointing at a menu item **lights up what it is about** on the canvas. "End 1" and "End 2" name nothing a person can see until the end in question is picked out, so a few cells at that end are washed in the cursor's colour while the item is highlighted, by hover or by key alike. The hint is session state and writes nothing. |
| B-UI-16b | `[v0]` | The remembered highlight (B-UI-13) survives as a **path**, and only while every step of it still lands on something: the menu over a line has nothing in common with the menu over a box. |
| B-LINE-01 | `[v0]` | **A line's ends are addressable separately.** They are found as the two loose ends of the run graph and ordered by **reading order** — top to bottom, then left to right — because the order a line was drawn in is not recoverable from the characters, and "End 1" must not mean different ends on different days. A ring has no ends and something that branches has more than two; neither offers the menu. |
| B-LINE-02 | `[v0]` | An end can be `normal` or `arrow`. Setting one **replaces** the end cell rather than growing the line, which is what `stampPath` already does when it draws an arrow; clearing one puts the cell back to whatever its connectivity says it should be. Crow's-foot notation — *one*, *many*, *zero or one* — is **not yet available**: every character it is conventionally drawn with (`\|`, `<`, `o`) is already spoken for, `\|` being a line glyph and `<` an ASCII arrowhead, so writing them at the end of a wire would have the recognizer read them straight back as more line. They need a weak decoration family of their own (B-CONN-06), and which characters that family uses is a decision about the saved `.txt`. |
| B-LINE-03 | `[v0]` | A character set can be applied to **the selection alone**, not only to the whole document (B-CS-03). Connectivity is still read from the real grid, so a wire restyled where it sits still merges correctly with the walls it meets; only what gets written is limited. |
| B-LINE-04 | `[v0]` | **End decorations are a second weak family**, on exactly the terms arrowheads are (B-CONN-06): one counts as part of a line only when a shaft is really behind it, so a notation character can sit at the end of a wire without being read back as more wire. Unlike an arrowhead the glyph says which way the **run** lies rather than which end this is — a tick looks the same at either — so it joins whichever side actually has a shaft. `╫` crosses a horizontal run and `╪` a vertical one, which is crow's-foot *exactly one* as a single cell. |
| B-LINE-05 | `[open]` | *Many* — the crow's foot itself — waits on a **character**, not on machinery. The family above takes one more entry, but `<` `>` `^` `v` are already the ASCII arrowheads and `\|` is a line glyph, so the conventional spellings are unavailable and the substitute is a decision about what lands in the saved `.txt`. |
| B-UI-11 | `[v0]` | **The actions menu opens from the keyboard.** `Ctrl`+`E` on a selection opens it exactly as a right-click does, offering the same nothing for a shape with no lattice. While it is open it owns four keys: left and right step between the items and wrap at both ends, `Enter` runs the highlighted one, and `ArrowDown` puts it away — down because the menu sits under the shape as often as over it, so down is the direction it came from. `Escape` still closes it through the ordinary chain. The highlighted item is drawn with an accent ring rather than by focusing a button, because the keyboard belongs to the canvas throughout. |
| B-UI-11a | `[v0]` | The menu offers itself over **any bordered rectangle**, not only a selection the matcher labelled `box`. Every keyboard route to a whole table — a `Shift`+arrow sweep, object select, the `Ctrl`+`Enter` structure rung — answers `cells`, because the trace is one component with dividers in it and no rectangle matcher will claim that; only a click ever lands on a `box`. The test is `enclosesArea` (nesting §9), and the menu asks exactly what the planners ask, so it cannot offer something they would then refuse. A circle is still excluded: it encloses an area and has no lattice. |
| B-UI-10 | `[v0]` | **The keyboard has one position, drawn two ways, and never both at once.** The caret and the keyboard cursor are the same cell — every move of one carries the other — and which marker is drawn says what that cell is *for*: a blinking bar where the keyboard is writing, the square where it is only pointing. Since B-SEL-12 the **mode** answers that question rather than the history of what was last clicked: a caret exists under `text` and nowhere else, so `select` is always a square and `text` always a bar. |
| B-UI-08 | `[v0]` | The eraser shows its brush footprint under the pointer. |
| B-UI-09 | `[v0]` | Transient outcomes — saved, opened, pasted, clipboard refused — appear briefly in the toolbar and clear themselves. |

## 13. Non-goals for v0

Stated so their absence reads as a decision rather than an oversight.

### Delivered since this list was written

- Line, arrow, text, and eraser tools — **`[v0]`**
- Circle tool — **`[v0]`** (B-DRAW-13)
- Resize handles, duplicate, multi-select — **`[v0]`**
- File open/save, paste import — **`[v0]`**; desktop packaging is **scaffolded**, not built
- Regular text typing insert/type mode — **`[v0]`**
- Drill-through candidate cycling — **`[v0]`** (B-REC-10 … B-REC-12); nested and
  edge-sharing shapes of every kind are now individually selectable
- Sticky connectors — **`[v0]`** (B-MAN-11), on move
- Corner-by-corner line drawing — **`[v0]`** (B-DRAW-14)
- Drawing a box from the keyboard — **`[v0]`** (B-DRAW-15)
- Rounded / heavy / double charset packs — **`[v0]`** (B-CS-06)
- Automated UI tests — **`[v0]`**, 24 Playwright specs in [e2e/](e2e)

### Still outstanding

- **Desktop installers** — the Tauri shell, config, capabilities and icons exist and the
  TypeScript side is wired, but nothing has been compiled: the Rust toolchain on this
  machine is 1.76 and the dependency tree needs edition-2024 support (Rust 1.85+).
  `rustup update` is the whole gap.
- Interior text travelling with its box — `[planned]` (B-REC-13)
- Grow-to-fit typing — `[planned]` (content §4)
- Layers, styling, templates, auto-layout — `[planned]`
- Autosave — `[planned]` (B-FILE-06)
- Whether a line touching a box joins its candidate — `[open]` (B-REC-16)
- Multiplayer — `[planned]`; only the structural seams exist
- Touch input — `[open]`
