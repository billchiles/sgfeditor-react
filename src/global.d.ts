/// Declarations so that renderer code has an API for window at runtime (API preload.ts exposes).
/// Files ending in .d.ts only contain types, and the compiler produces no js for them.  No files
/// import this file. TypeScript picks it up via tsconfig.json’s "include" (e.g., "src/**/*").
///

export {}; // Make the file a module and not a script to run.

declare global { // doesn't pollute global scope due to export {}
  interface Window { // merge defs with the DOM's Window interface.
    electron?: {
      isElectron: boolean; // in the web build, this is undefined
      ping(): Promise<string>;
      // Matching contextBridge.exposeInMainWorld('electron', { … }) from preload.ts ...
      pickOpenFile (): Promise<string | null>;
      pickSaveFile (suggested?: string): Promise<string | null>;
      readText (path: string): Promise<string>;
      writeText (path: string, data: string): Promise<boolean>;
      timestamp (path: string): Promise<number>;
    };
  }
}