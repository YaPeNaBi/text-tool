/**
 * What every user operation returns.
 *
 * Move, resize, type, insert-a-row — all of them have the same shape: gather
 * what is affected, work out the new characters, and hand back **one** diff.
 * Making that a type turns three rules from discipline into structure:
 *
 *  - *one gesture is one undo step* (B-HIST-02) — an operation returns one diff
 *    or none, so there is nothing to get wrong;
 *  - *a resize may not close over a child* (nesting §7) and *a resize never
 *    destroys what it encloses* (content §5) — a refusal that has nowhere to
 *    live is a refusal that gets forgotten, so it gets a field;
 *  - *no silent reflow* (tables §13) — every table operation rewrites cells far
 *    from the pointer, and saying so is not optional.
 *
 * Planners are pure and live in `src/core/ops/`. Only the store applies a plan,
 * which is what keeps the single mutation path single (B-DOC-04).
 *
 * See intuitive/plan.md §2.
 */

import type { CellDiff } from '../grid/grid.ts';
import type { Candidate } from '../recognize/recognize.ts';

export interface Plan {
  /** Every cell this operation changes. Empty means "nothing to do". */
  diff: CellDiff;
  /**
   * What should be selected afterwards. `undefined` leaves the selection
   * alone; `null` clears it.
   */
  selection?: Candidate | null;
  /**
   * Set when the rules said no. A refused plan MUST carry an empty diff: the
   * point of refusing is that nothing happened.
   */
  refused?: string;
  /** One line for the status bar, when the change reaches beyond the pointer. */
  note?: string;
}

/** A plan that does nothing, because there was nothing to do. */
export function nothing(): Plan {
  return { diff: new Map() };
}

/** A plan that declines, with the reason the user should see. */
export function refuse(reason: string): Plan {
  return { diff: new Map(), refused: reason };
}

/**
 * Fold several diffs into one, later writes winning.
 *
 * Order matters and is always the same: **lift, then move, then draw.** A
 * re-routed connector is erased before the shape moves and drawn after it
 * lands, so the new path merges with where things ended up rather than where
 * they began.
 */
export function merge(...diffs: ReadonlyArray<CellDiff>): CellDiff {
  const out: CellDiff = new Map();
  for (const diff of diffs) {
    for (const [key, value] of diff) out.set(key, value);
  }
  return out;
}
