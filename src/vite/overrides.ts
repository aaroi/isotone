/**
 * What the variants store says about each source path, memoized for load():
 * the active set, the manifests, which copy answers a path, and how a file
 * with copies is dispatched in live mode. Nothing here talks to the server.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { normalizePath } from 'vite';

import { type OverlayVariant, overlayGroups, VARIANTS_ENDPOINT } from '../core/variants';
import { isWithin, realPath } from '../node/fs/paths';
import {
  ACTIVE_FILE,
  conflictedCopies,
  hasConflictMarkers,
  readActive,
  readVariants,
  resolveOverride,
  variantDir,
  variantsDir,
  type VariantsStoreOptions,
} from '../node/variants';
import { isRouteModule, scanExports } from '../node/variants/exports';
import type { LiveConfig } from './live';

/** Element type comparisons, which a component wrapper would break. */
const COMPARES_TYPES = /\.type\s*[!=]==?|[!=]==?\s*[\w$.]+\.type\b/;
const SCRIPT = /\.[cm]?[jt]sx?$/;

/**
 * A component its framework plugin compiles into several modules (Vue,
 * Svelte, Astro), each part answered from the plugin's compile of the whole
 * file: so a part request is left to the plugin, and a copy is never served
 * on its own (`?isotone=`), since the parts it imports would be the page's.
 */
export const isCompiledInParts = (path: string): boolean => /\.(?:vue|svelte|astro)$/.test(path);

/**
 * plugin-vue's hot update compares its last parse of a component with the
 * real file on disk, neither of which a switch changes, so it would update
 * nothing: a Vue component switches by reloading the page. Svelte's compiles
 * the file again through load(), which answers with the copy.
 */
export const reloadsOnSwitch = (path: string): boolean => path.endsWith('.vue');

/** How live mode serves one file: every version, and the names it exports. */
export interface DispatchPlan {
  key: string;
  versions: (string | null)[];
  names: string[];
}

/** The plugin's `variants` option, when the feature is on. */
export interface VariantsSetup {
  root?: string;
  dir?: string;
}

/** The canonical form of a directory, or the path as given when it does not
 *  exist yet (nothing to canonicalize; the comparison can only fail open).
 *  Native, as Vite's own module ids are: on Windows that expands an 8.3
 *  short name (`RUNNER~1`) the JavaScript realpath keeps. */
function realDir(path: string): string {
  try {
    return realPath(path);
  } catch {
    return path;
  }
}

/** `ISOTONE_VARIANT=a, b` → `['a', 'b']`; unset or blank → `[]`. */
function parseVariantList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

export type Overrides = ReturnType<typeof createOverrides>;

export function createOverrides(setup: VariantsSetup) {
  const storeOptions = (root: string): VariantsStoreOptions => ({
    root: resolve(root, setup.root ?? '.'),
    ...(setup.dir ? { dir: setup.dir } : {}),
  });
  let opts = storeOptions('.');
  let dir = variantsDir(opts);
  let isBuild = false;
  let isAsset: (file: string) => boolean = () => false;

  // The active set, and which override (if any) answers each source path
  // under it. `resolveOverride` re-reads the manifests every call, and load()
  // asks once per module per page, so memoize per active set and drop the
  // memo whenever the set or anything under the variants dir changes.
  // `undefined` means not read yet: configureServer primes it, and a load()
  // that somehow runs first reads the file itself.
  let activeIds: string[] | undefined;
  const answers = new Map<string, string | null>();
  let manifests: OverlayVariant[] | null = null;
  let byFile: Map<string, string[]> | null = null;
  let addedFiles: Map<string, string[]> | null = null;
  // The live store's groups and the members it cannot show, for each page.
  let liveGroups: Pick<LiveConfig, 'groups' | 'conflicted'> | null = null;

  const readManifests = (): OverlayVariant[] => {
    manifests ??= readVariants(opts);
    return manifests;
  };

  /** Variant ids that have a copy of each file, by forward-slash absolute path. */
  const versionsByFile = (): Map<string, string[]> => {
    if (byFile) return byFile;
    byFile = new Map();
    for (const variant of readManifests()) {
      for (const key of Object.keys(variant.files)) {
        const path = normalizePath(join(opts.root, key));
        byFile.set(path, [...(byFile.get(path) ?? []), variant.id]);
      }
    }
    return byFile;
  };

  /** Files only variants have, keyed by their path without an extension. */
  const filesOnlyInVariants = (): Map<string, string[]> => {
    if (addedFiles) return addedFiles;
    addedFiles = new Map();
    for (const path of versionsByFile().keys()) {
      if (existsSync(path)) continue;
      const stem = path.replace(SCRIPT, '');
      addedFiles.set(stem, [...(addedFiles.get(stem) ?? []), path]);
    }
    return addedFiles;
  };

  const active = (): string[] => {
    // A build takes its set from the environment: `ISOTONE_VARIANT=a,b`.
    if (isBuild) return parseVariantList(process.env.ISOTONE_VARIANT);
    if (activeIds === undefined) activeIds = readActive(opts);
    return activeIds;
  };

  /** Variant `id`'s copy of `path`, when it has one on disk. */
  const copyOf = (id: string, path: string): string | null => {
    const key = normalizePath(relative(opts.root, path));
    const manifest = readManifests().find((v) => v.id === id);
    if (!manifest || !Object.hasOwn(manifest.files, key)) return null;
    const file = join(variantDir(opts, id), key);
    return existsSync(file) ? file : null;
  };

  /** Drop every memo after a change under the variants dir. */
  const forget = (): void => {
    manifests = null;
    byFile = null;
    addedFiles = null;
    liveGroups = null;
    answers.clear();
  };

  return {
    get opts(): VariantsStoreOptions {
      return opts;
    },
    get dir(): string {
      return dir;
    },
    get activeFile(): string {
      return join(opts.root, ACTIVE_FILE);
    },
    readManifests,
    /** The manifests as last read, without reading them again. */
    cachedManifests: (): OverlayVariant[] => manifests ?? [],
    versionsByFile,
    active,
    copyOf,

    /** Take the project root and build/serve mode from Vite's resolved config. */
    configure(config: { root: string; command: string; assetsInclude: (file: string) => boolean }): void {
      isBuild = config.command === 'build';
      isAsset = config.assetsInclude;
      // Vite hands load() realpath'd module ids but leaves `config.root` as
      // configured, so a root reached through a symlink would never contain
      // any module and no override would ever apply. Canonicalize it here.
      const configured = storeOptions(config.root);
      opts = { ...configured, root: realDir(configured.root) };
      dir = variantsDir(opts);
      forget();
    },

    /** Replace the active set; what each path resolves to is asked again. */
    setActive(next: string[]): void {
      activeIds = next;
      answers.clear();
    },

    /** Re-read the active set from disk. */
    readActive: (): string[] => readActive(opts),

    forget,

    /** Drop which copy answers each path, and which copies hold conflict
     *  markers, keeping the manifests. */
    forgetAnswers(): void {
      answers.clear();
      liveGroups = null;
    },

    /** The override that answers `path` under the active set `ids`. */
    overrideFor(ids: string[], path: string): string | null {
      if (ids.length === 0) return null;
      // Sorted: the same set in another order answers the same for every path.
      const key = `${[...ids].sort().join(',')}\0${path}`;
      let hit = answers.get(key);
      if (hit === undefined) {
        hit = resolveOverride(opts, ids, path);
        answers.set(key, hit);
      }
      return hit;
    },

    /** Whether load() may swap `path` at all: a real file of the project the
     *  variants describe, not a dependency and not an override itself. */
    // Module ids reach load() with forward slashes on every platform, while a
    // watcher path is native; splitting on either separator covers both.
    overridable(path: string): boolean {
      return (
        isAbsolute(path) &&
        !path.split(/[\\/]/).includes('node_modules') &&
        isWithin(opts.root, path) &&
        !isWithin(dir, path) &&
        !isAsset(path)
      );
    },

    /**
     * How to dispatch `path`, or null to serve it whole: a script with at
     * least one variant copy, whose every version lists its exports plainly,
     * and which is not a route module a framework reads export by export.
     */
    dispatchPlan(path: string): DispatchPlan | null {
      if (!SCRIPT.test(path)) return null;
      const ids = versionsByFile().get(path);
      if (!ids?.length) return null;
      const versions: (string | null)[] = [];
      const names = new Set<string>();
      const sources: [string | null, string][] = [];
      if (existsSync(path)) sources.push([null, path]);
      // A copy with conflict markers from `variant sync` does not parse, and
      // the dispatcher imports every version: left in, it would break the
      // page for every tab. Left out, picking it shows the real file.
      for (const id of ids) {
        const file = copyOf(id, path);
        if (file && !hasConflictMarkers(file)) sources.push([id, file]);
      }
      for (const [id, file] of sources) {
        const code = readFileSync(file, 'utf8');
        // Code that compares element types (`child.type === Tab`) would see
        // the wrapper on one side and its own component on the other.
        if (COMPARES_TYPES.test(code)) return null;
        const found = scanExports(code);
        if (!found || isRouteModule(found)) return null;
        for (const name of found) names.add(name);
        versions.push(id);
      }
      // A file without exports runs for its side effects (an entry, a
      // registration); loading every version would run them all.
      if (versions.length === 0 || names.size === 0) return null;
      return { key: normalizePath(relative(opts.root, path)), versions, names: [...names].sort() };
    },

    /** The live store's config: groups in panel order, the members it cannot
     *  show, and the active set. Read once per change under the variants dir. */
    liveConfig(ssr: boolean): LiveConfig {
      liveGroups ??= {
        groups: overlayGroups(readManifests()).map((group) => ({ id: group.id, members: group.members.map((m) => m.id) })),
        conflicted: readManifests()
          .filter((m) => conflictedCopies(opts, m.id).length > 0)
          .map((m) => m.id),
      };
      return { ...liveGroups, active: active(), ssr, endpoint: VARIANTS_ENDPOINT };
    },

    /**
     * A file a variant adds, imported as `source` from `importer`, when the
     * import names exactly one: the path the variant gives it. `resolved` is
     * what Vite's own resolver found, which wins when it found anything.
     */
    async addedFile<R>(source: string, importer: string, resolved: () => Promise<R | null>): Promise<R | string | null> {
      const added = filesOnlyInVariants();
      if (added.size === 0 || source.startsWith('\0')) return null;
      const bare = source.replace(/[?#].*$/, '');
      const leaf = bare.slice(bare.lastIndexOf('/') + 1).replace(SCRIPT, '');
      const candidates = [...added.entries()].filter(([stem]) => stem.endsWith(`/${leaf}`) || stem.endsWith(`/${leaf}/index`));
      if (candidates.length === 0) return null;
      const found = await resolved();
      if (found) return found;
      const importerPath = importer.replace(/[?#].*$/, '');
      const target = bare.startsWith('.') ? normalizePath(resolve(dirname(importerPath), bare)).replace(SCRIPT, '') : null;
      // A relative import names the file exactly; an aliased one (`@/x/y`)
      // is matched on everything after its first segment.
      const tail = bare.split('/').slice(1).join('/').replace(SCRIPT, '');
      const hits = candidates.filter(([stem]) =>
        target
          ? stem === target || stem === `${target}/index`
          : tail !== '' && (stem.endsWith(`/${tail}`) || stem.endsWith(`/${tail}/index`)),
      );
      if (hits.length !== 1) return null;
      const paths = hits[0]?.[1] ?? [];
      return paths.length === 1 ? (paths[0] ?? null) : null;
    },
  };
}
