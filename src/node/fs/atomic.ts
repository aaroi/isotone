/**
 * Whole-file JSON writes that readers never see half-done, and bounded JSON
 * reads for small state files. A write goes to a unique temporary file beside
 * the target and is renamed over it; a failed write leaves the old file.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Readers see either the old document or the complete replacement. */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
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
    await rename(temporary, file);
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
