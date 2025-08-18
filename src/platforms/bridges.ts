/// This file is an abstraction over system calls, that two other files will either plug in
/// a browser implementation or an electron shell implementation.
///
export type OpenResult = { path?: string; data: string } | null;

export interface FileBridge {
  open(): Promise<OpenResult>;
  save(pathHint: string | undefined, data: string): Promise<string>; // returns written path or name
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
