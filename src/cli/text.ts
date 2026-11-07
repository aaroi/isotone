/**
 * What the CLI prints for an agent to read or run. Notes are written in a
 * browser, so their text can hold anything a page script put there: newlines
 * that forge CLI lines, terminal escape sequences, shell syntax in an id.
 * Everything printed passes through one of these helpers.
 */

/** Characters a POSIX shell never treats specially. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** One argument, quoted for a POSIX shell only when it needs it. */
export function shellQuote(arg: string): string {
  if (SHELL_SAFE.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** A command line an agent can paste into a shell: `npx isotone --done <id>`. */
export function shellCommand(...args: string[]): string {
  return args.map(shellQuote).join(' ');
}

// C0 and C1 controls (ESC, BEL, CSI …), DEL, and the bidirectional overrides
// that can make text read differently from what it is. Tab and newline are
// handled by the callers.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const NEWLINE = /\r\n|[\r\n\u2028\u2029]/g;

/** Page or reviewer text on one line: no control characters, newlines shown as ⏎. */
export function oneLine(text: unknown, max = Number.POSITIVE_INFINITY): string {
  const line = String(text ?? '')
    .replace(/\t/g, ' ')
    .replace(NEWLINE, ' ⏎ ')
    .replace(CONTROL, '');
  return line.length > max ? `${line.slice(0, Math.max(0, max - 1))}…` : line;
}

/**
 * Multi-line reviewer text, every line prefixed with `indent> ` so none of
 * it can pass for a line the CLI printed itself.
 */
export function quoted(text: string, indent: string): string[] {
  return text
    .replace(/\t/g, ' ')
    .split(NEWLINE)
    .map((line) => `${indent}> ${line.replace(CONTROL, '')}`.trimEnd());
}

// JSON.stringify escapes C0 controls but leaves C1 controls and bidi
// overrides raw, and a raw CSI (U+009B) still drives some terminals.
const JSON_UNSAFE = /[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/g;

/** Compact JSON that is safe to print to a terminal. */
export function toJson(value: unknown): string {
  return JSON.stringify(value).replace(JSON_UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** `2026-11-07 09:41 UTC`: a note's time, labelled so no one reads it as local. */
export function utcStamp(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return oneLine(iso, 24);
  return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}
