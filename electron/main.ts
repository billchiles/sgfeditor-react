/// This is the electron shell main start up code.
/// npm starts the Vite dev server starts at http://localhost:5173 (where the web build runs).
/// This file creates a BrowserWindow and does:
///    loadURL("http://localhost:5173") (so the renderer is the Vite site)
///    attaches the compiled electron/dist/preload.js)
/// Preload runs before the web page's js and exposes window.electron (file picking, reading, etc.).
/// Vite then runs the browser app by serving up index.html that calls into main.tsx which createroot.
/// 
/// In a packaged build, vite build produces static files in /dist.  electron/dist/main.js and
/// preload.js compile, and main creates BrowserWindow, then:
///    loadFile("<project>/dist/index.html") (no dev server)
///    Preload still exposes window.electron before React app runs
///    renderer boots the same React tree (<App />, providers, etc.) but from local files, not from
///       Vite.
///

import { app, BrowserWindow, Menu, ipcMain, dialog } from "electron";
import * as path from "path"; // "node:path" ???
import { fileURLToPath } from "url";
/// For debugging with preloadrel, preloadbs
import * as fs from "node:fs"; // for existsSync, createReadStream, etc. (sync/callback API)
import { promises as fsp } from "node:fs"; // // for async readFile/writeFile/stat (promise API)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/// For debugging...
const preloadRel = process.env.ELECTRON_PRELOAD_PATH || "preload.js";
const preloadAbs = path.join(__dirname, preloadRel);

const devUrl = process.env.ELECTRON_START_URL || process.env.VITE_DEV_SERVER_URL;

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

///
//// IPC for app to get system services from Electron.
///

ipcMain.handle("ping", () => "pong");

// ipcMain.handle("dialog:open", async () => {
//   const res = await dialog.showOpenDialog({
//     properties: ["openFile"],
//     filters: [{ name: "SGF", extensions: ["sgf"] }]  });
//   // res is OpenDialogReturnValue { canceled: boolean, filePaths: string[] }
//   return res.canceled ? null : res.filePaths[0] ?? null;
// });

/// Pick a File to Open
///
ipcMain.handle("file:pickOpen", async () => {
  const retValue = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "SGF", extensions: ["sgf"] }],
  });
  return retValue.canceled ? null : retValue.filePaths[0] ?? null;
});

/// pick a save path
///
ipcMain.handle("file:pickSave", async (_e, suggested?: string) => {
  const retValue = await dialog.showSaveDialog({
    defaultPath: suggested ?? "game.sgf",
    filters: [{ name: "SGF", extensions: ["sgf"] }],
  });
  return retValue.canceled ? null : retValue.filePath ?? null;
});

/// read a file
///
// ipcMain.handle("file:readText", async (_e, p: string) => fs.readFile(p, "utf8"));
ipcMain.handle("file:readText", async (_e, p: string) => {
  return fsp.readFile(p, { encoding: "utf8" }); });

/// write a file
///
ipcMain.handle("file:writeText", async (_e, p: string, data: string) => {
  await fsp.writeFile(p, data, { encoding: "utf8" });
  return true;
});

/// write date
///
ipcMain.handle("file:timestamp", async (_e, p: string) => (await fsp.stat(p)).mtimeMs);

///
//// Create the App's main window.
///

/// createWindow must be after the ipcMain.handle calls above.
///
function createWindow () {
  const win = new BrowserWindow({
    x: 140, y: 40, width: 1025, height: 600,
    title: "SGF Editor",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadAbs, // path.join(__dirname, process.env.ELECTRON_PRELOAD_PATH || "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    }
  });
  // Setup for UI/rendering code to auto save if app is shutting down
  let isClosing = false;
  // Hook window's onclose event and make sure or done/timeout closures execute
  win.on("close", (e) => {
    if (isClosing) return;  // already doing final save for closing
    e.preventDefault();
    isClosing = true; // stop re-entrancy in case of multiple onclose events or timers
    // Ask the renderer to do the final autosave, and it will send back "app:flush-done" when done.
    win.webContents.send("app:final-autosave");
    // send returns immediately, but we wait for the IPC msg "app:flush-done" to come back
    const done = new Promise<void>((resolve) => {const once = () => {
                                                   ipcMain.removeListener("app:flush-done", once);
                                                   resolve(); };
                                                 ipcMain.on("app:flush-done", once); });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500)); // 1.5s budget
    // Hope final save completes first, but if not just give up and close the window
    Promise.race([done, timeout]).finally(() => {
      isClosing = true; // gpt5 put this here, perhaps erroneously
      win.close(); // proceed with close after flush/timeout
    });
  });

  win.setMenuBarVisibility(false); // keeps users from using alt key to show menus.

  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    //win.loadFile(path.join(__dirname, "..", "dist", "index.html")); error file not found
    const indexHtml = path.resolve(__dirname, "..", "..", "dist", "index.html");
    console.log("[main] loading:", indexHtml, "exists:", fs.existsSync(indexHtml));
    win.loadFile(indexHtml);
  }

} // createWindow()
