/// This file provides the browser impl of bridges.ts declarations.
/// src/models/appglobals.tsx wires up the handlers.
///
import type { FileBridge, HotkeyBridge, OpenResult } from "./bridges";

export const browserFileBridge: FileBridge = {
  async open(): Promise<OpenResult> {
    // Chromium File System Access API
    if ("showOpenFilePicker" in window) {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{ description: "SGF", accept: { "text/plain": [".sgf"] } }],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      const file = await handle.getFile();
      const data = await file.text();
      return { path: file.name, data };
    }

    // Fallback: <input type="file">
    return await new Promise<OpenResult>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".sgf,text/plain";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const data = await file.text();
        resolve({ path: file.name, data });
      };
      input.click();
    });
  },

  async save(pathHint: string | undefined, data: string): Promise<string> {
    if ("showSaveFilePicker" in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: pathHint ?? "game.sgf",
        types: [{ description: "SGF", accept: { "text/plain": [".sgf"] } }],
      });
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
      return (handle as any).name ?? pathHint ?? "game.sgf";
    }

    // Fallback: download
    const name = pathHint ?? "game.sgf";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
    a.download = name;
    a.click();
    return name;
  },
};

export const browserHotkeys: HotkeyBridge = {
  on(handler) { window.addEventListener("keydown", handler); },
  off(handler) { window.removeEventListener("keydown", handler); },
};
