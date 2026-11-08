export const FEEDBACK_STORAGE_KEY = 'isotone-feedback';

/** Reads a stored value; blocked or unavailable storage reads as empty. */
export function readBrowserStorage(storage: Pick<Storage, 'getItem'>, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
