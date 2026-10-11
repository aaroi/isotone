import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli/run';
import { version } from '../package.json';

const directories: string[] = [];
function project(git = true) {
  const root = mkdtempSync(join(tmpdir(), 'isotone-migrate-'));
  directories.push(root);
  if (git) command(root, ['init', '-q']);
  return root;
}
function command(root: string, args: string[]) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
function put(root: string, file: string, contents: string | Buffer) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents);
}
function read(root: string, path: string) { return readFileSync(join(root, path), 'utf8'); }
async function migrate(root: string, ...args: string[]) {
  let output = '', error = '';
  const code = await runCli(['migrate', '--json', ...args], { cwd: root, stdout: { write: text => { output += text; } }, stderr: { write: text => { error += text; } } });
  return { code, error, result: output ? JSON.parse(output) : null };
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('migration', () => {
  it('previews without writes, applies narrow edits, preserves feedback and lockfiles, and repeats safely', async () => {
    const root = project();
    put(root, 'package.json', JSON.stringify({ name: 'app', devDependencies: { 'iso-iterate': '^0.3.4' }, scripts: { review: 'iso-iterate serve' } }, null, 2));
    put(root, 'src/app.ts', "import { iteration } from 'iso-iterate/vite';\nconst changedByUser = 42;\nconst mode = 'ISO_ITERATE_UPDATE_CHECK';\n");
    put(root, 'pnpm-lock.yaml', 'iso-iterate: 0.3.4\n');
    put(root, '.iteration-feedback.json', '[{"id":"note","feedback":"Keep iso-iterate here"}]');
    command(root, ['add', '.']);
    put(root, 'AGENTS.md', 'Use npx iso-iterate --json.\n');
    put(root, 'src/untracked.ts', "import 'iso-iterate/react';\n");
    const before = read(root, 'src/app.ts');
    const preview = await migrate(root);
    expect(preview.code).toBe(0);
    expect(preview.result.applied).toBe(false);
    expect(preview.result.install).toMatchObject({ command: 'pnpm install' });
    expect(read(root, 'src/app.ts')).toBe(before);
    const applied = await migrate(root, '--write');
    expect(applied.result.applied).toBe(true);
    expect(JSON.parse(read(root, 'package.json'))).toMatchObject({ devDependencies: { isotone: version }, scripts: { review: 'isotone serve' } });
    expect(read(root, 'src/app.ts')).toContain("from 'isotone/vite'");
    expect(read(root, 'src/app.ts')).toContain('changedByUser = 42');
    expect(read(root, 'src/app.ts')).toContain('ISOTONE_UPDATE_CHECK');
    expect(read(root, 'AGENTS.md')).toContain('npx isotone');
    expect(read(root, 'pnpm-lock.yaml')).toBe('iso-iterate: 0.3.4\n');
    expect(read(root, '.iteration-feedback.json')).toContain('Keep iso-iterate here');
    expect(read(root, 'src/untracked.ts')).toContain('iso-iterate');
    expect((await migrate(root, '--write')).result).toMatchObject({ applied: false, edits: [], moves: [], install: null });
  });

  it('blocks the whole migration when the destination directory already exists, including a dangling symlink', async () => {
    for (const link of [false, true]) {
      const root = project();
      put(root, 'package.json', '{"devDependencies":{"iso-iterate":"0.3.4"}}');
      put(root, '.iso-iterate/active.json', '["card"]');
      if (link) symlinkSync(join(root, 'missing'), join(root, '.isotone'));
      else mkdirSync(join(root, '.isotone'));
      expect((await migrate(root, '--write')).code).toBe(1);
      expect(read(root, 'package.json')).toContain('iso-iterate');
      expect(existsSync(join(root, '.iso-iterate/active.json'))).toBe(true);
    }
  });

  it('blocks conflicting dependencies across sections and legacy file names before writing', async () => {
    const root = project();
    put(root, 'package.json', '{"dependencies":{"iso-iterate":"0.3.4"},"devDependencies":{"isotone":"0.4.0"}}');
    put(root, 'src/iso-iterate-config.ts', 'export default true;');
    command(root, ['add', '.']);
    const result = await migrate(root, '--write');
    expect(result.code).toBe(1);
    expect(result.result.conflicts).toHaveLength(2);
    expect(read(root, 'package.json')).toContain('iso-iterate');
  });

  it('preserves custom storage namespaces, binary assets, symlink targets, and private feedback shapes', async () => {
    const root = project(), outside = project(false);
    put(root, 'package.json', '{}');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal source fixture includes a template string.
    put(root, 'src/config.ts', "const options = { key: 'iso-iterate-custom', storageKey: `iso-iterate-${id}` }; localStorage.getItem('iso-iterate-custom'); const builtin = { key: 'iso-iterate-feedback' }; window.__isoIterate.mount(); const css = 'iso-iter-root'; const env = 'ISO_VARIANT';");
    put(root, 'custom-notes.json', '[{"id":"note","feedback":"iso-iterate"}]');
    put(root, 'asset.ts', Buffer.from([0, 105, 115, 111]));
    put(outside, 'config.ts', "import 'iso-iterate/react';");
    symlinkSync(join(outside, 'config.ts'), join(root, 'linked.ts'));
    command(root, ['add', '.']);
    expect((await migrate(root, '--write')).code).toBe(0);
    expect(read(root, 'src/config.ts')).toContain("key: 'iso-iterate-custom'");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: assert the original template string survives.
    expect(read(root, 'src/config.ts')).toContain('`iso-iterate-${id}`');
    expect(read(root, 'src/config.ts')).toContain("getItem('iso-iterate-custom')");
    expect(read(root, 'src/config.ts')).toContain("key: 'isotone-feedback'");
    expect(read(root, 'src/config.ts')).toContain('window.__isotone.mount()');
    expect(read(root, 'src/config.ts')).toContain('isotone-root');
    expect(read(root, 'src/config.ts')).toContain('ISOTONE_VARIANT');
    expect(read(root, 'custom-notes.json')).toContain('iso-iterate');
    expect(read(outside, 'config.ts')).toContain('iso-iterate');
    expect(readFileSync(join(root, 'asset.ts'))).toEqual(Buffer.from([0, 105, 115, 111]));
  });

  it('moves variant state, rewrites merge bases, and retains existing staleness and Git exclusions', async () => {
    const root = project();
    const source = "import 'iso-iterate/react';\nconst oldValue = 1;\n";
    put(root, 'src/app.ts', source);
    const base = command(root, ['hash-object', '-w', 'src/app.ts']);
    put(root, 'src/stale.ts', source);
    put(root, 'package.json', '{"devDependencies":{"iso-iterate":"0.3.4"}}');
    command(root, ['add', '.']);
    put(root, 'src/stale.ts', `${source}const userEdit = true;\n`);
    put(root, '.iso-iterate/active.json', '["cards"]');
    put(root, '.iso-iterate/knobs.json', '[{"kind":"range","id":"radius","min":0,"max":24,"step":1,"defaultValue":8}]');
    put(root, '.iso-iterate/variants/cards/variant.json', JSON.stringify({ id: 'cards', label: 'Cards', files: { 'src/app.ts': { base }, 'src/stale.ts': { base } } }));
    put(root, '.iso-iterate/variants/cards/src/app.ts', source.replace('= 1', '= 2'));
    put(root, '.git/info/exclude', '/.iso-iterate/active.json\n/.iteration-feedback.json\n');
    expect((await migrate(root, '--write')).code).toBe(0);
    expect(existsSync(join(root, '.iso-iterate'))).toBe(false);
    expect(read(root, '.isotone/active.json')).toBe('["cards"]');
    expect(read(root, '.isotone/variants/cards/src/app.ts')).toContain("import 'isotone/react'");
    const manifest = JSON.parse(read(root, '.isotone/variants/cards/variant.json'));
    const hash = command(root, ['hash-object', 'src/app.ts']);
    expect(manifest.files['src/app.ts'].base).toBe(hash);
    expect(manifest.files['src/stale.ts'].base).not.toBe(command(root, ['hash-object', 'src/stale.ts']));
    expect(command(root, ['cat-file', 'blob', hash])).toContain("import 'isotone/react'");
    expect(read(root, '.git/info/exclude')).toBe('/.isotone/active.json\n/.iteration-feedback.json\n');
  });

  it('leaves nested independent Git projects untouched', async () => {
    const root = project();
    put(root, 'package.json', '{}');
    const child = join(root, 'nested');
    mkdirSync(child);
    command(child, ['init', '-q']);
    put(child, 'package.json', '{"devDependencies":{"iso-iterate":"0.3.4"}}');
    put(child, '.iso-iterate/active.json', '[]');
    const result = await migrate(root, '--write');
    expect(result.code).toBe(0);
    expect(result.result.warnings[0]).toContain('Separate Git checkout skipped');
    expect(existsSync(join(child, '.iso-iterate'))).toBe(true);
    expect(read(child, 'package.json')).toContain('iso-iterate');
  });

  it.each(['npm', 'pnpm', 'yarn', 'bun'])('supports non-Git projects with %s and regenerates locks by command only', async manager => {
    const root = project(false);
    put(root, 'package.json', JSON.stringify({ packageManager: `${manager}@10.0.0`, dependencies: { 'iso-iterate': '^0.3.4' } }));
    put(root, 'src/app.ts', "import 'iso-iterate/react';");
    const result = await migrate(root, '--write');
    expect(result.code).toBe(0);
    expect(result.result.install.command).toBe(`${manager} install`);
    expect(JSON.parse(read(root, 'package.json')).dependencies).toEqual({ isotone: version });
    expect(read(root, 'src/app.ts')).toContain('isotone/react');
  });

  it('targets all tracked workspace manifests and gives a root install step', async () => {
    const root = project();
    put(root, 'package.json', '{"private":true,"packageManager":"pnpm@10.0.0"}');
    put(root, 'pnpm-workspace.yaml', 'packages: [packages/*]');
    put(root, 'packages/app/package.json', '{"devDependencies":{"iso-iterate":"0.3.4"}}');
    command(root, ['add', '.']);
    const result = await migrate(join(root, 'packages/app'), '--write');
    expect(result.code).toBe(0);
    expect(result.result.install).toEqual({ cwd: result.result.root, command: 'pnpm install' });
    expect(JSON.parse(read(root, 'packages/app/package.json')).devDependencies).toEqual({ isotone: version });
  });
  it('gives a separate install step for each independently locked app', async () => {
    const root = project();
    put(root, 'frontend/package.json', '{"devDependencies":{"iso-iterate":"0.3.4"}}');
    put(root, 'frontend/pnpm-lock.yaml', 'lockfileVersion: 9');
    put(root, 'admin/package.json', '{"devDependencies":{"iso-iterate":"0.3.4"}}');
    put(root, 'admin/package-lock.json', '{}');
    command(root, ['add', '.']);
    const result = await migrate(root);
    expect(result.result.install).toBeNull();
    expect(result.result.installs).toEqual(expect.arrayContaining([
      { cwd: join(result.result.root, 'frontend'), command: 'pnpm install' },
      { cwd: join(result.result.root, 'admin'), command: 'npm install' },
    ]));
  });
  it('moves exact pinned CLI commands to the running version and blocks ambiguous overrides', async () => {
    const root = project();
    put(root, 'package.json', '{"devDependencies":{"iso-iterate":"0.3.4"},"scripts":{"review":"npx iso-iterate@0.3.4 serve"}}');
    put(root, 'AGENTS.md', 'Run npx iso-iterate@0.3.4 --json or npx iso-iterate@latest --help.');
    expect((await migrate(root, '--write')).code).toBe(0);
    expect(JSON.parse(read(root, 'package.json')).scripts.review).toBe(`npx isotone@${version} serve`);
    expect(read(root, 'AGENTS.md')).toContain(`npx isotone@${version} --json`);
    expect(read(root, 'AGENTS.md')).toContain('isotone@latest');
    put(root, 'package.json', '{"devDependencies":{"iso-iterate":"0.3.4"},"overrides":{"iso-iterate":"0.3.4"}}');
    expect((await migrate(root, '--write')).code).toBe(1);
    expect(read(root, 'package.json')).toContain('"overrides":{"iso-iterate"');
    put(root, 'package.json', '{"scripts":{"review":"npx iso-iterate@^0.3.4 serve"}}');
    expect((await migrate(root, '--write')).code).toBe(1);
    expect(read(root, 'package.json')).toContain('iso-iterate@^0.3.4');
  });
});
