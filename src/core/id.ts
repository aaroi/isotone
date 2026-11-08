/**
 * What a note id may be: it is printed into commands an agent runs
 * (`npx isotone --done <id>`), so nothing a shell would interpret, and no
 * leading dash a command line would read as an option.
 */
export const NOTE_ID = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;

let fallbackCounter = 0;

/** IDs must also work on HTTP development hosts, where randomUUID is absent. */
export function createNoteId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();

  if (typeof crypto?.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Old browsers without Web Crypto still need unique, stable retry IDs.
  fallbackCounter += 1;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
