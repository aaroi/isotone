import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkUpdate, compareVersions, fetchLatest, startUpdateCheck, upgradePlan } from '../src/update';
import { runCli } from '../src/cli/run';

const directories: string[] = [];
function project(json: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'iso-update-test-'));
  directories.push(root);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'consumer', ...json }));
  mkdirSync(join(root, '.git'));
  return root;
}
const registry = (version = '9.0.0') => vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ version })));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('version precedence', () => {
  it('follows the SemVer prerelease ordering example', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareVersions(ordered[i], ordered[i - 1])).toBe(1);
      expect(compareVersions(ordered[i - 1], ordered[i])).toBe(-1);
    }
  });
  it('compares numbers rather than strings and ignores build metadata', () => {
    expect(compareVersions('0.10.0', '0.9.99')).toBe(1);
    expect(compareVersions('1.0.0+build.2', '1.0.0+build.3')).toBe(0);
    expect(compareVersions('99999999999999999999999.0.0', '99999999999999999999998.0.0')).toBe(1);
  });
  it.each(['v1.0.0', '01.0.0', '1.0', '1.0.0-alpha.01', '1.0.0;echo secret', '1.0.0\n', 'latest', '1.0.0+'])('rejects malformed or command-like registry versions: %s', (value) => {
    expect(() => compareVersions(value, '1.0.0')).toThrow('Invalid version');
  });
});

describe('project update commands', () => {
  it.each(['npm', 'pnpm', 'yarn'] as const)('generates an exact %s command without executing it', (manager) => {
    const root = project({ packageManager: `${manager}@10.0.0` });
    const before = readFileSync(join(root, 'package.json'), 'utf8');
    expect(upgradePlan(root, '1.2.3').upgrade).toEqual({ manager, cwd: root, command: manager === 'npm' ? 'npm install -D --save-exact iso-iterate@1.2.3' : `${manager} add -D --exact iso-iterate@1.2.3` });
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toBe(before);
    expect(readdirSync(root).sort()).toEqual(['.git', 'package.json']);
  });
  it('uses the workspace package directory and root manager', () => {
    const root = project({ packageManager: 'pnpm@10.0.0' });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const child = join(root, 'packages', 'app');
    mkdirSync(join(child, 'src'), { recursive: true });
    writeFileSync(join(child, 'package.json'), '{"name":"child"}');
    expect(upgradePlan(join(child, 'src'), '1.2.3').upgrade).toMatchObject({ manager: 'pnpm', cwd: child, command: 'pnpm add -D --exact iso-iterate@1.2.3' });
    expect(upgradePlan(root, '1.2.3').upgrade?.command).toBe('pnpm add -D -w --exact iso-iterate@1.2.3');
  });
  it('does not guess between competing lockfiles or suggest npm to a Bun project', () => {
    const root = project();
    writeFileSync(join(root, 'package-lock.json'), '{}');
    writeFileSync(join(root, 'yarn.lock'), '');
    expect(upgradePlan(root, '1.2.3').upgrade).toBeNull();
    expect(upgradePlan(root, '1.2.3', 'yarn').upgrade?.manager).toBe('yarn');
    const bun = project();
    writeFileSync(join(bun, 'bun.lock'), '{}');
    expect(upgradePlan(bun, '1.2.3').upgrade).toBeNull();
  });
  it('updates the declaring workspace root when an app inherits the dependency', () => {
    const root = project({ packageManager: 'pnpm@10.0.0', devDependencies: { 'iso-iterate': '^0.3.4' } });
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const child = join(root, 'packages', 'app');
    mkdirSync(child, { recursive: true });
    writeFileSync(join(child, 'package.json'), '{"name":"child"}');
    expect(upgradePlan(child, '1.2.3').upgrade).toMatchObject({ cwd: root, command: 'pnpm add -D -w --exact iso-iterate@1.2.3' });
  });
  it('uses the Classic-only Yarn workspace root flag only when the version is known', () => {
    const base = { workspaces: ['packages/*'], devDependencies: { 'iso-iterate': '^0.3.4' } };
    expect(upgradePlan(project({ ...base, packageManager: 'yarn@1.22.22' }), '1.0.0').upgrade?.command).toBe('yarn add -D -W --exact iso-iterate@1.0.0');
    expect(upgradePlan(project({ ...base, packageManager: 'yarn@4.9.0' }), '1.0.0').upgrade?.command).toBe('yarn add -D --exact iso-iterate@1.0.0');
    expect(upgradePlan(project(base), '1.0.0', 'yarn').upgrade).toBeNull();
  });
  it('preserves a production dependency and refuses to add the package to itself', () => {
    expect(upgradePlan(project({ dependencies: { 'iso-iterate': '^0.3.0' } }), '1.0.0').upgrade?.command).toBe('npm install --save-exact iso-iterate@1.0.0');
    expect(upgradePlan(project({ name: 'iso-iterate' }), '1.0.0').upgrade).toBeNull();
  });
});

describe('bounded read-only registry request', () => {
  it('returns JSON-ready status and sends only the fixed public package lookup', async () => {
    const fetcher = registry();
    expect(await checkUpdate(project(), undefined, fetcher)).toMatchObject({ status: 'available', latestVersion: '9.0.0' });
    expect(fetcher).toHaveBeenCalledWith('https://registry.npmjs.org/iso-iterate/latest', expect.objectContaining({ redirect: 'error', headers: { accept: 'application/json' } }));
  });
  it('rejects oversized or invalid responses', async () => {
    await expect(fetchLatest(vi.fn(async () => new Response('x'.repeat(65537))))).rejects.toThrow('too large');
    await expect(fetchLatest(registry('1.2.3;touch broken'))).rejects.toThrow('Invalid version');
  });
  it('times out after five seconds and reports offline without making changes', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const root = project();
    const check = checkUpdate(root, undefined, fetcher);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await check).toMatchObject({ status: 'unavailable', latestVersion: null, upgrade: null });
    expect(readdirSync(root).sort()).toEqual(['.git', 'package.json']);
  });
  it('supports the CLI JSON contract with no extra stdout text', async () => {
    vi.stubGlobal('fetch', registry());
    let text = '';
    const exit = await runCli(['check-update', '--json', '--manager', 'pnpm'], { cwd: project(), stdout: { write: (value) => { text += value; } } });
    expect(exit).toBe(0);
    expect(JSON.parse(text)).toMatchObject({ status: 'available', upgrade: { manager: 'pnpm' } });
  });
});

describe('automatic checks', () => {
  it('returns immediately, caches successes, and never writes project files', async () => {
    const root = project();
    const cacheRoot = project();
    const cacheFile = join(cacheRoot, 'cache.json');
    const fetcher = registry();
    const first = startUpdateCheck(root, true, { cacheFile, fetcher, env: {} });
    expect(first.getSnapshot().status).toBe('checking');
    await first.ready;
    expect(first.getSnapshot().status).toBe('available');
    const second = startUpdateCheck(root, true, { cacheFile, fetcher, env: {} });
    await second.ready;
    expect(second.getSnapshot().status).toBe('available');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readdirSync(root).sort()).toEqual(['.git', 'package.json']);
  });
  it('caches failed attempts too, and retries after the day expires', async () => {
    const root = project(), cacheFile = join(root, 'cache.json');
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('offline'); });
    await startUpdateCheck(root, true, { cacheFile, fetcher, env: {} }).ready;
    await startUpdateCheck(root, true, { cacheFile, fetcher, env: {} }).ready;
    expect(fetcher).toHaveBeenCalledTimes(1);
    writeFileSync(cacheFile, JSON.stringify({ checkedAt: Date.now() - 86400001, latestVersion: null }));
    await startUpdateCheck(root, true, { cacheFile, fetcher, env: {} }).ready;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not request twice when two servers start together', async () => {
    const root = project(), cacheFile = join(root, 'cache.json');
    const fetcher = registry();
    await Promise.all([startUpdateCheck(root, true, { cacheFile, fetcher, env: {} }).ready, startUpdateCheck(root, true, { cacheFile, fetcher, env: {} }).ready]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels an in-flight registry request when its server closes', async () => {
    const root = project(), cacheFile = join(root, 'cache.json');
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => { started = resolve; });
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
      signal = options?.signal;
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      started();
    }));
    const check = startUpdateCheck(root, true, { cacheFile, fetcher, env: {} });
    await requestStarted;
    check.dispose();
    await check.ready;
    expect(signal?.aborted).toBe(true);
    expect(check.getSnapshot().status).toBe('unavailable');
    expect(readdirSync(root)).not.toContain('cache.json.lock');
  });
  it('does not contact the registry when explicitly disabled', async () => {
    const fetcher = registry();
    const check = startUpdateCheck(project(), false, { fetcher, env: {} });
    await check.ready;
    expect(check.getSnapshot().status).toBe('disabled');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{ CI: 'true' }, { VITEST: 'true' }, { NODE_ENV: 'test' }, { ISO_ITERATE_UPDATE_CHECK: '0' }])('stays entirely offline when disabled: %j', async (env) => {
    const fetcher = registry();
    const check = startUpdateCheck(project(), true, { fetcher, env });
    await check.ready;
    expect(check.getSnapshot().status).toBe('disabled');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
