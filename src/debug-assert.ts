declare const __DEV__: boolean; // Doesn't work in vite, see below

export function debugAssert(condition: boolean, message: string): asserts condition {
  if (import.meta.env.DEV && !condition) { // vite erases this code in production builds
    throw new Error(`Assertion failed: ${message}`);
  }
}
