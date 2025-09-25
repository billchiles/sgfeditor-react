/// Preload runs in the UI/renderer/app process.  It exposes an API that extends window for
/// UI/rendering code.
///
import { contextBridge, ipcRenderer } from "electron";

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

