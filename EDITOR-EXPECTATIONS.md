# Controls, and the Programs Worth Stealing From

> **Revised** after reading the code. The first draft of this file was written against an empty
> directory and guessed at what the app was; it guessed wrong in ways that mattered, and §6
> records what it got wrong rather than quietly deleting it.
>
> The keymap reviewed in §3 is the one in the **working tree**, not the last commit.

## 0. What the app actually is

Not a raw character canvas. **The characters are the entire model, and structure is read back
out of them on demand.** Four facts from `behaviour-goals.md` constrain every control decision
below:

- **`B-DOC-01`** — the document is a sparse map from cell to a single character. Nothing else.
- **`B-DOC-06`** — no shape objects, no ids, **no z-order**. Recognition recovers structure
  every time; nothing is stored.
- **`B-CONN-01`** — connectivity is derived from a glyph plus its four neighbours, never stored.
- **`B-MAN-04`** — where a move lands, it overwrites, permanently. The grid has no memory of
  what sat underneath.

This gives a sharp test for every idea in this document:

> **Does it require remembering something the characters do not say?**
> If yes, it is out — however good it is elsewhere.

That test is what rules out layers (§6.1), and it is why this app has more in common with
`ditaa` and `svgbob` than with draw.io.

---

## 1. Not three models but four

The first draft had three interaction models colliding — stream (vim, VS Code), grid (Excel),
canvas (Paint). That framing survives, but it missed the category this app is actually in.

| | stream | grid | canvas | **recognising grid** |
|---|---|---|---|---|
| Exemplars | vim, VS Code, Notepad++ | Excel, Sheets | Paint, REXPaint | **this app**, ditaa, svgbob, Monodraw |
| Model is | lines of text | cells | pixels | **characters, plus a reading of them** |
| A box is | some `+` and `-` | some cells | some pixels | **a box, until you edit it into something else** |
| Selecting picks | a range | a range | a region | **an interpretation** — and there may be several (`B-REC-11`) |

The fourth column is the interesting one and has almost no prior art in *editors* — the
recognition work has mostly been done in one-way **renderers** (§2.1), which read ASCII art and
emit a picture but never hand it back. This app is the rarer thing: a recogniser you can keep
typing into. That is worth knowing when looking for references, because it means the closest
matches for the two halves of the app sit in two different families.

---

## 2. Programs worth stealing from

The first draft covered vim, Notepad++, VS Code, Emacs, nano, Excel, Paint, Aseprite, ASCIIFlow,
Monodraw and draw.io. Those still apply. Below are the ones it missed — **found by looking at
what this project actually does**: recognition, sticky connectors, character-grid tables,
grow-to-fit, and charset packs.

### 2.1 The recognisers — closest prior art for the core

| | What it is | Take |
|---|---|---|
| **ditaa** | Reads a plain-text diagram and emits a bitmap. Recognises boxes, dashed edges, arrowheads, and colour tags from the characters alone. | Its **tag syntax** (`{d}` for a document shape, `cRED` for colour) is how it stores richness *in the characters* rather than beside them — exactly the constraint in §0. If styling is ever wanted, this is the shape the answer has to take. |
| **svgbob** | Rust; ASCII art → SVG. The most complete published set of rules for what a run of characters means. | Its handling of **diagonals and curves** (`/ \ ( )`) — the one axis this app has no answer for. Circles exist, diagonals do not. |
| **asciitosvg / Graph::Easy** | The same trick, older. `Graph::Easy` also goes the other way: graph description → ASCII art. | The **round trip**. Something that can both read and write the grid is the test that a recogniser is complete. |

**Why this family matters most:** they are the only other programs that treat characters as the
authoritative model. Every disagreement between them and this app is worth a look, because both
sides had to answer the same question with the same information.

### 2.2 The ASCII and ANSI art editors — the missing lineage

The first draft reached for MS Paint and Aseprite and skipped the tools built for exactly this
medium.

| | What it is | Take |
|---|---|---|
| **REXPaint** | The serious ASCII art editor (from the Cogmind developer). Layers, brushes, blocks, palettes, per-cell colour. | **Block operations with transparency** — copy a block, and spaces in it either erase or show through, chosen per paste. This app has no answer here yet (§5.4). REXPaint's is the best worked example. |
| **Moebius / PabloDraw** | Modern ANSI art editors, descendants of TheDraw and ACiDDraw. | **F-key glyph palettes**: a bank of box-drawing characters on the function keys, switchable. This app's five charsets are the same idea one level up, and the same UI would serve. Also: PabloDraw is collaborative, which is where M11's multiplayer goes. |
| **TheDraw / ACiDDraw** | The 1990s originals. | The **overtype-first** typing model this app already chose (`B-DRAW-11a`), arrived at independently by everyone who has built one of these. Good confirmation the default is right. |

### 2.3 Diagram editors — for connectors

| | Take |
|---|---|
| **Microsoft Visio** | **Glue and connection points.** Visio distinguishes *point* glue (pinned to one spot) from *dynamic* glue (the connector picks the best side as things move). This app implements dynamic glue (`B-MAN-11d`, `route/sides.ts`) and has no point glue — which is exactly limitation 3, several connectors piling onto one side. Point glue is the standard answer. |
| **OmniGraffle** | **Magnets** — an author declares where connectors may attach. Same fix, friendlier. |
| **draw.io** | **Waypoints**: drag a routed connector and the bend you dragged becomes a constraint the router must honour. The natural next step after A* routing, and the escape hatch for when the router's answer is not the one you wanted. |
| **tldraw / Excalidraw** | Arrow **binding** that survives editing, and a good model for how binding is shown on screen. |

### 2.4 The declarative family — the horizon

**Graphviz, Mermaid, PlantUML, D2, Pikchr.** You describe the graph; layout is computed.

Worth naming for three reasons: they are what much of the audience uses *instead* of an editor
like this; auto-layout is on the roadmap (M11+) and these are where the algorithms live; and
**Pikchr** in particular is the interesting one — relative placement (`right of last box`) with
no coordinates at all, which is what a keyboard-driven diagram editor is groping toward.

**Take:** as an **export target** before an import one. A diagram that can leave as Mermaid is
worth more than one that can only leave as text.

### 2.5 Text tables — the direct match for `tables §8`

The first draft sent tables to Excel. That was half wrong, and the correction matters:

> **Excel does not widen a column when you type past it.** It overflows into the neighbour, or
> shows `####`. The behaviour this project just built — *type past the end and the column
> widens, every row following* — is **Word and Google Docs table behaviour**, not spreadsheet
> behaviour.

| | Take |
|---|---|
| **Emacs `table.el`** | A plain-text table editor, in characters, with cell-wise editing — the single closest published prior art for `ops/lattice.ts`. It recognises tables from `+-|` exactly as this app does, and it **reflows the whole table** as a cell's content grows. |
| **Emacs org-mode tables** | Type, press `Tab`, and the table re-aligns itself. `Tab` in the last cell **creates a new row**. Grow-to-fit as a continuous background behaviour rather than an event. |
| **Word / Google Docs tables** | The real reference for grow-to-fit. Also: `Tab` = next cell, `Shift`+`Tab` = previous, `Tab` at the end adds a row — a convention with no serious competitor (§4.3). |
| **Markdown table formatters** (`prettier`, `mdformat`) | Column widths as a **function of content**, recomputed on every save. The end state of grow-to-fit if it is ever run continuously rather than per keystroke. |

### 2.6 Layout that grows — the vocabulary for grow-to-fit

**Figma and Sketch auto-layout.** A frame is either **fixed** or set to **hug contents**, and
the choice is per axis, visible in the inspector, and switched by dragging an edge.

This is the design vocabulary for what `ops/typing.ts` now does, and it answers a question the
implementation currently decides silently: **when does a box stop growing?** Right now every box
hugs, always, on the horizontal axis. Figma's answer — a box that has been resized by hand is
*fixed* and stops hugging — is worth considering, because "I made this box exactly 40 wide" is a
real intent that typing currently overrides.

### 2.7 Still the right references from the first draft

vim (`virtualedit`, blockwise `Ctrl-V`, `r`), Notepad++ (column editor, `Insert` toggle),
VS Code (command palette, multi-cursor), Emacs `picture-mode` and `artist-mode` (the whole app,
twice, in 1990s Emacs), Excel (navigation, `Ctrl`+arrow, go-to), Paint (transparent selection,
`Shift` to constrain, eyedropper), Aseprite, ASCIIFlow, Monodraw, draw.io.

---

## 3. The current keymap, read against all that

Every binding in the working tree, and what a user arriving from elsewhere expects of it.

| Binding | Does | Expectation elsewhere | Verdict |
|---|---|---|---|
| `Ctrl`+`1`…`7` | tools, toolbar order | Photoshop/Figma/Paint all use **bare letters** (`V` `B` `T`); Ctrl+digit is not a tool convention anywhere | Sound reasoning, incomplete — §4.1 |
| `Ctrl`+`B` | box | `Ctrl`+`B` is **bold** in every text app | Harmless here, but it is the one binding that will be pressed by accident |
| `Shift`+arrow | sweep a **rectangle** (whole objects after a double-tap of Shift) | every text editor extends a selection with `Shift`+arrow ✅ — though it extends a *run*, not a rectangle | ✅ — Shift means "extend the selection", and it does |
| `Ctrl`+arrow | **jump to the edge of the content block** | Excel, VS Code, Notepad++, GNOME, Windows — the same thing everywhere | ✅ — §4.2 was taken; the reading-order sweep moved to `Ctrl`+`Alt`+arrow |
| `Alt`+arrow | nudge the selection | VS Code: move line up/down. Figma/Paint: **arrows nudge, no modifier** | Acceptable; the bare key is spent on cursor movement, which is the right trade |
| bare arrow | step to the next table cell, else move the cursor | Excel/Word: next cell ✅ | ✅ good |
| `Space` | start a box, or drop a line corner | **Hold-space-to-pan** is universal: Figma, Photoshop, Illustrator, Blender, draw.io | Real loss — §4.5 |
| `Enter` | commit the draft; with a caret, newline and grow | Excel: commit and drop a row, returning to the anchor column ✅ | ✅ — the anchor-column return is already there (`B-DRAW-11`) |
| `Tab` | cross between shape and label; loose, +4 cells | Word/Docs/org-mode/Excel: **next cell**, and at the end, a new row | **Wrong inside a table** — §4.3 |
| `Insert` | insert vs overwrite | Notepad++ ✅, with the status-bar indicator ✅ | ✅ exactly right |
| `Escape` | menu → drag → caret → selection | a defined precedence chain, which is more than most apps have | ✅ |
| `Delete`/`Backspace` | erase the selection | ✅ | ✅ |
| `[` / `]` | brush size | Photoshop ✅ | ✅ |
| `Ctrl`+`C`/`V`/`A`/`D`/`Z`/`Y`/`O`/`S` | the CUA set | ✅ | ✅ |
| `Ctrl`+`0`, `Ctrl`+`Home` | zoom reset, camera to origin | `Ctrl`+`Home` means **go to the start of the document** in every text editor, which here would be a caret move, not a camera move | Minor collision, worth knowing |
| middle-drag, wheel, `Shift`+wheel, `Ctrl`+wheel | pan, scroll, h-scroll, zoom | ✅ | ✅ |
| — | *no* `Home` / `End` | universal | Missing — §5.2 |
| — | *no* `Ctrl`+`F` | universal | Missing — §5.1 |

---

## 4. Recommended changes, strongest first

### 4.1 Accept bare letters for tools *as well as* `Ctrl`+digit

The reasoning in `CanvasView.tsx` is sound as far as it goes — "a keyboard where `b` sometimes
types and sometimes changes tool is a keyboard you cannot trust" — and moving tools to `Ctrl`
does make the mapping total. But the cost is that **the muscle memory of every drawing tool ever
made now does nothing**, and the ambiguity it avoids is narrower than it looks: the caret branch
returns before the tool branch is ever reached, so a bare letter is only ambiguous when the user
cannot tell whether a caret is live.

That is a *feedback* problem, and it already has a fix in the codebase — the caret blinks
(`B-UI-07`) and the status bar shows the mode.

**Recommendation:** keep `Ctrl`+digit as the guaranteed path, and *also* accept bare `V B C L A
T E` when no caret is live. Two ways in, one of which never surprises anyone. Figma and
Illustrator both live with exactly this, and both resolve it the same way: `Esc` always leaves
text, so the letters always come back.

### 4.2 Give `Ctrl`+arrow back to jump-to-edge — **done**

`Ctrl`+arrow means *jump to the edge of the contiguous block* in Excel, Sheets, VS Code,
Notepad++, Word, GTK and Windows alike — it is one of the most universally learned keys there
is, and this app has an unusually good use for it: **jump to the far wall of the box you are in,
or across the gap to the next shape.** There is still no way to do that at all.

The sweeps have since been swapped, so the rectangle is on `Shift`+arrow — which is the right
home for it, because `Shift` means "extend the selection" everywhere and on a grid the rectangle
is the commoner want. But that put the reading-order sweep on `Ctrl`+arrow, so the universal key
is still spent on something that has no cross-app convention to honour.

**Recommendation:**

| Key | Meaning |
|---|---|
| `Shift`+arrow | rectangular sweep — unchanged |
| `Ctrl`+arrow | jump to the edge of the content block (Excel) — **new** |
| `Ctrl`+`Shift`+arrow | extend the sweep to that edge (Excel) — **new** |
| `Alt`+`Ctrl`+arrow | reading-order sweep — **moved** off the universal key |
| `Alt`+arrow | nudge — unchanged |

Prose selection is the rarer of the two on a diagram grid, so it is the one that should pay for
the modifier, and the universal key goes back to its universal meaning.

### 4.3 `Tab` should be "next cell" inside a table

Currently `Tab` crosses between a shape and its label, and otherwise moves the caret four cells
right. Inside a table cell, four cells right is close to meaningless — it lands wherever it
lands, possibly in the next cell, possibly on a wall.

`Tab` = next cell is the convention in **Word, Google Docs, Excel, org-mode, `table.el`, HTML
forms and every spreadsheet ever shipped**. The machinery already exists: `neighbourCell()`
answers exactly this question, and bare arrows already use it.

**Recommendation:** `Tab` → next cell, `Shift`+`Tab` → previous cell, when the caret is in a
table. `Tab` in the last cell **adds a row** (org-mode's best trick, and the fastest way to fill
a table there is). Keep the shape/label crossing on `Tab` when there is no table — it is a good
idea with nowhere else to live — and keep the four-cell indent for text loose on the page.

### 4.4 `Shift`+arrow means two opposite things

With a caret live, `Shift`+arrow **moves the selected text**. With no caret, `Shift`+arrow
**sweeps a selection**. The comment in the caret branch says the rule is "bare key moves you,
Shift moves the thing… one rule to learn rather than two" — but the select branch puts
move-the-thing on `Alt` and gives `Shift` to sweeping, so there are two rules after all, and
they contradict on the same key.

Every text editor in existence uses `Shift`+arrow to extend a selection. That is the one to
keep.

**Recommendation:** `Alt`+arrow moves the thing in **both** branches; `Shift`+arrow extends a
selection in both. One rule, and it is the one the whole audience already knows.

### 4.5 Give pan a key again

`Space` is now draw, and the comment is right that it is worth more there. But hold-space-to-pan
is in Figma, Photoshop, Illustrator, Blender, Krita, Inkscape and draw.io, and middle-drag is
not a gesture a laptop trackpad has. Losing it silently costs more than it looks.

**Recommendation:** hold `Alt` and drag to pan (Krita and Blender's alternate), or a `H` hand
tool once bare letters come back under §4.1. Cheap, and it takes nothing away from `Space`.

Note also that `B-CAM-04` and `B-KEY-07` in `behaviour-goals.md` still say `Space` pans. The
README was updated for the new binding and the behaviour catalogue was not.

---

## 5. Behaviours still missing

Ranked by what the audience will notice first.

### 5.1 Find and replace — absent entirely
There is no `Ctrl`+`F` anywhere in the app. For a tool that holds real text — labels, table
cells, paragraphs — this is the most conspicuous gap in the keymap. Three variants are worth
having, and the third is unique to this app:

1. **Find text**, per row, regex optional. Table stakes.
2. **Go to cell** — `Ctrl`+`G`, Excel's Name Box. The status bar already shows the coordinate
   (`B-UI-01`); there is no way to type one in.
3. **Find by shape** — "every box 3 wide", "every arrow that ends nowhere". The recogniser can
   already answer this; nothing exposes it.

### 5.2 `Home` and `End`
Not bound. `Home` should go to the first non-empty cell of the row, then column 0 on a second
press (VS Code's smart-Home); `End` to the last non-empty cell. Inside a box, both should stop
at the walls — which is the version that matters here, and is what makes them worth having.

### 5.3 A command palette
The keymap has grown past thirty bindings and there is no way to discover any of them from
inside the app. `Ctrl`+`Shift`+`P`, listing every command **with its current binding**, is the
cheapest discoverability win available and would also give a home to the commands that will
never earn a key (charset switching, add column, sticky toggle, the §5.1 searches).

### 5.4 Transparent paste
`B-TXT-04` imports one character per cell — opaque. Overlaying a label on existing art needs the
other one, where spaces in the pasted block show through instead of erasing:

```
Canvas       Clip (· = space)   Opaque stamp      Transparent stamp
+------+          ·^·           +-- ^ -+          +---^--+
|      |          <X>           |  <X> |          |  <X> |
+------+          ·v·           +-- v -+          +---v--+
```

REXPaint's per-paste choice (§2.2) is the model. `Ctrl`+`Shift`+`V`, with the paste shown as a
preview outline before it commits — the app already has preview overlays for every other
gesture (`B-DRAW-04`, `B-MAN-02`), so this is consistent rather than new machinery.

### 5.5 Round-tripping a file exactly
`B-TXT-01` trims the document to its bounding box and right-trims every row. Open a file with
three blank leading lines and a right-hand margin of spaces, save it unchanged, and the file is
different. For a `.txt`-native tool (`B-TXT-06`) this is worth a decision rather than a
side-effect: either say so in the limitations, or preserve the leading offset.

### 5.6 Connector waypoints, and more than one attachment point per side
Limitation 3 — several connectors piling onto one side — is Visio's *point glue* problem, and
its solution is well-trodden (§2.3). Waypoints are the escape hatch for when A* is technically
right and visually wrong.

---

## 6. What the first draft got wrong

### 6.1 It recommended layers. Retracted.
Layers were listed as P1: "draw a box over existing art, move it, then flatten". They are
incompatible with `B-DOC-06` — there is no z-order and no stored object to put on a layer, and
adding one would replace the model the whole app is built on.

The project already has a better answer to the same problem, and it is in the working tree:
**push, don't overwrite.** `standingInTheWay()` in `ops/lattice.ts` shoves neighbouring content
out of the path of a growing shape instead of writing over it. That is what layers were wanted
for, achieved without remembering anything — and the reasoning recorded in `README.md` is
sharper than the feature I proposed: *"damage you did not aim at is the thing to prevent; a drop
is aimed."*

### 6.2 It sent grow-to-fit to Excel. Wrong program.
Excel does not widen a column when content overflows. Word, Google Docs, `table.el` and org-mode
do. §2.5.

### 6.3 It called charset switching "non-destructive".
`B-CS-03` makes it a real edit, one undo step, converting the whole document. That is the right
call for an app where the file *is* the model — a display-only setting would mean the document
on disk and the document on screen disagree, which is precisely what §0 forbids. Lossless
(`B-CS-04`) is the property that matters, and it is already guaranteed.

### 6.4 Most of its "must-have" list was already built.
Free 2-D cursor, overwrite by default with an `Insert` toggle, auto-junction glyphs, charset
packs, one-gesture-one-undo, `W×H` in the status bar, tabs expanded on paste — all `[v0]`, most
of them specified in `behaviour-goals.md` before I wrote a word. What survives that list is
§5 above, and it is much shorter.

---

## 7. Open questions

1. **Does a hand-resized box still hug its contents?** (§2.6) Right now typing always grows the
   box. Figma's fixed-vs-hug distinction says a box you sized by hand should stop growing — but
   storing "this one is fixed" is exactly what §0 forbids, so the answer has to be readable from
   the characters or not exist at all. Genuinely hard, and worth deciding on purpose.
2. **Diagonals.** `svgbob` reads `/ \` as lines; this app reads them as text (`B-CONN-06`). Is
   that permanent?
3. **Is the reading-order sweep worth a modifier at all?** It now sits on `Ctrl`+arrow (§4.2),
   which is the most valuable unclaimed key in the app. If nobody selects prose that way, the
   binding is better spent on jump-to-edge.
4. **Export beyond `.txt`.** Mermaid or SVG out (§2.4) is a bigger win than either import.
