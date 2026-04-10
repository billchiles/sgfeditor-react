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

///
//// App Lifecycle Callbacks/Hooks
///

/// If we receive a file-open request before the renderer is ready, stash it here.
let pendingOpenPath: string | null = null;

/// Single-instance behavior:
/// - Windows/Linux: activation file arrives on argv, and a second activation starts a second
///   process unless we take the lock.
/// - macOS: open-file is delivered to the existing instance, but the lock is harmless.
const gotLock = app.requestSingleInstanceLock();
if (! gotLock) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", (_event, argv) => {
  const p = extractSgfPathFromArgv(argv);
  if (p) requestOpenFile(p);
  else focusMainWindow();
});

/// macOS file activation (Finder double-click)
app.on("open-file", (event, p) => {
  event.preventDefault();
  if (p) requestOpenFile(p);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // remove default app menus (Win/Linux; also fine on macOS)
  createWindow();
  // Windows/Linux initial activation (argv on first launch)
  const initial = extractSgfPathFromArgv(process.argv);
  if (initial) pendingOpenPath = initial;
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/// requestOpenFile is used by second app instance detection to stash the file path, ensure main
/// window is active, and try to send the file to the renderer.  Mac-OS uses this by default.
///
function requestOpenFile (filePath: string) {
  pendingOpenPath = filePath;
  focusMainWindow();
  sendOpenFileToRenderer(filePath);
}

/// Main window singleton for file-activation (single instance) and focus behavior.
let mainWindow: BrowserWindow | null = null;

function focusMainWindow () {
  if (! mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/// sendOpenFileToRenderer handles stashing path until we can reliably send it to renderer, or
/// sending it if renderer is ready.
///
function sendOpenFileToRenderer (filePath: string) {
  if (! mainWindow) {
    pendingOpenPath = filePath;
    return;
  }
  // If the renderer hasn't finished loading, stash and send after did-finish-load.
  if (mainWindow.webContents.isLoadingMainFrame()) {
    pendingOpenPath = filePath;
    return;
  }
  mainWindow.webContents.send("app:open-file", filePath);
}

/// Extract an SGF file path from argv (Windows/Linux) or from any caller-provided list.
/// Notes:
/// - In Windows dev, argv includes electron.exe + app path + args.
/// - We only accept existing files to avoid treating flags as paths.
function extractSgfPathFromArgv (argv: string[]): string | null {
  for (let arg of argv) {
    if (! arg) continue;
    arg = arg.trim(); // Trim whitespace
    // Strip surrounding quotes (Windows sometimes passes quoted paths)
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
      arg = arg.slice(1, -1).trim();
    }
    // Strip common trailing punctuation that can sneak into argv (copy/paste, wrappers).
    while (arg.endsWith(".") || arg.endsWith(",") || arg.endsWith(";")) {
      arg = arg.slice(0, -1);
    }
    if (! arg.toLowerCase().endsWith(".sgf")) continue;
    try {
      if (fs.existsSync(arg) && fs.statSync(arg).isFile()) return arg;
    } catch {
      // ignore
    }
  } // for args
  return null;
}

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

const devUrl = process.env.ELECTRON_START_URL || process.env.VITE_DEV_SERVER_URL;

/// createWindow must be after the ipcMain.handle calls above.
///
function createWindow () {
  // Make the browser instance hosted in Electron
  const win = new BrowserWindow({
    x: 140, y: 40, width: 1025, height: 600,
    title: "SGF Editor",
    icon: path.join(process.cwd(), "src", "assets", "filelogo50.ico"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadAbs, // path.join(__dirname, process.env.ELECTRON_PRELOAD_PATH || "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    }
  });
  mainWindow = win; // Set global The Window for single instancing
  // Flush any pending file open once the renderer is ready.
  win.webContents.on("did-finish-load", () => {
    if (pendingOpenPath) {
      const p = pendingOpenPath;
      pendingOpenPath = null;
      win.webContents.send("app:open-file", p);
    }
  });
  // Cleanup on system window close check game dirty state, prompts to save, cleans up autodave.
  // Asks renderer for game state.
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  let isClosing = false;
  // Hook window close so we can prompt for the current game's dirty state.
  win.on("close", async (e) => {
    // Prevent re-entry (Electron may fire close multiple times)
    if (isClosing) return;
    isClosing = true;
    e.preventDefault(); // Always intercept close so we can decide what to do
    try {
      const closeState = await requestRendererValue<{ isDirty: boolean, filename: string | null }>(
        win, "app:query-close-state", "app:query-close-state-result");
      console.log("closeState:", closeState);
      if (closeState?.isDirty) {
        const label = closeState.filename ?? "current game";
        console.log("closeState in main:", closeState);
        console.log("ABOUT TO SHOW CLOSE PROMPT");
        const result = await dialog.showMessageBox(win, { // main proc, normal desktop app diaolog
          type: "question",
          buttons: ["Save", "Don’t Save", "Cancel"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
          title: "Unsaved Game",
          message: `Save changes to ${label}?`,
        });
        console.log("CLOSE PROMPT RESULT:", result.response);
        if (result.response === 0) { // request renderer to save
          const saved = await requestRendererValue<boolean>(
            // longer timeout for file dialog / disk write
            win, "app:save-before-close", "app:save-before-close-result", 10000);
          if (!saved) {
            isClosing = false;
            return; // if failed or cancelled, abort
          }
        } else if (result.response === 1) { // explicitly said don't save, discard autosave
          await requestRendererValue<boolean>(
            win, "app:discard-autosave-before-close", "app:discard-autosave-before-close-result");
        } else { // user cancelled after clicking to save, still discard autosave
          await requestRendererValue<boolean>(
            win, "app:discard-autosave-before-close", "app:discard-autosave-before-close-result");
          isClosing = false;
          return;
        }
      } else { // game not dirty, autosave should have been cleaned up, but make sure
        await requestRendererValue<boolean>(
          win, "app:discard-autosave-before-close", "app:discard-autosave-before-close-result");
      }
      win.close();
    } catch (err) {
      console.error("Error during close handling:", err);
      isClosing = false;
    }
});

  win.setMenuBarVisibility(false); // keeps users from using alt key to show menus.

  if (devUrl) {
    win.loadURL(devUrl);
    // The next line can be commented out, but debug window is sort of nice while developing.
    // c-s-i may launch it on demand if comment out line.
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    //win.loadFile(path.join(__dirname, "..", "dist", "index.html")); error file not found
    const indexHtml = path.resolve(__dirname, "..", "..", "dist", "index.html");
    // console.log("[main] loading:", indexHtml, "exists:", fs.existsSync(indexHtml));
    win.loadFile(indexHtml);
  }


} // createWindow()


/// requestRendererValue<T> is a small RPC helper over Electron IPC.  It lets the main process get
/// data from the renderer.  The main process owns the window close event, and the renderer owns
/// the Game/isDirty.  For calling from renderer to main, we use ipcRenderer.
///
async function requestRendererValue<T> (win: BrowserWindow, requestChannel: string,
                                        responseChannel: string, timeoutMs = 2000,): Promise<T | null> {
  return await new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => { // timeout in case renderer never responds
      if (settled) return;
      settled = true;
      ipcMain.removeListener(responseChannel, onReply);
      resolve(null);
    }, timeoutMs);
    const onReply = (_event: Electron.IpcMainEvent, payload: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener(responseChannel, onReply);
      resolve(payload);
    };
    ipcMain.on(responseChannel, onReply);
    win.webContents.send(requestChannel); // send request (for isDirty for example)
  });
}

