# When a Connector Needs to Actually Find Its Way

The sticky-connector rules assume a route can be drawn with one or two bends.
These are the cases where that assumption breaks, and something closer to real
pathfinding is required.

Each shows **the task**, the **naive** route an L or Z gives, and the **ideal**.

A note on what "ideal" costs. Everything here is a shortest-path search on the
grid, and the interesting part is not the search but the **cost function** — what
the route is charged for. The scenarios below are really arguments about that
function, and the last section collects the prices they imply.

---

## 1. Something squarely in the way

**The task** — connect A to B.
```
┌───┐       ┌───┐       ┌───┐
│ A │       │   │       │ B │
└───┘       │ X │       └───┘
            │   │
            └───┘
```

**Naive** — straight through, skewering X
```
┌───┐       ┌───┐       ┌───┐
│ A │───────┼───┼──────▶│ B │
└───┘       │ X │       └───┘
            │   │
            └───┘
```

**Ideal** — go under
```
┌───┐       ┌───┐       ┌───┐
│ A │──┐    │   │    ┌─▶│ B │
└───┘  │    │ X │    │  └───┘
       │    │   │    │
       │    └───┘    │
       └─────────────┘
```

The naive line does not merely look wrong. Those `┼` are X's own border cells,
merged into the line — X now has a hole in each side, and the only way back is
undo. On a character grid, "route through" and "damage" are the same act.

---

## 2. A wall with one gap

**The task** — connect A to B through the only opening.
```
┌───┐     ┌───┐     ┌───┐
│ A │     │ W │     │ B │
└───┘     │   │     └───┘
          └───┘

          ┌───┐
          │ W │
          │   │
          └───┘
```

**Naive**
```
┌───┐     ┌───┐     ┌───┐
│ A │─────┼───┼────▶│ B │
└───┘     │   │     └───┘
          └───┘

          ┌───┐
          │ W │
          │   │
          └───┘
```

**Ideal** — find the gap and thread it
```
┌───┐     ┌───┐     ┌───┐
│ A │──┐  │ W │  ┌─▶│ B │
└───┘  │  │   │  │  └───┘
       │  └───┘  │
       └─────────┘

          ┌───┐
          │ W │
          │   │
          └───┘
```

This is the first case a bend-count heuristic cannot solve. Nothing about A or B
says where the gap is; the route has to be *searched for*.

---

## 3. A pocket that leads nowhere

A greedy router walks toward the target, finds an opening, and takes it. The
opening is a dead end.

**The task** — the opening faces A, and closes behind it.
```
        ┌───────┐
        │       │
┌───┐           │   ┌───┐
│ A │           │   │ B │
└───┘   │       │   └───┘
        │       │
        └───────┘
```

**Naive** — into the pocket, then straight out through the back wall
```
        ┌───────┐
        │       │
┌───┐           │   ┌───┐
│ A │───┬───────┼──▶│ B │
└───┘   │       │   └───┘
        │       │
        └───────┘
```

**Ideal** — over the top, never entering
```
      ┌───────────┐
      │ ┌───────┐ │
      │ │       │ │
┌───┐ │         │ │ ┌───┐
│ A │─┘         │ └▶│ B │
└───┘   │       │   └───┘
        │       │
        └───────┘
```

Note the `┬` in the naive picture: the line did not merely cross the pocket's
wall, it *joined* it. The diagram now claims a connection nobody drew.

Greedy-toward-the-goal is not enough. The search has to be willing to move
*away* from B before it can reach it.

---

## 4. Threading a one-cell gap

**The task** — P and Q leave exactly one row between them.
```
┌───┐   ┌───┐   ┌───┐
│ A │   │ P │   │ B │
└───┘   └───┘   └───┘

        ┌───┐
        │ Q │
        └───┘
```

**Ideal** — one cell is enough
```
┌───┐   ┌───┐   ┌───┐
│ A │─┐ │ P │ ┌▶│ B │
└───┘ │ └───┘ │ └───┘
      └───────┘
        ┌───┐
        │ Q │
        └───┘
```

**Open question.** A one-cell gap is *passable* but cramped — the line touches
both boxes along its whole length. Should the router charge for hugging and take
a longer clear route where one exists? My instinct is yes, with a small penalty:
enough to prefer breathing room, not enough to refuse the only way through.

---

## 5. Two connectors arriving at the same box

**The task** — both A and C point at B.
```
┌───┐
│ A │
└───┘
            ┌───┐
            │   │
            │ B │
            │   │
┌───┐       └───┘
│ C │
└───┘
```

**Naive** — both take the cheapest route, merge, and arrive as one arrow
```
┌───┐
│ A │──┐
└───┘  │
       │  ┌───┐
       ├─▶│ B │
       │  └───┘
┌───┐  │
│ C │──┘
└───┘
```

**Ideal** — they arrive separately, on the rows that face them
```
┌───┐
│ A │──┐
└───┘  │  ┌───┐
       └─▶│   │
          │ B │
       ┌─▶│   │
┌───┐  │  └───┘
│ C │──┘
└───┘
```

Two arrows that merge into a `├` have stopped being two arrows. Whatever else
the router does, it must not quietly turn two facts into one.

---

## 6. Crossing another connector

**Naive** — crosses C's line although there was room to go around
```
        ┌───┐
        │ C │
        └─┬─┘
┌───┐     │     ┌───┐
│ A │─────┼────▶│ B │
└───┘     │     └───┘
          ▼
```

**Ideal** — dip under, and leave both lines readable
```
        ┌───┐
        │ C │
        └─┬─┘
┌───┐     │     ┌───┐
│ A │──┐  │  ┌─▶│ B │
└───┘  │  ▼  │  └───┘
       │     │
       └─────┘
```

A `┼` is at least honest about being a crossing, and when there is no way round
it is the right glyph. But a crossing is a small lie about a diagram either way —
readers see junctions. The router should prefer not to make one.

---

## 7. Shortest, or fewest turns?

Both of these are **fourteen cells long**. They are not equally good.

**Eight bends**
```
┌───┐
│ A │
└─┬─┘
  └─┐
    └─┐
      └─┐
        └─┐ ┌───┐
          └▶│ B │
            └───┘
```

**One bend**
```
┌───┐
│ A │
└─┬─┘
  │
  │
  │
  │         ┌───┐
  └────────▶│ B │
            └───┘
```

**Ideal** — the second, and it is not close. A bend should cost several cells'
worth of distance. Staircases are what you get when a router optimises the wrong
number; they read as noise rather than as a line going somewhere.

---

## 8. Text is an obstacle too

**The task**
```
┌───┐                    ┌───┐
│ A │  invariant note    │ B │
└───┘                    └───┘
```

**Naive** — the note is overwritten, and it is not coming back
```
┌───┐                    ┌───┐
│ A │───────────────────▶│ B │
└───┘                    └───┘
```

**Ideal**
```
┌───┐                    ┌───┐
│ A │─┐invariant note ┌─▶│ B │
└───┘ │               │  └───┘
      └───────────────┘
```

Anything occupied is an obstacle. There is no separate annotation layer to route
above — that is the whole bargain of the character grid.

---

## 9. No route exists

**The task** — B is sealed in.
```
┌───┐   ┌─────────┐
│ A │   │ ┌─────┐ │
└───┘   │ │  B  │ │
        │ └─────┘ │
        └─────────┘
```

**Ideal** — refuse, visibly
```
┌───┐   ┌─────────┐
│ A │   │ ┌─────┐ │
└───┘   │ │  B  │ │
        │ └─────┘ │
        └─────────┘
```
> *"No route to that shape — it is fully enclosed."*

The wrong answers are drawing through the wall, and drawing nothing without
saying why. A router that can fail must be able to *report* failing.

---

## 10. Room to breathe

**Technically fine** — the route runs flush along X for its whole length
```
┌───┐ ┌───┐
│ A │ │ X │
└─┬─┘ │   │
  └──┐│   │
     ││   │
     │└───┘
     ▼
```

**Ideal** — a cell of clearance, when the space is there
```
┌───┐  ┌───┐
│ A │  │ X │
└─┬─┘  │   │
  └─┐  │   │
    │  └───┘
    ▼
```

A line flush against a box starts to look like part of it. Clearance is not
decoration; it is what keeps the shapes readable as separate things.

---

## What this implies about cost

Reading the ten cases back, the router is a shortest-path search where the price
list matters more than the algorithm:

| Charge for | Roughly | Because |
|---|---|---|
| Each cell travelled | 1 | the baseline |
| Each bend | 8–12 | §7 — same length, unreadable |
| Running flush against a shape | 2–3 per cell | §4, §10 — clearance keeps shapes distinct |
| Crossing another line | 30+ | §6 — legal, but a last resort |
| Passing through anything occupied | ∞ | §1, §8 — on a grid this is damage |

Three properties fall out that are worth stating as requirements rather than
preferences:

1. **It must be a real search.** Greedy walking fails §2 and §3.
2. **It must be able to fail.** §9 has no answer, and inventing one is worse
   than reporting none.
3. **It must be bounded.** A search over an unbounded plane needs a budget. A
   sensible one is the bounding box of the two endpoints expanded by a margin,
   with the naive L as the fallback when the budget runs out — degrading to
   today's behaviour rather than to a hang.

And one thing deliberately *not* on the list: routing may only ever move the
connector. It must never move, resize or nudge a shape to make room. That would
be a much larger promise, and a far more surprising one.

---

## Where this stands

Built: [`route/astar.ts`](../src/core/route/astar.ts) is the search,
[`route/cost.ts`](../src/core/route/cost.ts) the price list and the obstacle map,
and [`route/connectors.ts`](../src/core/route/connectors.ts) calls them. Every
scenario below is pinned by a test in [`tests/route.test.ts`](../tests/route.test.ts).

| | |
|---|---|
| §1 something in the way | ✅ goes around |
| §2 a wall with one gap | ✅ finds the gap |
| §3 a pocket that leads nowhere | ✅ never enters it |
| §4 threading a one-cell gap | ✅ takes it, and is not scared off it by the hug price |
| §5 two connectors at one box | ❌ they still pile onto one side — needs `assignAnchors` |
| §6 crossing another connector | 🟡 goes *around* another line, which is this section's own ideal; it will not cross one at a price, because it cannot tell a shaft from a wall |
| §7 shortest or fewest turns | ✅ a bend costs ten cells |
| §8 text is an obstacle | ✅ |
| §9 no route exists | 🟡 says so, but draws the plain line anyway — see below |
| §10 room to breathe | ✅ hugging is charged for |

### One decision the ten scenarios did not settle

**The plain elbow is tried first, and kept when it fits.** Not as an
optimisation, though it is one — about half a millisecond a frame — but because
the search cannot tell the difference between two equally priced routes and this
document can. An elbow two cells left of another costs exactly the same; only one
of them is the picture in [sticky-connectors.md](sticky-connectors.md) §1.1.
Searching first and taking whichever equal answer came off the heap first
redrew every connector in the editor for no reason a user could see.

So the search runs when the simple route would go through something, which is
the case it was built for. Everywhere else the editor draws what it always drew.

### What the price list is worth

The numbers in the table above are the defaults in `DEFAULT_COSTS`, and one of
them carries almost all the weight: a bend at **ten**. Set it to zero and the
router answers §7 with a staircase of the same length — there is a test that
does exactly that, because a price list with no test is a wish.

### Section 9 was overruled by ordinary use

The first build did what this document asks: no route meant the connector was
left exactly where it was, and the status bar said why. Then a box was dragged
*into* another box — an ordinary thing to do — and every arrow attached to it
stayed behind. An enclosed shape has no clear route by definition, so the
refusal fired on the most normal gesture there is.

A line that stops following its box is a worse answer than a line that overlaps
something. So a blocked route now falls back to the plain elbow and the note
explains the untidiness. Drag the box back out and there is a clear route again,
so routing resumes by itself — nothing is remembered, because nothing about this
is stored.

What survives of §9 is the part that mattered: the router still *reports*
failure rather than pretending, and the caller decides what to do about it.
Drawing through a wall is a poor answer, and this document was right that it is
poor. It is still better than the connector letting go.
