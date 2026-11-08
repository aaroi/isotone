import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/check-release.mjs', import.meta.url));
const roots: string[] = [];

function check(version: string, unreleased: string, published: string) {
  const root = mkdtempSync(join(tmpdir(), 'isotone-check-release-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'isotone', version }));
  writeFileSync(join(root, 'CHANGELOG.md'), `# Changelog\n\n## Unreleased\n${unreleased}\n## 1.2.4\n\n### Changed\n\n- Old.\n`);
  const result = spawnSync(process.execPath, [script, published], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('passes fixes and security notes on the published minor', () => {
  expect(check('1.2.4', '\n### Fixed\n\n- A fix.\n\n### Security\n\n- A guard.\n', '1.2.4').status).toBe(0);
  expect(check('1.2.4', '\n- fix: an old-style fix.\n', '1.2.4').status).toBe(0);
  expect(check('1.2.4', '', '1.2.4').status).toBe(0);
});

it.each([
  ['### What you need to know', '\n### What you need to know\n\n- Rename a flag.\n'],
  ['### Changed', '\n### Fixed\n\n- A fix.\n\n### Changed\n\n- New default.\n'],
  ['### Removed', '\n### Removed\n\n- An option.\n'],
  ['- feat', '\n- feat: a new panel.\n'],
  ['- change', '\n- change: a new default.\n'],
])('fails on %s unless the minor is raised', (reason, notes) => {
  const blocked = check('1.2.5', notes, '1.2.4');
  expect(blocked.status).toBe(1);
  expect(blocked.output).toContain(reason);
  expect(blocked.output).toContain('Raise the version in package.json');
  expect(check('1.3.0', notes, '1.2.4').status).toBe(0);
  expect(check('2.0.0', notes, '1.9.9').status).toBe(0);
});

it('needs a minor above the published one, not only above its patch', () => {
  // After 1.3.0 is published, the next feature needs 1.4.0.
  expect(check('1.3.0', '\n### Changed\n\n- Another feature.\n', '1.3.0').status).toBe(1);
  expect(check('1.3.1', '\n### Changed\n\n- Another feature.\n', '1.3.0').status).toBe(1);
  expect(check('1.4.0', '\n### Changed\n\n- Another feature.\n', '1.3.0').status).toBe(0);
});

it('ignores released sections below Unreleased', () => {
  // The fixture's 1.2.4 section has "### Changed"; only Unreleased counts.
  expect(check('1.2.4', '\n### Fixed\n\n- A fix.\n', '1.2.4').output).toContain('only patch-level');
});

it('rejects a malformed published version', () => {
  expect(check('1.3.0', '', 'latest').status).not.toBe(0);
});
