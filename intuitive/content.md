# Text Inside Shapes

Almost every box in a real diagram has something written in it. The editor
currently treats that text as unrelated characters that happen to sit in the same
region — so moving a box leaves its own label behind.

These scenarios settle what a label *is*, when it travels, and what happens when
things land on top of each other.

Every diagram was produced by the editor's own stampers, so the collisions shown
are exactly what really happens today.

---

## 1. A label travels with its box

**Before**
```
┌───────────┐
│ payments  │
└───────────┘
```

**Naive** — the box moves, the word stays
```
payments

      ┌───────────┐
      │           │
      └───────────┘
```

**Ideal**
```
      ┌───────────┐
      │ payments  │
      └───────────┘
```

**The rule:** text strictly inside a closed shape's bounds is part of that shape,
and moves with it. Like containment, this is *derived* on every drag — never
stored, never a relationship the file has to carry.

---

## 2. Text outside is not a label

**Before**
```
┌─────────┐
│ core    │  a loose note
└─────────┘
```

**Ideal after moving the box** — the note stays exactly where it was
```
             a loose note


┌─────────┐
│ core    │
└─────────┘
```

The test is *strictly inside the bounds*, and it has to be strict. A note beside
a box is a note about the diagram, not a caption on the shape, and dragging the
shape must not steal it.

---

## 3. Several lines are still one label

```
┌─────────────┐
│ Order       │
│ #1042       │
│ paid        │
└─────────────┘
```

No special handling. Everything inside the bounds is interior content, however
many rows it occupies, and it all travels together.

---

## 4. A label that outgrows its box

**Naive** — typing past the edge simply replaces the border
```
┌───────┐
│ reconciliation
└───────┘
```

**Ideal** — the box grows to fit
```
┌───────────────┐
│ reconciliation│
└───────────────┘
```

**The rule:** typing inside a shape may grow it rightward and downward to keep
the border intact. This is the one place the editor should move something the
user did not select, and it earns the exception: the alternative is silently
destroying the border, and there is no reading of "type a longer word" that
means "delete the box".

**Open question.** Should it also shrink back when the label is deleted? I think
not. Growing prevents damage; shrinking is just tidying, and tidying that happens
without being asked is how a tool starts to feel possessed.

---

## 5. Resizing below the label

**Before**
```
┌─────────────┐
│ settlement  │
└─────────────┘
```

**Naive** — the border closes over the word
```
┌──────┐
│ settl│ment
└──────┘
```

**Ideal** — the resize stops at the text
```
┌─────────────┐
│ settlement  │
└─────────────┘
```
> *"Cannot shrink past the label."*

The same rule as a container that cannot close over its child: **a resize never
destroys what it encloses.** Edit the text first, and the box will let you.

---

## 6. A box dropped onto loose text

This is the case with a genuinely surprising answer, and the answer is already
right.

**Text ends up in the interior** — it survives, and is now the box's label
```
┌─────────────┐
│ hello world │
└─────────────┘
```

**A border row lands on it** — it is gone
```
┌─────────────┐
│             │
└─────────────┘
```

Both pictures come from dropping the *same* box on the *same* words, one row
apart. The difference is that a shape carries **its border, not its interior**:
the interior was never part of the shape, so it never overwrote anything.

**The rule, worth naming:** dropping a box around text **adopts** it. That is not
a special case to implement — it falls out of only the outline being a shape —
and it is exactly what a person would expect. The one-row-different case is the
price, and undo is the answer to it.

---

## 7. Two labelled boxes collide

**Naive**
```
┌───────┬───┬───────┐
│ alpha │ beta      │
└───────┴───┴───────┘
```

Worth staring at. The borders merged into `┬` and `┴`, so this is no longer two
boxes — it reads as a three-column table, and `alpha` and `beta` now look like
two cells of one row. The document does not just look wrong; **it now means
something else.**

**Ideal** — the same, and that is fine, *provided* the move was one undo step and
the status bar says what happened. Refusing overlap outright would be wrong: two
boxes flush together is a legitimate thing to draw, and §7 of the table document
depends on being able to.

---

## 8. A label on a connector

**Before**
```
┌───────┐   calls       ┌───────┐
│ web   │──────────────▶│ api   │
└───────┘               └───────┘
```

**Ideal after moving `api` down** — the label goes with the line
```
┌───────┐               ┌───────┐
│ web   │──┐            │       │
└───────┘  │            └───────┘
           │  calls
           │            ┌───────┐
           └───────────▶│ api   │
                        └───────┘
```

**The rule:** text adjacent to a connector, and not inside any shape, belongs to
that connector and is re-placed at the midpoint of the new route.

This is the shakiest inference in the document, and the one I would build last.
"Adjacent to a line" is a much weaker signal than "inside a closed shape", and
the failure mode — a stray word teleporting across the diagram — is worse than
the failure it fixes. If it ships, it should require the text to be within one
cell of the line and clear of everything else.

---

## 9. Keeping the label where it was put

When a box is resized, the label should keep the *relationship* it had, not its
absolute offset.

**Before** — centred
```
┌─────────────┐
│  settlement │
└─────────────┘
```

**Ideal, widened** — still centred
```
┌───────────────────┐
│     settlement    │
└───────────────────┘
```

**Ideal, if it had been left-aligned** — still left-aligned
```
┌───────────────────┐
│ settlement        │
└───────────────────┘
```

Alignment is recoverable from the characters: compare the blank run to the left
of the text with the run to its right. Equal within one cell means centred;
otherwise it was placed against a side and should stay there.

**Open question.** Is this over-reach? It is the only case in the document where
the editor moves content the user did not touch, purely for appearance. My
instinct is that it is worth it for centred labels, where the alternative looks
obviously broken, and not worth it otherwise.

---

## The rules that fall out

1. **A label is text strictly inside a closed shape's bounds** — derived every
   time, never stored.
2. **Moving a shape moves its label.** Same cascade as containment, same single
   undo step.
3. **A shape carries its border, not its interior.** So dropping a box around
   text adopts it, and a box moved over text only destroys what its *outline*
   crosses.
4. **Typing may grow a shape** rather than destroy its border. The only
   sanctioned case of the editor resizing something unasked.
5. **A resize never destroys what it encloses** — label or child alike.
6. **Overlap is allowed and destructive**, because undo is the answer and
   forbidding it would forbid legitimate drawings.

Rules 3 and 6 are the pair that carry the character grid's bargain: the editor
does not pretend to have layers, so it must be *predictable* about what
overwrites what, and reversible when it does.
