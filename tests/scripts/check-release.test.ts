import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/check-release.mjs', import.meta.url));
const roots: string[] = [];

/** Runs the guard for a change whose package.json holds `version`. */
function check(version: string, ...args: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'isotone-check-release-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'isotone', version }));
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('passes a change that leaves the version as main has it', () => {
  expect(check('1.2.4', '1.2.4').output).toContain('next patch');
  // A minor the maintainer merged, or a patch a failed publish prepared, is main's version for every later change.
  expect(check('1.3.0', '1.3.0').status).toBe(0);
});

it.each([
  ['a minor', '1.3.0', '1.2.4'],
  ['a major', '2.0.0', '1.9.9'],
  ['a patch', '1.2.57', '1.2.4'],
  ['a lower version', '1.2.4', '1.3.0'],
])('fails a change to %s without the maintainer', (_, version, base) => {
  const blocked = check(version, base);
  expect(blocked.status).toBe(1);
  expect(blocked.output).toContain(`main has ${base}`);
  expect(blocked.output).toContain('minor-release');
});

it('passes a version the maintainer approved, wherever the flag stands', () => {
  expect(check('1.3.0', '1.2.4', '--minor-approved').output).toContain('approved changing the version to 1.3.0');
  expect(check('2.0.0', '--minor-approved', '1.9.9').status).toBe(0);
  expect(check('1.2.4', '1.2.4', '--minor-approved').output).toContain('next patch');
});

it('rejects a malformed version and a flag it does not know', () => {
  expect(check('1.3.0', 'latest').status).not.toBe(0);
  expect(check('1.3.0-beta.1', '1.3.0-beta.1').status).not.toBe(0);
  expect(check('1.3.0', '1.2.4', '--minor-aproved').status).not.toBe(0);
});
