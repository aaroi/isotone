/**
 * What the project the CLI runs in is built with, read from the files at its
 * top: which dev server, whether React, which Vite, and whether a config loads
 * the Vite plugin. `init` prints a setup from it, and the variant commands warn
 * when no dev server will serve file variants.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { dirname, join } from 'node:path';

export type Host = 'vite' | 'next' | 'other';

/** Config files at the top that can hold a Vite plugin: Vite's own and those of frameworks built on it. */
const CONFIG_FILE = /^[\w-]+\.config\.[cm]?[jt]s$/;
const VITE_PLUGIN = /['"]isotone\/vite['"]/;

export function detectHost(cwd: string): Host {
  const files = safeReaddir(cwd);
  const has = (prefix: string) => files.some((f) => f === prefix || f.startsWith(`${prefix}.`));
  if (has('vite.config') || has('react-router.config')) return 'vite';
  if (has('next.config')) return 'next';
  const deps = declaredDependencies(cwd);
  if (deps.next) return 'next';
  if (deps.vite) return 'vite';
  return 'other';
}

/**
 * How the Vite plugin will switch file variants here. Per tab (live mode) needs
 * React and Vite 6 or later, the same test the plugin makes when the dev server
 * starts; `unknown` is a React project whose Vite version cannot be read.
 */
export function viteSwitching(cwd: string): { mode: 'per-tab' | 'shared' | 'unknown'; react: boolean; vite: number | null } {
  const deps = declaredDependencies(cwd);
  const react = typeof deps.react === 'string';
  const vite = viteMajor(cwd, deps.vite);
  const mode = !react ? 'shared' : vite === null ? 'unknown' : vite >= 6 ? 'per-tab' : 'shared';
  return { mode, react, vite };
}

/**
 * Whether a config at the top imports `isotone/vite`, and the Vite config's
 * name, if there is one. Without the import no dev server serves file
 * variants from this directory.
 */
export function vitePlugin(cwd: string): { loaded: boolean; viteConfig: string | null } {
  const configs = safeReaddir(cwd)
    .filter((name) => CONFIG_FILE.test(name))
    .sort();
  return {
    loaded: configs.some((name) => VITE_PLUGIN.test(safeRead(join(cwd, name)))),
    viteConfig: configs.find((name) => name.startsWith('vite.config.')) ?? null,
  };
}

/** The dependencies and dev dependencies package.json declares; none without one. */
function declaredDependencies(cwd: string): Record<string, unknown> {
  try {
    const pkg = JSON.parse(safeRead(join(cwd, 'package.json')));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    // A manifest is optional for static HTML projects.
    return {};
  }
}

/** The installed Vite's major version, up to the Git root (a hoisted workspace), else the declared range's. */
function viteMajor(cwd: string, declared: unknown): number | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    try {
      const { version } = JSON.parse(safeRead(join(dir, 'node_modules', 'vite', 'package.json'))) as { version?: unknown };
      const major = typeof version === 'string' ? /^(\d+)\./.exec(version) : null;
      if (major) return Number(major[1]);
    } catch {
      /* Not installed here. */
    }
    if (safeReaddir(dir).includes('.git') || dirname(dir) === dir) break;
  }
  // `^5.4.0`, `~6.1`, `>=7`; a workspace or catalog reference names no version.
  const range = typeof declared === 'string' ? /^[\^~>=v\s]*(\d+)/.exec(declared) : null;
  return range ? Number(range[1]) : null;
}

export function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function safeReaddirent(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

export function safeRead(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}
