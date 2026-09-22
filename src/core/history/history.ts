/**
 * Undo/redo over CellDiffs.
 *
 * Applying a diff returns its inverse, so history needs no per-command undo
 * logic (B-HIST-01). One gesture is one entry (B-HIST-02).
 */

import { applyDiff, type CellDiff, type Grid } from '../grid/grid.ts';

export const HISTORY_LIMIT = 200; // B-HIST-06

export class History {
  private undoStack: CellDiff[] = [];
  private redoStack: CellDiff[] = [];
  /** Which run the top entry belongs to, for coalescing. */
  private openRun: string | undefined = undefined;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Record the inverse of a diff that has just been applied.
   *
   * `run` folds consecutive mutations into one entry — typing a word is one
   * gesture, so it is one undo step (B-HIST-02). Any mutation without the same
   * run id closes the run.
   */
  record(inverse: CellDiff, run?: string): void {
    if (inverse.size === 0) return;

    const top = this.undoStack[this.undoStack.length - 1];
    if (run !== undefined && run === this.openRun && top !== undefined) {
      // The entry must describe the state before the *whole* run, so the
      // earliest value for each cell is the one to keep.
      for (const [key, value] of inverse) {
        if (!top.has(key)) top.set(key, value);
      }
    } else {
      this.undoStack.push(inverse);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }

    this.openRun = run;
    this.redoStack.length = 0; // B-HIST-04
  }

  undo(grid: Grid): boolean {
    const diff = this.undoStack.pop();
    if (diff === undefined) return false;
    this.openRun = undefined;
    this.redoStack.push(applyDiff(grid, diff));
    return true;
  }

  redo(grid: Grid): boolean {
    const diff = this.redoStack.pop();
    if (diff === undefined) return false;
    this.openRun = undefined;
    this.undoStack.push(applyDiff(grid, diff));
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.openRun = undefined;
  }
}
