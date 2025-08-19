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
      // Return the handle as the cookie, IS NAME PATH OR BASE ???????????????????
      return { path: (handle as any).name ?? file.name, data, cookie: handle };
    }
    // Fallback: <input type="file">
    return await new Promise<OpenResult>((resolve) => {
      // resolve is provided by js to complete the promise.  Resolve takes a result value.
      // Js also provides a reject function that takes an error argument.
      // We don't use reject because we just return null for any errors.
      // FileReader.onload calls resolve(reader.result) to pass the file contents to a promise.then()
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

  async save(cookie: unknown | null, suggestedName: string, data: string): 
      Promise<{ fileName: string; cookie: unknown | null }> {
    // If we have a file handle, don't prompt user for name.
    if (cookie && typeof (cookie as any).createWritable === "function") {
      const handle = cookie as FileSystemFileHandle;
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
      const name = (handle as any).name ?? ""; //suggestedName;
      return { fileName: name, cookie: handle };
    }
    // Otherwise, prompt user if can for where to write.
    if ("showSaveFilePicker" in window) {
      const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{ description: "SGF", accept: { "text/plain": [".sgf"] } }],
      });
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
      const name = (handle as any).name ?? suggestedName;
      return { fileName: name, cookie: handle };
    }
    // Fallback: no handle support -> download
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
    a.download = suggestedName;
    a.click();
    return { fileName: suggestedName, cookie: null };
  },

  async saveAs(suggestedName: string, data: string): 
      Promise<{ fileName: string; cookie: unknown | null }> {
    if ("showSaveFilePicker" in window) {
      const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{ description: "SGF", accept: { "text/plain": [".sgf"] } }],
      });
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
      const name = (handle as any).name ?? suggestedName;
      return { fileName: name, cookie: handle };
    }
    // Fallback: download (no persistent cookie possible)
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
    a.download = suggestedName;
    a.click();
    return { fileName: suggestedName, cookie: null };
  },
};

export const browserHotkeys: HotkeyBridge = {
  on(handler) { window.addEventListener("keydown", handler); },
  off(handler) { window.removeEventListener("keydown", handler); },
};
