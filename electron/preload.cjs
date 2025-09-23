// electron/preload.cjs  (CommonJS preload)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  isElectron: true,
  ping: () => ipcRenderer.invoke("ping"),

  // (we can add the file APIs back after the base case works)
});
