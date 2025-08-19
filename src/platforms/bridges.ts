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
}

/// HotkeyBridge is needed because when we support electron shell, key input could come from the
/// main process, a renderer process, or "os-level hooks", so this allows the react UI code to
/// stay the same between browser and electron.
///
export interface HotkeyBridge {
  on(handler: (e: KeyboardEvent) => void): void;
  // off is called in a returned function from a useEffect call in appGlobals.tsx so that when
  // the effect reloads, React can clean up and remove the previous handler so that there isn't
  // a chain of increasing number of handlers.
  off(handler: (e: KeyboardEvent) => void): void;
}
