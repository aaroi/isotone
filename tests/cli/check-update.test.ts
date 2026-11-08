// `isotone check-update` as an agent runs it: what it prints and its exit code
// for each registry answer. The registry is a stubbed global fetch.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../package.json';
import { runCli } from '../../src/cli/index';
import { captureIo } from '../helpers/cli';

const dirs: string[] = [];
function app(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'iso-check-update-'));
  dirs.push(root);
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'app', devDependencies: { isotone: `^${version}` } }));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return root;
}
const latest = (answer: string) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ version: answer }))),
  );
const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
const newer = `${major + 1}.0.0`;
const older = patch > 0 ? `${major}.${minor}.${patch - 1}` : `${major}.${minor}.0-beta.1`;

async function checkUpdate(args: string[], root = app()) {
  const io = captureIo(root);
  const exit = await runCli(['check-update', ...args], io);
  return { exit, ...io.text, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('isotone check-update', () => {
  it('prints the upgrade command and where to run it when a release is newer', async () => {
    latest(newer);
    const { exit, out, root } = await checkUpdate([], app({ 'pnpm-lock.yaml': '' }));
    expect(exit).toBe(0);
    expect(out).toContain(`Running isotone ${version} · npm latest ${newer}`);
    expect(out).toContain('Update available. Review the release, then run:');
    expect(out).toContain(`pnpm add -D --exact isotone@${newer}`);
    expect(out).toContain(`from ${root}`);
    expect(out).toContain('Restart the dev server');
    // It only reads: nothing is installed or written.
    expect(readdirSync(root).sort()).toEqual(['.git', 'package.json', 'pnpm-lock.yaml']);
  });

  it('says why there is no command when it cannot build one', async () => {
    latest(newer);
    const { exit, out } = await checkUpdate([], app({ 'bun.lock': '' }));
    expect(exit).toBe(0);
    expect(out).toContain('Update available.');
    expect(out).not.toContain('Restart the dev server');
    expect(out).toContain('This project uses Bun.');
  });

  it('reports the latest release and a version ahead of it, exit 0', async () => {
    latest(version);
    expect(await checkUpdate([])).toMatchObject({ exit: 0, out: expect.stringContaining('Already on the latest release.') });
    latest(older);
    expect(await checkUpdate([])).toMatchObject({ exit: 0, out: expect.stringContaining('ahead of the latest tag; no downgrade') });
  });

  it('exits 1 and says the installed version still works when npm is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const { exit, out } = await checkUpdate([]);
    expect(exit).toBe(1);
    expect(out).toContain(`Running isotone ${version}\n`);
    expect(out).toContain('Could not check npm for updates. The installed version remains usable');
    const json = await checkUpdate(['--json']);
    expect(json.exit).toBe(1);
    expect(JSON.parse(json.out)).toMatchObject({ status: 'unavailable', latestVersion: null, upgrade: null });
  });

  it('honours --manager over the lockfile', async () => {
    latest(newer);
    const { out } = await checkUpdate(['--manager', 'yarn'], app({ 'package-lock.json': '{}' }));
    expect(out).toContain(`yarn add -D --exact isotone@${newer}`);
  });

  it.each([
    [['--manager', 'bun'], '--manager must be npm, pnpm or yarn.'],
    [['latest'], 'check-update does not take positional arguments.'],
  ])('refuses %j before contacting npm', async (args, message) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { exit, err } = await checkUpdate(args);
    expect(exit).toBe(1);
    expect(err).toContain(message);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('prints usage for --help without contacting npm', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { exit, out } = await checkUpdate(['--help']);
    expect(exit).toBe(0);
    expect(out).toContain('Usage: isotone check-update [--json] [--manager npm|pnpm|yarn]');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
