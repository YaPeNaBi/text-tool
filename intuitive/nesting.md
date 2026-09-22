# Boxes Inside Boxes

A box drawn inside another box is the most common structure in real diagrams — a
service inside a subnet, a field inside a record, a lane inside a swimlane — and
the editor currently has no concept of it at all. It sees two unrelated
rectangles that happen to overlap in space.

That is not automatically wrong. What these scenarios settle is **whether
containment should be inferred, and what it should buy.**

Every diagram below was produced by the editor's own stampers, so the merge
glyphs in the "naive" pictures are exactly what would really happen.

---

## 1. Clicking picks the innermost thing

```
┌─────────────────┐
│  ┌─────────┐    │
│  │ inner   │    │
│  └─────────┘    │
│      outer      │
└─────────────────┘
```

**Ideal** — clicking the inner border selects the inner box, clicking the outer
selects the outer. Neither is ambiguous, because the two outlines never touch and
are separate connected components.

This already works, and is worth stating precisely because everything else rests
on it: **containment is a spatial fact, not a stored relationship.** Nothing has
to be remembered for the above to be true.

---

## 2. Moving the container takes its contents

**Before**
```
┌─────────────────┐
│  ┌─────────┐    │
│  │ inner   │    │
│  └─────────┘    │
│      outer      │
└─────────────────┘
```

**Naive** — the container slides straight through its own child
```
  ┌─────────────────┐
┌─┼───────┐         │
│ │nner   │         │
└─┼───────┘         │
  │      outer      │
  └─────────────────┘
```

**Ideal** — the contents come along
```
┌─────────────────┐
│  ┌─────────┐    │
│  │ inner   │    │
│  └─────────┘    │
│      outer      │
└─────────────────┘
```

Look closely at the naive picture: the wall has eaten the `i` of `inner`, and the
child's border now carries `┼` where the two outlines merged. Both are permanent
until undo.

This is the single biggest reason to infer containment at all. Without it a
container is not a container — it is a rectangle you must drag everything out of,
one piece at a time.

**The rule:** moving a closed shape moves everything strictly inside its bounds.

---

## 3. Moving the inner box within the container

**Before**
```
┌─────────────────┐
│  ┌─────┐        │
│  │ in  │        │
│  └─────┘        │
│      outer      │
└─────────────────┘
```

**Ideal** — nothing else happens. It is just a move.
```
┌─────────────────┐
│         ┌─────┐ │
│         │ in  │ │
│         └─────┘ │
│      outer      │
└─────────────────┘
```

Containment must not be sticky in the other direction. The child moves freely;
only the parent's move cascades.

---

## 4. Dragging the inner box **out** of the container

The interesting one, and the one with a real decision in it.

**Naive** — it leaves, cutting through the wall on the way
```
┌─────────────────┐
│                 │
│             ┌───┼─┐
│             │ in│ │
│      outer  └───┼─┘
└─────────────────┘
```

**Ideal** — it leaves, and it is simply out
```
┌─────────────────┐
│                 │
│                 │      ┌─────┐
│                 │      │ in  │
│      outer      │      └─────┘
└─────────────────┘
```

**The rule:** membership is re-evaluated on drop, not defended during the drag.
The box leaves because it is no longer inside, and for no other reason.

Two things it must **not** do:

- **Refuse the drag.** Containment is inferred, not declared, so the editor has
  no standing to insist on it.
- **Grow the container to keep it.** Tempting, and wrong: the user dragged the
  child, not the parent.

---

## 5. Dropped halfway across the wall

**On release, straddling**
```
┌─────────────────┐
│            ┌────┼┐
│            │ in ││
│            └────┼┘
│ outer           │
└─────────────────┘
```

**Ideal** — pick a side, and make it look picked
```
┌─────────────────┐
│         ┌─────┐ │
│         │ in  │ │
│         └─────┘ │
│ outer           │
└─────────────────┘
```

**The rule:** in if its centre is in. Half-in is not a state worth having, and
"mostly inside" is the only test that needs no mode and no extra UI.

**Open question.** Should the drop nudge the box clear of the wall, as drawn, or
leave it exactly where it landed with the borders merged? Nudging is friendlier
and gives a clean picture; landing exactly is more honest about what the user
did. I lean to nudging, by the smallest offset that stops the two outlines
touching — but only on the axis that is straddling, so the box does not appear to
slide sideways for no reason.

---

## 6. The container is dragged onto the child

**Before**
```
┌────────┐
│        │    ┌─────┐
│ outer  │    │ in  │
│        │    └─────┘
└────────┘
```

**Ideal** — the child is inside now, and travels with the parent from here on
```
┌───────────────┐
│       ┌─────┐ │
│ outer │ in  │ │
│       └─────┘ │
└───────────────┘
```

Membership is spatial and symmetric: it can be gained by moving the parent, not
only by moving the child. The moment it is gained is the drop.

---

## 7. Resizing a container smaller than its contents

**Before**
```
┌─────────────────┐
│  ┌───────────┐  │
│  │  inner    │  │
│  └───────────┘  │
│      outer      │
└─────────────────┘
```

**Naive** — the wall closes over the child
```
┌────────┐
│  ┌─────┼─────┐
│  │  inn│r    │
│  └─────┼─────┘
│        │
└────────┘
```

**Ideal** — the resize stops at the child
```
┌─────────────────┐
│  ┌───────────┐  │
│  │  inner    │  │
│  └───────────┘  │
│      outer      │
└─────────────────┘
```
> *"Cannot shrink past the contents."*

This is the one place refusal is right, and it is worth being clear why it
differs from §4. There the user acted on the child, and the consequence was the
child's. Here the user acts on the parent and the consequence lands on a child
they never touched. **Damage the user did not aim at is the thing to prevent.**

---

## 8. Three deep

```
┌───────────────────────┐
│ ┌───────────────────┐ │
│ │  ┌───────────┐    │ │
│ │  │   core    │    │ │
│ │  └───────────┘    │ │
│ │      middle       │ │
│ └───────────────────┘ │
└───────────────────────┘
```

**Ideal** — moving `middle` takes `core` and leaves `outer` alone. Containment is
transitive downward and inert upward, and nothing has to be stored to know it:
"strictly inside my bounds" is re-derived on every drag.

Repeated clicks should walk the nesting outward — `core`, then `middle`, then
`outer`. That is exactly the drill-through already built for overlapping shapes,
applied to a case where it reads even more naturally.

---

## 9. A connector from inside to outside

**Before**
```
┌──────────────┐
│ ┌────────┐   │           ┌───────┐
│ │ inner  │───┼──────────▶│ far   │
│ └────────┘   │           └───────┘
└──────────────┘
```

**Ideal after moving the container down** — child and connector both follow
```
┌──────────────┐           ┌───────┐
│ ┌────────┐   │    ┌─────▶│ far   │
│ │ inner  │───┼────┘      └───────┘
│ └────────┘   │
└──────────────┘
```

The connector crosses the container's wall, which on a character grid means a
real `┼` in a real cell. That cell is shared by both shapes and belongs to
neither, so when the wall moves the crossing has to be **recomputed** rather than
carried along.

**The rule:** a cascade move is still **one** operation and **one** undo step —
container, contents, and every connector attached to any of them.

---

## 10. What containment must not become

Stated as non-goals, because each is a plausible next step that would make the
model worse:

- **A stored parent/child link.** The document is characters. The moment
  containment is remembered rather than seen, drawn and pasted diagrams stop
  behaving identically — and that equivalence is the foundation of the design.
- **Automatic layout.** Containers must not reflow, pack or align their
  contents. The user placed those cells.
- **Clipping.** Content poking outside its container stays visible. There is
  nowhere to hide it, and hiding it would be a lie about what the file says.
- **Containment by touching.** Two boxes sharing an edge are neighbours, not
  parent and child — the same rule that already stops a sticky connector
  re-routing a box that merely leans on another.

---

## The rules that fall out

1. **Containment is inferred from the bounds, every time it is needed.** Never
   stored, never remembered.
2. **Moving a container moves everything strictly inside it**, transitively, as
   one undo step.
3. **Moving a child is only a move.** The cascade runs downward, never up.
4. **Membership is decided on drop, by whether the centre is inside.**
5. **A drag may take a child out, and may bring one in.** Neither is refused.
6. **A resize may not close over a child** — the only refusal in the set, and
   only because it is the only case where the damage lands on something the user
   did not touch.
