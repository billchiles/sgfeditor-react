/// This file provides the browser impl of bridges.ts declarations.  This code works for
/// chrome-based browser, but safari/firefox/etc. don't support this file ops.
///
/// src/models/appglobals.tsx wires up the handlers.
///
import type { FileBridge, AppStorageBridge, KeyBindingBridge as KeyBindingBridge, OpenResult } from "./bridges";

///
//// File Bridge
///

/// Sometimes gpt5 generates && "showSaveFilePicker" in window for extra carefulness.
const hasFS = typeof window !== "undefined" && "showOpenFilePicker" in window;

export const browserFileBridge: FileBridge = {
  async open(): Promise<OpenResult> {
    // Chromium File System Access API
    if (hasFS) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{ description: "SGF", accept: { "text/plain": [".sgf", ".txt"] } }],
          excludeAcceptAllOption: false,
          multiple: false,
        });
        const file = await handle.getFile();
        const data = await file.text();
        return { path: (handle as any).name ?? file.name, data, cookie: handle };
      } catch (err: any) {
          // User cancelled (AbortError) or similar -> treat as no-op
          return null;
      }
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
      Promise<{ fileName: string; cookie: unknown | null } | null> {
    // If we have a file handle, don't prompt user for name.
    // if (hasFS && cookie && typeof (cookie as any).createWritable === "function") {
    if (hasFS && cookie && (cookie as any).createWritable) {
      const handle = cookie as FileSystemFileHandle;
      const w = await handle.createWritable();
      await w.write(data);
      await w.close();
      const name = (handle as any).name ?? ""; 
      return { fileName: name, cookie: handle };
    }
    // Otherwise, prompt user if can for where to write.
    if (hasFS) {
      try {
        const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{ description: "SGF", accept: { "text/plain": [".sgf"] } }], });
        const w = await handle.createWritable();
        await w.write(data);
        await w.close();
        const name = (handle as any).name ?? suggestedName;
        return { fileName: name, cookie: handle };
      } catch (err: any) {
        // Cancelled -> null
        return null;
      }
    }
    // Fallback: no handle support -> download
    const a = document.createElement("a");
    const url = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
    a.href = url;
    a.download = suggestedName;
    a.click();
    // Revoke the blob URL on the next tick so the click has time to start navigation.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { fileName: suggestedName, cookie: null };
  },

  async saveAs(suggestedName: string, data: string): 
      Promise<{ fileName: string; cookie: unknown | null } | null> {
    if (hasFS) {
      try {
        const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{ description: "SGF", accept: { "text/plain": [".sgf"] } }], });
        const w = await handle.createWritable();
        await w.write(data);
        await w.close();
        const name = (handle as any).name ?? suggestedName;
        return { fileName: name, cookie: handle };
      } catch (err: any) {
        return null; // user canceled
      }
    }
    // Fallback: download (no persistent cookie possible)
    const a = document.createElement("a");
    const url = URL.createObjectURL(new Blob([data], { type: "text/plain" }));
    a.href = url;
    a.download = suggestedName;
    a.click();
    // Clean up the object URL immediately after the click is dispatched.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return { fileName: suggestedName, cookie: null };
  },

  // async pickOpenFile(accept: string[] = [".sgf", ".txt"]): 
  async pickOpenFile(): 
      Promise<{ cookie: unknown; fileName: string } | null> {
    if (hasFS) {
      try {
        const [handle]: FileSystemFileHandle[] = await (window as any).showOpenFilePicker({
          // gpt5 generated this line, but I commented it out so that open and pickOpen were the same.
          //    types: [{ description: "SGF", accept: { "application/octet-stream": accept, "text/plain": accept }}],
          // pickOpenFile param list was: accept: string[] = [".sgf", ".txt"]
          types: [{ description: "SGF", accept: { "text/plain": [".sgf", ".txt"] } }],
          excludeAcceptAllOption: false,
          multiple: false,});
        const file = await handle.getFile();
        //return { cookie: handle, fileName: path ?? "unknown" };
        return { cookie: handle, fileName: (handle as any).name ?? file.name };
      } catch {
        return null;
      }
    }
    return null;
    // One gpt5 version generated return null here, but that's ambiguous with the user cancelling.
    // Fallback cannot return a cookie; just prompt and return the picked name (best-effort)
    // return new Promise((resolve) => {
    //   const input = document.createElement("input");
    //   input.type = "file";
    //   input.accept = ".sgf,text/plain";
    //   input.onchange = () => {
    //     const f = input.files?.[0];
    //     if (!f) return resolve(null);
    //     resolve({ cookie: null, fileName: f.name ?? "unknown" });
    //   };
    //   input.click();
    // });
  },

  // async pickSaveFile(suggestedName = "game01.sgf", accept: string[] = [".sgf"]):
  async pickSaveFile(suggestedName = "game01.sgf"):
    Promise<{ cookie: unknown; fileName: string } | null> {
    if (hasFS) {
      try {
        const handle: FileSystemFileHandle = await (window as any).showSaveFilePicker({
          suggestedName,
          // types: [{ description: "Files", accept: { "application/octet-stream": accept, "text/plain": accept } }],
          types: [{ description: "SGF", accept: { "text/plain": [".sgf"] } }], });
        const file = await handle.getFile();
        return { cookie: handle, fileName: file.name ?? suggestedName };
      } catch {
        return null;
      }
    }
    // OLD COMMENT: Fallback has no real save picker; we only “suggest” a name and return it
    return null; //{ cookie: null, fileName: suggestedName };
  },

  async readText(cookie: unknown): Promise<string | null> {
    const h = cookie as any;
    if (h && typeof h.getFile === "function") {
      const f = await h.getFile();
      return await f.text();
    }
    return null; // unsupported or no handle
  },

  canPickFiles(): boolean {
      return hasFS;
    },

  async getWriteDate (cookie) {
    const h = cookie as any;
    try {
      if (h === null || typeof h.getFile !== "function") return null;
      const f: File = await h.getFile();
      //
      return f.lastModified;
    } catch {
      return null;
    }
  },

}; // browserFileBridge


///
//// App Storage Bridge
///

const hasOPFS = typeof navigator !== "undefined" && (navigator as any).storage &&
                typeof (navigator as any).storage.getDirectory === "function";


/// OpfsStorage is the primary class we expect to always use, even in Electron.
///
class OpfsStorage implements AppStorageBridge {
  private rootPromise: Promise<FileSystemDirectoryHandle>;
  private folder = "sgfeditor"; // keep our files in a subfolder

  constructor() {
    this.rootPromise = (navigator as any).storage.getDirectory();
  }

  private async getFolder (): Promise<FileSystemDirectoryHandle> {
    const root = await this.rootPromise;
    return await root.getDirectoryHandle(this.folder, { create: true });
  }

  async writeText (name: string, text: string): Promise<void> {
    const dir = await this.getFolder();
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  async readText (name: string): Promise<string | null> {
    try {
      const dir = await this.getFolder();
      const fh = await dir.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      return await file.text();
    } catch {
      return null;
    }
  }

  async delete (name: string): Promise<boolean> {
    try {
      const dir = await this.getFolder();
      await dir.removeEntry(name);
      return true;
    } catch {
      return false;
    }
  }

  async exists (name: string): Promise<boolean> {
    try {
      const dir = await this.getFolder();
      await dir.getFileHandle(name, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  async timestamp (name: string): Promise<number | null> {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(this.folder, { create: true })
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      return typeof file.lastModified === "number" ? file.lastModified : null;
    } catch {
      return null;
    }
  }

  // async list(): Promise<string[]> {
  //   const dir = await this.getFolder();
  //   const out: string[] = [];
  //   // @ts-ignore: async iterator is supported in modern TS lib
  //   for await (const [key, entry] of (dir as any).entries()) {
  //     if (entry && entry.kind === "file") out.push(key);
  //   }
  //   return out;
  // }

  // async writeJSON<T>(name: string, value: T): Promise<void> {
  //   await this.writeText(name, JSON.stringify(value));
  // }

  // async readJSON<T>(name: string): Promise<T | null> {
  //   const s = await this.readText(name);
  //   if (s == null) return null;
  //   try {
  //     return JSON.parse(s) as T;
  //   } catch {
  //     return null;
  //   }
  // }
} // OpfsStorage class

/// LocalStorageStorage is purely generalized defensive coding, should never need this.
///
class LocalStorageStorage implements AppStorageBridge {
  private prefix = "sgfeditor/";
  private key(name: string) { return this.prefix + name; }

  async writeText(name: string, text: string): Promise<void> {
    localStorage.setItem(this.key(name), text);
    // Keep a tiny meta record for fallback stores (no native timestamp).
    localStorage.setItem(`${this.prefix}${name}:meta`, Date.now.toString());
  }

  async readText(name: string): Promise<string | null> {
    return localStorage.getItem(this.key(name));
  }

  async delete (name: string): Promise<boolean> {
    const k = this.key(name);
    const had = localStorage.getItem(k) !== null;
    localStorage.removeItem(k);
    localStorage.removeItem(`${this.prefix}${name}:meta`);
    return had;
  }

  async exists (name: string): Promise<boolean> {
    return localStorage.getItem(this.key(name)) !== null;
  }

  async timestamp (name: string): Promise<number | null> {
    const v = localStorage.getItem(`${this.prefix}${name}`);
    if (v === null) return null;
    const metaRaw = localStorage.getItem(`${this.prefix}${name}:meta`);
    if (metaRaw) {
      try {
        return parseInt(metaRaw, 10);
      } catch {
        return null;
      }
    }
    return null;
  }

  // async list(): Promise<string[]> {
  //   const out: string[] = [];
  //   for (let i = 0; i < localStorage.length; i++) {
  //     const k = localStorage.key(i)!;
  //     if (k.startsWith(this.prefix)) out.push(k.substring(this.prefix.length));
  //   }
  //   return out;
  // }
  
  // async writeJSON<T>(name: string, value: T): Promise<void> {
  //   await this.writeText(name, JSON.stringify(value));
  // }
  
  // async readJSON<T>(name: string): Promise<T | null> {
  //   const s = await this.readText(name);
  //   if (s == null) return null;
  //   try { return JSON.parse(s) as T; } catch { return null; }
  // }
} // LocalStorageStorage class

export const browserAppStorageBridge = hasOPFS ? new OpfsStorage() : new LocalStorageStorage();

///
//// Keybindings Bridge
///

export const browserKeybindings: KeyBindingBridge = {
  on(handler) { window.addEventListener("keydown", handler, { capture: true }); },
  off(handler) { window.removeEventListener("keydown", handler, { capture: true }); },
  commonKeyBindingsHijacked: true,
};
