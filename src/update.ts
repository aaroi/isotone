import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { UpdateInfo } from './core/update';
import { name as packageName, version as currentVersion } from '../package.json';

export const UPDATE_ENDPOINT = '/api/iteration/update';
const REGISTRY_URL = `https://registry.npmjs.org/${packageName}/latest`;
const CHECK_TIMEOUT = 5_000;
const CACHE_TTL = 24 * 60 * 60 * 1000;
const CACHE_FILE = join(tmpdir(), `isotone-update-${process.getuid?.() ?? 'user'}-v1.json`);

type Manager = 'npm' | 'pnpm' | 'yarn';
export type { UpdateInfo } from './core/update';

interface Version { parts: bigint[]; prerelease: string[] }
function parseVersion(value: string): Version {
  if (value.length > 256) throw new Error('Invalid version.');
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(value);
  if (!match) throw new Error('Invalid version.');
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^0\d+$/.test(part))) throw new Error('Invalid version.');
  return { parts: match.slice(1, 4).map(BigInt), prerelease };
}

/** SemVer precedence, including numeric prereleases and ignored build metadata. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a), right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] > right.parts[i] ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i], y = right.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function manifest(directory: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function findProject(cwd: string): { directory: string; json: Record<string, unknown> | null } {
  let directory = resolve(cwd);
  while (true) {
    const json = manifest(directory);
    if (json) return { directory, json };
    if (dirname(directory) === directory || existsSync(join(directory, '.git'))) return { directory: resolve(cwd), json: null };
    directory = dirname(directory);
  }
}

function dependencyOwner(project: ReturnType<typeof findProject>): ReturnType<typeof findProject> {
  let directory = project.directory;
  while (true) {
    const json = manifest(directory);
    if (['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].some((key) => {
      const dependencies = json?.[key];
      return dependencies && typeof dependencies === 'object' && Object.hasOwn(dependencies, packageName);
    })) return { directory, json };
    if (dirname(directory) === directory || existsSync(join(directory, '.git'))) return project;
    directory = dirname(directory);
  }
}

export function upgradePlan(cwd: string, latest: string, override?: Manager): Pick<UpdateInfo, 'upgrade' | 'message'> {
  parseVersion(latest); // Only a validated version can enter a copied command.
  const project = dependencyOwner(findProject(cwd));
  if (project.json?.name === packageName) return { upgrade: null, message: 'This is the source checkout; update its source instead of adding itself as a dependency.' };
  let manager = override;
  let directory = project.directory;
  const locks = new Set<Manager>();
  while (!manager) {
    const declared = manifest(directory)?.packageManager;
    if (typeof declared === 'string') {
      const match = /^(npm|pnpm|yarn)@/.exec(declared);
      if (!match) return { upgrade: null, message: 'The declared package manager is not supported by this command. Upgrade with your project’s package manager.' };
      manager = match[1] as Manager;
      break;
    }
    if (['bun.lock', 'bun.lockb'].some((file) => existsSync(join(directory, file)))) return { upgrade: null, message: 'This project uses Bun. Upgrade with the project’s package manager.' };
    if (existsSync(join(directory, 'pnpm-lock.yaml'))) locks.add('pnpm');
    if (existsSync(join(directory, 'yarn.lock'))) locks.add('yarn');
    if (['package-lock.json', 'npm-shrinkwrap.json'].some((file) => existsSync(join(directory, file)))) locks.add('npm');
    if (locks.size || dirname(directory) === directory || existsSync(join(directory, '.git'))) break;
    directory = dirname(directory);
  }
  if (!manager && locks.size > 1) return { upgrade: null, message: 'Multiple package-manager lockfiles found. Pass --manager npm, pnpm or yarn.' };
  manager ??= [...locks][0] ?? 'npm';
  const production = project.json?.dependencies as Record<string, unknown> | undefined;
  const optional = project.json?.optionalDependencies as Record<string, unknown> | undefined;
  const peers = project.json?.peerDependencies as Record<string, unknown> | undefined;
  if (optional?.[packageName] || peers?.[packageName]) return { upgrade: null, message: 'Review this optional/peer dependency manually with your package manager.' };
  const dev = production?.[packageName] ? '' : ' -D';
  let workspace = manager === 'pnpm' && existsSync(join(project.directory, 'pnpm-workspace.yaml')) ? ' -w' : '';
  if (manager === 'yarn' && project.json?.workspaces) {
    const declared = project.json.packageManager;
    if (typeof declared !== 'string' || !/^yarn@\d+\./.test(declared)) return { upgrade: null, message: 'Declare the Yarn version in packageManager before updating a workspace-root dependency; Yarn Classic and modern Yarn use different root flags.' };
    if (declared.startsWith('yarn@1.')) workspace = ' -W';
  }
  const command = manager === 'npm'
    ? `npm install${dev} --save-exact ${packageName}@${latest}`
    : `${manager} add${dev}${workspace} --exact ${packageName}@${latest}`;
  return { upgrade: { manager, command, cwd: project.directory } };
}

export async function fetchLatest(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, CHECK_TIMEOUT);
  try {
    if (controller.signal.aborted) throw new Error('Update check cancelled.');
    const response = await fetcher(REGISTRY_URL, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}.`);
    if (!response.body) throw new Error('Registry returned an empty response.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 64 * 1024) {
          await reader.cancel();
          throw new Error('Registry response was too large.');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof data.version !== 'string') throw new Error('Registry returned no version.');
    parseVersion(data.version);
    return data.version;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function updateInfo(latest: string, cwd: string, manager?: Manager): UpdateInfo {
  const order = compareVersions(latest, currentVersion);
  return {
    currentVersion, latestVersion: latest,
    status: order > 0 ? 'available' : order < 0 ? 'ahead' : 'current',
    ...(order > 0 ? upgradePlan(cwd, latest, manager) : { upgrade: null }),
  };
}

export async function checkUpdate(cwd: string, manager?: Manager, fetcher?: typeof fetch, signal?: AbortSignal): Promise<UpdateInfo> {
  try { return updateInfo(await fetchLatest(fetcher, signal), cwd, manager); }
  catch { return { currentVersion, latestVersion: null, status: 'unavailable', upgrade: null, message: 'Could not check npm for updates. The installed version remains usable; try again when online.' }; }
}

interface CachedCheck { checkedAt: number; latestVersion: string | null }
async function readCache(file: string): Promise<CachedCheck | null> {
  try {
    if ((await stat(file)).size > 4096) return null;
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (!Number.isFinite(data.checkedAt) || data.checkedAt > Date.now() || Date.now() - data.checkedAt >= CACHE_TTL) return null;
    if (data.latestVersion !== null) parseVersion(data.latestVersion);
    return data;
  } catch { return null; }
}

async function saveCache(file: string, latestVersion: string | null): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ checkedAt: Date.now(), latestVersion }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

/** One bounded request a day, including failed attempts, shared across dev servers. */
export function startUpdateCheck(cwd: string, enabled = true, options: { cacheFile?: string; fetcher?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): { getSnapshot(): UpdateInfo; ready: Promise<void>; dispose(): void } {
  const controller = new AbortController();
  const env = options.env ?? process.env;
  const off = !enabled || env.ISOTONE_UPDATE_CHECK === '0' || (!!env.CI && env.CI !== 'false' && env.CI !== '0') || env.NODE_ENV === 'test' || !!env.VITEST;
  let info: UpdateInfo = { currentVersion, latestVersion: null, status: off ? 'disabled' : 'checking', upgrade: null };
  const ready = off ? Promise.resolve() : (async () => {
    const file = options.cacheFile ?? CACHE_FILE;
    let locked = false;
    try {
      const cache = await readCache(file);
      if (cache) { info = cache.latestVersion ? updateInfo(cache.latestVersion, cwd) : { ...info, status: 'unavailable' }; return; }
      await mkdir(dirname(file), { recursive: true });
      try { await (await open(`${file}.lock`, 'wx', 0o600)).close(); locked = true; }
      catch {
        // A concurrent server owns the request. Recover an abandoned lease next time.
        if (Date.now() - (await stat(`${file}.lock`)).mtimeMs > CHECK_TIMEOUT * 3) await rm(`${file}.lock`, { force: true });
        info = { ...info, status: 'unavailable' };
        return;
      }
      const refreshed = await readCache(file);
      if (refreshed) { info = refreshed.latestVersion ? updateInfo(refreshed.latestVersion, cwd) : { ...info, status: 'unavailable' }; return; }
      await saveCache(file, null);
      info = await checkUpdate(cwd, undefined, options.fetcher, controller.signal);
      if (info.latestVersion) await saveCache(file, info.latestVersion);
    } catch { info = { currentVersion, latestVersion: null, status: 'unavailable', upgrade: null }; }
    finally { if (locked) await rm(`${file}.lock`, { force: true }).catch(() => {}); }
  })();
  return { getSnapshot: () => info, ready, dispose: () => controller.abort() };
}
