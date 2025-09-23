import { app, BrowserWindow, Menu, ipcMain, dialog } from "electron";
import * as path from "path"; // "node:path" ???
import { fileURLToPath } from "url";
/// For debugging with preloadrel, preloadbs
import * as fs from "node:fs";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/// For debugging...
// const preloadRel = process.env.ELECTRON_PRELOAD_PATH || "preload.js";
const preloadRel = process.env.ELECTRON_PRELOAD_PATH || "preload.cjs";
const preloadAbs = path.join(__dirname, preloadRel);
console.log("[main] preload path:", preloadAbs, "exists:", fs.existsSync(preloadAbs));

const devUrl = process.env.ELECTRON_START_URL || process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    x: 140, y: 40, width: 1000, height: 600,
    title: "SGF Editor",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadAbs, // path.join(__dirname, process.env.ELECTRON_PRELOAD_PATH || "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    }
  });
  win.setMenuBarVisibility(false); // keeps users from using alt key to show menus.
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // remove default app menus (Win/Linux; also fine on macOS)
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// IPC
ipcMain.handle("ping", () => "pong");

ipcMain.handle("dialog:open", async () => {
  const res = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "SGF", extensions: ["sgf"] }]  });
  // res is OpenDialogReturnValue { canceled: boolean, filePaths: string[] }
  return res.canceled ? null : res.filePaths[0] ?? null;
});
