/**
 * The gesture surface, driven for real (M6).
 *
 * Everything here is a thing the unit suite structurally cannot check: that a
 * press-drag-release reaches the right stamper, that a click and a drag on the
 * same cell mean different things, that one gesture is one undo step.
 */

import { expect, test } from '@playwright/test';
import { Editor } from './editor.ts';

test.describe('drawing', () => {
  test('a box drag draws exactly its border (B-DRAW-01, B-DRAW-06)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([1, 1], [5, 3]);

    expect(await ed.text()).toBe(['┌───┐', '│   │', '└───┘'].join('\n'));
  });

  test('a drag below the minimum size commits nothing (B-DRAW-03)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([2, 2], [2, 2]);

    expect(await ed.cellCount()).toBe(0);
  });

  test('escape during a drag leaves the document alone (B-DRAW-05)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([1, 1], [6, 4]);
    const before = await ed.text();

    await ed.tool('Box');
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(320, 260, { steps: 4 });
    await ed.press('Escape');
    await page.mouse.up();

    expect(await ed.text()).toBe(before);
  });

  test('boxes drawn flush together share their edge (B-DRAW-07)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    await ed.drag([3, 0], [6, 2]);

    expect(await ed.text()).toBe(['┌──┬──┐', '│  │  │', '└──┴──┘'].join('\n'));
  });

  test('the circle tool draws a closed ring (B-DRAW-13)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Circle');
    await ed.drag([0, 0], [4, 4]);

    expect(await ed.text()).toBe(
      [' ╭─╮', '/   \\', '│   │', '\\   /', ' ╰─╯'].join('\n'),
    );
  });

  test('an arrow stops beside a box rather than through it (B-DRAW-10a)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([8, 0], [12, 2]);
    await ed.tool('Arrow');
    await ed.drag([0, 1], [8, 1]);

    const rows = (await ed.text()).split('\n');
    expect(rows[1]).toBe('───────▶│   │');
  });

  test('clicking corner after corner builds a line, Enter finishes it (B-DRAW-14)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.click(0, 0); // start
    await ed.click(4, 0); // straight run
    await ed.click(4, 3); // a corner
    await ed.press('Enter');

    expect(await ed.text()).toBe(['────┐', '    │', '    │', '    │'].join('\n'));
  });

  test('right-click finishes a line too (B-DRAW-14)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Arrow');
    await ed.click(0, 0);
    await ed.click(3, 0);
    await ed.rightClick(3, 0);

    expect(await ed.text()).toBe('───▶');
  });

  test('escape abandons a line in progress (B-DRAW-05)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.click(0, 0);
    await ed.click(5, 0);
    await ed.click(5, 4);
    await ed.press('Escape');

    expect(await ed.cellCount()).toBe(0);
  });

  test('switching tool confirms the line rather than losing it (B-DRAW-14)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.click(0, 0);
    await ed.click(4, 0);
    await ed.tool('Select');

    expect(await ed.text()).toBe('─────');
  });

  test('dragging still draws a single segment (B-DRAW-10)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.drag([0, 0], [4, 0]);

    expect(await ed.text()).toBe('─────');
  });

  test('the eraser mends what it leaves behind (B-DRAW-12a)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    await ed.drag([3, 0], [6, 2]);

    // Rub out the shared divider; the T-junctions should relax back to lines.
    await ed.tool('Eraser');
    await ed.drag([3, 1], [3, 1]);

    const rows = (await ed.text()).split('\n');
    expect(rows[0]).toBe('┌─────┐');
    expect(rows[2]).toBe('└─────┘');
  });
});

test.describe('selecting', () => {
  test('clicking a border recognises the shape (B-SEL-01)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([2, 1], [12, 5]);
    await ed.tool('Select');
    await ed.click(7, 1);

    expect(await ed.selection()).toContain('Box 11×5');
  });

  test('clicking empty space clears the selection (B-SEL-02)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([1, 1], [5, 3]);
    await ed.tool('Select');
    await ed.click(1, 1);
    expect(await ed.selection()).toContain('Box');

    await ed.click(30, 12);
    expect(await ed.selection()).toContain('no selection');
  });

  test('a second click widens to the whole component (B-REC-11, B-REC-12)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    await ed.drag([3, 0], [6, 2]);
    await ed.tool('Select');

    // First click: the box you actually clicked on.
    await ed.click(0, 0);
    expect(await ed.selection()).toContain('Box 4×3');

    // Second click on the same cell widens to the whole component.
    await ed.click(0, 0);
    expect(await ed.selection()).toContain('7×3');
  });

  test('shift+click adds a shape and removes it again (B-SEL-09)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [4, 3]);
    await ed.drag([10, 0], [14, 3]);
    await ed.tool('Select');

    await ed.click(0, 0);
    expect(await ed.selection()).toContain('Box 5×4');

    await ed.click(10, 0, { modifiers: ['Shift'] });
    expect(await ed.selection()).toContain('15×4');

    await ed.click(10, 0, { modifiers: ['Shift'] });
    expect(await ed.selection()).toContain('5×4');
  });

  test('marquee selects everything it touches (B-SEL-03)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([1, 1], [5, 3]);
    await ed.tool('Select');
    await ed.drag([20, 8], [0, 0]);

    expect(await ed.selection()).toContain('Cells 5×3');
  });
});

test.describe('manipulating', () => {
  test('dragging a selection moves it, once (B-MAN-01, B-MAN-05)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    const drawn = await ed.text();

    await ed.tool('Select');
    await ed.click(2, 0);
    // (2,0) is on the top edge but is not a grab point — corners and edge
    // midpoints resize, everything else moves.
    await ed.drag([2, 0], [7, 3]);

    // Same shape, new place: trimming to the bounding box gives the same text.
    expect(await ed.text()).toBe(drawn);
    expect(await ed.cellCount()).toBe(10);

    await ed.press('Control+z');
    expect(await ed.text()).toBe(drawn);
    expect(await ed.cellCount()).toBe(10);
  });

  test('dragging a handle resizes rather than moves (B-MAN-09)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    await ed.tool('Select');
    await ed.click(1, 0); // a top edge cell, not a handle
    expect(await ed.selection()).toContain('Box 4×3');

    await ed.drag([3, 2], [5, 4]); // the south-east handle
    expect(await ed.selection()).toContain('Box 6×5');
    expect(await ed.text()).toBe(
      ['┌────┐', '│    │', '│    │', '│    │', '└────┘'].join('\n'),
    );
  });

  test('arrow keys nudge and clamp at the origin (B-MAN-07, B-PLANE-04)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);

    await ed.press('ArrowUp');
    await ed.press('ArrowLeft');
    expect(await ed.cellCount()).toBe(10); // slid along the edge, nothing lost
  });

  test('ctrl+D duplicates the selection (B-MAN-10)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [4, 3]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Control+d');

    expect(await ed.selection()).toContain('5×4');
    expect(await ed.cellCount()).toBeGreaterThan(14);
  });

  test('delete erases the selection (B-MAN-08)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([1, 1], [5, 3]);
    await ed.tool('Select');
    await ed.click(1, 1);
    await ed.press('Delete');

    expect(await ed.cellCount()).toBe(0);
  });
});

test.describe('typing', () => {
  test('the caret writes cells and Enter returns to its column (B-DRAW-11)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(2, 1);
    expect(await ed.caret()).toContain('caret 2, 1');

    await ed.type('ab');
    await ed.press('Enter');
    await ed.type('cd');

    expect(await ed.text()).toBe(['ab', 'cd'].join('\n'));
    expect(await ed.caret()).toContain('caret 4, 2');
  });

  test('a run of typing is a single undo step (B-DRAW-11b)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.type('hello');
    expect(await ed.text()).toBe('hello');

    await ed.press('Escape');
    await ed.press('Control+z');
    expect(await ed.text()).toBe('');
  });

  test('insert mode pushes the word along, overwrite replaces it (B-DRAW-11a)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.type('abc');

    await ed.click(1, 0);
    await ed.type('X');
    expect(await ed.text()).toBe('aXc');

    await ed.press('Insert');
    await ed.click(1, 0);
    await ed.type('Y');
    expect(await ed.text()).toBe('aYXc');
  });

  test('typing keys do not switch tool while the caret is live (B-KEY-14)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.type('vbl'); // all of them are tool shortcuts

    expect(await ed.text()).toBe('vbl');
    await expect(page.getByRole('button', { name: /^Text/ })).toHaveClass(/active/);
  });
});

test.describe('sticky connectors', () => {
  test('an arrow follows the box it points at (B-MAN-11)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [7, 3]);
    await ed.drag([20, 0], [27, 3]);
    await ed.tool('Arrow');
    await ed.drag([8, 1], [20, 1]);

    await ed.tool('Select');
    await ed.click(24, 0); // grab the right-hand box's top edge, not a handle
    await ed.drag([24, 0], [24, 6]);

    const rows = (await ed.text()).split('\n');
    // The head still sits immediately beside the box, six rows lower.
    expect(rows[7]).toContain('▶');
    expect(await ed.cellCount()).toBeGreaterThan(30);
  });

  test('an arrow drawn from the box edge follows too (B-MAN-11)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [7, 3]);
    await ed.drag([20, 0], [27, 3]);

    // Starting the drag *on* the left box's border is the natural gesture, and
    // it merges the shaft into that border. The connector is still a connector.
    await ed.tool('Arrow');
    await ed.drag([7, 1], [20, 1]);
    expect(await ed.text()).toContain('├');

    await ed.tool('Select');
    await ed.click(24, 0);
    await ed.drag([24, 0], [24, 6]);

    const rows = (await ed.text()).split('\n');
    expect(rows[7]).toContain('▶'); // the head arrived where the box went
    // The tail still joins the left box, one row lower than it did, and the
    // row it left behind is a plain wall again.
    expect(rows[2]).toContain('├');
    expect(rows[1]).not.toContain('├');
  });

  test('turning sticky off leaves the line where it was', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [7, 3]);
    await ed.drag([20, 0], [27, 3]);
    await ed.tool('Arrow');
    await ed.drag([8, 1], [20, 1]);

    await page.getByLabel('Sticky').uncheck();

    await ed.tool('Select');
    await ed.click(24, 0);
    await ed.drag([24, 0], [24, 6]);

    const rows = (await ed.text()).split('\n');
    expect(rows[1]).toContain('▶'); // arrow stayed on its original row
  });
});

test.describe('history', () => {
  test('one drag is one undo step, and redo puts it back (B-HIST-01)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    await ed.drag([6, 0], [9, 2]);
    expect(await ed.cellCount()).toBe(20);

    await ed.press('Control+z');
    expect(await ed.cellCount()).toBe(10);

    await ed.press('Control+y');
    expect(await ed.cellCount()).toBe(20);
  });

  test('undo does not restore a past selection (B-SEL-05)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Control+z');

    expect(await ed.selection()).toContain('no selection');
  });
});

test.describe('charsets', () => {
  test('switching pack converts the document and comes back exactly (B-CS-04)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [3, 2]);
    const unicode = await ed.text();

    await page.locator('#charset').selectOption('ascii');
    expect(await ed.text()).toBe(['+--+', '|  |', '+--+'].join('\n'));

    await page.locator('#charset').selectOption('double');
    expect(await ed.text()).toBe(['╔══╗', '║  ║', '╚══╝'].join('\n'));

    await page.locator('#charset').selectOption('unicode');
    expect(await ed.text()).toBe(unicode);
  });
});

test.describe('the actions menu', () => {
  const menu = '.shape-menu';

  test('right-clicking a selected box offers a column and a row', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([2, 4], [9, 7]);
    await ed.tool('Select');

    // Nothing selected yet: a right-click reaches for nothing.
    await ed.rightClick(3, 4);
    await expect(page.locator(menu)).toHaveCount(0);

    await ed.click(3, 4);
    await ed.rightClick(3, 4);
    await expect(page.locator(menu)).toBeVisible();
    await expect(page.locator(`${menu} button`)).toHaveText(['Add column', 'Add row']);
  });

  test('it sits above the shape it acts on', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([2, 6], [9, 9]);
    await ed.tool('Select');
    await ed.click(3, 6);
    await ed.rightClick(3, 6);

    const box = await page.locator(menu).boundingBox();
    const canvas = await ed.canvas.boundingBox();
    if (box === null || canvas === null) throw new Error('no box');

    // Its bottom edge is clear of the shape's top row, and it lines up with
    // the shape's left edge rather than with the pointer.
    expect(box.y + box.height).toBeLessThan(canvas.y + 6 * 17);
    expect(box.x).toBeLessThan(canvas.x + 3 * 8);
  });

  test('Add column widens the box and leaves a divider', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 2], [7, 5]);
    await ed.tool('Select');
    await ed.click(1, 2);

    await ed.rightClick(1, 2);
    await page.getByRole('button', { name: 'Add column' }).click();

    expect(await ed.text()).toBe(
      ['┌──────┬──────┐', '│      │      │', '│      │      │', '└──────┴──────┘'].join('\n'),
    );
    // Acting closes the menu, and leaves the grown box selected so the next
    // one goes on the end rather than starting over.
    await expect(page.locator(menu)).toHaveCount(0);
    expect(await ed.selection()).toBe('Box 15×4');
  });

  test('a second column and then a row build a lattice', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 2], [7, 5]);
    await ed.tool('Select');
    await ed.click(1, 2);

    for (const item of ['Add column', 'Add column', 'Add row']) {
      await ed.rightClick(1, 2);
      await page.getByRole('button', { name: item }).click();
    }

    expect(await ed.text()).toBe(
      [
        '┌──────┬──────┬──────┐',
        '│      │      │      │',
        '│      │      │      │',
        '├──────┼──────┼──────┤',
        '│      │      │      │',
        '│      │      │      │',
        '└──────┴──────┴──────┘',
      ].join('\n'),
    );
  });

  test('the toolbar never changes height, so the canvas cannot jump', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    const toolbarHeight = async (): Promise<number> => {
      const b = await page.locator('.toolbar').boundingBox();
      if (b === null) throw new Error('no toolbar');
      return b.height;
    };
    const before = await toolbarHeight();

    await ed.tool('Box');
    await ed.drag([0, 2], [7, 5]);
    await ed.tool('Select');
    await ed.click(1, 2);
    await ed.rightClick(1, 2);
    await page.getByRole('button', { name: 'Add column' }).click();

    // The note is showing now. If it reflowed the toolbar, every cell under
    // the pointer would have moved.
    await expect(page.locator('.notice')).toBeVisible();
    expect(await toolbarHeight()).toBe(before);
  });

  test('escape closes the menu and keeps the selection', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 2], [7, 5]);
    await ed.tool('Select');
    await ed.click(1, 2);
    await ed.rightClick(1, 2);
    await expect(page.locator(menu)).toBeVisible();

    await ed.press('Escape');
    await expect(page.locator(menu)).toHaveCount(0);
    expect(await ed.selection()).toBe('Box 8×4');
  });

  test('a circle is offered nothing, because it has no lattice', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Circle');
    await ed.drag([1, 1], [9, 9]);
    await ed.tool('Select');
    await ed.click(5, 1);
    expect(await ed.selection()).toContain('Circle');

    await ed.rightClick(5, 1);
    await expect(page.locator(menu)).toHaveCount(0);
  });
});

test.describe('routing around obstacles', () => {
  test('a re-routed arrow goes around a box instead of through it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [6, 2]); // A
    await ed.drag([30, 0], [36, 2]); // B
    await ed.drag([14, 4], [21, 8]); // the obstacle, below the line
    await ed.tool('Arrow');
    await ed.drag([7, 1], [30, 1]);

    await ed.tool('Select');
    await ed.click(33, 0);
    await ed.drag([33, 0], [33, 8]); // drop B below the obstacle

    const text = await ed.text();
    // A crossing is the tell: the old behaviour drew straight through the
    // obstacle's walls and left `┼` in each of them.
    expect(text).not.toContain('┼');
    // The obstacle is still four corners and nothing else.
    expect(text.split('┌').length - 1).toBe(3);
    expect(text).toContain('▶');
  });
});

test.describe('growing to fit', () => {
  test('a box grows rather than losing its border (content §4)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 2]);
    await ed.tool('Text');
    await ed.click(1, 1);
    await ed.type('reconciliation');

    expect(await ed.text()).toBe(
      ['┌──────────────┐', '│reconciliation│', '└──────────────┘'].join('\n'),
    );
  });

  test('a table cell widens its whole column, and every row follows (tables §8)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [7, 3]);
    await ed.tool('Select');
    await ed.click(1, 0);
    for (const item of ['Add column', 'Add row']) {
      await ed.rightClick(1, 0);
      await page.getByRole('button', { name: item }).click();
    }

    await ed.tool('Text');
    await ed.click(1, 1);
    await ed.type('Administrator');

    // The separator is still a separator on every row: the lattice held.
    expect(await ed.text()).toBe(
      [
        '┌─────────────┬──────┐',
        '│Administrator│      │',
        '│             │      │',
        '├─────────────┼──────┤',
        '│             │      │',
        '│             │      │',
        '└─────────────┴──────┘',
      ].join('\n'),
    );
  });
});

test.describe('resizing a track', () => {
  async function table(ed: Editor, page: import('@playwright/test').Page): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [7, 3]);
    await ed.tool('Select');
    await ed.click(1, 0);
    for (const item of ['Add column', 'Add row']) {
      await ed.rightClick(1, 0);
      await page.getByRole('button', { name: item }).click();
    }
  }

  test('dragging a separator widens the column to its left (tables §7)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);

    await ed.drag([7, 1], [11, 1]);

    expect(await ed.text()).toBe(
      [
        '┌──────────┬──────┐',
        '│          │      │',
        '│          │      │',
        '├──────────┼──────┤',
        '│          │      │',
        '│          │      │',
        '└──────────┴──────┘',
      ].join('\n'),
    );
  });

  test('and dragging it back narrows the column again', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);
    const before = await ed.text();

    await ed.drag([7, 1], [11, 1]);
    await ed.drag([11, 1], [7, 1]);

    expect(await ed.text()).toBe(before);
  });

  test('a horizontal separator resizes the row above it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);

    await ed.drag([1, 3], [1, 5]);

    const rows = (await ed.text()).split('\n');
    expect(rows.length).toBe(9); // two rows taller
    expect(rows[5]).toBe('├──────┼──────┤');
  });

  test('the pointer says so before the drag starts', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);

    await ed.hover(7, 1);
    await expect(ed.canvas).toHaveCSS('cursor', 'col-resize');

    await ed.hover(1, 3);
    await expect(ed.canvas).toHaveCSS('cursor', 'row-resize');

    // The outer wall is not a separator — that is what the resize handles are.
    await ed.hover(0, 1);
    await expect(ed.canvas).not.toHaveCSS('cursor', 'col-resize');
  });
});

test.describe('arrow keys in a table', () => {
  async function table(ed: Editor, page: import('@playwright/test').Page): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [7, 3]);
    await ed.tool('Select');
    await ed.click(1, 0);
    for (const item of ['Add column', 'Add row']) {
      await ed.rightClick(1, 0);
      await page.getByRole('button', { name: item }).click();
    }
  }

  test('step between cells instead of dragging one around', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);
    const drawn = await ed.text();

    // Clear first: the menu left the whole table selected, and a click inside
    // the current selection keeps that reading (B-SEL-06).
    await ed.click(40, 20);
    await ed.click(3, 0); // the first cell
    expect(await ed.selection()).toContain('Box 8×4');

    await ed.press('ArrowRight');
    expect(await ed.selection()).toContain('Box 8×4');
    await ed.press('ArrowDown');
    await ed.press('ArrowLeft');
    await ed.press('ArrowUp');

    // Four steps around the table changed the selection, never the document.
    expect(await ed.text()).toBe(drawn);
  });

  test('alt+arrow drags the cell out of the table instead', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);

    await ed.click(40, 20);
    await ed.click(3, 0);
    expect(await ed.selection()).toContain('Box 8×4');
    await page.keyboard.press('Alt+ArrowDown');

    // The document changed: this moved something rather than stepping.
    const rows = (await ed.text()).split('\n');
    expect(rows[0]).not.toBe('┌──────┬──────┐');
  });

  test('alt+arrow nudges a plain box, and a bare arrow does not (B-MAN-07)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    // Two boxes, so the picture shows a move: `toText` crops to the content,
    // and a lone box that shifts right looks identical afterwards.
    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([8, 0], [12, 2]);
    await ed.tool('Select');
    await ed.click(10, 0);
    expect(await ed.selection()).toContain('Box 5×3');
    const drawn = await ed.text();

    // A bare arrow walks the cursor now, so the document does not move.
    await ed.press('ArrowRight');
    expect(await ed.text()).toBe(drawn);

    await page.keyboard.press('Alt+ArrowRight');
    expect(await ed.text()).toBe(
      ['┌───┐    ┌───┐', '│   │    │   │', '└───┘    └───┘'].join('\n'),
    );
  });
});

test.describe('growing pushes rather than destroys', () => {
  test('the box beside it moves along, whole', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 2]);
    await ed.drag([12, 0], [18, 2]);
    await ed.tool('Text');
    await ed.click(1, 1);
    await ed.type('reconciliation');

    // Typed one letter at a time, so the gap is used up before anything is
    // pushed — the second box only moves once the first is against it, and
    // then it moves rather than being written over.
    expect(await ed.text()).toBe(
      [
        '┌──────────────┐┌─────┐',
        '│reconciliation││     │',
        '└──────────────┘└─────┘',
      ].join('\n'),
    );
  });
});

test.describe('editing a selected run of text (B-KEY-21)', () => {
  async function word(ed: Editor): Promise<void> {
    await ed.tool('Text');
    await ed.click(2, 1);
    await ed.type('hello');
    await ed.press('Escape');
    await ed.tool('Select');
  }

  test('clicking it takes the run, and leaves no caret behind', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(4, 1);
    expect(await ed.selection()).toContain('Text');
    // Select does not write any more, so a bar here would be claiming
    // otherwise. The click is "this word"; `t` is "and I am editing it".
    expect(await ed.caret()).toBeNull();
  });

  test('t opens it for editing, at the character clicked', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(4, 1);
    await ed.press('t');

    await expect(page.getByRole('button', { name: /^Text/ })).toHaveClass(/active/);
    // Where the pointer put the keyboard, not the start of the run: every
    // press moves the cursor, and `t` writes where the cursor already is.
    expect(await ed.caret()).toContain('4, 1');
  });

  test('typing writes between the characters rather than over them', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(4, 1); // between "he" and "llo"
    await ed.press('t');
    await ed.type('XY');

    // Insert, not overwrite — the run came through the mode change with the
    // selection intact, which is what `typeAt` reads to decide.
    expect(await ed.text()).toBe('heXYllo');
  });

  test('and in text mode the letters are letters again', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(4, 1);
    await ed.press('t');
    await ed.type('b'); // the key that means "box" one mode up

    expect(await ed.text()).toBe('hebllo');
    await expect(page.getByRole('button', { name: /^Text/ })).toHaveClass(/active/);
  });

  test('arrow keys walk the text instead of dragging it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(2, 1);
    await ed.press('t');
    await ed.press('ArrowRight');
    await ed.press('ArrowRight');
    expect(await ed.caret()).toContain('4, 1');

    await ed.type('-');
    expect(await ed.text()).toBe('he-llo');
  });

  test('shift+arrow drags the text, and the caret goes with it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(4, 1);
    await ed.press('t');
    await page.keyboard.press('Shift+ArrowDown');

    expect(await ed.caret()).toContain('4, 2');
    await ed.type('!');
    // The word moved down a row and the caret stayed in the same place in it.
    expect(await ed.text()).toBe('he!llo');
  });

  test('backspace closes the gap behind it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(4, 1);
    await ed.press('t');
    await ed.press('Backspace');

    expect(await ed.text()).toBe('hllo');
  });

  test('escape comes back out to select in one press', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await word(ed);

    await ed.click(4, 1);
    await ed.press('t');
    await ed.press('Escape');

    await expect(page.getByRole('button', { name: /^Select/ })).toHaveClass(/active/);
    expect(await ed.caret()).toBeNull();
  });
});

test.describe('tools live on Ctrl', () => {
  test('Ctrl and a number picks the tool from the toolbar', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    for (const [n, label] of [
      ['2', 'Box'],
      ['3', 'Circle'],
      ['4', 'Line'],
      ['5', 'Arrow'],
      ['6', 'Text'],
      ['7', 'Eraser'],
      ['1', 'Select'],
    ] as const) {
      await ed.canvas.hover();
      await page.keyboard.press(`Control+${n}`);
      await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveClass(
        /active/,
      );
    }
  });

  test('Ctrl+B is the box, because B was the letter left free', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.canvas.hover();
    await page.keyboard.press('Control+B');
    await expect(page.getByRole('button', { name: /^Box/ })).toHaveClass(/active/);
  });

  test('a bare letter changes tool again, now that select does not write', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    // Each one from select, because that is the only mode they mean anything
    // in — and Escape is the way back (B-KEY-21).
    for (const [k, label] of [
      ['b', 'Box'],
      ['s', 'Circle'],
      ['c', 'Line'],
      ['t', 'Text'],
    ] as const) {
      await ed.canvas.hover();
      await page.keyboard.press(k);
      await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveClass(
        /active/,
      );
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: /^Select/ })).toHaveClass(/active/);
    }
  });

  test('but only from select: under another mode a letter is inert', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.canvas.hover();
    await page.keyboard.press('s'); // circle, one mode up
    await expect(page.getByRole('button', { name: /^Box/ })).toHaveClass(/active/);
    expect(await ed.cellCount()).toBe(0); // and it did not type, either
  });

  test('two taps of Ctrl come back to select without reaching for Escape', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.canvas.hover();
    await page.keyboard.press('Control');
    await page.keyboard.press('Control');
    await expect(page.getByRole('button', { name: /^Select/ })).toHaveClass(/active/);
  });

  test('jk comes back to select from the writing mode, writing neither letter (B-KEY-23)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.type('ab');
    await ed.type('jk');

    await expect(page.getByRole('button', { name: /^Select/ })).toHaveClass(/active/);
    expect(await ed.text()).toBe('ab');
  });

  test('but a j followed by anything else is a letter, and so is one left on its own', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.type('jaj');

    // The first `j` is written the moment the `a` arrives; the last one once
    // the window for a `k` has closed.
    await expect.poll(() => ed.text()).toBe('jaj');
    await expect(page.getByRole('button', { name: /^Text/ })).toHaveClass(/active/);
  });

  test('and a k that comes too late is only a k', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.press('j');
    await page.waitForTimeout(500);
    await ed.press('k');

    expect(await ed.text()).toBe('jk');
    await expect(page.getByRole('button', { name: /^Text/ })).toHaveClass(/active/);
  });

  test('jk leaves a drawing mode too', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.canvas.hover();
    await ed.press('j');
    await ed.press('k');

    await expect(page.getByRole('button', { name: /^Select/ })).toHaveClass(/active/);
  });

  test('and one tap of Ctrl, or Ctrl with a key, does not', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.canvas.hover();
    await page.keyboard.press('Control');
    await expect(page.getByRole('button', { name: /^Box/ })).toHaveClass(/active/);

    // A shortcut fires a Ctrl press and release exactly as a tap does; what
    // tells them apart is whether anything happened in between.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: /^Box/ })).toHaveClass(/active/);
  });

  test('and the standard shortcuts still mean what they always did', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    const drawn = await ed.text();

    // Ctrl+A selects all, Ctrl+Z undoes, Ctrl+C copies.
    await ed.canvas.hover();
    await page.keyboard.press('Control+a');
    expect(await ed.selection()).toContain('Cells');

    await page.keyboard.press('Control+z');
    expect(await ed.cellCount()).toBe(0);
    await page.keyboard.press('Control+y');
    expect(await ed.text()).toBe(drawn);
  });
});

test.describe('a block of text is one selection', () => {
  test('lines stacked one above another come as a paragraph', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(2, 1);
    await ed.type('one');
    await ed.press('Enter');
    await ed.type('two');
    await ed.press('Escape');

    await ed.tool('Select');
    await ed.click(3, 1);
    // Both rows, not just the one clicked.
    expect(await ed.selection()).toContain('Text 6 chars');
  });

  test('the arrow keys reach the line below', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(2, 1);
    await ed.type('one');
    await ed.press('Enter');
    await ed.type('two');
    await ed.press('Escape');

    await ed.tool('Select');
    await ed.click(2, 1);
    await ed.press('t'); // the block comes through with it, so typing inserts
    await ed.press('ArrowDown');
    expect(await ed.caret()).toContain('2, 2');

    await ed.type('X');
    expect(await ed.text()).toBe(['one', 'Xtwo'].join('\n'));
  });

  test('text in a box comes as everything written in that box', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [10, 4]);
    await ed.tool('Text');
    await ed.click(1, 1);
    await ed.type('ab');
    await ed.click(1, 3);
    await ed.type('cd');
    await ed.press('Escape');

    await ed.tool('Select');
    await ed.click(1, 1);
    // Both lines, though they do not touch and are rows apart.
    expect(await ed.selection()).toContain('Text 4 chars');
  });
});

test.describe('Tab crosses between a shape and its text', () => {
  async function labelled(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [10, 2]);
    await ed.tool('Text');
    await ed.click(2, 1);
    await ed.type('name');
    await ed.press('Escape');
    await ed.tool('Select');
  }

  test('from the text to the box, and back again', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await labelled(ed);

    await ed.click(3, 1);
    expect(await ed.selection()).toContain('Text');

    await ed.press('Tab');
    expect(await ed.selection()).toContain('Box 11×3');
    expect(await ed.caret()).toBeNull();

    await ed.press('Tab');
    expect(await ed.selection()).toContain('Text');
    expect(await ed.caret()).not.toBeNull();
  });

  test('and typing after tabbing back lands in the label', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await labelled(ed);

    await ed.click(3, 1);
    await ed.press('Tab'); // to the box
    await ed.press('Tab'); // back to the text
    await ed.type('X');

    expect(await ed.text()).toContain('Xname');
  });
});

test.describe('drawing from the keyboard', () => {
  test('space starts a box, arrows size it, Enter commits it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    // Park the cursor with a click, then let go of the mouse entirely.
    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();
    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    for (let i = 0; i < 2; i++) await ed.press('ArrowDown');
    expect(await ed.cellCount()).toBe(0); // still only a preview

    await ed.press('Enter');
    expect(await ed.text()).toBe(['┌───┐', '│   │', '└───┘'].join('\n'));
  });

  test('and the same keys draw a circle', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Circle');
    await ed.click(0, 0);
    await ed.canvas.hover();
    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    for (let i = 0; i < 4; i++) await ed.press('ArrowDown');
    await ed.press('Enter');

    expect(await ed.text()).toBe(
      [' ╭─╮', '/   \\', '│   │', '\\   /', ' ╰─╯'].join('\n'),
    );
  });

  test('escape abandons a draft, and the document never saw it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();
    await page.keyboard.press('Space');
    await ed.press('ArrowRight');
    await ed.press('ArrowDown');
    await ed.press('Escape');
    await ed.press('Enter');

    expect(await ed.cellCount()).toBe(0);
  });

  test('a mouse press abandons it too — whichever pointed last wins', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();
    await page.keyboard.press('Space');
    await ed.press('ArrowRight');

    await ed.click(20, 20); // somewhere else entirely
    await ed.press('Enter');
    expect(await ed.cellCount()).toBe(0);
  });

  test('shift and the arrows draw a box, and letting go keeps it (B-DRAW-15)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();

    // One gesture: Shift goes down, the arrows stretch, Shift comes back up.
    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    for (let i = 0; i < 2; i++) await ed.press('ArrowDown');
    expect(await ed.cellCount()).toBe(0); // still only a preview

    await page.keyboard.up('Shift');
    expect(await ed.text()).toBe(['┌───┐', '│   │', '└───┘'].join('\n'));
  });

  test('escape drops it mid-gesture, and the release finds nothing left', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();

    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    await ed.press('ArrowDown');
    await ed.press('Escape');
    await page.keyboard.up('Shift');

    expect(await ed.cellCount()).toBe(0);
  });

  test('and picking another tool drops it too (B-DRAW-15b)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();

    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    await ed.press('ArrowDown');

    // Mid-gesture, with Shift still down: reaching for another tool means
    // "not this", so the release that follows has nothing left to commit.
    await ed.tool('Circle');
    await page.keyboard.up('Shift');

    expect(await ed.cellCount()).toBe(0);
  });

  test('a Space draft is owed an Enter, not a shift release (B-DRAW-15a)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();
    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');

    // Shift held and released over a draft that Space started: it keeps going.
    await page.keyboard.down('Shift');
    for (let i = 0; i < 2; i++) await ed.press('ArrowDown');
    await page.keyboard.up('Shift');
    expect(await ed.cellCount()).toBe(0);

    await ed.press('Enter');
    expect(await ed.text()).toBe(['┌───┐', '│   │', '└───┘'].join('\n'));
  });

  test('the circle tool still needs Space — shift only moves the cursor', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Circle');
    await ed.click(1, 1);
    await ed.canvas.hover();

    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    for (let i = 0; i < 4; i++) await ed.press('ArrowDown');
    await page.keyboard.up('Shift');

    expect(await ed.cellCount()).toBe(0);
  });

  test('a line drawn with Space follows the arrows, not the mouse (B-DRAW-14d)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    // The mouse parks far away and stays there. It used to win outright, so
    // the arrow keys moved the cursor and the preview ignored them.
    await ed.hover(20, 10);

    await page.keyboard.press('Space'); // the run starts at the cursor, (0,0)
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    await ed.press('Enter');

    // Four cells right of the origin, and nothing reaching toward (20,10).
    expect(await ed.text()).toBe('─────');
  });

  test('and Enter finishes through the cursor, so one Space is enough (B-DRAW-14e)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.hover(20, 10);

    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    await page.keyboard.press('Space'); // a corner
    for (let i = 0; i < 3; i++) await ed.press('ArrowDown');
    await ed.press('Enter'); // no third Space: Enter takes the leg being aimed

    expect(await ed.text()).toBe(['────┐', '    │', '    │', '    │'].join('\n'));
  });

  test('escape still abandons one, aimed leg and all', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.hover(20, 10);

    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    await ed.press('Escape');
    await ed.press('Enter');

    expect(await ed.cellCount()).toBe(0);
  });

  test('a clicked line is still aimed by the pointer, and Enter adds no leg', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.click(0, 0);
    await ed.click(4, 0);

    // The mouse wanders off and Enter finishes. A chain the pointer started
    // takes its corners from clicks, so where the hand ended up is not one.
    await ed.hover(20, 10);
    await ed.press('Enter');

    expect(await ed.text()).toBe('─────');
  });

  test('each space drops a line corner, and Enter finishes the run', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    // Entirely from the keyboard: the cursor starts at the origin, so there is
    // nothing to click and nothing to aim with.
    await ed.tool('Line');
    await ed.canvas.hover();
    await page.keyboard.press('Space'); // the run starts here
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    await page.keyboard.press('Space'); // a corner
    for (let i = 0; i < 3; i++) await ed.press('ArrowDown');
    await page.keyboard.press('Space'); // and the end of the run
    await ed.press('Enter');

    expect(await ed.text()).toBe(['────┐', '    │', '    │', '    │'].join('\n'));
  });
});

test.describe('sweeping a selection with the keyboard', () => {
  test('ctrl+alt sweeps in reading order, like a text editor', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.type('ab');
    await ed.press('Enter');
    await ed.type('cd');
    await ed.press('Escape');

    await ed.tool('Select');
    await ed.click(30, 30); // clear, and park the cursor away
    await ed.click(1, 0); // cursor on the 'b'
    // Two Escapes: the first drops the caret, the second the text selection.
    // Both are needed now, because with a selection standing Ctrl+Alt would
    // carry it rather than sweep (B-KEY-20) — which is the point of the key,
    // and means this test has to actually be holding nothing.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // From 'b' to the end of its row, then onto the next: 'b', 'c', 'd'.
    await page.keyboard.press('Control+Alt+ArrowDown');
    expect(await ed.selection()).toContain('Cells');
  });

  test('shift sweeps a rectangle instead', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [6, 4]);
    await ed.tool('Select');
    await ed.click(30, 30);
    await ed.click(0, 0);
    await page.keyboard.press('Escape');

    for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');

    // A 3x2 corner of the box: the top-left three cells and the wall below.
    expect(await ed.selection()).toContain('Cells 3×2');
  });

  test('a bare arrow ends the sweep, so the next one starts fresh', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(30, 30);
    await ed.click(0, 0);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('Cells 3×1');

    await ed.press('ArrowRight'); // plain: moves the cursor, drops the anchor
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('Cells 2×1');
  });
});

test.describe('select is a mode, and does not write (B-KEY-21)', () => {
  test('a printable key writes nothing', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.type('xyz'); // none of these is a mode letter

    expect(await ed.cellCount()).toBe(0);
    expect(await ed.caret()).toBeNull();
  });

  test('space writes nothing either, and draws nothing', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.press('Space');
    await ed.press('Space');

    expect(await ed.cellCount()).toBe(0);
  });

  test('writing takes a t first, and lands where the keyboard is', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.press('t');
    await ed.type('ab');
    await ed.press('Escape');

    await ed.click(0, 1);
    await ed.press('t');
    await ed.type('cd');

    expect(await ed.text()).toBe(['ab', 'cd'].join('\n'));
  });

  test('[ and ] are still characters, and brush size only to the eraser', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.mark('[x]');

    expect(await ed.text()).toBe('[x]');
  });

  test('an empty box is labelled by tabbing in, which is entering text mode', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [6, 2]);
    await ed.tool('Select');

    await ed.click(0, 0); // the box itself
    await ed.press('Tab'); // across to its label, and into the writing mode
    await expect(page.getByRole('button', { name: /^Text/ })).toHaveClass(/active/);

    await ed.type('hi');
    expect(await ed.text()).toBe(['┌─────┐', '│hi   │', '└─────┘'].join('\n'));
  });

  test('crossing from Text to Select drops the caret', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(2, 1);
    await ed.type('ab');
    expect(await ed.caret()).not.toBeNull();

    // It used to survive the crossing (B-SEL-12), back when select wrote too.
    // A bar under select would now be claiming a keystroke it will not get.
    await ed.tool('Select');
    expect(await ed.caret()).toBeNull();
  });

  test('and the box tool takes the keyboard back as it always did', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(2, 1);
    await ed.type('ab');
    expect(await ed.caret()).not.toBeNull();

    await ed.tool('Box');
    expect(await ed.caret()).toBeNull();
  });
});

test.describe('hjkl walks the grid (B-KEY-22)', () => {
  test('j and l carry the keyboard down and right', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.mark('a'); // 'a' at (0,0), keyboard left at (1,0)

    await ed.press('j');
    await ed.press('j');
    await ed.press('l');
    await ed.mark('X');

    expect(await ed.text()).toBe(['a', '', '  X'].join('\n'));
  });

  test('h and k come back the other way', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.mark('a');

    for (const k of ['j', 'j', 'j', 'l', 'l', 'l']) await ed.press(k);
    for (const k of ['k', 'h']) await ed.press(k); // one back up, one back left
    await ed.mark('X');

    // Down three and right three from (1,0) is (4,3); back one each way is
    // (3,2).
    expect(await ed.text()).toBe(['a', '', '   X'].join('\n'));
  });

  test('the arrow keys still do the very same thing', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.mark('a');

    await ed.press('ArrowDown');
    await ed.press('ArrowDown');
    await ed.press('ArrowRight');
    await ed.mark('X');

    expect(await ed.text()).toBe(['a', '', '  X'].join('\n'));
  });

  test('alt nudges a selection with l exactly as with the arrow', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([8, 0], [12, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);

    await page.keyboard.press('Alt+l');

    // The gap closed by one: the modifier means on `l` what it means on `→`.
    expect((await ed.text()).split('\n')[0]).toBe('┌───┐  ┌───┐');
  });

  test('and they carry the cursor under the box tool as well (B-KEY-22a)', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.mark('a'); // keyboard at (1,0)

    await ed.tool('Box');
    await ed.press('j'); // the walk carries into the drawing modes
    await ed.press('l');
    await ed.press('Space'); // so the draft starts at (2,1), not (1,0)
    for (let i = 0; i < 3; i++) await ed.press('ArrowRight');
    await ed.press('ArrowDown');
    await ed.press('Enter');

    expect(await ed.text()).toBe(['a', '  ┌──┐', '  └──┘'].join('\n'));
  });

  test('and size the box being drafted, exactly as the arrows do', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();
    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('l');
    for (let i = 0; i < 2; i++) await ed.press('j');
    expect(await ed.cellCount()).toBe(0); // still only a preview

    await ed.press('Enter');
    // The very shape the arrow-key version of this test draws.
    expect(await ed.text()).toBe(['┌───┐', '│   │', '└───┘'].join('\n'));
  });

  test('shift and hjkl draw a box in one gesture, like shift and the arrows', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.click(1, 1);
    await ed.canvas.hover();

    await page.keyboard.down('Shift');
    for (let i = 0; i < 4; i++) await ed.press('l');
    for (let i = 0; i < 2; i++) await ed.press('j');
    expect(await ed.cellCount()).toBe(0); // still only a preview

    await page.keyboard.up('Shift'); // the release is the commit (B-DRAW-15)
    expect(await ed.text()).toBe(['┌───┐', '│   │', '└───┘'].join('\n'));
  });

  test('a circle is sized by them too', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Circle');
    await ed.click(0, 0);
    await ed.canvas.hover();
    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('l');
    for (let i = 0; i < 4; i++) await ed.press('j');
    await ed.press('Enter');

    expect(await ed.text()).toBe([' ╭─╮', '/   \\', '│   │', '\\   /', ' ╰─╯'].join('\n'));
  });

  test('and they aim a line, corner by corner', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Line');
    await ed.hover(20, 10); // the pointer parks far away and stays there

    await page.keyboard.press('Space');
    for (let i = 0; i < 4; i++) await ed.press('l');
    await page.keyboard.press('Space'); // a corner
    for (let i = 0; i < 3; i++) await ed.press('j');
    await ed.press('Enter');

    expect(await ed.text()).toBe(['────┐', '    │', '    │', '    │'].join('\n'));
  });

  test('but a letter is a letter under text, where it writes', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.press('t');
    await ed.type('hjkl');

    // The one mode the walk stays out of: these are four characters.
    expect(await ed.text()).toBe('hjkl');
  });
});

test.describe('the keyboard has one position (B-UI-10)', () => {
  test('escape leaves it where the caret was, not where the pointer last was', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.mark('ab'); // in, written, and back out to select
    await ed.press('t'); // in again, with nothing moved in between
    await ed.type('cd');

    // Two markers in two places would have started this run back at the click.
    expect(await ed.text()).toBe('abcd');
  });

  test('and the caret carries it while it walks', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.press('t');
    await ed.type('ab');
    await ed.press('ArrowLeft');
    await ed.press('Escape'); // the caret goes, its position stays
    await ed.press('t');
    await ed.type('X');

    expect(await ed.text()).toBe('aX');
  });

  test('typing outside the selection dissolves it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    await ed.click(0, 0);
    await ed.mark('hey');

    await ed.click(1, 0);
    expect(await ed.selection()).toContain('Text');

    // A bare arrow walks the keyboard out of the run; `t` then writes where it
    // landed, which is nowhere near what is selected.
    for (let i = 0; i < 5; i++) await ed.press('ArrowRight');
    await ed.press('t');
    await ed.type('q');

    expect(await ed.selection()).not.toContain('Text');
    expect(await ed.text()).toBe('hey   q');
  });
});

test.describe('object select (B-SEL-14, B-SEL-15)', () => {
  /** Two 6x3 boxes with two blank columns between them. */
  async function twoBoxes(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [5, 2]);
    await ed.drag([8, 0], [13, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Escape'); // drop the selection, keep the keyboard where it is
  }

  test('double-tapping shift takes the object under the keyboard', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);

    await ed.doubleShift();

    expect(await ed.selection()).toContain('Box 6×3');
  });

  test('a single tap of shift does nothing on its own', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);

    await ed.press('Shift');

    expect(await ed.selection()).not.toContain('Box');
  });

  test('shift+arrow then reaches across the gap and swallows the far box whole', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);
    await ed.doubleShift();

    // Two presses cross the blank columns, holding the height while they reach.
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('Cells 7×3');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('Cells 8×3');

    // The third touches the far box, which comes in whole rather than by a column.
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('Cells 14×3');
  });

  test('without the double tap, shift+arrow still sweeps cells', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);

    await page.keyboard.press('Shift+ArrowRight');

    // A reading-order sweep of two cells, not the whole box.
    expect(await ed.selection()).not.toContain('14×3');
  });

  test('a bare arrow leaves object select', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);
    await ed.doubleShift();

    await ed.press('ArrowRight'); // moves the keyboard, ends the mode
    await page.keyboard.press('Shift+ArrowRight');

    expect(await ed.selection()).not.toContain('14×3');
  });
});

test.describe('the actions menu from the keyboard (B-UI-11)', () => {
  async function selectedBox(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);
  }

  const menu = (page: import('@playwright/test').Page) => page.locator('.shape-menu');
  const here = (page: import('@playwright/test').Page) => page.locator('.shape-menu button.here');

  test('ctrl+e opens it, exactly as a right-click does', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await selectedBox(ed);

    await expect(menu(page)).toHaveCount(0);
    await page.keyboard.press('Control+e');

    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('button')).toHaveText(['Add column', 'Add row']);
  });

  test('and offers nothing for a shape with no lattice', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Circle');
    await ed.drag([0, 0], [8, 6]);
    await ed.tool('Select');
    await ed.click(4, 0);
    await page.keyboard.press('Control+e');

    await expect(menu(page)).toHaveCount(0);
  });

  test('left and right step between the options, wrapping', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await selectedBox(ed);
    await page.keyboard.press('Control+e');

    await expect(here(page)).toHaveText('Add column');

    await ed.press('ArrowRight');
    await expect(here(page)).toHaveText('Add row');

    await ed.press('ArrowRight'); // wraps
    await expect(here(page)).toHaveText('Add column');

    await ed.press('ArrowLeft'); // wraps the other way
    await expect(here(page)).toHaveText('Add row');
  });

  test('down puts it away and changes nothing', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await selectedBox(ed);
    const before = await ed.text();

    await page.keyboard.press('Control+e');
    await ed.press('ArrowDown');

    await expect(menu(page)).toHaveCount(0);
    expect(await ed.text()).toBe(before);
  });

  test('enter runs the highlighted option', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await selectedBox(ed);

    await page.keyboard.press('Control+e');
    await ed.press('ArrowRight'); // Add row
    await ed.press('Enter');

    await expect(menu(page)).toHaveCount(0);
    // A new track as deep as the last one, so 5 rows become 9 -- the same
    // answer the right-click gives, which is the point.
    expect((await ed.text()).split('\n')).toHaveLength(9);
  });

  test('and the first option is the one Enter takes without stepping', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await selectedBox(ed);

    await page.keyboard.press('Control+e');
    await ed.press('Enter');

    // Add column, the first item: 9 wide becomes 17, and the old right-hand
    // wall becomes the divider.
    expect((await ed.text()).split('\n')[0]).toBe('┌───────┬───────┐');
  });

  test('escape still closes it and keeps the selection', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await selectedBox(ed);

    await page.keyboard.press('Control+e');
    await ed.press('Escape');

    await expect(menu(page)).toHaveCount(0);
    expect(await ed.selection()).toContain('Box');
  });
});

test.describe('the actions menu over a keyboard-selected table (B-UI-11a)', () => {
  const menu = (page: import('@playwright/test').Page) => page.locator('.shape-menu');
  const open = (page: import('@playwright/test').Page) => page.keyboard.press('Control+e');

  /** A 2×2 table, built through the menu itself. */
  async function table(ed: Editor, page: import('@playwright/test').Page): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [7, 3]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await open(page);
    await ed.press('Enter'); // Add column
    await open(page);
    await ed.press('ArrowRight'); // Add row
    await ed.press('Enter');
  }

  test('ctrl+e opens it over a table taken with the keyboard, not just a clicked one', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);

    // Take the whole table from the keyboard. `Enter` widens to the shape,
    // which for a lattice is a `cells` reading no rectangle matcher claims.
    await ed.click(0, 0);
    await ed.press('Escape');
    await ed.press('Enter');
    await ed.press('Enter');
    expect(await ed.selection()).toContain('Cells');

    await open(page);
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).getByRole('button')).toHaveText(['Add column', 'Add row']);
  });

  test('and running it grows the whole table', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);
    const before = (await ed.text()).split('\n')[0] ?? '';

    await ed.click(0, 0);
    await ed.press('Escape');
    await ed.press('Enter');
    await ed.press('Enter');

    await open(page);
    // The menu remembers its highlight (B-UI-13), and building the table above
    // left it on "Add row", so step back to the column.
    await ed.press('ArrowLeft');
    await ed.press('Enter');

    const after = (await ed.text()).split('\n')[0] ?? '';
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.split('┬')).toHaveLength(3); // two dividers, three columns
  });

  test('a swept selection reaches it too', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await table(ed, page);

    await ed.click(0, 0);
    await ed.press('Escape');
    for (let i = 0; i < 20; i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+ArrowDown');

    await open(page);
    await expect(menu(page)).toBeVisible();
  });
});

test.describe('the menu over a line (B-UI-16)', () => {
  const menu = (page: import('@playwright/test').Page) => page.locator('.shape-menu');
  const open = (page: import('@playwright/test').Page) => page.keyboard.press('Control+e');
  /** One button is lit per open row; the deepest is the one being pointed at. */
  const lit = (page: import('@playwright/test').Page) =>
    page.locator('.shape-menu button.here').last();

  async function line(ed: Editor): Promise<void> {
    await ed.tool('Line');
    await ed.drag([0, 0], [10, 0]);
    await ed.tool('Select');
    await ed.click(5, 0);
  }

  test('offers a style and the two ends', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await line(ed);

    await open(page);
    await expect(menu(page)).toBeVisible();
    await expect(menu(page).locator('.shape-menu-row').first().getByRole('button')).toHaveText([
      'Style▸',
      'Line end▸',
    ]);
  });

  test('entering a group opens a second row rather than replacing the first', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await line(ed);

    await open(page);
    await ed.press('ArrowRight'); // Line end
    await ed.press('Enter');

    await expect(menu(page).locator('.shape-menu-row')).toHaveCount(2);
    await expect(menu(page).locator('.shape-menu-row').nth(1).getByRole('button')).toHaveText([
      'End 1▸',
      'End 2▸',
    ]);
  });

  test('escape backs out one level at a time', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await line(ed);

    await open(page);
    await ed.press('ArrowRight');
    await ed.press('Enter'); // into Line end
    await ed.press('Enter'); // into End 1
    await expect(menu(page).locator('.shape-menu-row')).toHaveCount(3);

    await ed.press('Escape');
    await expect(menu(page).locator('.shape-menu-row')).toHaveCount(2);
    await ed.press('Escape');
    await expect(menu(page).locator('.shape-menu-row')).toHaveCount(1);
    await ed.press('Escape');
    await expect(menu(page)).toHaveCount(0);
  });

  test('putting an arrow on one end, and taking it off again', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await line(ed);
    expect(await ed.text()).toBe('───────────');

    await open(page);
    await ed.press('ArrowRight'); // Line end
    await ed.press('Enter');
    await ed.press('ArrowRight'); // End 2 — the right-hand one
    await ed.press('Enter');
    await ed.press('ArrowRight'); // Arrow
    await ed.press('Enter');

    expect(await ed.text()).toBe('──────────▶');

    // And back. Reopening lands where it was left (B-UI-16b), so the way back
    // is one step sideways rather than the whole walk again.
    await ed.click(5, 0);
    await open(page);
    await expect(lit(page)).toHaveText('Arrow');

    await ed.press('ArrowLeft'); // Normal
    await ed.press('Enter');

    // The cell goes to whatever its connectivity says, not to blank.
    expect(await ed.text()).toBe('───────────');
  });

  test('style redraws just that line, leaving everything else alone', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 2], [8, 4]);
    await ed.tool('Line');
    await ed.drag([0, 0], [10, 0]);
    await ed.tool('Select');
    await ed.click(5, 0);

    await open(page);
    await ed.press('Enter'); // into Style
    // Unicode, rounded, heavy, double, ASCII. Rounded draws a straight run with
    // the same character, so it is no proof of anything — ASCII is.
    for (let i = 0; i < 4; i++) await ed.press('ArrowRight');
    await ed.press('Enter');

    const rows = (await ed.text()).split('\n');
    // The line changed and the box did not: a charset applies to the selection,
    // not to the page.
    expect(rows[0]).toBe('-----------');
    expect(rows[2]).toBe('┌───────┐');
  });

  test('hovering an end lights it up on the canvas', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await line(ed);

    await open(page);
    await ed.press('ArrowRight');
    await ed.press('Enter'); // End 1 highlighted
    await expect(lit(page)).toHaveText('End 1▸');

    // The hint is session state, so the canvas can draw it; nothing is written.
    expect(await ed.text()).toBe('───────────');
  });

  test('a box still gets its lattice, not a line menu', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);

    await open(page);
    await expect(menu(page).getByRole('button')).toHaveText(['Add column', 'Add row']);
  });
});

test.describe('the freehand tool (B-DRAW-16)', () => {
  test('ctrl+q picks it up, and a drag draws what the pointer crossed', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await page.keyboard.press('Control+q');
    await ed.drag([0, 0], [6, 0]);

    expect(await ed.text()).toBe('───────');
  });

  test('a dragged corner comes out as a corner', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await page.keyboard.press('Control+q');
    // `drag` moves in steps, so the pointer really does pass through the bend.
    await ed.drag([0, 0], [4, 3]);

    const rows = (await ed.text()).split('\n');
    expect(rows.length).toBeGreaterThan(1);
    // Line glyphs, not a scatter of dots: every cell knows its neighbours.
    expect(rows.join('')).toMatch(/^[─│┌┐└┘├┤┬┴┼ ]+$/);
  });

  test('one stroke is one undo step', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await page.keyboard.press('Control+q');
    await ed.drag([0, 0], [6, 0]);
    expect(await ed.cellCount()).toBeGreaterThan(0);

    await page.keyboard.press('Control+z');
    expect(await ed.cellCount()).toBe(0);
  });

  test('the line tool offers a button through to it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Line');

    await page.getByRole('button', { name: 'Draw by hand' }).click();
    await expect(page.locator('.ribbon-caption')).toContainText(['Draw', 'Back']);

    // And the band under it now describes freehand rather than corners.
    await expect(page.locator('.ribbon')).toContainText('follows the pointer');
  });

  test('and a button back to straight lines', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await page.keyboard.press('Control+q');
    await page.getByRole('button', { name: 'Straight lines' }).click();

    await expect(page.locator('.ribbon')).toContainText('Click corner after corner');
  });
});

test.describe('the ribbon (B-UI-12)', () => {
  test('shows the current tool, and changes with it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Select');
    // Modes first, because leaving select is the thing select is for; and no
    // Typing group any more, because it does not type (B-KEY-21).
    expect(await ed.ribbonGroups()).toEqual([
      'Modes',
      'Select',
      'Move',
      'Sweep',
      'Objects',
      'Act',
    ]);

    await ed.tool('Eraser');
    expect(await ed.ribbonGroups()).toEqual(['Brush', 'Repair']);

    await ed.tool('Line');
    expect(await ed.ribbonGroups()).toEqual(['Draw', 'Shape', 'Freehand']);

    await page.keyboard.press('Control+q');
    expect(await ed.ribbonGroups()).toEqual(['Draw', 'Back']);
  });

  test('never moves the canvas, whatever tool is chosen', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    const top = await ed.canvasTop();
    for (const name of ['Box', 'Circle', 'Line', 'Arrow', 'Text', 'Eraser', 'Select']) {
      await ed.tool(name);
      expect(await ed.canvasTop()).toBe(top);
    }
  });

  test('shows live state, not just keys', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Select');

    // Object select is select's own state. Insert-versus-overwrite is not
    // shown here any more: it is a fact about writing, and writing has its
    // own mode now.
    expect(await ed.ribbonStates()).toEqual(['Off']);

    await ed.doubleShift();
    expect(await ed.ribbonStates()).toEqual(['On']);

    await ed.press('ArrowRight'); // a bare arrow leaves object select
    expect(await ed.ribbonStates()).toEqual(['Off']);
  });

  test('and the typing mode, where typing actually happens', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Text');

    expect(await ed.ribbonStates()).toEqual(['Overwrite']);

    await ed.press('Insert');
    expect(await ed.ribbonStates()).toEqual(['Insert']);
  });

  test('and the brush size it is actually holding', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await ed.tool('Eraser');

    expect(await ed.ribbonStates()).toEqual(['1×1']);
    await ed.press(']');
    await ed.press(']');
    expect(await ed.ribbonStates()).toEqual(['3×3']);
  });
});

test.describe('Tab reaches into an empty shape (B-SEL-17)', () => {
  async function emptyBox(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);
  }

  test('tab puts a caret inside a box with nothing written in it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await emptyBox(ed);

    await ed.press('Tab');
    expect(await ed.caret()).toContain('1, 1');

    await ed.type('hi');
    expect((await ed.text()).split('\n')[1]).toBe('│hi     │');
  });

  test('and tab again comes back out to the box', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await emptyBox(ed);

    await ed.press('Tab');
    await ed.press('Tab');

    expect(await ed.caret()).toBeNull();
    expect(await ed.selection()).toContain('Box 9×5');
  });

  test('a box too small to hold anything is left alone', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [1, 1]); // 2x2: all wall, no interior
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Tab');

    expect(await ed.caret()).toBeNull();
  });
});

test.describe('the actions menu remembers (B-UI-13)', () => {
  test('reopening highlights the option used last', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);

    await page.keyboard.press('Control+e');
    await ed.press('ArrowRight'); // move to Add row
    await ed.press('Enter'); // and use it

    await ed.click(0, 0); // select the grown shape again
    await page.keyboard.press('Control+e');

    await expect(page.locator('.shape-menu button.here')).toHaveText('Add row');
  });
});

test.describe('enter widens, ctrl+enter takes everything joined up (B-SEL-19)', () => {
  /** Two boxes drawn flush, with a line running out of the right-hand one. */
  async function wired(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([4, 0], [8, 2]);
    await ed.tool('Line');
    await ed.drag([8, 1], [16, 1]);
    await ed.tool('Select');
    // Park the keyboard on the left box, then drop what the click selected so
    // the ladder is entered from the bottom.
    await ed.click(1, 0);
    await ed.press('Escape');
  }

  test('enter takes the shape, and again takes the whole shape', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);
    expect(await ed.selection()).toContain('no selection');

    await ed.press('Enter');
    expect(await ed.selection()).toContain('5×3'); // the one box

    await ed.press('Enter');
    expect(await ed.selection()).toContain('9×3'); // both, as one shape
  });

  test('and never reaches down the line to what it connects to', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);

    // However many times it is pressed, it stays inside the shape: the line
    // running out to x=16 is never swept in.
    for (let i = 0; i < 6; i++) {
      await ed.press('Enter');
      expect(await ed.selection()).not.toContain('17×');
    }
  });

  test('ctrl+enter does reach it, line and all', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);

    await page.keyboard.press('Control+Enter');
    // Both boxes plus the line: nine columns become seventeen.
    expect(await ed.selection()).toContain('17×3');
  });

  test('neither of them touches the document', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);
    const drawn = await ed.text();

    for (let i = 0; i < 3; i++) await ed.press('Enter');
    await page.keyboard.press('Control+Enter');

    // Delete is the key that erases; these only ever change what is lit up.
    expect(await ed.text()).toBe(drawn);
  });

  test('a lone shape is its own whole shape, so enter settles on it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Escape');

    // Nowhere else to go, so it stays rather than flickering to something else.
    await ed.press('Enter');
    expect(await ed.selection()).toContain('9×5');
    await ed.press('Enter');
    expect(await ed.selection()).toContain('9×5');
  });
});

test.describe('ctrl+click builds a selection out of pieces (B-SEL-09a)', () => {
  /** Two boxes wired together: one component, three pieces. */
  async function wired(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [6, 2]);
    await ed.drag([16, 0], [22, 2]);
    await ed.tool('Line');
    await ed.drag([6, 1], [16, 1]);
    await ed.tool('Select');
  }

  test('shift takes the whole connected thing', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);
    await ed.click(30, 10); // start from nothing

    await ed.click(0, 0, { modifiers: ['Shift'] });
    // Both boxes and the wire, because they are all one component.
    expect(await ed.selection()).toContain('23×3');
  });

  test('ctrl takes only the piece under the pointer', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);
    await ed.click(30, 10);

    await ed.click(0, 0, { modifiers: ['Control'] });
    expect(await ed.selection()).toContain('7×3'); // the left box alone
  });

  test('and a second ctrl+click adds the next piece', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);
    await ed.click(30, 10);

    await ed.click(0, 0, { modifiers: ['Control'] });
    await ed.click(16, 0, { modifiers: ['Control'] });

    // The two boxes, and deliberately not the wire between them.
    expect(await ed.selection()).toContain('23×3');
    // Erasing takes both boxes and leaves the wire standing, which is the
    // proof that it was never selected. Its two end cells merged into the
    // walls, so they go with them; `toText` crops to what is left.
    await ed.press('Delete');
    expect(await ed.text()).toBe('─────────');
  });

  test('ctrl+clicking a piece already in drops it again', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await wired(ed);
    await ed.click(30, 10);

    await ed.click(0, 0, { modifiers: ['Control'] });
    await ed.click(16, 0, { modifiers: ['Control'] });
    await ed.click(16, 0, { modifiers: ['Control'] });

    expect(await ed.selection()).toContain('7×3');
  });
});

test.describe('reaching a line that is joined to a shape (B-SEL-19d)', () => {
  /** A box with a line hanging off its bottom wall. */
  async function hanging(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [10, 4]);
    await ed.tool('Line');
    await ed.drag([5, 4], [5, 10]);
    await ed.tool('Select');
  }

  test('ctrl+enter from the blank inside of a shape still takes it, line and all', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();
    await hanging(ed);

    // Clicking a cell's inside is the natural way to point at it, and the
    // inside is blank — so there was nothing under the keyboard to trace from
    // and the key did nothing at all.
    await ed.click(3, 2);
    expect(await ed.selection()).toContain('no selection');

    await page.keyboard.press('Control+Enter');
    expect(await ed.selection()).toContain('11×11');
  });

  test('and from a selection it grows to everything that touches it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await hanging(ed);

    await ed.click(0, 0); // the box alone
    expect(await ed.selection()).toContain('11×5');

    await page.keyboard.press('Control+Enter');
    expect(await ed.selection()).toContain('11×11');
  });

  test('clicking the line then selects the line, big selection or not', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await hanging(ed);

    await ed.click(0, 0);
    await page.keyboard.press('Control+Enter');
    expect(await ed.selection()).toContain('11×11');

    // A press inside the selection used to keep it, so there was no way to
    // point back at one piece of what had been taken.
    await ed.click(5, 8);
    expect(await ed.selection()).toContain('Line');
  });

  test('a drag inside the selection still moves it rather than re-reading', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await hanging(ed);

    // A second, unconnected box, so the export has something to be measured
    // against: move *everything* and the crop moves with it, leaving the text
    // identical however far it went.
    await ed.tool('Box');
    await ed.drag([20, 0], [24, 2]);
    await ed.tool('Select');

    await ed.click(0, 0);
    await page.keyboard.press('Control+Enter');
    const before = await ed.text();

    await ed.drag([5, 8], [7, 8]); // grab the selection and move it
    expect(await ed.text()).not.toBe(before);
    // Still the whole thing: a drag pins its reading for the gesture (B-SEL-06),
    // so only a click that goes nowhere reads the cell again.
    expect(await ed.selection()).toContain('11×11');
  });
});

test.describe('shift+arrow adds cells to what is selected (B-SEL-20)', () => {
  /** A box, a gap, and a second box to reach into. */
  async function neighbours(ed: Editor): Promise<void> {
    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([6, 0], [10, 2]);
    await ed.tool('Select');
    await ed.click(1, 0);
    await ed.press('Escape');
    await ed.press('Enter'); // take the first box
  }

  test('it grows the selection rather than starting a new sweep', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await neighbours(ed);
    expect(await ed.selection()).toContain('5×3');

    // The rectangle carries on from the box. It used to throw the box away and
    // start again at the cursor, leaving `Cells 2×1`.
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('5×3');
    expect(await ed.selection()).not.toContain('2×1');

    // One more reaches the gap's far side and takes the neighbour's wall.
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('7×3');
  });

  test('and pressing back the other way shrinks it again', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await neighbours(ed);

    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    expect(await ed.selection()).toContain('7×3');

    // It is an ordinary sweep with an anchor, so it runs both ways.
    await page.keyboard.press('Shift+ArrowLeft');
    expect(await ed.selection()).toContain('5×3');
  });

  test('downward too, taking whole rows', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([0, 4], [4, 6]);
    await ed.tool('Select');
    await ed.click(1, 0);
    await ed.press('Escape');
    await ed.press('Enter');
    expect(await ed.selection()).toContain('5×3');

    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    expect(await ed.selection()).toContain('5×5');
  });

  test('a bare arrow still ends it, so the next sweep starts where you are', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await neighbours(ed);

    // Walking out of the selection gives up the right to carry on from it.
    await ed.press('ArrowRight');
    await ed.press('ArrowRight');
    await ed.press('ArrowRight');
    await ed.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');

    expect(await ed.selection()).not.toContain('5×3');
  });
});

test.describe('escape abandons, and never destroys (B-KEY-02)', () => {
  test('a box abandoned mid-drag leaves the one it was drawn across untouched', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    const drawn = await ed.text();

    // A second box straight over the first, called off before release.
    await ed.abandonedDrag([2, 1], [16, 9]);

    expect(await ed.text()).toBe(drawn);
  });

  test('and a box abandoned mid-draft was never in the document at all', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    const drawn = await ed.text();

    await ed.press('Space'); // start one at the keyboard cursor
    for (let i = 0; i < 6; i++) await ed.press('ArrowRight');
    for (let i = 0; i < 3; i++) await ed.press('ArrowDown');
    await ed.press('Escape');

    expect(await ed.text()).toBe(drawn);
  });

  test('a move, a resize and an eraser stroke are all only ever called off', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    const drawn = await ed.text();

    await ed.tool('Select');
    await ed.click(0, 0);

    // (2,0) is plain edge — a move. (4,0) is the midpoint — a resize handle.
    await ed.abandonedDrag([2, 0], [20, 12]);
    expect(await ed.text()).toBe(drawn);

    await ed.click(0, 0);
    await ed.abandonedDrag([4, 0], [4, 14]);
    expect(await ed.text()).toBe(drawn);

    await ed.tool('Eraser');
    await ed.abandonedDrag([0, 0], [8, 4]);
    expect(await ed.text()).toBe(drawn);
  });

  test('erasing is what erases, and it still does', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);

    // Escape only lets go of the selection; Delete is what takes the shape.
    await ed.press('Escape');
    expect(await ed.cellCount()).toBeGreaterThan(0);

    await ed.click(0, 0);
    await ed.press('Delete');
    expect(await ed.cellCount()).toBe(0);
  });
});

test.describe('the wheel (B-CAM-02, B-CAM-03)', () => {
  test('scrolls down and back up', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.hover(10, 5);
    const [x0, y0] = await ed.cursorCell();

    // The pointer does not move, so a changed reading is the camera moving.
    await page.mouse.wheel(0, 200);
    await ed.hover(10, 5);
    const [x1, y1] = await ed.cursorCell();
    expect(y1).toBeGreaterThan(y0);
    expect(x1).toBe(x0);

    await page.mouse.wheel(0, -200);
    await ed.hover(10, 5);
    const [, y2] = await ed.cursorCell();
    expect(y2).toBe(y0);
  });

  test('and ctrl sends it sideways instead', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.hover(10, 5);
    const [x0, y0] = await ed.cursorCell();

    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 200);
    await page.keyboard.up('Control');

    await ed.hover(10, 5);
    const [x1, y1] = await ed.cursorCell();
    expect(x1).toBeGreaterThan(x0);
    expect(y1).toBe(y0);
  });

  test('shift zooms, and Ctrl+0 puts it back', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    expect(await ed.zoom()).toBe('100%');

    await ed.hover(10, 5);
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -200);
    await page.keyboard.up('Shift');

    expect(await ed.zoom()).not.toBe('100%');

    await page.keyboard.press('Control+0');
    expect(await ed.zoom()).toBe('100%');
  });

  test('scrolling up at the origin stops rather than going negative (B-CAM-01)', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.hover(10, 5);
    const [x0, y0] = await ed.cursorCell();

    await page.mouse.wheel(0, -600);
    await ed.hover(10, 5);

    expect(await ed.cursorCell()).toEqual([x0, y0]);
  });
});

test.describe('ctrl+arrow jumps like a spreadsheet (B-KEY-18)', () => {
  test('to the far wall of the shape you are standing on', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Escape'); // drop the selection, leave the keyboard there

    await page.keyboard.press('Control+ArrowRight');
    await ed.mark('X'); // lands wherever the keyboard now is

    // X at index 8 is the right-hand wall, which is where the jump had to land.
    // The box then grows by one to keep its border rather than lose it
    // (content §4), which is why the `┐` is still there behind it.
    expect((await ed.text()).split('\n')[0]).toBe('┌───────X┐');
  });

  test('and across a gap to the next shape', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([12, 0], [16, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Escape');

    await page.keyboard.press('Control+ArrowRight'); // to this box's far wall
    await page.keyboard.press('Control+ArrowRight'); // over the blanks
    await ed.mark('X');

    expect((await ed.text()).split('\n')[0]).toBe('┌───┐       X───┐');
  });

  test('with shift it drags the selection out to where it lands', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Escape');

    await page.keyboard.press('Control+Shift+ArrowRight');
    await ed.press('Delete');

    // The whole top edge went in one press, and nothing below it did.
    expect((await ed.text()).split('\n')).toEqual([
      '│       │',
      '│       │',
      '│       │',
      '└───────┘',
    ]);
  });

  test('a wall already reached is not left', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('Escape');

    await page.keyboard.press('Control+ArrowUp'); // already on the top wall
    await ed.mark('X');

    expect((await ed.text()).split('\n')[0]).toBe('X───┐');
  });

  test('with nothing to jump to, left and up still reach the walls', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    // One mark, far from both walls, and nothing between it and them.
    await ed.tool('Select');
    await ed.click(12, 6);
    await ed.mark('a');

    await page.keyboard.press('Control+ArrowLeft');
    await page.keyboard.press('Control+ArrowUp');
    await ed.mark('b');

    // 'b' landed at the origin: the two walls were both reachable.
    expect((await ed.text()).split('\n')[0]).toBe('b');
    expect(await ed.cellCount()).toBe(2);
  });

  test('and right and down move one cell rather than nothing', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.mark('a'); // keyboard is now at (1,0), with nothing beyond

    await page.keyboard.press('Control+ArrowRight');
    await ed.mark('b');

    // A step, not a stand-still: 'b' at x=2 leaves one blank behind it.
    expect((await ed.text()).split('\n')[0]).toBe('a b');
  });
});

test.describe('alt+arrow strides when there is nothing to nudge (B-KEY-19)', () => {
  test('five cells, in the direction asked', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.mark('a'); // written, and back out at (1,0) with nothing selected

    await page.keyboard.press('Alt+ArrowRight');
    await ed.mark('b');

    // 'a' at x=0 leaves the keyboard at x=1; a stride across is ten, so 'b'
    // lands at x=11 with x=1..10 blank. Built rather than counted, because
    // counting spaces by eye is what has gone wrong here repeatedly.
    expect((await ed.text()).split('\n')[0]).toBe(`a${' '.repeat(10)}b`);
  });

  test('and downward too, clamped at the origin coming back', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.mark('a');

    await page.keyboard.press('Alt+ArrowDown');
    await page.keyboard.press('Alt+ArrowUp');
    await page.keyboard.press('Alt+ArrowUp'); // would be negative; clamps at 0
    await ed.mark('b');

    // Down a stride and up two lands back on row 0: the vertical stride is
    // still five, and only the sideways one doubled.
    expect((await ed.text()).split('\n')).toEqual(['ab']);
  });

  test('but with something selected it still nudges that instead', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    // Two boxes, because `toText` crops to the content: a lone box that shifts
    // right comes out looking identical, and the gap is what shows the move.
    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([8, 0], [12, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);
    expect((await ed.text()).split('\n')[0]).toBe('┌───┐   ┌───┐');

    await page.keyboard.press('Alt+ArrowRight');

    // The gap closed by one, not five: a nudge, not a stride.
    expect((await ed.text()).split('\n')[0]).toBe('┌───┐  ┌───┐');
  });

  test('in a drawing tool too, before a shape is started', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    // A mark at the origin, so `toText` has something to crop against and the
    // box's position is visible rather than normalised away.
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.mark('a'); // keyboard left at (1,0)

    await ed.tool('Box');
    await page.keyboard.press('Alt+ArrowRight'); // (6,0)
    await ed.press('Space');
    for (let i = 0; i < 3; i++) await ed.press('ArrowRight');
    for (let i = 0; i < 2; i++) await ed.press('ArrowDown');
    await ed.press('Enter');

    expect((await ed.text()).split('\n')[0]).toBe(`a${' '.repeat(10)}┌──┐`);
  });

  test('and it drags a drafted corner by a stride as well', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.press('Space'); // anchored at the origin
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowDown');
    await ed.press('Enter');

    // A stride each way from the anchor: ten across and five down, so 11x6.
    const rows = (await ed.text()).split('\n');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe(`┌${'─'.repeat(9)}┐`);
  });

  test('and under the text tool, which has its own caret', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Text');
    await ed.click(0, 0);
    await ed.type('a');

    await page.keyboard.press('Alt+ArrowRight');
    await ed.type('b'); // still writing: `t` here would be a letter, not a mode

    expect((await ed.text()).split('\n')[0]).toBe(`a${' '.repeat(10)}b`);
  });

  test('a stride while writing carries the caret with it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.press('t');
    await ed.type('a'); // caret live at (1,0), nothing selected

    await page.keyboard.press('Alt+ArrowRight');
    await ed.type('b');

    expect((await ed.text()).split('\n')[0]).toBe(`a${' '.repeat(10)}b`);
  });
});

test.describe('ctrl carries the selection (B-KEY-20)', () => {
  /** Two boxes, because `toText` crops: the gap is what shows a move. */
  async function twoBoxes(ed: Editor): Promise<void> {
    // Far enough apart that a full stride still lands clear of the second box.
    await ed.tool('Box');
    await ed.drag([0, 0], [4, 2]);
    await ed.drag([24, 0], [28, 2]);
    await ed.tool('Select');
    await ed.click(0, 0);
  }

  test('ctrl+arrow moves it one cell', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);

    await page.keyboard.press('Control+ArrowRight');

    // Box one slid from x=0 to x=1; the gap to box two at x=24 is 18 cells.
    expect((await ed.text()).split('\n')[0]).toBe(`┌───┐${' '.repeat(18)}┌───┐`);
  });

  test('and ctrl+alt+arrow moves it a whole stride', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);

    await page.keyboard.press('Control+Alt+ArrowRight');

    // Ten across, so box one now starts at x=10 and the gap is 9.
    expect((await ed.text()).split('\n')[0]).toBe(`┌───┐${' '.repeat(9)}┌───┐`);
  });

  test('with nothing selected ctrl still jumps', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();
    await twoBoxes(ed);
    await ed.press('Escape'); // let go, and the key goes back to navigating

    await page.keyboard.press('Control+ArrowRight'); // to this box's far wall
    await ed.mark('X');

    // X at x=4 is the right-hand wall, which is where the jump had to land;
    // the box then grows by one to keep its border (content §4), and the far
    // box is untouched because it was never in the way.
    expect((await ed.text()).split('\n')[0]).toBe(`┌───X┐${' '.repeat(18)}┌───┐`);
  });

  test('and a reading-order sweep keeps growing rather than turning into a drag', async ({
    page,
  }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.mark('ab');
    await ed.click(0, 0);
    await ed.press('Escape'); // keyboard at (0,0), nothing selected

    const drawn = await ed.text();
    await page.keyboard.press('Control+Alt+ArrowRight');
    await page.keyboard.press('Control+Alt+ArrowRight');

    // The second press extended the sweep; it did not pick the selection up.
    expect(await ed.text()).toBe(drawn);
    expect(await ed.selection()).not.toContain('no selection');
  });
});

test.describe('dragging a side resizes the shape (B-MAN-15)', () => {
  test('a box widens rather than coming apart', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [16, 5]);
    await ed.tool('Select');

    // Marquee from empty space over the right-hand column alone.
    await ed.drag([20, 7], [16, 0]);
    expect(await ed.selection()).toContain('1×6');

    await ed.drag([16, 3], [18, 3]);

    expect((await ed.text()).split('\n')).toEqual([
      `┌${'─'.repeat(17)}┐`,
      `│${' '.repeat(17)}│`,
      `│${' '.repeat(17)}│`,
      `│${' '.repeat(17)}│`,
      `│${' '.repeat(17)}│`,
      `└${'─'.repeat(17)}┘`,
    ]);
  });

  test('and the left side too, growing the other way', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([4, 0], [20, 5]);
    await ed.tool('Select');
    await ed.drag([2, 7], [4, 0]);
    await ed.drag([4, 3], [2, 3]);

    const rows = (await ed.text()).split('\n');
    expect(rows[0]).toBe(`┌${'─'.repeat(17)}┐`);
    expect(rows).toHaveLength(6);
  });

  test('a bottom edge deepens it', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');

    await ed.drag([12, 6], [0, 4]); // the bottom row alone
    expect(await ed.selection()).toContain('9×1');

    await ed.drag([4, 4], [4, 6]);

    const rows = (await ed.text()).split('\n');
    expect(rows).toHaveLength(7);
    expect(rows[6]).toBe(`└${'─'.repeat(7)}┘`);
  });

  test('a table widens the track against the wall, and keeps its divider', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 4]);
    await ed.tool('Select');
    await ed.click(0, 0);
    await ed.rightClick(0, 0);
    await page.getByRole('button', { name: 'Add column' }).click();

    const table = (await ed.text()).split('\n');
    expect(table[0]).toBe('┌───────┬───────┐');

    // The table's own right wall, on its own.
    await ed.drag([20, 6], [16, 0]);
    await ed.drag([16, 2], [18, 2]);

    const after = (await ed.text()).split('\n');
    expect(after[0]).toBe('┌───────┬─────────┐');
    expect(after).toHaveLength(5);
  });

  test('the side stays in hand, so the pull can be repeated', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [16, 5]);
    await ed.tool('Select');
    await ed.drag([20, 7], [16, 0]);

    // Three pulls in a row, each grabbing the wall where the last one left it.
    await ed.drag([16, 3], [18, 3]);
    await ed.drag([18, 3], [20, 3]);
    await ed.drag([20, 3], [22, 3]);

    // 17 wide plus three pulls of two.
    expect((await ed.text()).split('\n')[0]).toBe(`┌${'─'.repeat(21)}┐`);
  });

  test('and pulling it back in shrinks the shape again', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [16, 5]);
    await ed.tool('Select');
    await ed.drag([20, 7], [16, 0]);

    await ed.drag([16, 3], [20, 3]); // out four
    await ed.drag([20, 3], [17, 3]); // and back three

    expect((await ed.text()).split('\n')[0]).toBe(`┌${'─'.repeat(16)}┐`);
  });

  test('and the arrow keys carry on stretching it too', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [16, 5]);
    await ed.tool('Select');
    await ed.drag([20, 7], [16, 0]);

    // Alt nudges the selection by one, and the selection is a side.
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowRight');

    expect((await ed.text()).split('\n')[0]).toBe(`┌${'─'.repeat(17)}┐`);
  });

  test('but half a wall is still just cells being moved', async ({ page }) => {
    const ed = new Editor(page);
    await ed.goto();

    await ed.tool('Box');
    await ed.drag([0, 0], [8, 5]);
    await ed.tool('Select');

    // Only part of the right-hand column: not a side, so not a resize.
    await ed.drag([11, 3], [8, 1]);
    expect(await ed.selection()).toContain('1×3');

    await ed.drag([8, 2], [10, 2]);

    // Torn on purpose — rearranging a piece of a drawing is a real thing to do.
    const rows = (await ed.text()).split('\n');
    expect(rows[0]).toBe('┌───────┐');
    expect(rows[2]).toBe('│         │');
  });
});
