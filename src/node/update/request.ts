/**
 * Version precedence and the validation of a stored update request. Kept free
 * of the package manifest and the network so the notes store can use it.
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

import type { PackageManager, UpdateRequest } from '../../core/update';
import { isWithin } from '../fs/paths';

interface Version {
  parts: bigint[];
  prerelease: string[];
}
export function parseVersion(value: string): Version {
  if (value.length > 256) throw new Error('Invalid version.');
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?$/.exec(value);
  if (!match) throw new Error('Invalid version.');
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((part) => /^0\d+$/.test(part))) throw new Error('Invalid version.');
  return { parts: match.slice(1, 4).map(BigInt), prerelease };
}

/** SemVer precedence, including numeric prereleases and ignored build metadata. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a),
    right = parseVersion(b);
  for (const [i, part] of left.parts.entries()) {
    const other = right.parts[i] ?? 0n;
    if (part !== other) return part > other ? 1 : -1;
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i],
      y = right.prerelease[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function isVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    parseVersion(value);
    return true;
  } catch {
    return false;
  }
}

const plainText = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value !== '' &&
  value.length <= max &&
  ![...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });

const PACKAGE_NAME = 'isotone';
/** MAJOR.MINOR.PATCH with an optional prerelease, and no build metadata. */
const STRICT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;

/** A version an upgrade command may name: strict SemVer, nothing a shell could read as more. */
function isStrictVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && STRICT_VERSION.test(value) && isVersion(value);
}

/**
 * The upgrade command for Isotone, the one form `check-update` suggests: the
 * project's manager, an exact version, `-D` for a development dependency, and
 * the workspace-root flag where that manager needs one (pnpm `-w`, Yarn
 * Classic `-W`).
 */
export function upgradeCommand(manager: PackageManager, version: string, flags: { dev: boolean; workspace: boolean }): string {
  if (!isStrictVersion(version)) throw new Error('Invalid version.');
  const dev = flags.dev ? ' -D' : '';
  if (manager === 'npm') return `npm install${dev} --save-exact ${PACKAGE_NAME}@${version}`;
  const workspace = flags.workspace ? (manager === 'pnpm' ? ' -w' : ' -W') : '';
  return `${manager} add${dev}${workspace} --exact ${PACKAGE_NAME}@${version}`;
}

/** Every command an update note may carry for this manager and version. */
export function canonicalUpgradeCommands(manager: PackageManager, version: string): string[] {
  if (!isStrictVersion(version)) return [];
  const commands: string[] = [];
  for (const dev of [true, false]) {
    for (const workspace of manager === 'npm' ? [false] : [false, true])
      commands.push(upgradeCommand(manager, version, { dev, workspace }));
  }
  return commands;
}

/**
 * The project a notes file belongs to: the nearest directory holding it that
 * is a Git checkout, or outside one the file's own directory (the one holding
 * `.isotone/` for the default file). An update note may only name a directory
 * inside it.
 */
export function notesProjectRoot(file: string): string {
  const own = dirname(file);
  const start = basename(own) === '.isotone' ? dirname(own) : own;
  for (let directory = start; ; directory = dirname(directory)) {
    if (existsSync(join(directory, '.git'))) return directory;
    if (dirname(directory) === directory) return start;
  }
}

/** Whether `cwd` is an existing directory at or below an existing `root`, after symlinks. */
function isDirectoryInside(cwd: string, root: string): boolean {
  try {
    return statSync(realpathSync(cwd)).isDirectory() && existsSync(root) && isWithin(root, cwd, { realpath: true });
  } catch {
    return false;
  }
}

/**
 * A stored update request, or null when any part of it is malformed. The
 * notes file is a plain JSON file in the project, so a hand edit is checked
 * before an agent is told to run the command in it: the command must be
 * exactly the one `check-update` would build for that manager and version,
 * and, given the project root, the directory must be inside it.
 */
export function updateRequestOf(value: unknown, context: { root?: string } = {}): UpdateRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<UpdateRequest>;
  if (!isVersion(v.from) || !isStrictVersion(v.to)) return null;
  if (v.manager !== 'npm' && v.manager !== 'pnpm' && v.manager !== 'yarn') return null;
  if (!plainText(v.command, 500) || !plainText(v.cwd, 4096)) return null;
  if (!canonicalUpgradeCommands(v.manager, v.to).includes(v.command)) return null;
  if (!isAbsolute(v.cwd)) return null;
  if (context.root !== undefined && !isDirectoryInside(v.cwd, context.root)) return null;
  if (v.changelog !== undefined && !(plainText(v.changelog, 500) && v.changelog.startsWith('https://'))) return null;
  return {
    from: v.from,
    to: v.to,
    command: v.command,
    cwd: v.cwd,
    manager: v.manager,
    ...(v.changelog !== undefined ? { changelog: v.changelog } : {}),
  };
}

/** Where a release's notes live: its tag's CHANGELOG, also shipped in the package. */
export function changelogUrl(version: string): string {
  parseVersion(version);
  return `https://github.com/aaroi/isotone/blob/v${version}/CHANGELOG.md`;
}
