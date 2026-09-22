# Implementation Plan for the Intuitive Rules

The five design documents in this folder settle **two dozen rules and thirteen
table operations**. This one works out what to build so that those rules are
enforced *structurally* — in one place each, by construction — rather than
sprinkled through the code and re-remembered at every call site.

Companion reading: the rules themselves live in
[sticky-connectors.md](sticky-connectors.md), [pathfinding.md](pathfinding.md),
[nesting.md](nesting.md), [content.md](content.md) and [tables.md](tables.md).
Architecture and milestones live in the root [plan.md](../plan.md).

---

## Four observations that decide the design

### 1. Every rule is about a derived *relationship*, not about characters

Read the rules back and notice what they never mention: glyphs. They talk about
things being *strictly inside*, *attached to*, *in the way of*, or *part of the
same row*. Every one of those is a relationship the characters imply and nothing
stores.

Today those derivations are scattered — `findConnectors` lives in `route/`,
`strandAt` in `rank.ts`, containment and labels do not exist at all. Each new
rule would add another one somewhere else.

**So: one home for derived relationships.** A `derive/` module family whose
every function is `(grid, …) → facts`, pure, and cheap enough to re-run on each
gesture. The name is deliberate: not `scene/`, because a scene is a thing you
*keep*, and keeping it is precisely what this design refuses to do.

### 2. Every operation has the same shape

Move, resize, type, insert-a-row — all of them:

```
gather what is affected → compute the new characters → one CellDiff → apply, or refuse
```

Make that a type and three rules stop needing discipline:

- *"one gesture is one undo step"* becomes structural — an operation returns one
  diff or none, so there is nothing to get wrong.
- *"a resize may not close over a child"* and *"a resize never destroys what it
  encloses"* become a `refused` field. A refusal that has nowhere to live is a
  refusal that gets forgotten.
- *"no silent reflow"* becomes a `note` field the status bar reads. Every table
  operation rewrites cells far from the pointer; saying so is not optional.

**So: `ops/`, where every user operation is a pure planner returning a `Plan`.**
The store stops containing logic and becomes what it claims to be — the single
mutation path.

### 3. Tables need no new machinery

A table looks like the biggest item on the list and is actually the smallest,
because it collapses onto the spine the project already has:

| | Shapes today | Tables |
|---|---|---|
| draw it | `stampBox(rect) → cells` | `stampTable(spec) → cells` |
| recognise it | `matchBox(cells) → rect` | `matchTable(cells) → spec` |
| operate on it | move/resize the rect | **thirteen `spec → spec` functions** |

Insert a row, delete a column, sort, align, widen — each is a few lines of array
manipulation on a `TableSpec`, and then the region is re-stamped. No table
operation ever touches a character directly.

That is the same stamper/matcher pair the project has used for every shape,
applied one level up. It is also what keeps tables honest about rule *"no hidden
model"*: the spec is derived on read and thrown away on write.

### 4. Only one genuinely new algorithm

Routing. Everything else above is bookkeeping over primitives that exist.

Concentrating the risk is the point: `route/astar.ts` is the only file where
being clever is required, it is a pure function over a terrain and a cost table,
and it is testable against text fixtures like everything else in `core`.

---

## Module map

`✓` exists · `+` new · `→` moves

```
src/core/
  geom/cell.ts            ✓  + strictlyInside, centreOf, sidesOf, nudgeClear
  grid/grid.ts            ✓
  charset/charsets.ts     ✓

  derive/                 +  facts the characters imply, recomputed every time
    contain.ts            +  children, descendants, container-of
    label.ts              +  interior text, and how it was aligned
    gather.ts             +  everything that travels with a shape
    attach.ts             →  connectors attached to a shape (from route/connectors.ts)

  ops/                    +  one planner per user operation
    plan.ts               +  the Plan type, diff merging, refusal helpers
    move.ts               +  cascade, membership settle, re-route
    resize.ts             +  refusals, connector re-route
    typing.ts             +  grow-to-fit
    table.ts              +  the thirteen spec → spec operations

  route/
    connectors.ts         ✓  keeps orchestration; sheds finding and side-choice
    sides.ts              +  side selection, anchor placement, fan-out
    cost.ts               +  terrain and the price list
    astar.ts              +  the bounded, direction-aware search

  recognize/
    trace.ts              ✓
    segmentize.ts         ✓
    recognize.ts          ✓
    rank.ts               ✓  + table candidate, cell → row → table ordering
    table.ts              +  the lattice matcher

  stamp/
    box.ts ellipse.ts     ✓
    path.ts erase.ts      ✓
    text.ts               ✓
    table.ts              +  TableSpec → CellDiff

  transform/              ✓  low-level cell moves; unchanged
  history/ io/            ✓  unchanged
```

Four additions, each with one job. Nothing else moves.

---

## What each new module holds

### `derive/contain.ts` — nesting rules 1, 2, 3

```
childrenOf(grid, bounds)      closed shapes strictly inside, non-transitive
descendantsOf(grid, bounds)   the same, transitively, depth-capped
containerOf(grid, shape)      the smallest closed shape strictly containing it
```

Implementation is a bounded scan: walk only the cells inside `bounds`, trace the
components found there, keep the ones that recognise as closed and whose own
bounds are strictly inside. Cost is proportional to the container's area, not the
document's.

### `derive/label.ts` — content rules 1, 2, and 9

```
labelOf(grid, bounds)               text cells strictly inside
labelBoundsOf(grid, bounds)         their bounding box, or null
alignmentOf(shapeBounds, textBounds)  'left' | 'centre' | 'right'
```

`alignmentOf` compares the blank run each side of the text; equal within one cell
means centred. That is the whole of content §9, and it is recoverable from the
characters, which is the only reason that rule is allowed to exist.

### `derive/gather.ts` — the cascade, in one function

```
travellingWith(grid, shape)   shape ∪ label ∪ descendants ∪ their labels
```

This is the single answer to "what moves when I move this", and it is what makes
nesting rule 2 and content rule 2 the *same* rule rather than two features. Note
what it deliberately excludes: blank interior cells. That is what preserves
content rule 3 — a shape still carries its border and its text, never its empty
space, so dropping a box around a word still adopts it.

### `derive/attach.ts` — sticky rule 6

Absorbs `findConnectors` and its helpers unchanged. It moves because *finding*
what is attached is a derivation, while *deciding where it goes* is routing, and
the two have no business in one file.

### `ops/plan.ts` — the keystone

```ts
interface Plan {
  diff: CellDiff;             // every cell this changes; one diff, one undo step
  selection?: Candidate | null;
  refused?: string;           // set instead of diff when the rules say no
  note?: string;              // "Inserted row 3 — 12 cells rewritten"
}
```

with `merge(...diffs)`, `refuse(reason)` and `nothing()`. Every planner returns
one of these; the store does one thing with all of them.

### `ops/move.ts` — nesting 2–5, content 2, sticky 1–6

```
planMove(grid, selection, dx, dy, opts) → Plan
```

1. `travellingWith` to get the full cascade
2. clamp to the quadrant
3. `settleMembership` — the straddle nudge, nesting rule 5
4. lift and drop those cells
5. `derive/attach` on the moved set, `route/` to redraw each connector
6. merge into one diff

Nesting rule 3 — *the cascade runs downward, never up* — is enforced by the fact
that nothing in this list ever looks at `containerOf`.

### `ops/resize.ts` — nesting 6, content 5

```
planResize(grid, selection, handle, dx, dy) → Plan
```

Computes the new rect, then checks it against `descendantsOf` and `labelBoundsOf`
before doing anything. If the new rect would not contain them, it returns
`refuse("Cannot shrink past the contents")` and no diff at all. Otherwise it
re-stamps and re-routes exactly like a move.

### `ops/typing.ts` — content 4

```
planType(grid, caret, ch, mode) → Plan
```

If the character would land on the border of the enclosing shape, the plan grows
that shape by one first and includes both edits in one diff. This is the only
place in the codebase permitted to resize something the user did not select, and
the comment there should say so.

### `route/cost.ts` and `route/astar.ts` — all of pathfinding

```ts
interface RouteCosts { step; bend; hug; cross }      // 1, 10, 2, 30
interface Terrain { blocked(x,y); crossing(x,y); hugging(x,y) }
```

```
terrainFor(grid, { ignore })          the obstacle map, minus the cells we own
findRoute(request) → Route | Failure  A* over (x, y, heading)
```

The node carries a heading so a bend is a cost rather than a post-hoc penalty —
that single choice is what makes pathfinding §7 fall out instead of needing a
smoothing pass afterwards. `budget` bounds the search to the endpoints' bounding
box plus a margin; exceeding it returns a failure, and the caller falls back to
today's L or Z. Failure is a return value, never an exception, because
pathfinding §9 requires being able to say "no route".

### `route/sides.ts` — sticky 2 and 3

```
sideFacing(self, other)              which side should face which     [exists, moves here]
anchorOn(shape, approach, toward)    where on that side               [exists, moves here]
assignAnchors(shape, requests)       several connectors, spread out   [new]
```

`assignAnchors` is sticky rule 3, the one still unbuilt: given every connector
wanting to reach one shape, hand each a distinct cell — sorted by the direction
they come from, so the arrangement survives the move and two arrows never merge.

### `stamp/table.ts` + `recognize/table.ts` + `ops/table.ts`

```ts
interface TableSpec {
  origin: Cell;
  widths: number[];        // per column, borders shared
  rows: string[][];        // cell text
  align?: Array<'l' | 'r'>;
  headerRows?: number;
}
```

```
stampTable(grid, spec, cs) → CellDiff        draw it
matchTable(grid, cells, bounds) → TableSpec  read it back
```

and then thirteen small functions in `ops/table.ts`, every one of them
`(spec, args) → spec`: `insertRow`, `deleteRow`, `insertColumn`, `deleteColumn`,
`resizeColumn`, `fitColumn`, `reorderRows`, `sortBy`, `alignColumn`,
`mergeCells`, `toCsv`, `fromCsv`, `moveTable`.

The plan for each is identical: erase the old region, stamp the new spec, one
diff, and a `note` saying how many cells moved.

---

## Every rule, and where it will live

| Rule | Home |
|---|---|
| **Sticky 1** far end stays attached | `ops/move.ts` (keeps `free`), `route/sides.ts` (may slide) |
| **Sticky 2** re-choose the side | `route/sides.ts` — *shipped* |
| **Sticky 3** keep the arrangement | `route/sides.ts` `assignAnchors` |
| **Sticky 4** simplify | free — routes are rebuilt, never patched |
| **Sticky 5** yield to obstacles | `route/astar.ts` |
| **Sticky 6** touching is not attachment | `derive/attach.ts` — *shipped* |
| **Path 1** a real search | `route/astar.ts` |
| **Path 2** able to fail | `RouteResult` union, `Plan.refused` |
| **Path 3** bounded | `RouteRequest.budget` + expansion cap |
| **Path costs** | `route/cost.ts` |
| **Nest 1** inferred, never stored | `derive/contain.ts` (no state anywhere) |
| **Nest 2** container carries contents | `derive/gather.ts` |
| **Nest 3** cascade downward only | `ops/move.ts` (never calls `containerOf`) |
| **Nest 4** membership on drop | `ops/move.ts` `settleMembership` |
| **Nest 5** in and out both allowed | `ops/move.ts` — by having no refusal |
| **Nest 6** resize may not close over a child | `ops/resize.ts` |
| **Content 1** label is interior text | `derive/label.ts` |
| **Content 2** label travels | `derive/gather.ts` |
| **Content 3** border not interior | `derive/gather.ts` (blank cells excluded) |
| **Content 4** typing may grow | `ops/typing.ts` |
| **Content 5** resize never destroys | `ops/resize.ts` |
| **Content 6** overlap allowed | free — by having no refusal |
| **Content 9** keep alignment | `derive/label.ts` `alignmentOf` |
| **Table** matcher | `recognize/table.ts`, ranked in `rank.ts` |
| **Table** thirteen operations | `ops/table.ts` |
| **Table** no hidden model | spec derived per read, discarded per write |
| **Table** no forced uniformity | `matchTable` returns null and falls back |
| **Table** no silent reflow | `Plan.note` |

Two rules cost nothing to enforce because they are the *absence* of code —
sticky 4 and nesting 5 — and one, content 6, is satisfied by not adding a
refusal. Worth noticing: three of the two dozen rules are already true, and the
temptation will be to write something for them anyway.

---

## Order of work

Each phase is independently shippable and independently useful.

**Phase 1 — foundations.** `geom` additions, `derive/contain.ts`,
`derive/label.ts`, `derive/gather.ts`, `ops/plan.ts`. Move `planMove` off the
store and onto `ops/move.ts` with no behaviour change beyond the cascade.
*Ships: nesting 1–3, content 1–3.* This is the phase that pays for the rest.

**Phase 2 — refusals and growth.** `ops/resize.ts`, `ops/typing.ts`,
`settleMembership`. *Ships: nesting 4–6, content 4–5, 9.* Small, and it removes
the two most destructive surprises in the editor.

**Phase 3 — routing.** `route/cost.ts`, `route/astar.ts`, `route/sides.ts`
fan-out. *Ships: all of pathfinding, sticky 3 and 5.* The one with real
algorithmic risk, deliberately after the foundations so it can be swapped out
without disturbing them.

**Phase 4 — tables.** `stamp/table.ts`, `recognize/table.ts`, `ops/table.ts`,
ranking. *Ships: all thirteen operations.* Last because it is the most code and
the least risk, and because phases 1 and 2 make the operations trivial to write.

---

## What does not change

Worth stating plainly, because a plan this size invites drift:

- **The document is still `Map<"x,y", char>`.** Nothing here adds a field.
- **Nothing is stored.** Containment, labels, attachment and table structure are
  all derived per gesture and discarded. If any of them ever gets cached, drawn
  and pasted diagrams stop behaving identically, and that equivalence is the
  foundation of the whole editor.
- **One mutation path.** `ops/` returns plans; only the store applies them. The
  lint rule that enforces this gets stronger, not weaker.
- **`core` stays DOM-free and pure**, so every rule above is testable against
  text fixtures without a browser.
- **The stamper/matcher spine.** Tables extend it rather than working around it.

---

## Risks worth naming now

**Derivation cost on every gesture.** `travellingWith` traces components inside
the moved shape on each frame of a drag. Mitigation: derive once at
*pointer-down*, not per frame — the set of things travelling cannot change
mid-drag. If that is not enough, the cap is the same one tracing already uses.

**A\* on an unbounded plane.** Covered by `budget` and an expansion cap, with the
current L/Z as the fallback. The failure mode is "routes like today", which is
acceptable; a hang is not.

**Cascade surprise.** Once a container carries its contents, a careless drag
moves more than the user expected. Mitigation: the selection highlight must show
the *gathered* set before the drag starts, so what will move is visible.
`travellingWith` returning the full set makes that free.

**Table matcher false positives.** Two boxes drawn flush look like a 1×2 table.
Mitigation: require at least two separators on one axis, and rank the table
*below* individual cells, so a wrong guess is one click away from the right
answer rather than being forced on the user.

**Scope.** Four phases is a lot. They are ordered so that stopping after any one
leaves the editor better than before, and phase 1 is the only one the others
depend on.
