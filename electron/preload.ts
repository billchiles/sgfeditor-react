import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  ping: () => ipcRenderer.invoke("ping"),
  openFileDialog: () => ipcRenderer.invoke("dialog:open"),
});
