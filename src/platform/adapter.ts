/**
 * The platform boundary (plan §6).
 *
 * Files, dialogs, the clipboard and native menus live behind this interface and
 * nowhere else. The web build and the desktop build share every line of UI code
 * above it; the only thing that differs is which implementation is injected at
 * startup.
 */

export interface OpenedFile {
  name: string;
  text: string;
}

export interface PlatformAdapter {
  readonly id: 'web' | 'desktop';
  /** Human-readable note about what this platform cannot do, if anything. */
  readonly limitation: string | null;

  /** Null when the user cancels. */
  openFile(): Promise<OpenedFile | null>;
  /**
   * Write back to the file that was opened or last saved. Platforms that cannot
   * write in place fall through to `saveFileAs`.
   * Returns the name it wrote, or null if the user cancelled.
   */
  saveFile(name: string, text: string): Promise<string | null>;
  saveFileAs(name: string, text: string): Promise<string | null>;
  /** True when `saveFile` can overwrite without asking. */
  canSaveInPlace(): boolean;

  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;

  recentFiles(): Promise<string[]>;
  onMenuCommand(handler: (cmd: string) => void): void;
}

export const DEFAULT_FILENAME = 'diagram.txt';
