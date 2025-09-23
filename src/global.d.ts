export {};

declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      ping(): Promise<string>;
      openFileDialog(): Promise<string | null>;
    };
  }
}
