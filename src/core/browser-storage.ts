/** Browser-only migration from the former package's default namespaces. */
export const FEEDBACK_STORAGE_KEY = 'isotone-feedback';
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function legacyKey(key: string): string | undefined {
  if (key === FEEDBACK_STORAGE_KEY || key.startsWith(`${FEEDBACK_STORAGE_KEY}::draft::`))
    return `iso-iterate-feedback${key.slice(FEEDBACK_STORAGE_KEY.length)}`;
  if (key === 'isotone:knobs') return 'iso-iterate:knobs';
  return undefined;
}

/** A failed migration remains readable under its old key for the next visit. */
export function readBrowserStorage(
  storage: BrowserStorage,
  key: string,
  merge: (current: string | null, previous: string) => string = (current, previous) => current ?? previous,
): string | null {
  let current: string | null = null;
  try { current = storage.getItem(key); }
  catch { return null; }
  const previousKey = legacyKey(key);
  if (!previousKey) return current;
  let previous: string | null;
  try { previous = storage.getItem(previousKey); }
  catch { return current; }
  if (previous === null) return current;
  const next = merge(current, previous);
  try { writeBrowserStorage(storage, key, next); }
  catch { /* Quota or access restrictions must not hide the previous value. */ }
  return next;
}

export function writeBrowserStorage(storage: BrowserStorage, key: string, value: string): void {
  storage.setItem(key, value);
  const previousKey = legacyKey(key);
  if (!previousKey) return;
  try {
    if (storage.getItem(key) === value) storage.removeItem(previousKey);
  } catch { /* Keep the old value unless its replacement was verified. */ }
}

/** Explicitly clearing a value also clears its legacy fallback. */
export function removeBrowserStorage(storage: BrowserStorage, key: string): void {
  storage.removeItem(key);
  const previousKey = legacyKey(key);
  if (previousKey) storage.removeItem(previousKey);
}
