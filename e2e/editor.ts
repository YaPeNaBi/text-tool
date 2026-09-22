/**
 * Page object for the editor.
 *
 * Two decisions make these tests readable rather than a wall of coordinates:
 *
 *  - **Cell addressing.** Tests say `drag([2, 1], [12, 5])`, not pixels. The
 *    cell size is measured by moving the pointer and reading the coordinate
 *    the app reports, so the suite survives a different font on a different
 *    machine — and never hardcodes what the app already knows.
 *  - **Reading the document back as text.** Everything goes through the real
 *    UI: copy to the clipboard, read the clipboard. No test-only hook in the
 *    app, and asserting on `┌──┐` beats asserting on a cell count.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export interface Metrics {
  cellW: number;
  cellH: number;
}

/** Big enough that a one-pixel rounding error cannot change the answer. */
const CALIBRATION_SPAN = 400;

export class Editor {
  private metrics: Metrics = { cellW: 8, cellH: 17 };

  constructor(private readonly page: Page) {}

  get canvas(): Locator {
    return this.page.locator('.canvas-wrap canvas');
  }

  private status(index: number): Locator {
    return this.page.locator('.statusbar span').nth(index);
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await expect(this.canvas).toBeVisible();
    await this.calibrate();
    // A fresh document per test, whatever the dev server was left holding.
    await this.clear();
  }

  /** Work out the cell size from the coordinates the status bar reports. */
  private async calibrate(): Promise<void> {
    const box = await this.canvas.boundingBox();
    if (box === null) throw new Error('canvas has no box');

    const read = async (dx: number, dy: number): Promise<[number, number]> => {
      await this.page.mouse.move(box.x + 4 + dx, box.y + 4 + dy);
      const text = (await this.status(0).textContent()) ?? '';
      const [x, y] = text.split(',').map((n) => Number(n.trim()));
      return [x ?? 0, y ?? 0];
    };

    const origin = await read(0, 0);
    const right = await read(CALIBRATION_SPAN, 0);
    const down = await read(0, CALIBRATION_SPAN);

    const dx = right[0] - origin[0];
    const dy = down[1] - origin[1];
    if (dx <= 0 || dy <= 0) throw new Error('could not measure the grid');

    // Both are whole pixels by construction, so rounding is exact.
    this.metrics = {
      cellW: Math.round(CALIBRATION_SPAN / dx),
      cellH: Math.round(CALIBRATION_SPAN / dy),
    };
  }

  // ---- reading the document ------------------------------------------------

  /**
   * The document as text, via copy-to-clipboard — the same string a save
   * would write (B-TXT-02).
   */
  async text(): Promise<string> {
    await this.canvas.hover();
    await this.page.keyboard.press('Control+Shift+C');
    const copied = await this.page.evaluate(() => navigator.clipboard.readText());
    // Windows hands back CRLF whatever went in; the document itself is LF.
    return copied.replace(/\r\n/g, '\n');
  }

  async cellCount(): Promise<number> {
    const text = (await this.status(1).textContent()) ?? '';
    return Number(text.split(' ')[0]);
  }

  /** What the status bar calls the current selection, e.g. `Box 11×5 · 1/3`. */
  async selection(): Promise<string> {
    return (await this.status(2).textContent()) ?? '';
  }

  /** The cell under the pointer, as the status bar reports it. */
  async cursorCell(): Promise<[number, number]> {
    const text = (await this.status(0).textContent()) ?? '';
    const [x, y] = text.split(',').map((n) => Number(n.trim()));
    return [x ?? 0, y ?? 0];
  }

  async zoom(): Promise<string> {
    const span = this.page.locator('.statusbar span', { hasText: /%$/ });
    return (await span.last().textContent()) ?? '';
  }

  async caret(): Promise<string | null> {
    const span = this.page.locator('.statusbar span', { hasText: /^caret / });
    return (await span.count()) === 0 ? null : span.first().textContent();
  }

  // ---- driving it ----------------------------------------------------------

  async tool(label: string): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(`^${label}`) }).click();
  }

  async clear(): Promise<void> {
    await this.page.getByRole('button', { name: 'Clear' }).click();
    await this.page.keyboard.press('Escape');
  }

  /** Screen coordinates of the centre of a cell. */
  private async point(cx: number, cy: number): Promise<{ x: number; y: number }> {
    const box = await this.canvas.boundingBox();
    if (box === null) throw new Error('canvas has no box');
    return {
      x: box.x + cx * this.metrics.cellW + this.metrics.cellW / 2,
      y: box.y + cy * this.metrics.cellH + this.metrics.cellH / 2,
    };
  }

  async drag(
    from: readonly [number, number],
    to: readonly [number, number],
    opts: { steps?: number } = {},
  ): Promise<void> {
    const a = await this.point(from[0], from[1]);
    const b = await this.point(to[0], to[1]);

    await this.page.mouse.move(a.x, a.y);
    await this.page.mouse.down();
    // Several moves, because a real drag is many events and the preview is
    // recomputed from the untouched document on each one.
    await this.page.mouse.move(b.x, b.y, { steps: opts.steps ?? 8 });
    await this.page.mouse.up();
  }

  async click(
    cx: number,
    cy: number,
    opts: { modifiers?: Array<'Shift' | 'Control' | 'Alt'> } = {},
  ): Promise<void> {
    const p = await this.point(cx, cy);
    await this.page.mouse.move(p.x, p.y);
    for (const m of opts.modifiers ?? []) await this.page.keyboard.down(m);
    await this.page.mouse.down();
    await this.page.mouse.up();
    for (const m of opts.modifiers ?? []) await this.page.keyboard.up(m);
  }

  /** A drag called off with Escape before the button comes back up. */
  async abandonedDrag(
    from: readonly [number, number],
    to: readonly [number, number],
  ): Promise<void> {
    const a = await this.point(from[0], from[1]);
    const b = await this.point(to[0], to[1]);

    await this.page.mouse.move(a.x, a.y);
    await this.page.mouse.down();
    await this.page.mouse.move(b.x, b.y, { steps: 6 });
    await this.page.keyboard.press('Escape');
    await this.page.mouse.up();
  }

  async rightClick(cx: number, cy: number): Promise<void> {
    const p = await this.point(cx, cy);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.down({ button: 'right' });
    await this.page.mouse.up({ button: 'right' });
  }

  async hover(cx: number, cy: number): Promise<void> {
    const p = await this.point(cx, cy);
    await this.page.mouse.move(p.x, p.y);
  }

  /** The live values the ribbon is showing for the current tool. */
  async ribbonStates(): Promise<string[]> {
    return this.page.locator('.ribbon-state').allTextContents();
  }

  /** The captions of the ribbon groups, left to right. */
  async ribbonGroups(): Promise<string[]> {
    return this.page.locator('.ribbon-caption').allTextContents();
  }

  async canvasTop(): Promise<number> {
    const b = await this.canvas.boundingBox();
    if (b === null) throw new Error('canvas has no box');
    return Math.round(b.y);
  }

  /** Two taps of Shift, close enough together to read as one gesture. */
  async doubleShift(): Promise<void> {
    await this.page.keyboard.press('Shift');
    await this.page.keyboard.press('Shift');
  }

  async press(keys: string): Promise<void> {
    await this.page.keyboard.press(keys);
  }

  async type(text: string): Promise<void> {
    for (const ch of text) await this.page.keyboard.press(ch === ' ' ? 'Space' : ch);
  }

  /**
   * Write at the keyboard cursor, from select, and come back to select.
   *
   * The navigation tests use a written character as a probe for where the
   * keyboard is — the status bar reports the *pointer's* cell and the caret's,
   * but never the cursor's, so a mark on the grid is the only way to ask.
   *
   * Select does not write any more (B-KEY-21), so the probe is an explicit
   * trip through the text mode: `t` in, the characters, `Escape` back. It
   * leaves the keyboard exactly where plain typing used to — one cell past the
   * last character — so the assertions it feeds are unchanged.
   */
  async mark(text: string): Promise<void> {
    await this.press('t');
    await this.type(text);
    await this.press('Escape');
  }
}
