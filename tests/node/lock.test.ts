import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LockBusyError, withFileLock } from '../../src/node/fs/lock';
import { notesResponse } from '../../src/node/notes/handler';
import { variantsDir, variantsResponse } from '../../src/node/variants';
import { serveIsotone } from '../../src/serve';
import { compileSources } from '../helpers/compile';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iso-lock-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A PID that belonged to a process which has exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(child.stdout);
}

function writeLock(file: string, contents: string, ageMs: number): string {
  const lock = `${file}.lock`;
  writeFileSync(lock, contents);
  const at = (Date.now() - ageMs) / 1000;
  utimesSync(lock, at, at);
  return lock;
}

function owner(pid: number, host = hostname()): string {
  return JSON.stringify({ pid, host, token: 'someone-else' });
}

it('loses no note when many CLI processes write at once, even over an abandoned lock', async () => {
  const writers = 20;
  const file = join(root, 'notes.json');
  writeFileSync(file, '[]');
  // A crashed writer's lock, in the old format (a bare PID), which every
  // writer finds at the same moment.
  writeLock(file, String(deadPid()), 5_000);
  const store = compileSources(['node/notes/store'], join(root, 'runtime'))['node/notes/store'];
  const startAt = Date.now() + 600;
  const codes = await Promise.all(
    Array.from(
      { length: writers },
      (_, index) =>
        new Promise<{ code: number | null; stderr: string }>((resolve) => {
          const child = spawn(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              `
        import { updateNotes } from ${JSON.stringify(store)};
        while (Date.now() < ${startAt}) {}
        updateNotes(${JSON.stringify(file)}, (notes) => {
          // A real read-modify-write of a larger file takes a moment.
          const until = Date.now() + 3;
          while (Date.now() < until) {}
          notes.push({ id: 'n${index}', route: '/', feedback: 'note ${index}', element: null, done: false, doneAt: null, createdAt: new Date().toISOString() });
          return notes;
        });
      `,
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] },
          );
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('exit', (code) => resolve({ code, stderr }));
        }),
    ),
  );
  expect(codes.filter((result) => result.code !== 0)).toEqual([]);
  const ids = (JSON.parse(readFileSync(file, 'utf8')) as { id: string }[]).map((note) => note.id).sort();
  expect(ids).toEqual(Array.from({ length: writers }, (_, index) => `n${index}`).sort());
  expect(readdirSync(root).sort()).toEqual(['notes.json', 'runtime']);
}, 15_000);

it('takes over a lock left empty or unreadable by a writer that died mid-write', () => {
  const file = join(root, 'notes.json');
  const lock = writeLock(file, '', 5_000);
  expect(withFileLock(file, () => 'ran')).toBe('ran');
  expect(existsSync(lock)).toBe(false);
});

it('takes over the lock of a process that has exited', () => {
  const file = join(root, 'notes.json');
  writeLock(file, owner(deadPid()), 2_000);
  expect(withFileLock(file, () => 'ran')).toBe('ran');
});

it('waits on a fresh lock however it looks, since its owner may have just released it', () => {
  const file = join(root, 'notes.json');
  writeLock(file, owner(deadPid()), 0);
  expect(() => withFileLock(file, () => 'ran', { waitMs: 50 })).toThrow(LockBusyError);
});

it('waits on a live owner, then takes over a lock held for longer than any write takes', () => {
  const file = join(root, 'notes.json');
  const lock = writeLock(file, owner(process.pid), 5_000);
  expect(() => withFileLock(file, () => 'ran', { waitMs: 50 })).toThrow(LockBusyError);
  expect(readFileSync(lock, 'utf8')).toBe(owner(process.pid));
  writeLock(file, owner(process.pid), 60_000);
  expect(withFileLock(file, () => 'ran')).toBe('ran');
});

it("does not judge another machine's lock by its PID", () => {
  const file = join(root, 'notes.json');
  writeLock(file, owner(deadPid(), 'another-container'), 5_000);
  expect(() => withFileLock(file, () => 'ran', { waitMs: 50 })).toThrow(LockBusyError);
});

it('leaves a lock alone that has passed to a new owner', () => {
  const file = join(root, 'notes.json');
  const lock = `${file}.lock`;
  withFileLock(file, () => {
    // Taken over while this owner was stuck: the new owner's lock stays.
    writeFileSync(lock, owner(process.pid));
  });
  expect(readFileSync(lock, 'utf8')).toBe(owner(process.pid));
});

it('answers 503 quickly from a server while another writer holds the store', async () => {
  const file = join(root, 'notes.json');
  writeLock(file, owner(process.pid), 0);
  const started = Date.now();
  const served = await serveIsotone({ file, port: 0, checkForUpdates: false });
  const response = await fetch(`${served.url}/api/isotone/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ route: '/', feedback: 'Hi' }),
  }).finally(() => served.close());
  expect(response.status).toBe(503);
  expect(Date.now() - started).toBeLessThan(1_000);
});

it('answers 503 from the handlers themselves, for servers that call them directly', () => {
  const file = join(root, 'notes.json');
  writeLock(file, owner(process.pid), 0);
  expect(notesResponse(file, { method: 'POST', url: '/', body: { route: '/', feedback: 'Hi' } }).status).toBe(503);
  // The panel's variant switch waits on the same lock as `variant use` and `promote`.
  const opts = { root };
  mkdirSync(variantsDir(opts), { recursive: true });
  writeLock(join(variantsDir(opts), '.mutation'), owner(process.pid), 0);
  expect(variantsResponse(opts, { method: 'POST', url: '/active', body: { active: [] } }).status).toBe(503);
});

it('does not use a lock it created while another process was taking over a stale one', () => {
  // The takeover renames the judged lock aside; a lock that appeared in its
  // place meanwhile would be renamed too, so its writer must not proceed.
  const file = join(root, 'notes.json');
  const steal = `${file}.lock.steal`;
  writeFileSync(steal, '1');
  let ran = false;
  expect(() =>
    withFileLock(
      file,
      () => {
        ran = true;
      },
      { waitMs: 50 },
    ),
  ).toThrow(LockBusyError);
  expect(ran).toBe(false);
  expect(existsSync(`${file}.lock`)).toBe(false);
  // A takeover that died is not waited on forever.
  const at = (Date.now() - 10_000) / 1000;
  utimesSync(steal, at, at);
  expect(withFileLock(file, () => 'ran', { waitMs: 50 })).toBe('ran');
  expect(existsSync(steal)).toBe(false);
});

it('sweeps temporary files a killed writer left beside the store, once they are old', () => {
  const file = join(root, 'notes.json');
  const old = [`${file}.0f8c.tmp`, `${file}.lock.9a1b.tmp`, `${file}.lock.77aa.stale`];
  for (const path of old) {
    writeFileSync(path, '');
    const at = (Date.now() - 120_000) / 1000;
    utimesSync(path, at, at);
  }
  const fresh = `${file}.c0de.tmp`;
  writeFileSync(fresh, '');
  const unrelated = join(root, 'other.json.1234.tmp');
  writeFileSync(unrelated, '');
  utimesSync(unrelated, (Date.now() - 120_000) / 1000, (Date.now() - 120_000) / 1000);
  withFileLock(file, () => {});
  expect(old.filter((path) => existsSync(path))).toEqual([]);
  expect(existsSync(fresh)).toBe(true);
  expect(existsSync(unrelated)).toBe(true);
});

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'reports a store in a directory it cannot write as an error, not as busy',
  () => {
    const dir = join(root, 'locked');
    mkdirSync(dir, { mode: 0o500 });
    try {
      const file = join(dir, 'notes.json');
      expect(() => withFileLock(file, () => 'ran', { waitMs: 2_000 })).toThrow(`Cannot lock the local store ${file}: EACCES`);
    } finally {
      chmodSync(dir, 0o700);
    }
  },
);
