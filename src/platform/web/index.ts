/**
 * Web platform: File System Access API where it exists, download fallback
 * everywhere else.
 *
 * Chrome and Edge can write back to the file you opened. Firefox and Safari
 * cannot — there, "Save" produces a download instead, which is the honest
 * behaviour rather than pretending the file was updated in place.
 */

import {
  DEFAULT_FILENAME,
  type OpenedFile,
  type PlatformAdapter,
} from '../adapter.ts';

/** Minimal shape of the File System Access API, which TS's DOM lib may not carry. */
interface FilePickerWindow {
  showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
}

const RECENT_KEY = 'ascii-writer:recent';
const RECENT_MAX = 8;

const PICKER_OPTS = {
  types: [
    { description: 'Text', accept: { 'text/plain': ['.txt', '.asc', '.md'] } },
  ],
};

function picker(): FilePickerWindow {
  return window as unknown as FilePickerWindow;
}

function hasFileSystemAccess(): boolean {
  return typeof picker().showSaveFilePicker === 'function';
}

/** A cancelled picker throws AbortError; that is a normal outcome, not a failure. */
function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function pickWithInput(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,.asc,.md,text/plain';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file === undefined) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ name: file.name, text }));
    };
    input.click();
  });
}

export function createWebAdapter(): PlatformAdapter {
  // Held so "Save" can write back to the same file rather than re-prompting.
  let handle: FileSystemFileHandle | null = null;

  const remember = (name: string): void => {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      const list: string[] = raw === null ? [] : (JSON.parse(raw) as string[]);
      const next = [name, ...list.filter((n) => n !== name)].slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode, quota, or corrupt entry — recents are not worth failing over */
    }
  };

  const writeTo = async (h: FileSystemFileHandle, text: string): Promise<void> => {
    const writable = await h.createWritable();
    await writable.write(text);
    await writable.close();
  };

  return {
    id: 'web',
    limitation: hasFileSystemAccess()
      ? null
      : 'This browser cannot write files in place; Save downloads a copy.',

    canSaveInPlace: () => handle !== null,

    async openFile() {
      const open = picker().showOpenFilePicker;
      if (open === undefined) return pickWithInput();

      try {
        const [picked] = await open(PICKER_OPTS);
        if (picked === undefined) return null;
        handle = picked;
        const file = await picked.getFile();
        remember(file.name);
        return { name: file.name, text: await file.text() };
      } catch (err) {
        if (isAbort(err)) return null;
        throw err;
      }
    },

    async saveFile(name, text) {
      if (handle === null) return this.saveFileAs(name, text);
      await writeTo(handle, text);
      remember(handle.name);
      return handle.name;
    },

    async saveFileAs(name, text) {
      const save = picker().showSaveFilePicker;
      if (save === undefined) {
        download(name === '' ? DEFAULT_FILENAME : name, text);
        remember(name);
        return name;
      }
      try {
        const picked = await save({ suggestedName: name, ...PICKER_OPTS });
        handle = picked;
        await writeTo(picked, text);
        remember(picked.name);
        return picked.name;
      } catch (err) {
        if (isAbort(err)) return null;
        throw err;
      }
    },

    async readClipboard() {
      return navigator.clipboard.readText();
    },

    async writeClipboard(text) {
      await navigator.clipboard.writeText(text);
    },

    async recentFiles() {
      try {
        const raw = localStorage.getItem(RECENT_KEY);
        return raw === null ? [] : (JSON.parse(raw) as string[]);
      } catch {
        return [];
      }
    },

    onMenuCommand() {
      /* the browser has no native menu bar */
    },
  };
}
