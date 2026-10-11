import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** Serialize read-modify-write across the CLI and the dev server. A dead
 * process's lock is recoverable; a busy store fails without discarding data. */
export function withFileLock<T>(file: string, work: () => T): T {
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      try { writeFileSync(fd, String(process.pid)); } finally { closeSync(fd); }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const owner = Number(readFileSync(lock, 'utf8'));
        if (Number.isSafeInteger(owner) && owner > 0) {
          try { process.kill(owner, 0); } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code === 'ESRCH') { rmSync(lock, { force: true }); continue; }
          }
        }
      } catch { /* The other writer may have just released its lock. */ }
      if (Date.now() >= deadline) throw new Error(`Local store is busy: ${file}. Retry after the other writer finishes.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return work(); } finally { rmSync(lock, { force: true }); }
}
