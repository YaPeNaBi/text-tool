import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const PLATFORM_PATTERN = {
  group: ['**/platform/web/**', '**/platform/desktop/**'],
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
    files: ['src/app/**/*.{ts,tsx}', 'src/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PLATFORM_PATTERN] }],
    },
  },

  {
    files: ['src/app/**/*.{ts,tsx}'],
    ignores: ['src/app/state/store.ts'],
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
);
