/**
 * Version precedence and the validation of a stored update request. Kept free
 * of the package manifest and the network so the notes store can use it.
 */
import type { UpdateRequest } from './core/update';

interface Version { parts: bigint[]; prerelease: string[] }
export function parseVersion(value: string): Version {
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

function isVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { parseVersion(value); return true; } catch { return false; }
}

const plainText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value !== '' && value.length <= max &&
  ![...value].some((char) => { const code = char.charCodeAt(0); return code < 32 || code === 127; });

/**
 * A stored update request, or null when any part of it is malformed. The
 * notes file is a plain JSON file in the project, so a hand edit is checked
 * before an agent is told to run the command in it.
 */
export function updateRequestOf(value: unknown): UpdateRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<UpdateRequest>;
  if (!isVersion(v.from) || !isVersion(v.to)) return null;
  if (v.manager !== 'npm' && v.manager !== 'pnpm' && v.manager !== 'yarn') return null;
  if (!plainText(v.command, 500) || !plainText(v.cwd, 4096)) return null;
  if (v.changelog !== undefined && !(plainText(v.changelog, 500) && v.changelog.startsWith('https://'))) return null;
  return { from: v.from, to: v.to, command: v.command, cwd: v.cwd, manager: v.manager,
    ...(v.changelog !== undefined ? { changelog: v.changelog } : {}) };
}

/** Where a release's notes live: its tag's CHANGELOG, also shipped in the package. */
export function changelogUrl(version: string): string {
  parseVersion(version);
  return `https://github.com/aaroi/isotone/blob/v${version}/CHANGELOG.md`;
}
