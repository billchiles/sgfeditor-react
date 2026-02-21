import type { FileBridge, KeyBindingBridge } from './bridges';

/// Simple basename helper (Windows/macOS/Linux-safe)
/// We keep it local to avoid importing Node path in the renderer bundle.
function baseName (fullPath: string): string {
  const slash = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
  return slash >= 0 ? fullPath.slice(slash + 1) : fullPath;
}

/// Electron implementation skeleton for FileBridge.
/// NOTE: This version intentionally returns minimal placeholders so the app compiles
/// and runs in Electron. We'll add real IPC (read/write) in a follow-up.
///
export const fileBridgeElectron: FileBridge = {
  async open () {
    const path = await window.electron?.pickOpenFile();
    if (!path) return null;
    const data = await window.electron!.readText(path);
    return { path, data, cookie: path };
  },

  async save (cookie: unknown | null, suggestedName: string, data: string) {
    // If we already have a target (cookie is a path string), write in place
    if (typeof cookie === "string" && cookie !== "") {
      await window.electron!.writeText(cookie, data);
      return { fileName: baseName(cookie), cookie };
    }
    // Otherwise, fall back to Save As
    return this.saveAs(suggestedName, data);
  },

  async saveAs (suggestedName: string, data: string) {
    const path = await window.electron?.pickSaveFile(suggestedName);
    if (!path) return null;
    await window.electron!.writeText(path, data);
    return { fileName: baseName(path), cookie: path };
  },

  async pickOpenFile () {
    const path = await window.electron?.pickOpenFile();
    // In Electron, fileName is the full path (used as the stable game identity).
    return path ? { cookie: path, fileName: path } : null;

  },

  async pickSaveFile (suggestedName) {
    const path = await window.electron?.pickSaveFile(suggestedName);
    // In Electron, fileName is the full path (used as the stable game identity).
    return path ? { cookie: path, fileName: path } : null;
  },

  async readText (cookie) {
    return typeof cookie === "string" && cookie !== ""
      ? window.electron!.readText(cookie)
      : null;
  },

  canPickFiles () {
    return true;
  },

  async getWriteDate (cookie: unknown) {
    if (typeof cookie !== "string" || cookie === "") return null;
    return await window.electron!.timestamp(cookie);
  },
};

/// Electron KeyBindingBridge:
/// - Provide DOM keydown on/off so your existing useEffect cleanup works.
///
export const keyBindingBridgeElectron: KeyBindingBridge = {
  on(handler: (e: KeyboardEvent) => void) {
    document.addEventListener('keydown', handler, { capture: true, passive: false });
  },
  off(handler: (e: KeyboardEvent) => void) {
    document.removeEventListener('keydown', handler, { capture: true });
  },
  commonKeyBindingsHijacked: false,
};
