/**
 * Setup for the tests that run in jsdom: `localStorage` and `sessionStorage`
 * are the document's own.
 *
 * Newer Node has Web Storage globals of its own, unusable without
 * `--localstorage-file` (undefined on Node 24 and later, a throwing getter on
 * Node 22 with `--experimental-webstorage`). Vitest's jsdom environment copies
 * a window property onto the global only when the global lacks it or the
 * property is on its own list, and the storages are not, so a bare
 * `localStorage` in a test reached Node's. This puts jsdom's in their place,
 * once, before any test file runs; `vi.stubGlobal` still replaces them per test.
 */
const dom = (globalThis as { jsdom?: { window: Pick<Window, 'localStorage' | 'sessionStorage'> } }).jsdom;
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, enumerable: true, get: () => dom.window[key] });
  }
}
