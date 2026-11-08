import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ACTIVE_FILE, addVariantFile, createVariant, promoteVariant, readVariant, variantDir, writeActive } from '../../src/node/variants';
import { tempGitRepo } from '../helpers/fs';

// Fail the rename onto one chosen target, after the earlier targets were
// already replaced: the only way to reach promote's rollback.
const failRenameTo = vi.hoisted(() => ({ suffix: '' }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    renameSync: (from: string, to: string) => {
      if (failRenameTo.suffix && String(to).endsWith(failRenameTo.suffix)) throw new Error('disk full');
      return fs.renameSync(from, to);
    },
  };
});

const dirs: string[] = [];
afterEach(() => {
  failRenameTo.suffix = '';
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function project() {
  const root = tempGitRepo('isotone-promote-', dirs);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'A.tsx'), 'real a\n');
  writeFileSync(join(root, 'src', 'B.tsx'), 'real b\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  const opts = { root };
  createVariant(opts, { id: 'v1' });
  addVariantFile(opts, 'v1', 'src/A.tsx');
  addVariantFile(opts, 'v1', 'src/B.tsx');
  addVariantFile(opts, 'v1', 'src/New.tsx', { create: true });
  for (const [file, text] of [
    ['src/A.tsx', 'variant a\n'],
    ['src/B.tsx', 'variant b\n'],
    ['src/New.tsx', 'variant new\n'],
  ] as const)
    writeFileSync(join(variantDir(opts, 'v1'), file), text);
  return { root, opts };
}

it('puts back every file it already replaced when a later one fails, and keeps the variant', () => {
  const { root, opts } = project();
  writeActive(opts, ['v1']);
  failRenameTo.suffix = 'B.tsx';
  expect(() => promoteVariant(opts, 'v1', { force: true })).toThrow('disk full');
  expect(readFileSync(join(root, 'src', 'A.tsx'), 'utf8')).toBe('real a\n');
  expect(readFileSync(join(root, 'src', 'B.tsx'), 'utf8')).toBe('real b\n');
  expect(existsSync(join(root, 'src', 'New.tsx'))).toBe(false);
  expect(execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: root, encoding: 'utf8' })).toBe('');
  expect(readVariant(opts, 'v1')).not.toBeNull();
  expect(JSON.parse(readFileSync(join(root, ACTIVE_FILE), 'utf8')).active).toEqual(['v1']);
});

it('takes a promoted variant out of the stored active list', () => {
  const { root, opts } = project();
  createVariant(opts, { id: 'other' });
  writeActive(opts, ['other', 'v1']);
  promoteVariant(opts, 'v1', { force: true });
  expect(readFileSync(join(root, 'src', 'New.tsx'), 'utf8')).toBe('variant new\n');
  // The file itself, not readActive, which would drop a missing id anyway.
  expect(JSON.parse(readFileSync(join(root, ACTIVE_FILE), 'utf8')).active).toEqual(['other']);
});
