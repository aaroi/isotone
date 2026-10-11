import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/prepare-release.mjs', import.meta.url));
const roots: string[] = [];

function fixture(version: string, changelog: string) {
  const root = mkdtempSync(join(tmpdir(), 'isotone-release-test-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'isotone', version }));
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'Describe the merged change']);
  return root;
}

function prepare(root: string, published: string) {
  const result = spawnSync('node', [script, published], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout.trim();
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('keeps an explicit major version and moves pending notes into its release', () => {
  const root = fixture('1.0.0', '# Changelog\n\n## Unreleased\n\n- Explain the new onboarding.\n\n## 0.4.2\n\n- Earlier release.\n');
  expect(prepare(root, '0.4.2')).toBe('1.0.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('## 1.0.0\n\n- Explain the new onboarding.');
  expect(prepare(root, '0.4.2')).toBe('1.0.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8').match(/## 1\.0\.0/g)).toHaveLength(1);
});

it('bumps the published patch for a routine merge and records its subject', () => {
  const root = fixture('1.0.0', '# Changelog\n\n## Unreleased\n\n## 1.0.0\n\n- Stable release.\n');
  expect(prepare(root, '1.0.0')).toBe('1.0.1');
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('1.0.1');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('## 1.0.1\n\n- Describe the merged change');
});

it('rejects malformed registry versions before editing release files', () => {
  const changelog = '# Changelog\n\n## Unreleased\n';
  const root = fixture('1.0.0', changelog);
  expect(() => prepare(root, '01.0.0')).toThrow();
  expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('1.0.0');
  expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toBe(changelog);
});

it('does not reuse a tagged version if npm latest has not caught up', () => {
  const root = fixture('1.0.0', '# Changelog\n\n## Unreleased\n\n## 1.0.0\n\n- Stable release.\n');
  execFileSync('git', ['-C', root, 'tag', 'v1.0.0']);
  expect(prepare(root, '0.4.2')).toBe('1.0.1');
});
