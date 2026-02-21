/// Preload runs in the UI/renderer/app process.  It exposes an API that extends window for
/// UI/rendering code.
///
import { contextBridge, ipcRenderer } from "electron";


/// Buffer file-open activations that arrive before the renderer subscribes.  If the main proc
/// sends "app:open-file" before React calls onOpenFile(handler), this ensures we save them
/// until we can send them reliably.  Preload is the go between main and renderer, and if renderer
/// isn't ready, preload buffers for main.
/// Flow is OS -> main calls win.WebContents.send -> ipcRenderer.on fires -> preload intervenes ->
///    preload invokes stored renderer callbacks
/// Very important: ipcRenderer.on registered once and listens for all "app:open-file" msgs from main
///
let pendingOpenFile: string | null = null;
/// listeners are callbacks from the renderer when it calls window.electron.onOpenFile(handler).
/// use a set to avoid duplicates but allow multiple listeners for future development I'll never do.
const openFileListeners = new Set<(path: string) => void>();
/// IPC listener from electron get the event from main when it calls:
///    win.webContents.send("app:open-file", filePath);
ipcRenderer.on("app:open-file", (_event, filePath: string) => {
  if (openFileListeners.size === 0) {
    pendingOpenFile = filePath;
    return;
  }
  for (const cb of openFileListeners) {
    try { cb(filePath); } catch { /* keep other listeners alive */ }
  }
});

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,

  ping: (): Promise<string> =>
    ipcRenderer.invoke("ping"),

  pickOpenFile: (): Promise<string | null> => ipcRenderer.invoke("file:pickOpen"),

  pickSaveFile: (suggested?: string): Promise<string | null> =>
    ipcRenderer.invoke("file:pickSave", suggested),

  readText: (p: string): Promise<string> => ipcRenderer.invoke("file:readText", p),

  writeText: (p: string, data: string): Promise<boolean> =>
    ipcRenderer.invoke("file:writeText", p, data),

  timestamp: (p: string): Promise<number> => ipcRenderer.invoke("file:timestamp", p),

  /// onOpenFile is a push event from main.ts for file activation (double click .sgf).
  /// This returns an unsubscribe function.
  onOpenFile: (handler: (path: string) => void) => {
    openFileListeners.add(handler);
    // Flush any pending open-file that arrived before subscription.
    if (pendingOpenFile) {
      const p = pendingOpenFile;
      pendingOpenFile = null;
      // Invoke on next tick so caller finishes installing state before handling open.
      queueMicrotask(() => { try { handler(p); } catch {} });
    }
    return () => openFileListeners.delete(handler);
  },  

  /// onFinalSaveRequest is an event for the UI/renderer, and GameProvider calls this with a handler
  /// that does the auto save.  This function wraps that autosave handler in a function that sends
  /// "app:flush-done" (keeps UI clean of IPC protocol).  This function then installs UI's handler's
  /// wrapper (listener) as the event handler for the "app:final-autosave" event (which main.ts's
  /// win.on("close"... sends to the UI).
  ///
  onFinalSaveRequest: (handler: () => Promise<void> | void) => {
    const listener = async () => { try { await handler(); }
                                   finally { ipcRenderer.send("app:flush-done"); }
    };
    ipcRenderer.on("app:final-autosave", listener);
    // return an unsubscribe function
    return () => ipcRenderer.removeListener("app:final-autosave", listener);
},
});

