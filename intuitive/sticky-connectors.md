# Sticky Connectors — What "Perfect" Looks Like

Nineteen situations, each shown three times:

- **Before** — the starting arrangement
- **Naive** — the shape moves, the line does not
- **Ideal** — what someone would have drawn if they had planned it this way all along

The **Ideal** column is the target, not a description of the editor. Some of it is
already true; some of it is aspiration. The point is to agree the picture first.

Throughout, the box being dragged is the one that moves. Everything else stays put.

---

## 1. The basics

### 1.1 The far box moves down

**Before**
```
┌─────┐      ┌─────┐
│  A  │─────▶│  B  │
└─────┘      └─────┘
```

**Naive** — the arrow points at nothing
```
┌─────┐
│  A  │─────▶
└─────┘

             ┌─────┐
             │  B  │
             └─────┘
```

**Ideal** — the same sides, an elbow to reach them
```
┌─────┐
│  A  ├──┐
└─────┘  │
         │
         │   ┌─────┐
         └──▶│  B  │
             └─────┘
```

---

### 1.2 The far box moves further away

The simplest case there is. Nothing needs re-thinking, only stretching.

**Before**
```
┌─────┐      ┌─────┐
│  A  │─────▶│  B  │
└─────┘      └─────┘
```

**Naive**
```
┌─────┐             ┌─────┐
│  A  │─────▶       │  B  │
└─────┘             └─────┘
```

**Ideal**
```
┌─────┐             ┌─────┐
│  A  ├────────────▶│  B  │
└─────┘             └─────┘
```

---

### 1.3 The far box moves closer

Worth showing because the naive result is *destructive*, not just untidy: the box
lands on the arrow and eats the arrowhead.

**Before**
```
┌─────┐             ┌─────┐
│  A  │────────────▶│  B  │
└─────┘             └─────┘
```

**Naive** — the head is gone, and undo is the only way back
```
┌─────┐      ┌─────┐
│  A  │──────│  B  │
└─────┘      └─────┘
```

**Ideal**
```
┌─────┐      ┌─────┐
│  A  ├─────▶│  B  │
└─────┘      └─────┘
```

---

### 1.4 The *near* box moves instead

The end that moves is the tail, not the head. The head must stay exactly where it
was — it is pointing at something that has not moved.

**Before**
```
┌─────┐      ┌─────┐
│  A  │─────▶│  B  │
└─────┘      └─────┘
```

**Naive**
```
             ┌─────┐
       ─────▶│  B  │
             └─────┘

┌─────┐
│  A  │
└─────┘
```

**Ideal**
```
             ┌─────┐
         ┌──▶│  B  │
         │   └─────┘
         │
┌─────┐  │
│  A  ├──┘
└─────┘
```

---

## 2. Choosing which side to attach to

The heart of the whole feature. A connector leaves a shape from a *side*, and when
the shapes rearrange, the side that made sense before may not any more. Keeping the
old side stubbornly is the single biggest source of "that looks wrong".

### 2.1 The far box moves directly below

**Before**
```
┌─────┐      ┌─────┐
│  A  │─────▶│  B  │
└─────┘      └─────┘
```

**Naive**
```
┌─────┐
│  A  │─────▶
└─────┘



┌─────┐
│  B  │
└─────┘
```

**Ideal** — B is *below* now, so the arrow should leave the bottom and enter the top
```
┌─────┐
│  A  │
└──┬──┘
   │
   │
   ▼
┌─────┐
│  B  │
└─────┘
```

Keeping the east/west sides would give a pointless dog-leg out to the right and
back again. Nobody draws it that way by hand.

---

### 2.2 The far box moves to the *other side*

**Before**
```
              ┌─────┐      ┌─────┐
              │  A  │─────▶│  B  │
              └─────┘      └─────┘
```

**Naive** — the arrow still leaves eastward, into empty space
```
┌─────┐       ┌─────┐
│  B  │       │  A  │─────▶
└─────┘       └─────┘
```

**Ideal** — the whole connector mirrors
```
┌─────┐       ┌─────┐
│  B  │◀──────┤  A  │
└─────┘       └─────┘
```

---

### 2.3 A long diagonal move

When both axes change a lot, the *dominant* one decides the sides. Here the
horizontal distance is more than twice the vertical, so east/west still wins.

**Before**
```
┌─────┐      ┌─────┐
│  A  │─────▶│  B  │
└─────┘      └─────┘
```

**Naive**
```
┌─────┐
│  A  │─────▶
└─────┘




                  ┌─────┐
                  │  B  │
                  └─────┘
```

**Ideal**
```
┌─────┐
│  A  │─────┐
└─────┘     │
            │
            │
            │
            │     ┌─────┐
            └────▶│  B  │
                  └─────┘
```

---

## 3. Several connectors at once

### 3.1 A hub with three arrows into it

**Before**
```
          ┌─────┐
          │  B  │
          └──┬──┘
             ▼
┌─────┐   ┌─────┐
│  A  │──▶│  H  │
└─────┘   └─────┘
             ▲
          ┌──┴──┐
          │  C  │
          └─────┘
```

**Naive** — three arrows aimed at where the hub used to be
```
          ┌─────┐
          │  B  │
          └──┬──┘
             ▼
┌─────┐             ┌─────┐
│  A  │──▶          │  H  │
└─────┘             └─────┘
             ▲
          ┌──┴──┐
          │  C  │
          └─────┘
```

**Ideal** — every arrow follows, and they **fan out** rather than piling onto one side
```
          ┌─────┐
          │  B  │──────┐
          └─────┘      │
                       ▼
┌─────┐             ┌─────┐
│  A  │────────────▶│  H  │
└─────┘             └─────┘
                       ▲
          ┌─────┐      │
          │  C  │──────┘
          └─────┘
```

B was above and C below, so they still arrive from above and below. Their relative
arrangement is information, and it should survive the move.

---

### 3.2 Two connectors between the same pair

Parallel lines must stay parallel, and must not merge into one another.

**Before**
```
┌─────┐      ┌─────┐
│  A  │─────▶│  B  │
│     │      │     │
│     │◀─────│     │
└─────┘      └─────┘
```

**Naive**
```
┌─────┐
│  A  │─────▶
│     │
│     │◀─────
└─────┘

             ┌─────┐
             │  B  │
             │     │
             │     │
             └─────┘
```

**Ideal** — two routes, still distinct, and deliberately not crossing
```
┌─────┐
│  A  │────┐
│     │    │
│     │◀─┐ │
└─────┘  │ │
         │ │
         │ │ ┌─────┐
         │ └▶│  B  │
         │   │     │
         └───│     │
             └─────┘
```

The two turning columns are chosen apart from one another. Picking the midpoint for
both — the obvious implementation — would have them cross twice for no reason.

---

## 4. Other shapes, other attachments

### 4.1 An arrow into a circle

**Before**
```
             ┌───┐
┌───┐       ┌┘   └┐
│ A │──────▶│  C  │
└───┘       └┐   ┌┘
             └───┘
```

**Naive**
```
┌───┐
│ A │──────▶
└───┘
             ┌───┐
            ┌┘   └┐
            │  C  │
            └┐   ┌┘
             └───┘
```

**Ideal** — the attachment point tracks the widest part of the curve
```
┌───┐
│ A │───┐
└───┘   │
        │    ┌───┐
        │   ┌┘   └┐
        └──▶│  C  │
            └┐   ┌┘
             └───┘
```

---

### 4.2 A plain line, no arrowhead

Identical rules. The only difference is that there is no head to keep pointing.

**Before**
```
┌─────┐      ┌─────┐
│  A  │──────│  B  │
└─────┘      └─────┘
```

**Naive**
```
┌─────┐
│  A  │──────
└─────┘

             ┌─────┐
             │  B  │
             └─────┘
```

**Ideal**
```
┌─────┐
│  A  │──┐
└─────┘  │
         │
         │   ┌─────┐
         └───│  B  │
             └─────┘
```

---

### 4.3 A connector attached to another line, not to a box

Attachment is about characters, not about shapes. A line that ends on another line
is just as attached as one that ends on a box.

**Before**
```
┌─────┐
│  A  │
└──┬──┘
   │
───┴─────────────
```

**Naive** — the stem is left behind, still joined to the rail
```
        ┌─────┐
        │  A  │
        └─────┘
   │
───┴─────────────
```

**Ideal** — the stem follows, and the rail's junction moves with it
```
        ┌─────┐
        │  A  │
        └──┬──┘
           │
───────────┴─────
```

---

## 5. Chains

### 5.1 Move the middle of A → B → C

Both connectors are affected, and they must be re-routed as one gesture, not two.

**Before**
```
┌───┐     ┌───┐     ┌───┐
│ A │────▶│ B │────▶│ C │
└───┘     └───┘     └───┘
```

**Naive**
```
┌───┐               ┌───┐
│ A │────▶     ────▶│ C │
└───┘               └───┘


          ┌───┐
          │ B │
          └───┘
```

**Ideal**
```
┌───┐               ┌───┐
│ A │──┐         ┌─▶│ C │
└───┘  │         │  └───┘
       │         │
       │         │
       │  ┌───┐  │
       └─▶│ B │──┘
          └───┘
```

---

## 6. The hard cases

These are where "perfect" stops being obvious and starts being opinionated.

### 6.1 The natural route would cross something else

**Before**
```
┌───┐               ┌───┐
│ A │──────────────▶│ B │
└───┘               └───┘

          ┌───┐
          │ X │
          └───┘
```

**Naive**
```
┌───┐
│ A │──────────────▶
└───┘

          ┌───┐     ┌───┐
          │ X │     │ B │
          └───┘     └───┘
```

**Ideal** — the elbow shifts clear of X rather than driving through it
```
┌───┐
│ A │────────────┐
└───┘            │
                 │
          ┌───┐  │  ┌───┐
          │ X │  └─▶│ B │
          └───┘     └───┘
```

The naive midpoint elbow would have run straight down through X. Choosing a
different turning column is cheap; realising you needed to is the hard part.

---

### 6.2 The route should *simplify* when it can

Re-routing is not only about adding bends. When the shapes line up again, the bends
should go away.

**Before**
```
┌───┐
│ A │───────┐
└───┘       │
            │
            │      ┌───┐
            └──────│ B │
                   └───┘
```

**Naive** — the elbow is stranded, aimed at where B used to be
```
┌───┐              ┌───┐
│ A │───────┐      │ B │
└───┘       │      └───┘
            │
            │
            └──────
```

**Ideal**
```
┌───┐              ┌───┐
│ A │──────────────│ B │
└───┘              └───┘
```

---

### 6.3 The box lands right next to the other one

There is no longer any room for a connector at all — not one cell.

**Before**
```
┌───┐    ┌───┐
│ A │───▶│ B │
└───┘    └───┘
```

**Naive** — the box lands on the arrow and erases it
```
┌───┐┌───┐
│ A ││ B │
└───┘└───┘
```

**Ideal** — the same, but *deliberately*, and said out loud
```
┌───┐┌───┐
│ A ││ B │
└───┘└───┘
```
> *"Connector removed — no room between the shapes."*

The picture is identical; the difference is that one of them was an accident. An
editor that silently eats work feels broken even when the result is right.

**Open question.** The alternative is to refuse the last cell of the move and keep a
one-cell gap. That protects the connector but overrides what the user asked for, and
this design would rather be honest than clever.

---

### 6.4 An unrelated box is dropped on top of a connector

Nothing here is attached to anything. C is simply in the way now.

**Before**
```
┌───┐               ┌───┐
│ A │──────────────▶│ B │
└───┘               └───┘

    ┌───┐
    │ C │
    └───┘
```

**Naive** — the arrow runs straight through C, which looks skewered
```
┌───┐               ┌───┐
│ A │─┌───┐────────▶│ B │
└───┘ │ C │         └───┘
      └───┘
```

**Ideal** — the connector gets out of the way
```
┌───┐               ┌───┐
│ A │ ┌───┐      ┌─▶│ B │
└─┬─┘ │ C │      │  └───┘
  │   └───┘      │
  └──────────────┘
```

This is the most speculative case in the document, and the most magical when it
works: a connector that yields to content it never knew about. It is also the one
most likely to surprise, since the moved shape and the re-routed line have no
relationship at all.

---

## 7. What "perfect" must refuse to do

Restraint is half the feature. These are cases where the *right* behaviour is to
leave everything alone.

### 7.1 A line that merely runs past a shape

**Before**
```
┌─────┐ │
│  A  │ │
└─────┘ │
        │
```

**Ideal after moving A** — the line is not attached, and does not care
```
        │
        │
        │
        │
┌─────┐
│  A  │
└─────┘
```

Touching is not attachment. The line runs *alongside* the box, never into it.
Getting this wrong would make every diagram feel haunted.

---

### 7.2 Two shapes that share an edge

**Before**
```
┌───┬───┐
│ A │ B │
└───┴───┘
```

**Ideal after moving A down** — B is a neighbour, not a wire
```
    ┌───┐
    │ B │
    └───┘
┌───┐
│ A │
└───┘
```

B must not be re-routed, stretched, or followed. It is a shape in its own right
that happened to be drawn flush.

**What makes this harder than it looks.** The shared column is not A's or B's —
it is `┬`, `│`, `┴`, and it belongs to both. Carry it away and B is left with a
hole where its wall used to be; leave it behind and A lands as an open shape,
still wearing the `┬` of a join it no longer has. Getting the picture above
means doing *both*: the column stays and is re-derived for whoever is left,
and the mover is **redrawn** at its destination rather than carried glyph for
glyph.

---

## The rules that fall out

Reading the nineteen cases back, the ideal behaviour is about six rules:

1. **The far end never moves.** Re-route from it, don't translate the line.
2. **Re-choose the side** from the shapes' new relative position, don't preserve
   the old one. This is the difference between §1 and §2, and it is what makes the
   result look drawn rather than dragged.
3. **Keep the arrangement.** What arrived from above should still arrive from
   above; parallel lines should stay parallel and apart.
4. **Simplify as readily as you complicate.** A bend that is no longer needed
   should go.
5. **Yield to things in the way** — and prefer a different turning point over a
   longer route.
6. **Touching is not attachment.** A connector runs *into* a shape. Anything else
   is a neighbour and must be left alone.

---

## Where today's editor stands

Honest gap analysis against the pictures above.

| Case | Today |
|---|---|
| §1.1 far box moves down | ✅ works |
| §1.2 far box moves away | ✅ works |
| §1.3 far box moves closer | ✅ works — and no longer destroys the box it moved onto |
| §1.4 near box moves | ✅ works |
| §2.1 attach to the nearest side | ✅ works — leaves the bottom, enters the top |
| §2.2 sides mirror | ✅ works |
| §2.3 dominant axis | ✅ works |
| §3.1 hub fan-out | 🟡 all three follow, but they can pile onto one side |
| §3.2 parallel pair | 🟡 both follow; nothing stops them crossing |
| §4.1 circle | ✅ works |
| §4.2 plain line | ✅ works |
| §4.3 attached to a line | 🟡 found and re-routed; the rail's junction is not tidied |
| §5.1 chain | ✅ works |
| §6.1 route around an obstacle | ❌ routes straight through |
| §6.2 simplify | ✅ works — the route is rebuilt from scratch every time |
| §6.3 no room | 🟡 the connector is destroyed, silently |
| §6.4 yield to an unrelated box | ❌ not attempted |
| §7.1 line running past | ✅ correctly ignored |
| §7.2 shared edge | ✅ neither re-routed nor torn — both shapes stay whole |

**What is left is §3 and §6** — telling several connectors apart from one another,
and getting out of the way of things. Both are M13, and both need the router that
does not exist yet; everything above them is now behaviour rather than aspiration.

### One picture in this document was wrong, and then the other one was

§2.1's ideal drew A's bottom edge as `└──┬──┘`, showing the connector *merging*
into the border. §1.1's ideal, two pages earlier, drew a line leaving A's side as
`│  A  │──┐` — touching, not merging. Both cannot be right.

The first answer was **touching**, on the grounds that a merged connector becomes
part of the shape's connected component, which is the case that breaks nesting
§9 — and that it contradicts B-MAN-11a, where attachment is defined as looser
than connection *because* a line drawn up to a `│` only ever touches it.

That answer was wrong, and §2.1 had it right all along. Two reasons:

- **It does not match what the editor draws.** Starting a line on a box's own
  edge is the obvious gesture and it produces a `├`. So did every hand-drawn
  picture in §3 and §5 of this document. A connector that wore a junction until
  the moment you dragged the box, and then quietly stopped wearing one, was the
  editor changing the drawing for reasons the user could not see.
- **The objection no longer holds.** Reading a merged connector used to be the
  thing that failed: from the far box the whole near box was part of the line,
  and a line that is not a simple path is not re-routed. Finding a connector is
  now a **walk** that stops at the junction rather than a flood that swallows it,
  and a click takes the most specific reading rather than the widest — so the box
  is still a box, exactly as two boxes drawn flush still are.

So a line **joins** what it reaches, at either end, and the pictures above are
corrected the other way. An arrow is the one exception: its head has to stay
visible, so it still stops one cell short (B-DRAW-10a). Lifting a connector still
**mends** the border it let go of, which is what stops the junction outliving the
join.

The rule that survived both answers: attachment stays looser than connection.
Joining is how a connector is *drawn*, not how it is *found*.
