# A Table Is Not a Shape

Spreadsheets and database tables are the most common thing people draw in ASCII
that the editor has no concept of. A table is not a box, and it is not a group of
boxes — it is a **lattice**, and almost everything a user wants to do to one is a
*structural* edit that reflows the rest.

Our worked example throughout:

```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Ada    │Eng   │36  │
├───────┼──────┼────┤
│Grace  │Admin │45  │
├───────┼──────┼────┤
│Alan   │Eng   │41  │
└───────┴──────┴────┘
```

---

## What the editor sees today

Asked what is under the pointer, the recognizer answers honestly and uselessly.
This is real output, not a caricature:

```
click a top border    (3,0): Box 9×3 | Box 9×5 | Box 9×7 | Box 9×9 |
                             Box 16×3 | Box 16×5 | Box 16×7 | Box 21×3 |
                             Cells 21×9
click an inner cross  (8,2): Box 8×3 | Box 8×3 | Box 9×3 | Box 9×3 |
                             Box 8×5 | Box 8×5 | Box 9×5 | Box 9×5 |
                             Cells 21×9
```

Every one of those rectangles genuinely exists in the characters. Not one of them
is a **row**, a **column**, or a **cell** — and the thing the user actually
clicked on is somewhere in that list, unnamed.

That is the gap. What follows is what the answers should be.

---

## 1. Move the whole table

**Today** — possible, awkwardly: marquee the lot, or click and drill outward to
the last reading (`Cells 21×9`).

**Ideal** — clicking any border and drilling outward reaches `Table 3×4` by name,
and it moves as one shape. Its label in the status bar should say what it is.

Nothing else on this page is possible at all today.

---

## 2. Select a row

**Before**
```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Ada    │Eng   │36  │
├───────┼──────┼────┤
│Grace  │Admin │45  │
├───────┼──────┼────┤
│Alan   │Eng   │41  │
└───────┴──────┴────┘
```

**Ideal** — clicking in a cell and drilling out reaches: cell → row → table.
`Grace / Admin / 45` selects as one thing, borders included, ready to delete,
duplicate, or drag to a new position.

Column selection is the same idea, one axis over — and the two together are the
argument for the table matcher being a *lattice* rather than a list of boxes: you
cannot ask a list of boxes for "the third column".

---

## 3. Insert a row

**Before**
```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Ada    │Eng   │36  │
├───────┼──────┼────┤
│Grace  │Admin │45  │
├───────┼──────┼────┤
│Alan   │Eng   │41  │
└───────┴──────┴────┘
```

**After** — everything below moves down, the lattice stays closed
```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Ada    │Eng   │36  │
├───────┼──────┼────┤
│       │      │    │
├───────┼──────┼────┤
│Grace  │Admin │45  │
├───────┼──────┼────┤
│Alan   │Eng   │41  │
└───────┴──────┴────┘
```

**Today** this is: marquee everything below the insertion point, drag it down two
rows, draw three new boxes, and hope they line up. Every step is a chance to
break the lattice.

---

## 4. Delete a row

**After deleting `Grace`** — the gap closes
```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Ada    │Eng   │36  │
├───────┼──────┼────┤
│Alan   │Eng   │41  │
└───────┴──────┴────┘
```

Note what makes this hard on a grid: deleting the row means deleting its cells
**and** pulling everything below up by two — and the row's top border is shared
with the row above it, so exactly one of the two separators must survive.

---

## 5. Insert a column

**After adding `Team`**
```
┌───────┬──────┬────┬───────┐
│Name   │Role  │Age │Team   │
├───────┼──────┼────┼───────┤
│Ada    │Eng   │36  │Core   │
├───────┼──────┼────┼───────┤
│Grace  │Admin │45  │Ops    │
├───────┼──────┼────┼───────┤
│Alan   │Eng   │41  │Core   │
└───────┴──────┴────┴───────┘
```

---

## 6. Delete a column

**After removing `Role`** — the table closes up horizontally
```
┌───────┬────┐
│Name   │Age │
├───────┼────┤
│Ada    │36  │
├───────┼────┤
│Grace  │45  │
├───────┼────┤
│Alan   │41  │
└───────┴────┘
```

Column operations are the ones that make a table unmistakably not-a-shape: every
single row is edited, and the total width changes. There is no move, resize, or
stamp in the editor today that does anything like it.

---

## 7. Widen a column

**After dragging the first separator right by four**
```
┌───────────┬──────┬────┐
│Name       │Role  │Age │
├───────────┼──────┼────┤
│Ada        │Eng   │36  │
├───────────┼──────┼────┤
│Grace      │Admin │45  │
├───────────┼──────┼────┤
│Alan       │Eng   │41  │
└───────────┴──────┴────┘
```

**The interaction:** dragging a vertical separator should widen the column to its
left and shift everything to its right — the spreadsheet gesture, and the one
people will try first without being told.

---

## 8. Typing more than fits

**Naive** — the text runs straight through the separator into the next column
```
┌───────┬───────────┬────┐
│Name   │Role       │Age │
├───────┼───────────┼────┤
│Ada    │Eng        │36  │
├───────┼───────────┼────┤
│Grace  │Administrato45  │
├───────┼───────────┼────┤
│Alan   │Eng        │41  │
└───────┴───────────┴────┘
```

Look at what that costs: the separator is gone from that row only, so the lattice
is broken in one place. The table is no longer a table, and `Administrato45`
is now a single word.

**Ideal** — the column widens to fit, and every row follows
```
┌───────┬───────────────┬────┐
│Name   │Role           │Age │
├───────┼───────────────┼────┤
│Ada    │Eng            │36  │
├───────┼───────────────┼────┤
│Grace  │Administrator  │45  │
├───────┼───────────────┼────┤
│Alan   │Eng            │41  │
└───────┴───────────────┴────┘
```

This is the same rule as a label growing its box — *typing may grow the thing it
is inside rather than destroy it* — applied to a structure where "grow" means
reflowing thirty other cells.

---

## 9. Reorder rows by dragging

**After dragging `Grace` above `Ada`**
```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Grace  │Admin │45  │
├───────┼──────┼────┤
│Ada    │Eng   │36  │
├───────┼──────┼────┤
│Alan   │Eng   │41  │
└───────┴──────┴────┘
```

Row contents swap; borders do not move at all. Worth stating because the
implementation is the opposite of a normal drag: nothing is translated, the
*text* is rewritten in place.

---

## 10. Sort by a column

**After sorting by `Name`**
```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Ada    │Eng   │36  │
├───────┼──────┼────┤
│Alan   │Eng   │41  │
├───────┼──────┼────┤
│Grace  │Admin │45  │
└───────┴──────┴────┘
```

Sorting needs one thing the others do not: knowing that **the first row is a
header** and must not be sorted. That cannot be inferred reliably — a heavier
separator under row one is a hint, not a guarantee — so it should be a property
the user sets on the table, and the only piece of table state worth remembering.

**But it cannot be stored in the document.** The file is characters. So either
the header is re-inferred each time from the separator style, or sorting simply
asks "treat the first row as a header?" the first time it is used on a table.

---

## 11. Align a column

**After right-aligning `Age`**
```
┌───────┬──────┬────┐
│Name   │Role  │Age │
├───────┼──────┼────┤
│Ada    │Eng   │ 36 │
├───────┼──────┼────┤
│Grace  │Admin │ 45 │
├───────┼──────┼────┤
│Alan   │Eng   │ 41 │
└───────┴──────┴────┘
```

Numbers want to be right-aligned, and doing it by hand across a long table is
miserable. Like §9, this rewrites text without moving a single border.

---

## 12. Paste a table in, copy it out

**Paste** — a block of tab- or comma-separated text dropped on the canvas should
offer to become a table: columns sized to their widest value, borders drawn.
The editor already accepts any text as cells; this is the same import with one
extra question asked.

**Copy** — a selected table should be able to leave as CSV, not just as the
characters that draw it. That is what makes the editor usable *with* a
spreadsheet rather than instead of one.

Both are cheap once the lattice is recognised, and both are worth more than most
of the drawing features, because they are what connects this tool to the rest of
someone's work.

---

## 13. What must not happen

- **No hidden model.** A table must remain exactly the characters that draw it.
  The moment there is a `Table` object with rows and columns in memory that the
  text is rendered *from*, pasted tables and drawn tables stop behaving the same
  — the one equivalence the whole editor is built on.
- **No forced uniformity.** Ragged tables, merged cells and missing separators
  are all legal ASCII. If the matcher cannot recognise one, it must fall back to
  the shapes it does understand, not "repair" the drawing.
- **No silent reflow.** Every operation here rewrites cells far from the
  pointer. Each must be one undo step, and the status bar should say what
  happened: *"Inserted row 3 — 12 cells rewritten."*

---

## What a table matcher would need

The actions above are all easy *given* a lattice, and impossible without one. So
the whole page reduces to one piece of recognition:

1. From a seed on any border, trace the component (already built).
2. Find the **separator lines**: full-height verticals and full-width
   horizontals within the bounding box.
3. If they partition the bounds into a complete grid of rectangles with no gaps
   and no strays, it is a `Table` — with column x-positions, row y-positions,
   and a cell at every intersection.
4. Rank it *below* the individual cell rectangles but *above* the whole-component
   fallback, so drilling outward reads: **cell → row → table**.

Everything else on this page is then a matter of rewriting a rectangular region
from a spec — which is what the stampers already do, one row at a time.

The honest cost estimate: the matcher is a day, and the thirteen operations are a
week. The reason to do it is that a diagram tool that cannot edit a table is not
a diagram tool that people will keep using — tables are where the actual data in
a drawing lives.
