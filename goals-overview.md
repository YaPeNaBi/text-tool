# Goals Overview

The short, readable version. What the project is, which milestones exist, what
actually works today, and **where each thing lives in the code**.

- Full behavioural contract → [behaviour-goals.md](behaviour-goals.md)
- Architecture & technology decisions → [plan.md](plan.md)
- Code map for developers → [README.md](README.md)
- How it should *feel*, drawn out case by case → [intuitive/](intuitive)
- How those scenarios become modules → [intuitive/plan.md](intuitive/plan.md)

**Legend:** ✅ done · 🟡 partly done · ⬜ not started · 📐 designed, not built

---

## What this is

A diagram editor where the document *is* ASCII text. You draw boxes, circles,
lines and arrows onto an infinite character grid; the file you save is exactly
what you see. Shapes are not stored as objects — clicking a character
re-discovers the shape around it. That is the one idea the whole design hangs
off.

---

## Milestones

| # | Milestone | State | In one line | Where it lives |
|---|---|---|---|---|
| M0 | Scaffold | 🟡 | Vite + TypeScript + tests + lint boundaries + local git. No CI yet. | [package.json](package.json) · [vite.config.ts](vite.config.ts) · [tsconfig.json](tsconfig.json) · [eslint.config.js](eslint.config.js) |
| M1 | Grid & viewport | ✅ | Pan, zoom, scroll, infinite canvas, cell size measured from the real font. | [camera.ts](src/app/canvas/camera.ts) · [renderer.ts](src/app/canvas/renderer.ts) · [cell.ts](src/core/geom/cell.ts) |
| M2 | Typing & erase | ✅ | Undo/redo, copy as text, delete, and a real text caret you can type into. | [stamp/text.ts](src/core/stamp/text.ts) · [history.ts](src/core/history/history.ts) · [io/text.ts](src/core/io/text.ts) |
| M3 | Draw tools & charsets | ✅ | Box, circle, line, arrow, eraser and text tools. Five charset packs. | [src/core/stamp/](src/core/stamp) · [charsets.ts](src/core/charset/charsets.ts) |
| M4 | **Recognizer** ★ | ✅ | Boxes, circles, lines, arrows and text runs, with every reading ranked. | [src/core/recognize/](src/core/recognize) |
| M5 | Select mode | ✅ | Click, click again to drill to the standalone shape, marquee, shift+click, Ctrl+A. | [rank.ts](src/core/recognize/rank.ts) · [store.ts](src/app/state/store.ts) · [CanvasView.tsx](src/app/canvas/CanvasView.tsx) |
| M6 | Manipulate | ✅ | Move, nudge, delete, resize handles, duplicate, and a UI test suite. | [transform/](src/core/transform) · [e2e/](e2e) |
| M7 | Sticky connectors | ✅ | Lines follow the shape they touch, whether it is moved or resized. | [route/connectors.ts](src/core/route/connectors.ts) |
| M8 | Files & clipboard | 🟡 | Open, Save, Save As and paste-import behind one interface. Autosave owed. | [src/platform/](src/platform) |
| M9 | Desktop packaging | 🟡 | Tauri shell scaffolded and configured; **never compiled**. Needs `rustup update`. | [src-tauri/](src-tauri) · [platform/desktop/](src/platform/desktop) |
| M10 | Extensibility hardening | 🟡 | The circle proved the stamper/matcher pair works. Not yet written down as a contract. | [ellipse.ts](src/core/stamp/ellipse.ts) + [recognize.ts](src/core/recognize/recognize.ts) |
| M12 | **Composition** ◆ | ✅ | Containers carry their contents, shapes carry their labels, resize refuses to destroy them, and typing grows the shape it is inside. | [derive/](src/core/derive) · [ops/](src/core/ops) |
| M13 | Route finding | 🟡 | ✅ A* over a cost function: connectors go *around* boxes, circles and text, and refuse when there is no way through. ⬜ Fan-out (§3), crossing another line at a price (§6). | [route/astar.ts](src/core/route/astar.ts) · [route/cost.ts](src/core/route/cost.ts) |
| M14 | Tables | 🟡 | ✅ Add a column or row, drag a separator to resize one, type past a cell and the column widens; the lattice moves as one shape. ⬜ The matcher, and the other ten operations. | [ops/lattice.ts](src/core/ops/lattice.ts) · [stamp/table.ts](src/core/stamp/table.ts) · [ops/table.ts](src/core/ops/table.ts) |
| M11+ | Future | ⬜ | Multiplayer, VS Code extension, SVG/PNG export, auto-layout. | — |

★ = the risky one. Recognition is where the hard problems live.
◆ = the one the others depend on. 📐 = designed and scaffolded, not yet built.

---

## Features, one line each

### Drawing — `src/core/stamp/`

| Feature | State | Notes | File |
|---|---|---|---|
| Box tool | ✅ | Drag to draw. Joins onto boxes and lines it touches (`┬`, `├`, `┼`). | [box.ts](src/core/stamp/box.ts) |
| Circle tool | ✅ | Drag to draw an ellipse. Same joining rules. Minimum 3×3. | [ellipse.ts](src/core/stamp/ellipse.ts) |
| Line tool | ✅ | Click to start, click again for each corner, `Enter` or right-click to finish. Drag draws a single segment. | [path.ts](src/core/stamp/path.ts) |
| Arrow tool | ✅ | Same as line, with an arrowhead. Aimed at a box, it stops beside the border. | [path.ts](src/core/stamp/path.ts) |
| Eraser tool | ✅ | Draggable brush, `[` / `]` resize it. Repairs the glyphs it leaves behind. | [erase.ts](src/core/stamp/erase.ts) |
| Text tool | ✅ | Click for a caret, then type. `Enter` returns to the start column. | [text.ts](src/core/stamp/text.ts) |
| Editing selected text | ✅ | Selecting a run puts a caret in it: arrow keys walk it, typing writes between the characters, backspace closes up. Stacked lines, and everything inside one box, select together as a block. | [store.ts](src/app/state/store.ts) · [derive/label.ts](src/core/derive/label.ts) |
| Tab between shape and label | ✅ | Two things share a place and only one can be selected, so `Tab` says "the other one". | [store.ts](src/app/state/store.ts) |
| Keyboard cursor | ✅ | A square the arrow keys move, in every tool. Where the next keystroke lands, as `hover` is where the pointer is. | [store.ts](src/app/state/store.ts) · [renderer.ts](src/app/canvas/renderer.ts) |
| Drawing without a mouse | ✅ | `Space` starts a box or circle at the cursor and drops line corners; arrows size it; `Enter` commits, `Escape` abandons. | [CanvasView.tsx](src/app/canvas/CanvasView.tsx) |
| Sweeping a selection | ✅ | `Shift`+arrow sweeps in reading order, `Ctrl`+arrow sweeps a rectangle. | [recognize.ts](src/core/recognize/recognize.ts) |
| Insert vs overwrite typing | ✅ | `Insert` toggles. Insert pushes the word right, stopping at the first blank. | [text.ts](src/core/stamp/text.ts) |
| Charsets | ✅ | Unicode, Rounded, Heavy, Double and ASCII, converting between all of them losslessly. | [charsets.ts](src/core/charset/charsets.ts) · [convert.ts](src/core/transform/convert.ts) |

### Selecting & editing — `src/core/recognize/`, `src/core/transform/`

| Feature | State | Notes | File |
|---|---|---|---|
| Click to select a shape | ✅ | Works the same on drawn, pasted and loaded art. | [recognize.ts](src/core/recognize/recognize.ts) |
| Drill-through | ✅ | Clicking the same cell again steps to the standalone shape, then outward. Works for boxes, circles and lines. | [rank.ts](src/core/recognize/rank.ts) |
| Sticky connectors | ✅ | Move a box and the arrows pointing at it follow, leaving from the side that faces where it went — including a line drawn *into* a border, grabbed from either end. A line joins the wall it reaches (`┬`, `┴`, `├`, `┤`); an arrow keeps its head clear. Every §1 and §2 case in the design doc is pinned by a test. | [connectors.ts](src/core/route/connectors.ts) |
| Connectors on resize | ✅ | Dragging a handle re-routes them too, exactly as moving does. | [ops/resize.ts](src/core/ops/resize.ts) |
| Refusing a damaging resize | ✅ | A box will not shrink over its own label or a child, and says so. | [ops/resize.ts](src/core/ops/resize.ts) |
| Routing around obstacles | ✅ | A re-routed line goes around whatever is in the way, and says so when it cannot. The plain elbow is kept when it fits. | [route/astar.ts](src/core/route/astar.ts) · [route/cost.ts](src/core/route/cost.ts) |
| Marquee select | ✅ | Drag from empty space. | [recognize.ts](src/core/recognize/recognize.ts) |
| Multi-select | ✅ | `Shift`+click adds a shape, or removes it if already in. | [store.ts](src/app/state/store.ts) |
| Select all | ✅ | `Ctrl`+`A`. | [recognize.ts](src/core/recognize/recognize.ts) |
| Move | ✅ | Drag, or nudge with the arrow keys. | [move.ts](src/core/transform/move.ts) |
| Resize | ✅ | Handles on a box or circle; the border is redrawn, not stretched. | [resize.ts](src/core/transform/resize.ts) |
| Duplicate | ✅ | `Ctrl`+`D`, offset by one cell. | [store.ts](src/app/state/store.ts) |
| Add column / add row | ✅ | Right-click a selected box. The box grows by one track, the old wall becomes a divider, and the new track is divided the way its neighbour is. | [ops/lattice.ts](src/core/ops/lattice.ts) · [ShapeMenu.tsx](src/app/components/ShapeMenu.tsx) |
| Resize a column or row | ✅ | Drag a separator, as in a spreadsheet. The track beside it changes width and everything past it shifts. | [ops/lattice.ts](src/core/ops/lattice.ts) |
| Grow to fit the text | ✅ | Typing past the end of a box grows the box; past the end of a table cell widens the whole column, every row following. Whatever it comes up against is pushed along, not written over — but only once it is actually touched. | [ops/typing.ts](src/core/ops/typing.ts) |
| Arrow keys in a table | ✅ | Step from cell to cell, as in a spreadsheet. `Shift`+arrow drags the cell instead, which is also how it leaves the table. The same division as a run of text: bare key moves you, Shift moves the thing. | [ops/lattice.ts](src/core/ops/lattice.ts) |
| Delete | ✅ | `Delete` / `Backspace`. | [box.ts](src/core/stamp/box.ts) |
| Undo / redo | ✅ | One gesture is one step. A run of typing is one step. | [history.ts](src/core/history/history.ts) |

### Recognition — `src/core/recognize/`

| Feature | State | Notes | File |
|---|---|---|---|
| Connectivity | ✅ | Derived from a glyph and its neighbours, never stored. | [grid.ts](src/core/grid/grid.ts) · [charsets.ts](src/core/charset/charsets.ts) |
| Trace | ✅ | Flood fill across characters that agree they touch. Capped at 20 000 cells. | [trace.ts](src/core/recognize/trace.ts) |
| Run graph | ✅ | Cells collapse to nodes and straight runs before any matcher looks. | [segmentize.ts](src/core/recognize/segmentize.ts) |
| Boxes | ✅ | Any rectangle whose outline is complete. | [recognize.ts](src/core/recognize/recognize.ts) |
| Circles / ellipses | ✅ | Matched against what the stamper would draw for the same bounds. | [recognize.ts](src/core/recognize/recognize.ts) |
| Lines / polylines | ✅ | Open paths, any number of corners. | [recognize.ts](src/core/recognize/recognize.ts) |
| Arrows | ✅ | A path with an arrowhead attached at either end. | [recognize.ts](src/core/recognize/recognize.ts) |
| Text runs | ✅ | Clicking a word selects the word. | [recognize.ts](src/core/recognize/recognize.ts) |
| Ranking | ✅ | Every closed outline and strand through the click; most specific first, then smallest, whole component last. | [rank.ts](src/core/recognize/rank.ts) |
| Nested & overlapping shapes | ✅ | Reachable by clicking the same cell again — boxes, circles and lines alike. | [rank.ts](src/core/recognize/rank.ts) |
| Fallback | ✅ | Anything unrecognised still selects as cells, so clicking never dead-ends. | [recognize.ts](src/core/recognize/recognize.ts) |
| Labels moving with their box | ✅ | Text inside a shape travels with it; a note sitting *beside* it does not. | [derive/label.ts](src/core/derive/label.ts) |
| Boxes carrying their contents | ✅ | Moving a container takes everything wholly inside it, at any depth, in one undo step. | [derive/gather.ts](src/core/derive/gather.ts) |
| Detaching flush shapes | ✅ | Drag one of two boxes drawn edge-to-edge and both stay whole. | [derive/shared.ts](src/core/derive/shared.ts) |
| Tables | 📐 | A table reads as nine overlapping rectangles, none of them a row. Designed: [tables.md](intuitive/tables.md). | [recognize/table.ts](src/core/recognize/table.ts) |

### Files — `src/platform/`

| Feature | State | Notes | File |
|---|---|---|---|
| Copy as text | ✅ | Whole document, or just the selection if there is one. | [io/text.ts](src/core/io/text.ts) · [store.ts](src/app/state/store.ts) |
| Paste import | ✅ | `Ctrl`+`V`. Any ASCII art lands as editable cells. Never fails. | [stamp/text.ts](src/core/stamp/text.ts) |
| Open `.txt` | ✅ | Native format is plain text. No sidecar file, no metadata. Dialog not yet exercised. | [platform/web/](src/platform/web) |
| Save / Save As | ✅ | Chrome/Edge write in place; Firefox/Safari fall back to a download. Dialog not yet exercised. | [platform/web/](src/platform/web) |
| Recent files | 🟡 | Names are remembered; reopening in one click is desktop-only. | [platform/](src/platform) |
| Autosave | ⬜ | Not started. | *(planned)* |
| Desktop app | 🟡 | Shell scaffolded and wired, but never compiled — needs `rustup update`. | [src-tauri/](src-tauri) |

### The app shell — `src/app/`

| Piece | What it does | File |
|---|---|---|
| Store | Document + session state; the only place the grid is ever written. | [state/store.ts](src/app/state/store.ts) |
| Canvas input | Pointer and keyboard handling, gesture state, live previews. | [canvas/CanvasView.tsx](src/app/canvas/CanvasView.tsx) |
| Renderer | Draws visible cells straight from the grid, plus selection, handles, caret. | [canvas/renderer.ts](src/app/canvas/renderer.ts) |
| Camera | Cell ↔ screen, zoom, runtime font metrics. | [canvas/camera.ts](src/app/canvas/camera.ts) |
| Toolbar / status bar | Tool buttons, charset picker, file actions, readouts. | [components/](src/app/components) |

### Tests

| Suite | Covers | File |
|---|---|---|
| Stampers & transforms | Glyphs, junction merging, charset round-trips, moves. | [tests/stamp.test.ts](tests/stamp.test.ts) |
| Recognition | Trace, run graph, every matcher. | [tests/recognize.test.ts](tests/recognize.test.ts) |
| Tools | Paths, arrows, eraser repair, typing, paste, resize, history. | [tests/tools.test.ts](tests/tools.test.ts) |
| Shapes & ranking | Ellipse geometry and connectivity, charset packs, drill-through. | [tests/shapes.test.ts](tests/shapes.test.ts) |
| Connectors & polylines | Attachment, Z routing, multi-corner lines, drilling into non-boxes. | [tests/connectors.test.ts](tests/connectors.test.ts) |
| Sticky scenarios | Every §1 and §2 picture from the design doc, copied verbatim, plus connectors merged into a border at either end. | [tests/sticky.test.ts](tests/sticky.test.ts) |
| Lattices | Adding columns and rows, and a divided box surviving a move. | [tests/lattice.test.ts](tests/lattice.test.ts) |
| Routing | Every scenario in pathfinding.md, against invented terrain and against real connectors. | [tests/route.test.ts](tests/route.test.ts) |
| Text blocks | What counts as one piece of writing, loose on the page and inside a box. | [tests/textblock.test.ts](tests/textblock.test.ts) |
| Grow to fit | Boxes and table columns growing with what is typed into them. | [tests/typing.test.ts](tests/typing.test.ts) |
| Composition | Containment, labels, the cascade, detaching flush shapes. | [tests/compose.test.ts](tests/compose.test.ts) |
| End-to-end | The gesture surface in a real browser. | [e2e/editor.spec.ts](e2e/editor.spec.ts) |

---

## The known limitations

Worth knowing before you rely on the tool. None of these are bugs.

1. **Moving a shape over something erases it.** The grid has no memory of what sat
   underneath. Dragging *across* content and back is safe — only where you finally
   drop matters — and undo always gets it back. Note the exception: a shape that
   grows *by itself*, because text outgrew it or a column was widened, pushes
   what is in its way instead. Damage you did not aim at is the thing to
   prevent; a drop is aimed.
2. **Switching charset rewrites the document.** It is a real edit, not a display
   setting — but it is one undo step and it round-trips exactly.
3. **Several connectors to one shape still pile onto one side.** They all
   follow, but they are not spread out, so two can arrive at the same cell and
   read as one arrow. That is pathfinding §3/§5, and it is the rest of M13.
4. **A circle is a staircase.** On a character grid it cannot be anything else.
   Below 5×5 it degenerates into a rectangle.
5. **A route will not cross another line, even when crossing is the only way.**
   Telling a connector's shaft from a box's wall needs more than the
   characters give, so everything drawn is treated as solid. Where crossing is
   the only way through, the search fails and the plain elbow is drawn instead —
   which does overwrite, exactly as it used to. Undo gets it back.
6. **A table is still just a lot of rectangles.** It can now be *drawn* — right-
   click a box and add columns and rows — and it moves as one shape. But nothing
   *reads* it: there is no lattice matcher, so the other eleven table operations
   have nothing to operate on, and clicking a table still selects one of its
   rectangles rather than a row or a cell.
7. **A connector crossing a container's wall is carried, not re-routed.** The
   `┼` joins the two into one component, so the container stops reading as a
   box. Recomputing the crossing is part of M13.

Limitations 3, 5, 6 and 7 all have a design now — they are the rest of M13 and
M14, and the reasoning is in [intuitive/plan.md](intuitive/plan.md).
Limitations 1, 2 and 4 are inherent to the character grid and are not going
anywhere.

---

## How much of this has actually been run

Worth being precise, because "implemented" and "verified" are not the same thing.

**Automated, in a real browser** — 73 Playwright tests over drawing, corner-by-corner
lines, selecting, drilling, moving, resizing, sticky connectors, typing, history and
charsets. They drive real pointer and keyboard events and read the document back
through the app's own copy command.

**Covered by unit tests** — 263, all passing: every glyph the stampers emit, junction
merging, eraser repair, ellipse connectivity at five sizes, charset round-trips
through all five packs, the run graph, paste import, resize geometry, candidate
ranking, connector attachment and routing, history coalescing.

**Written but never run:** the file dialogs — Open, Save and Save As go through the
browser's file picker, which a test cannot drive — and the whole desktop shell,
which has not been compiled. Treat both as unproven until you click them yourself.

---

## What to build next

What is missing is no longer capability, it is **composition**. The editor understands
individual shapes very well and understands nothing about how they relate. The five
documents in [intuitive/](intuitive) work out what those relationships should feel
like; [intuitive/plan.md](intuitive/plan.md) works out the modules.

1. **M12 — composition.** Containers that carry their contents, shapes that carry
   their labels, and one place where an operation can refuse. Two new module
   families, [derive/](src/core/derive) and [ops/](src/core/ops), both scaffolded.
   Everything else depends on it, and it closes the two most-felt gaps today.
2. **M13 — route finding.** Connectors that go around things instead of through
   them, and fan out instead of merging into one arrow. The only genuinely new
   algorithm in the project.
3. **M14 — tables.** Thirteen operations, each a few lines once the lattice is
   recognised. Probably the highest user value here: tables are where the data in
   a drawing actually lives.
4. **`rustup update`, then verify the desktop build** — the shell is written and
   has never been compiled. Rust 1.76 here; a dependency needs edition 2024, i.e. 1.85+.
5. **CI** — three-OS matrix running `npm run check` and `npm run e2e`.
