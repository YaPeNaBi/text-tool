import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const PLATFORM_PATTERN = {
  group: ['**/platform/web/**', '**/platform/desktop/**', '**/platform/terminal/**'],
  message: 'Import from src/platform only; it picks the implementation.',
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src-tauri'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  /**
   * Boundary 1 — the core stays pure.
   *
   * No React, no store, no DOM. This is what keeps recognition unit-testable
   * and what would let `core` be lifted into its own package later.
   */
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'zustand', '**/app/**', '**/platform/**'],
              message: 'src/core must stay pure: no React, no store, no DOM.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'src/core must stay DOM-free.' },
        { name: 'document', message: 'src/core must stay DOM-free.' },
        { name: 'navigator', message: 'src/core must stay DOM-free.' },
      ],
    },
  },

  /**
   * Boundary 2 — one mutation path.
   *
   * Only the store may write to the grid (B-DOC-04). This is also what keeps
   * the door open for a CRDT swap later: exactly one call site to replace.
   */
  /**
   * Boundary 3 — one UI, two platforms.
   *
   * The app talks to `platform()` and never to a concrete implementation, so
   * there is no per-platform forked code path to keep in sync (plan §6).
   *
   * ESLint replaces rather than merges a repeated rule, so the block below
   * restates this pattern alongside the applyDiff one.
   */
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/terminal/**/*.ts', 'src/*.{ts,tsx}'],
    /**
     * The one file allowed to name its own platform.
     *
     * A *shell* knows which platform it is — `src-tauri/main.rs` is nothing but
     * that knowledge — and the terminal's has to, because `platform/index.ts`
     * cannot import a Node adapter without dragging `node:fs` into the browser
     * bundle. What the rule is actually protecting is `src/app/**`, which still
     * cannot name any of the three.
     */
    ignores: ['src/terminal/main.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PLATFORM_PATTERN] }],
    },
  },

  {
    files: ['src/app/**/*.{ts,tsx}', 'src/terminal/**/*.ts'],
    ignores: ['src/app/state/store.ts', 'src/terminal/main.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            PLATFORM_PATTERN,
            {
              group: ['**/core/grid/grid*'],
              importNames: ['applyDiff'],
              message: 'Mutate through useEditor.apply() only (B-DOC-04).',
            },
          ],
        },
      ],
    },
  },

  /**
   * Boundary 4 — the terminal build is a second *shell*, not a second app.
   *
   * It may reach down into `core` and across into `app`, because reusing every
   * line above `platform/` is the whole point of it. What it may not do is grow
   * its own copy of anything that already exists: React has no business here, and
   * a canvas renderer imported into a program with no canvas would be the first
   * sign that the two builds had started to fork.
   */
  {
    files: ['src/terminal/**/*.ts'],
    ignores: ['src/terminal/main.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            PLATFORM_PATTERN,
            {
              group: ['react', 'react-dom', '**/*.tsx', '**/canvas/renderer*', '**/canvas/camera*'],
              message: 'The terminal shell has no DOM: draw through terminal/frame.ts.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'The terminal shell has no DOM.' },
        { name: 'document', message: 'The terminal shell has no DOM.' },
      ],
    },
  },
);
