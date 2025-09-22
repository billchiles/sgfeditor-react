/// This file is an abstraction over system calls, that two other files will implement
/// for a browser shell or electron shell.
///
export type OpenResult = {
  path?: string;   // display name (fallback download case) or full pathname
  data: string;    // file contents
  cookie?: unknown; // whatever platform needs, such as file handle or storage file
} | null;

export interface FileBridge {
  open(): Promise<OpenResult>;
  // Save to an existing target if cookie is recognized by the platform.
  // Without cookie, platform may always prompt user to save, possibly returning a pathname or name.
  save(cookie: unknown | null, suggestedName: string, data: string): 
      Promise<{ fileName: string; cookie: unknown | null } | null>;
  // Always prompt the user and return any cookie, pathname, or name.
  saveAs(suggestedName: string, data: string): 
      Promise<{ fileName: string; cookie: unknown | null } | null>;
  // Shows a file-open picker and returns the file handle and a best-effort filename (no path in
  // in browsers). Returns null if the user cancels.
  // pickOpenFile(accept?: string[]): Promise<{ cookie: unknown; fileName: string } | null>;
  pickOpenFile(): Promise<{ cookie: unknown; fileName: string } | null>;
  // Shows a save-as picker and returns the file handle and name, null if user cancels.
  pickSaveFile(suggestedName?: string): Promise<{ cookie: unknown; fileName: string } | null>;
  // Read text from a previously returned cookie/handle. Returns null if unsupported.
  // Browser (File System Access API): cookie is a FileSystemFileHandle.
  // Fallback will return null.  Electron can implement.
  readText(cookie: unknown): Promise<string | null>;
  // Returns true if this platform supports handle-based open/save file pickers
  canPickFiles(): boolean;
  // Return basic file info (null if unsupported or on error). */
  getWriteDate(cookie: unknown): Promise<number | null>;
}

/// App-private storage (OPFS when available; falls back to localStorage).
/// Should always have OPFS in chrome, post-2021 Safari, and Electron.
///
export interface AppStorageBridge {
  writeText(name: string, text: string): Promise<void>;
  readText(name: string): Promise<string | null>;
  delete(name: string): Promise<boolean>;
  exists(name: string): Promise<boolean>;
  timestamp(name: string): Promise<number | null>;
  // list(): Promise<string[]>; // best-effort; may be empty in fallback
  // // helpers
  // writeJSON<T>(name: string, value: T): Promise<void>;
  // readJSON<T>(name: string): Promise<T | null>;
}

/// HotkeyBridge is needed because when we support electron shell, key input could come from the
/// main process, a renderer process, or "os-level hooks", so this allows the react UI code to
/// stay the same between browser and electron.
///
export interface KeyBindingBridge {
  on(handler: (e: KeyboardEvent) => void): void;
  // off is called in a returned function from a useEffect call in appGlobals.tsx so that when
  // the effect reloads, React can clean up and remove the previous handler so that there isn't
  // a chain of increasing number of handlers.
  off(handler: (e: KeyboardEvent) => void): void;
  commonKeyBindingsHijacked: boolean; // true when shell (browser) refuses to give c-w, c-s-s, etc.
}
