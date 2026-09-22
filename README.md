# ASCII Writer

A diagram editor whose document is plain text. Draw boxes, lines and arrows on a
character grid; what you see is exactly what gets saved.

```
┌──────────┐        ┌──────────┐
│  editor  │───────>│  .txt    │
└──────────┘        └──────────┘
```

- [goals-overview.md](goals-overview.md) — what works today, in plain language
- [glossary.md](glossary.md) — the words this project uses, and what they mean here
- [behaviour-goals.md](behaviour-goals.md) — the precise behavioural contract (`B-…` IDs)
- [plan.md](plan.md) — architecture decisions and their reasoning

---

## Running it

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then a static bundle in `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` | ESLint, including the architectural boundary rules |
| `npm run check` | All three: types, lint, unit tests |
| `npm run e2e` | End-to-end tests in a real browser (starts the dev server itself) |
| `npm run tauri:dev` | Desktop app in dev mode — **needs a current Rust** (see below) |
| `npm run tauri:build` | Desktop installers — **needs a current Rust** (see below) |

---

## The one idea

**The document is a `Map` from `"x,y"` to a single character.** Nothing else.

There are no shape objects, no ids, no z-order, no layers. A box is not a `Box`; it
is twenty-eight characters that happen to form a rectangle.

Everything else in the codebase follows from that:

| Because the document is just characters… | …this becomes true |
|---|---|
| Saving is cropping and joining rows | Export cannot drift from what is on screen |
| Pasted art and drawn art are identical | Importing someone else's ASCII diagram needs no parser |
| There are no shape objects to select | Selection has to *re-derive* shapes on every click — this is the **recognizer**, and it is the heart of the product |
| Moving a shape overwrites what it lands on | Occlusion is a real, documented limitation, not a bug |

The cost is concentrated in one place — recognition — and that place is a pure
function over text, which makes it the most testable part of the system.

---

## How a change flows through the app

Every single mutation, without exception, takes this path:

```
  pointer / key
        │
        ▼
  CanvasView.tsx        gesture state in a ref; keymap.ts turns a key into an
        │                intent, gesture.ts computes the preview per frame
        │                from the UNMODIFIED grid — nothing is written yet
        ▼
  stamper               stampBox / stampPath / eraseBrush / typing
        │                pure function: parameters -> CellDiff
        ▼
  CellDiff              Map<"x,y", string | null>     (null = erase)
        │
        ▼
  store.apply(diff)     the only writer in the codebase
        │
        ├──▶ applyDiff(grid, diff)  mutates, returns the exact inverse
        └──▶ history.record(inverse)
```

Three consequences worth internalising:

1. **A gesture writes once, on release.** During a drag the preview is recomputed
   from the untouched document every frame. So one drag is exactly one undo step,
   and dragging a box across other content and back leaves that content intact.
2. **Undo needs no per-command logic.** `applyDiff` returns its own inverse, so
   history is a stack of diffs and nothing more.
3. **There is one call site to replace** if this ever becomes a collaborative
   document. That is enforced by lint, not by discipline.

---

## Module map

```
src/
  core/                      pure TypeScript — no React, no DOM, no side effects
    geom/cell.ts             Cell, Rect, "x,y" keys, bounding boxes
    grid/grid.ts             the document; applyDiff; connectivity
    charset/charsets.ts      glyph tables, what each glyph connects to, arrowheads
    stamp/
      box.ts                 rectangle  -> CellDiff
      ellipse.ts             circle     -> CellDiff (a closed, connected ring)
      path.ts                line/arrow -> CellDiff
      freehand.ts            a dragged stroke -> CellDiff
      erase.ts               eraser brush + glyph repair
      text.ts                typing, insert-mode row shifting, paste
    recognize/               ★ the heart
      trace.ts               ① flood fill across connected characters
      segmentize.ts          ② collapse cells into a graph of straight runs
      recognize.ts           ③ run the matchers, return a Candidate
      rank.ts                ④ every reading, ordered, for drill-through
    transform/
      move.ts                translate a set of cells
      resize.ts              redraw a box or circle at a new size
      convert.ts             swap the whole document to another charset
    derive/                  facts the characters imply, recomputed every time
      contain.ts             what is inside a shape: content, dividers, neither
      label.ts               interior text and how it was aligned
      gather.ts              everything that travels when a shape moves
      shared.ts              cells two shapes both rely on
    ops/                     one planner per user operation; each returns a Plan
      plan.ts                the Plan type, diff merging, refusals
      move.ts                cascade, detach, re-route
      resize.ts              the refusals, and connectors on a resize
      lattice.ts             add, widen and deepen a column or a row
      typing.ts              typing grows the shape it is inside
    route/
      connectors.ts          lines that follow the shape they are attached to
      astar.ts               the search: A* over (x, y, heading)
      cost.ts                the price list, and the obstacle map
    history/history.ts       undo/redo stack of diffs
    io/text.ts               toText / fromText

  platform/                  the only code allowed to touch files or the clipboard
    adapter.ts               the interface both implementations satisfy
    web/                     File System Access API, download fallback
    desktop/                 Tauri dialogs and fs
    index.ts                 picks one at startup

  app/
    tools.ts                 the toolbar's order — which Ctrl+digit, and which bare letter
    state/store.ts           document state + session state; the sole mutation path
    canvas/
      camera.ts              cell <-> screen, zoom, font metrics
      renderer.ts            draws the visible cells straight from the grid
      gesture.ts             the Drag union, and a gesture's preview as a pure function
      keymap.ts              what every key means; each branch ends in a store call
      CanvasView.tsx         the element, its size, the pointer, the frame
    components/              Toolbar, Ribbon, StatusBar, ShapeMenu

  src-tauri/                 the desktop shell (Rust)
  tests/                     Vitest — the pure core
  e2e/                       Playwright — the gesture surface in a real browser
```

### Three hard boundaries, all enforced by ESLint

| Rule | Why it exists |
|---|---|
| `src/core/**` may not import React, the store, or touch `window`/`document` | Keeps recognition testable without a browser, and keeps the door open to reusing `core` in a VS Code extension |
| Only `store.ts` may import `applyDiff` | One writer means one place to change for multiplayer, and one place undo can be trusted |
| `src/app/**` may not reach into `platform/web` or `platform/desktop` | One shared UI, no forked code paths per platform |

If you find yourself wanting to break one of these, that is the signal to revisit
[plan.md](plan.md) rather than the lint config.

---

## The recognizer

The interesting part. `recognize(grid, x, y) → Candidate | null` — a pure
function, no state, no knowledge of how the characters got there.

```
   click at (x, y)
        │
        │ ① trace          flood fill across characters that agree they touch
        ▼
   a set of cells
        │
        │ ② segmentize     nodes = ends, corners, junctions
        ▼                  runs  = the straight stretches between them
   run graph
        │
        │ ③ match          each matcher scores the graph
        ▼
   Candidate               box | ellipse | arrow | line | text | cells
        │
        │ ④ rank           every *other* reading of the same click,
        ▼                  smallest first — see below
   Candidate[]
```

### Ambiguity is inherent, so don't fight it

Two boxes sharing an edge are **one** connected component. Nothing in the
characters says which one you meant, and silently guessing is the one thing this
design refuses to do.

So `rank.ts` enumerates instead. Through the cell you clicked it collects every
closed outline — rectangle or ellipse — plus the *strand*, meaning how far the run
graph can be walked without passing through a junction. That last one is what makes
a line that has merged into a box selectable on its own. A fresh click takes the
widest reading; clicking again steps inward to the standalone shape, then outward,
then wraps. The status bar shows `2/3` so it is obvious more readings exist.
Dragging still moves — only a click that doesn't move drills.

Two rules keep the list honest, and both were learned the hard way:

- **An outline must connect, not merely be present.** A circle crossing a box
  leaves a character at every position of some smaller rectangle. Offering that
  accident is worse than offering the whole blob, so every cell must also point
  along the outline — a `┘` cannot be the middle of a left edge.
- **A closed shape outranks an open one regardless of size.** Two boxes sharing an
  edge contain a U-shaped strand one cell *smaller* than the left box. Answering
  "a line" to a click on a box would be obtuse.

### How two characters decide they are connected

Connectivity is **never stored**. It is re-derived from the character and its four
neighbours, every time it is needed:

- Every line glyph declares which directions it can connect to. `─` is east+west,
  `┌` is south+east.
- Two neighbours are connected only if **both** point at each other. A `─` sitting
  next to a `│` is not a connection.
- `+` and `┼` are genuinely ambiguous — they declare all four directions, then get
  narrowed down to the directions where a neighbour actually points back. This is
  what lets hand-written ASCII art be understood with no metadata at all.
- Arrowheads (`>`, `▶`, …) are *weak*: they only count as part of a line when there
  is a real shaft behind them. Otherwise `v` in the middle of a word would be
  mistaken for a diagram.
- Everything else is text, and is never traced through.

### The matchers

| Matcher | Recognises |
|---|---|
| `box` | The cells are exactly the complete outline of their own bounding box |
| `ellipse` | The cells are exactly the ring the circle stamper would draw for those bounds |
| `arrow` | An open path with an arrowhead at one or both ends |
| `line` | An open path between two loose ends, corners allowed |
| `text` | A run of ordinary characters on one row, bounded by blanks |
| `cells` | Fallback — the whole traced blob. Always succeeds, so a click never dead-ends |

### Adding a new shape

A shape type is a **stamper/matcher pair**:

- a stamper — how to draw it (`parameters → CellDiff`)
- a matcher — how to recognise it (`cells → is it one of these?`)

The circle was the first real test of that claim, and it held: `stamp/ellipse.ts`
plus a nine-line `matchEllipse`, and the rest was wiring — a tool id, a drag kind,
a toolbar button. Note how the matcher is defined *in terms of* the stamper — "are
these exactly the cells `ellipseCells` would produce for this bounding box?" — which
makes it impossible for the two to drift apart.

If a new shape needs edits outside those two files plus its wiring, the abstraction
is leaking, and that is worth stopping over.

---

## Sticky connectors

Move a box and the arrows pointing at it follow. There are no objects and no ids,
so nothing in the document says an arrow *belongs* to a box — attachment is worked
out the way everything else is, from the characters and where they sit.

A line is attached when it **runs into** the shape: its own connectivity heads that
way, or an arrowhead is aimed at it. Note this is deliberately looser than
connection. A line drawn up to a `│` does not join it — that border offers no
sideways arm — so requiring mutual agreement would miss the most common case in
the whole editor.

Finding the line is a **walk**, not a flood, and that distinction is load-bearing.
Start the drag on a box's own border — the natural gesture, and what most
hand-written ASCII diagrams already look like — and the shaft merges into that
border as a `├`. Flooding outward from the *other* box then walks the shaft,
arrives at that junction and carries on around the near box, so the component is
not a simple path and the connector gets discarded. Walking stops one cell short
of the junction instead, which leaves the shape beyond it to be recognised as a
shape. A junction into a passing line is not the same thing and is left alone: a
connector cut in half at a crossing would be an invention.

On a move the attached lines are erased and redrawn *from their free end*, which is
what makes this re-routing rather than translation: the far end stays exactly where
it was. Erasing also **mends** what the line was joined to — take the shaft away
and that `├` is a wall reaching out at nothing — which is the same repair the
eraser does. It all goes into the same diff as the move, so one gesture is still
one undo step.

```
┌──────┐            ┌──────┐        ┌──────┐
│      │───────────▶│      │        │      │──────┐
│      │            │      │   →    │      │      │
└──────┘            └──────┘        └──────┘      │
                                                  │
                                            ┌─────▼──┐
                                            │        │
```

Two things that only showed up once it ran:

- **One elbow cannot serve both ends.** Leaving one box sideways and arriving at
  the other sideways needs a middle leg, so parallel approaches route as a **Z**.
  Without it, moving a box detaches the *other* end of its own arrow.
- **A connector must meet the shape exactly once.** Two boxes sharing an edge read
  as an open path once the shared column is excluded, so without that rule, moving
  one box re-routes the other as though it were a wire.

---

## State: document vs session

One store, deliberately split down the middle.

| | Document | Session |
|---|---|---|
| Holds | the grid, a revision counter | tool, camera, selection, drill depth, caret, charset, hover |
| Undoable | yes | **no** |
| Saved | yes | no |
| Would sync in multiplayer | yes | no — this becomes presence data |

Conflating the two is the classic way editor undo turns maddening (Ctrl+Z changing
your zoom level). Free to get right now, painful to retrofit.

**One detail that bites:** in-flight drag state lives in a **ref**, with a copy in
React state purely so the canvas redraws. Reading drag state from React state
inside a pointer handler goes stale whenever two pointer events land in the same
tick — which happens with fast input, not just in tests.

---

## Rendering

Canvas 2D, hand-rolled, one `fillText` per visible cell. No virtual DOM, no scene
graph, no render pipeline — the renderer reads the grid directly. Two properties
fall out:

- Frame cost depends on the size of the **viewport**, never the document.
- What is drawn and what `toText()` emits cannot diverge, because there is only one
  source.

Cell size is measured from the actual font at runtime rather than hardcoded, which
is what keeps the grid seam-free across platforms and font stacks.

---

## Keyboard

**Select is the mode you live in.** It points, selects and navigates; it does not
write. A bare letter leaves it, and `Escape` — or two taps of `Ctrl` — comes back.

| Keys | |
|---|---|
| `b` · `t` · `c` · `s` | from select: box · text · **c**onnect (line) · circle |
| `Esc` · `Ctrl` `Ctrl` | back to select. One press undoes one thing, so a half-drawn line goes first and the mode second |
| `h` `j` `k` `l` | walk left, down, up, right — the arrow keys do the same, and every modifier means the same on both |
| `Ctrl`+`1`…`7` | select · box · circle · line · arrow · text · eraser, from any mode (`Ctrl`+`B` is the box too) |
| `Ctrl`+`Q` | freehand — drag, and every cell the pointer crosses is drawn |
| middle-drag | pan |
| wheel · `Ctrl`+wheel · `Shift`+wheel | scroll · scroll sideways · zoom |
| `Ctrl`+`0` / `Ctrl`+`Home` | reset zoom / back to the origin |
| click, click, … then `Enter` / right-click | draw a line corner by corner |
| `Space` | box/circle: start one at the cursor · line/arrow: drop a corner |
| arrow keys, mid-line | aim the next corner — a line started with `Space` ignores the mouse |
| `Shift`+arrow, in the box tool | draw a box in one gesture — let go of `Shift` to keep it |
| `Enter` | commit what the keyboard is drawing, through wherever the cursor has got to |
| `t`, then type | writes at the keyboard cursor. Click a word first and `t` opens it at the character you clicked |
| right-click a selection · `Ctrl`+`E` | actions: a box's columns and rows, a line's ends and style |
| in that menu: `Enter` | open the highlighted group, or run the highlighted item · `Esc` backs out one level |
| in that menu: `←` `→` · `Enter` · `↓` | step between the options · run the highlighted one · put it away |
| drag a table separator | widen or deepen the track beside it |
| select one whole side and drag it | resizes the shape rather than tearing it — boxes and tables alike, and the side stays in hand so you can keep pulling |
| arrow keys, `hjkl` | move the keyboard cursor — or walk a selected run of text, or step between table cells |
| `Tab` | cross between a shape and the text written inside it — including an empty one, where it puts the caret ready to type, and so takes you into the writing mode |
| `Shift`+arrow | sweep out a rectangle — with something selected, grow it by cells |
| `Shift` `Shift` then `Shift`+arrow | take the object under the cursor, then grow by whole objects — a box the selection touches comes in entire, gaps and all |
| `Ctrl`+arrow | move the selection one cell — or, with nothing selected, jump to the far wall of what you are on, or across a gap to the next shape. With nothing to reach, left and up take the walls; right and down step one |
| `Ctrl`+`Alt`+arrow | move the selection by a stride |
| `Ctrl`+`Shift`+arrow · `Ctrl`+`Alt`+arrow | that jump, dragging a selection with it · sweep in reading order |
| `Alt`+arrow | nudge whatever is selected — or stride, with nothing selected: ten cells across, five down |
| `Shift`+click | add the whole connected thing to the selection, or remove it |
| `Ctrl`+click | add just the piece under the pointer — build a selection out of parts |
| `Ctrl`+`A` / `Ctrl`+`D` | select all / duplicate |
| `Enter` | switch between the smallest shape under the keyboard and the whole one |
| `Ctrl`+`Enter` | everything joined up — lines, and whatever they run into |
| `Delete` `Backspace` | erase the selection |
| `Ctrl`+`Z` / `Ctrl`+`Y` | undo / redo |
| `Ctrl`+`C` / `Ctrl`+`V` | copy what is selected, or all of it · paste as cells |
| `Ctrl`+`O` `Ctrl`+`S` `Ctrl`+`Shift`+`S` | open · save · save as |
| `Alt` while dragging a line | flip the elbow |
| `[` `]` | eraser brush size |
| `Insert` | insert vs overwrite typing |
| `Escape` | cancel the gesture, else clear the selection |

---

## Desktop build

The web app and the desktop app share every line of UI code. The only difference
is which `PlatformAdapter` gets injected at startup, chosen by sniffing for the
Tauri runtime.

```
src-tauri/
  tauri.conf.json          window, CSP, bundle targets, withGlobalTauri
  capabilities/default.json  what the window may do: open/save the file you pick
  src/lib.rs               registers the dialog and fs plugins — that is all
  icons/                   generated
```

### It does not compile on this machine yet

`cargo check` fails, and not for a reason in our code:

```
feature `edition2024` is required
  ...but that feature is not stabilized in this version of Cargo (1.76.0)
```

Tauri 2's own floor is Rust 1.77.2, but a transitive dependency has since moved to
edition 2024, which needs **Rust 1.85 or newer**. This machine has 1.76.0. The fix
is one command, after which `npm run tauri:dev` should work:

```bash
rustup update
```

Everything else the desktop build needs is already present — WebView2 and MSVC are
both installed. Nothing about the shell has been run yet, so treat the desktop
target as scaffolded rather than working: **the web build is the verified one**.

Installers for all three platforms come from a CI matrix rather than one machine;
that workflow is not written yet.

---

## Licence

**GNU General Public License v3.0 or later** — the full text is in
[LICENSE](LICENSE).

Copyright © 2026 YaPeNaBi.

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but **without any
warranty** — without even the implied warranty of merchantability or fitness for a
particular purpose. See the licence for details.
