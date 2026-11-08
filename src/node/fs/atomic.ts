/**
 * Whole-file JSON writes that readers never see half-done, and bounded JSON
 * reads for small state files. A write goes to a unique temporary file beside
 * the target and is renamed over it; a failed write leaves the old file.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Windows refuses to replace a file another process has open, as a reader
 * briefly does; the reader lets go within milliseconds, so the rename retries.
 */
const RENAME_RETRIES = 20;
const RENAME_WAIT_MS = 15;
const busy = (error: unknown): boolean => ['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? '');

function renameOver(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (process.platform !== 'win32' || attempt >= RENAME_RETRIES || !busy(error)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_WAIT_MS);
    }
  }
}

async function renameOverAsync(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (process.platform !== 'win32' || attempt >= RENAME_RETRIES || !busy(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_WAIT_MS));
    }
  }
}

/** Readers see either the old document or the complete replacement. */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameOver(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** The asynchronous {@link writeJson}, for compact machine state such as caches. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await renameOverAsync(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** The parsed file, or undefined when it is missing, larger than `maxBytes` or not JSON. */
export async function readJsonBounded(file: string, maxBytes: number): Promise<unknown> {
  try {
    if ((await stat(file)).size > maxBytes) return undefined;
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}
