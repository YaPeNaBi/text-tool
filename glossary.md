# Glossary

The words this project uses, as the code actually uses them.

Written because several of them are ordinary English words doing narrow technical
jobs, and two of them — **shape** and **component** — mean close to the opposite
of what they mean in conversation. Where that happens it is flagged, because
picking the wrong one silently is how a request gets built backwards.

Each entry says what the thing *is*, and where it lives.

---

## The document

| Term | Meaning |
|---|---|
| **document** | The whole drawing. A `Map` from `"x,y"` to one character, and nothing else — no shape objects, no ids, no z-order. The only thing that is saved, and the only thing undo restores. [`core/grid/grid.ts`](src/core/grid/grid.ts) |
| **cell** | One character position. `{x, y}`. |
| **cell key** | A cell as the string `"x,y"`. What the document is keyed by. |
| **glyph** | A drawing character — `─ │ ┌ ┼ ▶`. Distinguished from *text*, which is everything else. A glyph declares connectivity; text declares none. |
| **text** | Any character that is not a glyph. Never traced through, so a `v` in the middle of a word stays a letter. |
| **diff** | A `Map` from cell key to character, or `null` to erase. Every mutation is one of these, and applying one returns its exact inverse — which is the whole of undo. |
| **occlusion** | Moving something over something else destroys what it lands on. A documented limitation, not a bug: there are no layers to preserve. |

## Connectivity — how characters decide they touch

Connectivity is **never stored**. It is re-derived from a character and its four
neighbours every time it is needed.

| Term | Meaning |
|---|---|
| **arm** | One of the four directions a glyph reaches: north, east, south, west. `┌` has a south arm and an east arm. |
| **mask** | The four arms as a bitfield. `maskOf(grid, x, y)` is *this cell's arms right now* — for ambiguous glyphs (`+`, `┼`) that means narrowed to the directions a neighbour actually answers in. |
| **connected** | Two neighbours that **both** point at each other. A `─` beside a `│` is not connected: neither reaches the other. |
| **junction** | A cell where more than two arms meet — where a line branches. Junctions stop walks. |
| **crossbar** | A cell running *across* the direction you are walking. What tells a real table separator (capped by a wall at both ends) from a line hanging in space. |

## Recognition — what is under the pointer

There are no shape objects, so structure is worked out afresh on every click.
This is the heart of the editor and its five stages have their own words.

| Term | Meaning |
|---|---|
| **component** | ⚠️ **The whole connected blob.** Everything reachable by flooding across connectivity from one cell. Two boxes drawn flush are **one** component. A box with a wire into it is one component with the wire *and* whatever the wire reaches. [`core/recognize/trace.ts`](src/core/recognize/trace.ts) |
| **trace** | Stage ①. The flood fill that produces a component. |
| **run** | A straight stretch of cells between two nodes. |
| **node** | An interesting cell in the run graph: a loose end, a corner, or a junction. |
| **run graph** | Stage ②. A component collapsed to nodes and runs. A 40×20 box becomes 4 nodes and 4 runs instead of 116 cells. |
| **reading** (*candidate*) | Stage ③. **One way of interpreting a click.** A click on two flush boxes has several honest readings: the left box, the right box, the pair as one rectangle, the whole blob. The editor refuses to guess between them; it enumerates. |
| **kind** | Which matcher claimed a reading: `box`, `ellipse`, `arrow`, `line`, `text`, or `cells` — the fallback that always succeeds, so a click never dead-ends. |
| **ranking** | Stage ④. Every reading, ordered smallest first, with the whole component last. Two rules keep it honest: an outline must *connect*, not merely be present; and a closed shape outranks an open one regardless of size. |
| **strand** | How far the run graph can be walked **without passing through a junction**. This is what makes a wire that has merged into a box selectable on its own. |
| **drill** | Clicking the same cell again to step outward through its readings. The status bar's `2/3`. |

## Shapes and what they contain

| Term | Meaning |
|---|---|
| **shape** | ⚠️ **A closed outline** — something with an inside. Formally: every cell of its own bounding box's border is present (`enclosesArea`). A box is a shape; a wire is not; a *table* is a shape even though no rectangle matcher will claim it. Deliberately **not** the same as a component. |
| **closed** | A reading whose kind is `box` or `ellipse`. Narrower than *shape*: a box with a wire through its wall reads as `cells`, and is still a shape. |
| **container** | A shape that something else sits wholly inside. Containment is inferred from geometry, never declared. |
| **label** | The text written inside a shape, and how it was aligned. |
| **travelling set** | Everything that moves when a shape moves: the shape, its label, and every component wholly inside it. Blank space is never included, which is why dropping a box around a word *adopts* the word instead of erasing it. |
| **cascade** | The travelling set running downward through nesting. It never looks upward: a child has no way to drag its parent. |

## Lines that follow things

| Term | Meaning |
|---|---|
| **connector** | A line **attached to a shape**: it runs into the shape, or an arrowhead is aimed at it. Looser than *connected* on purpose — a line drawn up to a `│` does not join it, because that wall offers no sideways arm. |
| **sticky** | Connectors are re-routed to follow the shape they are attached to when it moves or resizes. |
| **anchor end / free end** | The connector's two ends. On a re-route the free end **stays exactly where it was** and the path is redrawn from there — which is what makes this routing rather than translation. |
| **stroke** | A freehand drag, as the list of cells the pointer passed through. Densified into a 4-connected walk before it is drawn, because samples arrive with gaps. |
| **decoration** | What an end wears — an arrowhead, a tick. A *weak* glyph: it only counts as part of a line when a shaft is behind it, which is what lets notation characters sit at the end of a wire without being read back as wire. |
| **stranded** | A connector the router could find no clear path for. It goes straight there and says so in the status bar. |

## Tables

A table is not a thing. It is boxes sharing walls, read as a lattice.

| Term | Meaning |
|---|---|
| **lattice** | The grid of walls inside a shape. What makes a box a table. |
| **rail** (*separator*) | One divider — the `│` or `─` between two cells. Only counts as one when a crossbar caps **both** its ends. |
| **track** | The column or row *beside* a rail. Dragging a rail resizes the track next to it. |
| **cell** (of a table) | ⚠️ Careful: in table talk this means one box of the lattice, not one character position. |

## The actions menu

| Term | Meaning |
|---|---|
| **group** | A menu item that opens more items instead of doing something. Drawn with a `▸`. |
| **level / row** | One step down the menu tree, drawn as a row beneath the last so the whole path stays visible. |
| **path** | Where the keyboard is in the menu: one index per level, the last being the highlighted item. Read fresh from the selection every time, never stored as a tree. |
| **hint** | The cells a menu item is *about*, washed in the cursor's colour while it is pointed at. What makes "End 1" and "End 2" tell each other apart. |

## Operations

| Term | Meaning |
|---|---|
| **stamper** | A pure function `parameters → diff` that draws something. |
| **matcher** | Its twin: `cells → is it one of these?`. Matchers are defined *in terms of* their stamper, so the two cannot drift. Adding a shape type means adding a stamper/matcher pair and wiring, nothing else. |
| **plan** | What every operation returns: one diff, optionally a new selection, a refusal, or a status-bar note. One gesture is one plan is one undo step. |
| **refusal** | An operation declining, with a reason the user sees. A refused plan changes **nothing** — that is the point of refusing. Resizing is the only operation that refuses, because it is the only one where the damage lands on something the user never touched. |
| **note** | One line for the status bar, when a change reached further than the pointer did. |
| **heal / mend** | Re-deriving the glyphs around something that was removed. Take a wire away and the `├` it joined becomes a `│` again. |

## The keyboard and the session

Session state is never undoable and never saved. In a multiplayer version it
would become presence data.

| Term | Meaning |
|---|---|
| **mode** | The active tool, seen from the keyboard. **Select** is the one you live in: it points, selects and navigates, and does not write. A bare letter leaves it — `b` box, `t` text, `c` connect, `s` circle — and `Escape` or two taps of `Ctrl` comes back. Under any other mode those letters mean nothing, which is the whole point: `b` means box *there*. |
| **cursor** | Where the keyboard is. Always somewhere, in every mode. |
| **caret** | The same position, drawn as a blinking bar because it is *for* typing. One position, two readings — never both at once, and the **mode** says which: a caret exists under `text` and nowhere else. |
| **walk** | Moving the cursor a cell at a time. `hjkl` or the arrow keys, interchangeably, under select. |
| **hover** | Where the pointer is. The cursor's equal for people holding a mouse. |
| **sweep** | Extending a selection with `Shift`+arrow. The **anchor** is where it started; the run grows from there, so it can shrink again. |
| **jump** | `Ctrl`+arrow: the spreadsheet move — ride a run to its end, or cross a gap to the next thing. Stops at junctions. |
| **stride** | `Alt`+arrow: a fixed coarse step, ten cells across and five down. Different distances because a cell is about twice as tall as it is wide, so both cover about the same ground on screen. |
| **draft** | A shape being drawn from the keyboard: one corner pinned, the cursor the other. |
| **chain** | A line being drawn corner by corner, before it is committed. |
| **object select** | Growing a selection by whole objects rather than by cells. Entered by a double-tap of `Shift`. |
| **rung / ladder** | The steps a repeated key walks through — `Enter` going from the smallest shape to the whole one. The rung is read back off the current selection, never stored, so anything else that changes the selection starts the ladder again. |
| **piece** vs **component** | What `Ctrl`+click and `Shift`+click take, respectively. A piece is the reading a plain click would take; a component is the whole connected thing. |

---

## The two collisions, spelled out

These are the ones worth agreeing on, because both words get used casually in
the opposite sense.

**shape** — in this codebase, a *closed outline*: one box, one table, one
circle. Casually it often means "the whole drawing I can see", which here is a
**component**.

> `Enter` widens to the whole **shape** and deliberately stops there.
> `Ctrl`+`Enter` takes the whole **component** — lines and everything they reach.

**component** — in this codebase, *everything connected*. Casually it often
means "one of the parts", which here is a **piece** or a **reading**.

> `Shift`+click adds a whole **component**. `Ctrl`+click adds one **piece**.

If either of those is the wrong way round for you, say so — the names are
cheaper to change than the habit of reading them wrong.
