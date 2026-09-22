/**
 * Picks the platform implementation once, at startup.
 *
 * This is the only module the app imports; `web/` and `desktop/` are off limits
 * to everything above (enforced by lint), so there is no forked UI code path.
 */

import type { PlatformAdapter } from './adapter.ts';
import { createDesktopAdapter, isDesktop } from './desktop/index.ts';
import { createWebAdapter } from './web/index.ts';

let current: PlatformAdapter | null = null;

export function platform(): PlatformAdapter {
  current ??= isDesktop() ? createDesktopAdapter() : createWebAdapter();
  return current;
}

export { DEFAULT_FILENAME, type OpenedFile, type PlatformAdapter } from './adapter.ts';
