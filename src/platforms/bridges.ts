/// This file is an abstraction over system calls, that two other files will either plug in
/// a browser implementation or an electron shell implementation.
///
export type OpenResult = { path?: string; data: string } | null;

export interface FileBridge {
  open(): Promise<OpenResult>;
  save(pathHint: string | undefined, data: string): Promise<string>; // returns written path or name
}

export interface HotkeyBridge {
  on(handler: (e: KeyboardEvent) => void): void;
  off(handler: (e: KeyboardEvent) => void): void;
}
