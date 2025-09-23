import type { FileBridge, KeyBindingBridge } from './bridges';

// Simple basename helper (Windows/macOS/Linux-safe)
// We keep it local to avoid importing Node path in the renderer bundle.
function baseName(fullPath: string): string {
  const slash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
  return slash >= 0 ? fullPath.slice(slash + 1) : fullPath;
}

/**
 * Electron implementation skeleton for FileBridge.
 * NOTE: This version intentionally returns minimal placeholders so the app compiles
 * and runs in Electron. We'll add real IPC (read/write) in a follow-up.
 */
export const fileBridgeElectron: FileBridge = {
  async open() {
    const path = await window.electron?.openFileDialog();
    if (!path) return null;

    // TODO: Replace with IPC readText(path) from main.
    // OpenResult requires a `data: string`; return empty for now so callers can branch.
    return { path, data: '', cookie: path };
  },

  async save(cookie: unknown | null, suggestedName: string, data: string) {
    // TODO: Implement via dialog.showSaveDialog / writeFile in main and return filename+cookie.
    // Returning null signals "not handled" so callers can fall back if needed.
    return null;
  },

  async saveAs(suggestedName: string, data: string) {
    // TODO: Implement via dialog.showSaveDialog / writeFile in main and return filename+cookie.
    return null;
  },

  async pickOpenFile() {
    const path = await window.electron?.openFileDialog();
    if (!path) return null;
    return { cookie: path, fileName: baseName(path) };
  },

  async pickSaveFile(suggestedName?: string) {
    // TODO: Implement via dialog.showSaveDialog in main and return chosen path as cookie.
    return null;
  },

  async readText(cookie: unknown) {
    // TODO: Implement via IPC: main reads file (cookie/path) and returns contents.
    return null;
  },

  canPickFiles() {
    // Electron supports native pickers.
    return true;
  },

  async getWriteDate(cookie: unknown) {
    // TODO: Implement via IPC (stat.mtimeMs).
    return null;
  },
};

/**
 * Electron KeyBindingBridge:
 * - Electron doesn't hijack browser key combos, so mark as not hijacked.
 * - Provide DOM keydown on/off so your existing useEffect cleanup works.
 */
export const keyBindingBridgeElectron: KeyBindingBridge = {
  on(handler: (e: KeyboardEvent) => void) {
    document.addEventListener('keydown', handler, { passive: true });
  },
  off(handler: (e: KeyboardEvent) => void) {
    document.removeEventListener('keydown', handler);
  },
  commonKeyBindingsHijacked: false,
};
