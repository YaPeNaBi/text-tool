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

/**
 * How a platform asks the user for a line of text, when it has no dialog to put
 * one in.
 *
 * The web and the desktop both have a real file picker and never need this. A
 * terminal's picker is a row at the bottom of its own screen, and the only code
 * that can draw there is the shell that owns the tty — so the shell hands one
 * function down and the platform still owns every file read and write. Returns
 * null when the user presses Escape, which is the same "cancelled" the pickers
 * report by throwing `AbortError`.
 */
export type LinePrompt = (question: string, initial: string) => Promise<string | null>;

export interface PlatformAdapter {
  readonly id: 'web' | 'desktop' | 'terminal';
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
