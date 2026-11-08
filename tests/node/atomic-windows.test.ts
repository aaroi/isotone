import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

// Windows refuses to replace a file another process is reading (EPERM); the write retries.
let failures = 0;
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      if (failures > 0) {
        failures--;
        throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });
      }
      fs.renameSync(from, to);
    },
  };
});

const platform = Object.getOwnPropertyDescriptor(process, 'platform');
afterEach(() => {
  if (platform) Object.defineProperty(process, 'platform', platform);
  failures = 0;
});

it('retries a rename Windows refuses while a reader holds the file', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const { writeJson } = await import('../../src/node/fs/atomic');
  const file = join(mkdtempSync(join(tmpdir(), 'iso-win-')), 'notes.json');
  failures = 3;
  writeJson(file, { ok: true });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ ok: true });
  expect(failures).toBe(0);
});

it('gives up when the file stays locked, and leaves no temporary file', async () => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  const { writeJson } = await import('../../src/node/fs/atomic');
  const dir = mkdtempSync(join(tmpdir(), 'iso-win-'));
  failures = 1000;
  expect(() => writeJson(join(dir, 'notes.json'), {})).toThrow('EPERM');
  const { readdirSync } = await import('node:fs');
  expect(readdirSync(dir)).toEqual([]);
});

it('does not retry elsewhere, where EPERM is a real refusal', async () => {
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  const { writeJson } = await import('../../src/node/fs/atomic');
  failures = 1;
  expect(() => writeJson(join(mkdtempSync(join(tmpdir(), 'iso-win-')), 'notes.json'), {})).toThrow('EPERM');
});
