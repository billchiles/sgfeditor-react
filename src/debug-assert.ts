declare const __DEV__: boolean; // Doesn't work in vite

export function debugAssert(condition: boolean, message: string): asserts condition {
  if (import.meta.env.DEV && !condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
