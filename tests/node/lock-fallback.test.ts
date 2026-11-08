// The file lock on a filesystem without hard links (some network and FUSE
// mounts, where linkSync fails with EPERM): it falls back to an exclusive
// create and must still serialize writers.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LockBusyError, withFileLock } from '../../src/node/fs/lock';
import { compileSources } from '../helpers/compile';

const NO_LINKS = `
  import fs from 'node:fs';
  import { syncBuiltinESMExports } from 'node:module';
  fs.linkSync = () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); };
  syncBuiltinESMExports();
`;

/** An error code the exclusive create of the lock fails with, when set. */
const openFails = vi.hoisted(() => ({ code: null as string | null }));

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    linkSync: () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    },
    openSync: (...args: Parameters<typeof fs.openSync>) => {
      if (openFails.code && String(args[0]).endsWith('.lock')) {
        throw Object.assign(new Error(`${openFails.code}: refused, open '${args[0]}'`), { code: openFails.code });
      }
      return fs.openSync(...args);
    },
  };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'iso-lock-nolink-'));
});
afterEach(() => {
  openFails.code = null;
  rmSync(root, { recursive: true, force: true });
});

it('holds the lock with its owner written, refuses a second writer, and cleans up', () => {
  const file = join(root, 'notes.json');
  const seen = withFileLock(file, () => {
    const owner = JSON.parse(readFileSync(`${file}.lock`, 'utf8'));
    expect(owner.pid).toBe(process.pid);
    expect(() => withFileLock(file, () => 'second', { waitMs: 20 })).toThrow(LockBusyError);
    return 'first';
  });
  expect(seen).toBe('first');
  expect(readdirSync(root)).toEqual([]);
});

it('reports a lock it cannot create as an error at once, not as a busy store', () => {
  const file = join(root, 'notes.json');
  for (const code of ['EACCES', 'EROFS', 'ENOENT']) {
    openFails.code = code;
    const started = Date.now();
    let caught: unknown;
    try {
      withFileLock(file, () => 'ran', { waitMs: 2_000 });
    } catch (error) {
      caught = error;
    }
    expect(caught, code).not.toBeInstanceOf(LockBusyError);
    expect((caught as Error).message, code).toBe(`Cannot lock the local store ${file}: ${code}: refused, open '${file}.lock'`);
    expect(Date.now() - started, code).toBeLessThan(1_000);
  }
});

it('still takes over an abandoned lock', () => {
  const file = join(root, 'notes.json');
  writeFileSync(`${file}.lock`, '');
  const at = (Date.now() - 5_000) / 1000;
  utimesSync(`${file}.lock`, at, at);
  expect(withFileLock(file, () => 'ran')).toBe('ran');
  expect(readdirSync(root)).toEqual([]);
});

it('loses no note when many processes write at once', async () => {
  const writers = 20;
  const file = join(root, 'notes.json');
  writeFileSync(file, '[]');
  const store = compileSources(['node/notes/store'], join(root, 'runtime'))['node/notes/store'];
  const startAt = Date.now() + 600;
  const results = await Promise.all(
    Array.from(
      { length: writers },
      (_, index) =>
        new Promise<{ code: number | null; stderr: string }>((resolve) => {
          const script = `${NO_LINKS}
            const { updateNotes } = await import(${JSON.stringify(store)});
            while (Date.now() < ${startAt}) {}
            updateNotes(${JSON.stringify(file)}, (notes) => {
              const until = Date.now() + 3;
              while (Date.now() < until) {}
              notes.push({ id: 'n${index}', route: '/', feedback: 'note ${index}', done: false, createdAt: new Date().toISOString() });
              return notes;
            });`;
          const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
          let stderr = '';
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.on('exit', (code) => resolve({ code, stderr }));
        }),
    ),
  );
  expect(results.filter((result) => result.code !== 0)).toEqual([]);
  const ids = (JSON.parse(readFileSync(file, 'utf8')) as { id: string }[]).map((note) => note.id).sort();
  expect(ids).toEqual(Array.from({ length: writers }, (_, index) => `n${index}`).sort());
  expect(readdirSync(root).sort()).toEqual(['notes.json', 'runtime']);
}, 15_000);
