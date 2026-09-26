/**
 * Picks the platform implementation once, at startup.
 *
 * This is the only module the app imports; `web/`, `desktop/` and `terminal/` are
 * off limits to everything above (enforced by lint), so there is no forked UI code
 * path.
 *
 * Two of the three are chosen here and the third is handed in, and the asymmetry
 * is not laziness — it is the bundler. `web/` and `desktop/` are both browser code
 * and cost nothing to sit beside each other; `terminal/` imports `node:fs`,
 * `node:path` and `node:child_process`, and a static import of it here would put
 * those in the *browser* bundle's dependency graph, where they cannot be resolved
 * and the build fails outright. A dynamic import would not help: Rollup follows
 * those too.
 *
 * So the shell that has a Node platform installs it (`installPlatform`), and the
 * web build's graph never mentions the terminal at all. That is the same direction
 * the Tauri build already works in — a shell knows which platform it is; the app
 * above it does not.
 */

import type { PlatformAdapter } from './adapter.ts';
import { createDesktopAdapter, isDesktop } from './desktop/index.ts';
import { createWebAdapter } from './web/index.ts';

let current: PlatformAdapter | null = null;

/**
 * Use this implementation instead of picking one.
 *
 * For a shell whose platform cannot be part of the browser bundle — which today
 * means the terminal. Must be called before anything reads `platform()`, which in
 * practice means before the first frame: the store reaches for it the first time
 * a document is opened, saved or copied.
 */
export function installPlatform(adapter: PlatformAdapter): void {
  current = adapter;
}

export function platform(): PlatformAdapter {
  current ??= isDesktop() ? createDesktopAdapter() : createWebAdapter();
  return current;
}

export {
  DEFAULT_FILENAME,
  type LinePrompt,
  type OpenedFile,
  type PlatformAdapter,
} from './adapter.ts';
