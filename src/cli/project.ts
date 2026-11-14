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
/** The plugin's `variants: { live: false }`, which turns per-tab switching off. */
const LIVE_OFF = /\blive\s*:\s*false\b/;

/**
 * The dev server that serves the pages. A config loading the plugin settles it,
 * then the `dev` script; past those, Next goes first, since a Next app may keep
 * a `vite.config` for Vitest, which serves no pages.
 */
export function detectHost(cwd: string): Host {
  if (vitePlugin(cwd).loaded) return 'vite';
  const files = safeReaddir(cwd);
  const has = (prefix: string) => files.some((f) => f === prefix || f.startsWith(`${prefix}.`));
  const pkg = readManifest(cwd);
  const deps = declaredDependencies(cwd);
  // `vinext` (Next on Vite) has no word boundary before its `next`.
  const dev = typeof pkg.scripts?.dev === 'string' ? pkg.scripts.dev : '';
  if (/\b(?:vite|vinext|react-router)\b/.test(dev)) return 'vite';
  if (/\bnext\b/.test(dev)) return 'next';
  if (has('next.config') || deps.next) return 'next';
  if (has('vite.config') || has('react-router.config') || deps.vite) return 'vite';
  return 'other';
}

/**
 * How the Vite plugin will switch file variants here, by the test it makes when
 * the dev server starts: per tab (live mode) needs React, Vite 6 or later and
 * no `live: false`. `why` says what makes it shared; `unknown` is a React
 * project whose Vite version cannot be read.
 */
export function viteSwitching(cwd: string): {
  mode: 'per-tab' | 'shared' | 'unknown';
  why: 'no-react' | 'old-vite' | 'live-off' | null;
  vite: number | null;
} {
  const deps = declaredDependencies(cwd);
  const vite = viteMajor(cwd, deps.vite);
  if (typeof deps.react !== 'string') return { mode: 'shared', why: 'no-react', vite };
  if (vite !== null && vite < 6) return { mode: 'shared', why: 'old-vite', vite };
  const configs = safeReaddir(cwd).filter((name) => name.startsWith('vite.config.') && CONFIG_FILE.test(name));
  if (configs.some((name) => LIVE_OFF.test(readCode(join(cwd, name))))) return { mode: 'shared', why: 'live-off', vite };
  return { mode: vite === null ? 'unknown' : 'per-tab', why: null, vite };
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
    loaded: configs.some((name) => VITE_PLUGIN.test(readCode(join(cwd, name)))),
    viteConfig: configs.find((name) => name.startsWith('vite.config.')) ?? null,
  };
}

/** A config's text without its comments, so a commented-out plugin or option does not count. */
function readCode(file: string): string {
  return safeRead(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** package.json, or nothing: a manifest is optional for static HTML projects. */
function readManifest(cwd: string): {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  scripts?: Record<string, unknown>;
} {
  try {
    const pkg: unknown = JSON.parse(safeRead(join(cwd, 'package.json')));
    return pkg && typeof pkg === 'object' ? pkg : {};
  } catch {
    return {};
  }
}

/** The dependencies and dev dependencies package.json declares. */
function declaredDependencies(cwd: string): Record<string, unknown> {
  const pkg = readManifest(cwd);
  return { ...pkg.dependencies, ...pkg.devDependencies };
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
