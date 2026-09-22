/**
 * Desktop platform: native dialogs and real file writes, through Tauri.
 *
 * This talks to the globals Tauri exposes when `app.withGlobalTauri` is on,
 * rather than importing `@tauri-apps/api`. That keeps the web bundle free of a
 * dependency it would never use, and keeps `npm install` working on a machine
 * with no Rust toolchain.
 *
 * Every capability is feature-detected. If the shell is missing a plugin, that
 * operation degrades to the web behaviour instead of throwing — a half-wired
 * desktop build should still be usable.
 */

import {
  DEFAULT_FILENAME,
  type OpenedFile,
  type PlatformAdapter,
} from '../adapter.ts';
import { createWebAdapter } from '../web/index.ts';

interface TauriDialog {
  open?: (opts?: unknown) => Promise<string | string[] | null>;
  save?: (opts?: unknown) => Promise<string | null>;
}

interface TauriFs {
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, contents: string) => Promise<void>;
}

interface TauriEvent {
  listen?: (event: string, handler: (e: { payload: unknown }) => void) => Promise<unknown>;
}

interface TauriGlobal {
  dialog?: TauriDialog;
  fs?: TauriFs;
  event?: TauriEvent;
}

function tauri(): TauriGlobal | null {
  const found = (window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__;
  return found ?? null;
}

/** True when this build is running inside the Tauri shell. */
export function isDesktop(): boolean {
  return tauri() !== null;
}

const FILTERS = [{ name: 'Text', extensions: ['txt', 'asc', 'md'] }];
const RECENT_KEY = 'ascii-writer:recent-paths';
const RECENT_MAX = 8;

function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut < 0 ? path : path.slice(cut + 1);
}

export function createDesktopAdapter(): PlatformAdapter {
  // Anything the shell does not provide falls through to the browser path.
  const web = createWebAdapter();
  let path: string | null = null;

  const remember = (p: string): void => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list: string[] = raw === null ? [] : (JSON.parse(raw) as string[]);
      localStorage.setItem(
        RECENT_KEY,
        JSON.stringify([p, ...list.filter((n) => n !== p)].slice(0, RECENT_MAX)),
      );
    } catch {
      /* recents are a convenience, never a reason to fail a save */
    }
  };

  const write = async (target: string, text: string): Promise<string | null> => {
    const fs = tauri()?.fs;
    if (fs?.writeTextFile === undefined) return web.saveFileAs(baseName(target), text);
    await fs.writeTextFile(target, text);
    path = target;
    remember(target);
    return baseName(target);
  };

  return {
    id: 'desktop',
    limitation: null,

    canSaveInPlace: () => path !== null,

    async openFile(): Promise<OpenedFile | null> {
      const t = tauri();
      if (t?.dialog?.open === undefined || t.fs?.readTextFile === undefined) {
        return web.openFile();
      }

      const picked = await t.dialog.open({ multiple: false, filters: FILTERS });
      const target = Array.isArray(picked) ? picked[0] : picked;
      if (target === undefined || target === null) return null;

      const text = await t.fs.readTextFile(target);
      path = target;
      remember(target);
      return { name: baseName(target), text };
    },

    async saveFile(name, text) {
      if (path === null) return this.saveFileAs(name, text);
      return write(path, text);
    },

    async saveFileAs(name, text) {
      const dialog = tauri()?.dialog;
      if (dialog?.save === undefined) return web.saveFileAs(name, text);

      const target = await dialog.save({
        defaultPath: name === '' ? DEFAULT_FILENAME : name,
        filters: FILTERS,
      });
      if (target === null) return null;
      return write(target, text);
    },

    readClipboard: () => web.readClipboard(),
    writeClipboard: (text) => web.writeClipboard(text),

    async recentFiles() {
      try {
        const raw = localStorage.getItem(RECENT_KEY);
        return raw === null ? [] : (JSON.parse(raw) as string[]);
      } catch {
        return [];
      }
    },

    onMenuCommand(handler) {
      const listen = tauri()?.event?.listen;
      if (listen === undefined) return;
      void listen('menu', (e) => {
        if (typeof e.payload === 'string') handler(e.payload);
      });
    },
  };
}
