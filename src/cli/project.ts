/**
 * What the project the CLI runs in is built with, read from the files at its
 * top: which dev server, whether React, which Vite, whether a config loads
 * the Vite plugin, and the framework, Tailwind and linters around it. `init`
 * prints a setup from it, and the variant commands refuse or warn when no dev
 * server will serve file variants.
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
/** React Router's `ssr: false` (in react-router.config) or Remix's (in its plugin's options): SPA mode. */
const SSR_OFF = /\bssr\s*:\s*false\b/;

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
  const dev = devScript(pkg);
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
  const vite = installedMajor(cwd, 'vite', deps.vite);
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

function devScript(pkg: ReturnType<typeof readManifest>): string {
  return typeof pkg.scripts?.dev === 'string' ? pkg.scripts.dev : '';
}

/** The dependencies and dev dependencies package.json declares. */
function declaredDependencies(cwd: string): Record<string, unknown> {
  const pkg = readManifest(cwd);
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

/**
 * The framework that renders this Vite app's pages on the server too: React
 * Router's framework mode or Remix on Vite. Null in SPA mode (`ssr: false`) or
 * any other app.
 */
export function ssrFramework(cwd: string): 'React Router' | 'Remix' | null {
  const deps = declaredDependencies(cwd);
  const configs = safeReaddir(cwd).filter((name) => CONFIG_FILE.test(name));
  const ssrOff = (prefix: string) => configs.some((name) => name.startsWith(prefix) && SSR_OFF.test(readCode(join(cwd, name))));
  const reactRouter = configs.some((name) => name.startsWith('react-router.config.'));
  if (reactRouter || deps['@react-router/dev'] || /\breact-router\s+dev\b/.test(devScript(readManifest(cwd))))
    return ssrOff('react-router.config.') ? null : 'React Router';
  if (deps['@remix-run/dev']) return ssrOff('vite.config.') ? null : 'Remix';
  return null;
}

/**
 * The Vite plugins of the frameworks the panel switches through, as a config
 * names them, first match first: a framework plugin before the React one it
 * may bring along.
 */
const FRAMEWORK_PLUGINS: [pkg: string, shown: string][] = [
  ['@react-router/dev', 'reactRouter()'],
  ['@remix-run/dev', 'the Remix plugin'],
  ['@sveltejs/kit', 'sveltekit()'],
  ['@vitejs/plugin-react', '@vitejs/plugin-react'],
  ['@vitejs/plugin-react-swc', '@vitejs/plugin-react-swc'],
  ['@vitejs/plugin-vue', '@vitejs/plugin-vue'],
  ['@sveltejs/vite-plugin-svelte', '@sveltejs/vite-plugin-svelte'],
  ['@preact/preset-vite', '@preact/preset-vite'],
  ['vite-plugin-solid', 'vite-plugin-solid'],
];

/** The framework's Vite plugin package.json declares, by its package and as a config names it. */
export function frameworkPlugin(cwd: string): { pkg: string; shown: string } | null {
  const deps = declaredDependencies(cwd);
  const found = FRAMEWORK_PLUGINS.find(([pkg]) => typeof deps[pkg] === 'string');
  return found ? { pkg: found[0], shown: found[1] } : null;
}

/** Whether the project builds its CSS with Tailwind v4, which scans only the sources it is pointed at. */
export function tailwindV4(cwd: string): boolean {
  const deps = declaredDependencies(cwd);
  if (deps['@tailwindcss/vite'] || deps['@tailwindcss/postcss']) return true;
  const major = typeof deps.tailwindcss === 'string' ? installedMajor(cwd, 'tailwindcss', deps.tailwindcss) : null;
  return major !== null && major >= 4;
}

/** The installed (else declared) Biome's major version, which decides how it ignores a directory. */
export function biomeMajor(cwd: string): number | null {
  return installedMajor(cwd, '@biomejs/biome', declaredDependencies(cwd)['@biomejs/biome']);
}

/** The extensions of the project's component files, for a glob over variant copies. */
export function componentExtensions(cwd: string): string[] {
  const deps = declaredDependencies(cwd);
  const own = ['vue', 'svelte', 'astro'].filter((name) => typeof deps[name] === 'string');
  return [...own, ...(typeof deps.typescript === 'string' ? ['ts', 'tsx'] : ['js', 'jsx'])];
}

/** The major version of the copy of `name` installed up to the Git root (a hoisted workspace), else the declared range's. */
function installedMajor(cwd: string, name: string, declared: unknown): number | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    try {
      const { version } = JSON.parse(safeRead(join(dir, 'node_modules', name, 'package.json'))) as { version?: unknown };
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

/**
 * How the Vite plugin in `root` will switch file variants: per tab (`live`, which
 * also stands for "cannot tell": a project with neither a Vite config nor the
 * plugin may be served by a sibling, and an unreadable Vite version may be 6),
 * whole files that every tab follows through `.isotone/active.json` (`whole-react`
 * with React, `whole` without), or not at all (`none`: Next runs no Vite plugin).
 */
export function fileVariantSwitching(root: string): 'live' | 'whole-react' | 'whole' | 'none' {
  if (detectHost(root) === 'next') return 'none';
  const { loaded, viteConfig } = vitePlugin(root);
  if (!loaded && viteConfig === null) return 'live';
  const { mode, why } = viteSwitching(root);
  return mode !== 'shared' ? 'live' : why === 'no-react' ? 'whole' : 'whole-react';
}
