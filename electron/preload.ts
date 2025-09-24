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
});
