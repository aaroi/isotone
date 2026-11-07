/**
 * Development-only notes, source variants and a self-contained panel for Vite.
 * Inject through the HTML response so SSR frameworks work too. The loader lives
 * in <head> and mounts after load, leaving the host's hydration and HMR alone.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

// `normalizePath` is a plain function, so importing it as a value does not
// pull vite's nominal `Plugin` type into the structural return type below.
import {
  type DevEnvironment,
  type EnvironmentModuleNode,
  type HmrContext,
  type HotUpdateOptions,
  normalizePath,
  type Plugin,
  type ResolvedConfig,
} from 'vite';

import { ensureDirIgnored, ensureFileIgnored } from '../node/fs/git-exclude';
import { NOTES_ENDPOINT } from '../node/notes/handler';
import { readBundle } from '../standalone/bundle';
import { startUpdateCheck, UPDATE_ENDPOINT } from '../node/update/check';
import { autoUpdateNote } from '../node/update/note';
import { isWithin } from '../node/fs/paths';
import { isLoopback } from '../node/http';
import { type OverlayVariant, overlayGroups, VARIANTS_ENDPOINT } from '../core/variants';
import {
  ACTIVE_FILE,
  listVariants,
  overrideSourcePath,
  readActive,
  readVariant,
  readVariants,
  resolveOverride,
  variantDir,
  variantsDir,
  type VariantsStoreOptions,
} from '../node/variants';
import { isRouteModule, scanExports } from './exports';
import { BUNDLE_PATH, injectHtmlResponse, mountModuleSource } from './html-inject';
import { notesEndpoint, updateEndpoint, variantsEndpoint } from './middleware';
import type { IterationPlugin, IterationViteOptions } from './options';
import {
  ACTIVE_EVENT,
  BASE_VERSION,
  dispatcherModule,
  LIVE_MODULE,
  type LiveConfig,
  liveRuntimeModule,
  liveStoreScript,
  RESOLVED_LIVE_MODULE,
  VERSION_QUERY,
} from './live';

export type { IterationPlugin, IterationViteOptions } from './options';
export { withNativeFetch } from './html-inject';

const DEFAULT_FILE = '.iteration-feedback.json';
const MANIFEST = 'variant.json';

/**
 * Import queries that hand the file to one of vite's own loaders (assets,
 * workers, inline HTML scripts). Those read the file from disk themselves
 * and shape the module around it; a `pre` load returning the override's
 * text in their place would break the module, so such requests are left to
 * them and show the real file.
 */
const SPECIAL_QUERY = /[?&](raw|url|inline|no-inline|worker|sharedworker|html-proxy)(?:[&=]|$)/;

/** Element type comparisons, which a component wrapper would break. */
const COMPARES_TYPES = /\.type\s*[!=]==?|[!=]==?\s*[\w$.]+\.type\b/;

/** The version a module id names (`?isotone=<id>`), or null for any other module. */
function versionOfId(id: string | null): string | null {
  const at = id?.indexOf('?') ?? -1;
  if (!id || at < 0) return null;
  return new URLSearchParams(id.slice(at + 1)).get(VERSION_QUERY);
}

/** The canonical form of a directory, or the path as given when it does not
 *  exist yet (nothing to canonicalize; the comparison can only fail open). */
function realDir(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function iteration(options: IterationViteOptions = {}): IterationPlugin {
  let file = resolve(options.file ?? DEFAULT_FILE);
  let isDev = false;
  let isBuild = false;
  let isAsset: (file: string) => boolean = () => false;

  const variantsOptions = options.variants === false ? null : (options.variants ?? {});
  let vopts: VariantsStoreOptions = {
    root: resolve(variantsOptions?.root ?? '.'),
    ...(variantsOptions?.dir ? { dir: variantsOptions.dir } : {}),
  };
  let vDir = variantsDir(vopts);
  let activeFile = join(vopts.root, ACTIVE_FILE);

  // The active set, and which override (if any) answers each source path
  // under it. `resolveOverride` re-reads the manifests every call, and load()
  // asks once per module per page, so memoize per active set and drop the
  // memo whenever the set or anything under the variants dir changes.
  // `undefined` means not read yet: configureServer primes it, and a load()
  // that somehow runs first reads the file itself.
  let activeIds: string[] | undefined;
  const overrides = new Map<string, string | null>();
  // Real source paths activate() is reporting as changed right now. Their
  // hot update must go through, where an ordinary edit of an overridden
  // real file is dropped (see handleHotUpdate). Each path keeps the
  // environments that have already seen the swap: Vite 6 and later ask every
  // environment about one change, the browser first and the server after.
  const swapping = new Map<string, Set<string>>();

  // Live mode (see ./live.ts). Decided in configureServer, where the server's
  // environments show which Vite this is.
  let live = false;
  let hasReact = false;
  let ssrHost = false;
  let manifests: OverlayVariant[] | null = null;
  let byFile: Map<string, string[]> | null = null;
  let addedFiles: Map<string, string[]> | null = null;
  // The export names each dispatcher was written with, by real path. A
  // version whose names change needs a new dispatcher, which is a reload.
  const dispatched = new Map<string, string>();
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  const readManifests = (): OverlayVariant[] => {
    manifests ??= readVariants(vopts);
    return manifests;
  };
  /** Variant ids that have a copy of each file, by forward-slash absolute path. */
  const versionsByFile = (): Map<string, string[]> => {
    if (byFile) return byFile;
    byFile = new Map();
    for (const variant of readManifests()) {
      for (const key of Object.keys(variant.files)) {
        const path = normalizePath(join(vopts.root, key));
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
      const stem = path.replace(/\.[cm]?[jt]sx?$/, '');
      addedFiles.set(stem, [...(addedFiles.get(stem) ?? []), path]);
    }
    return addedFiles;
  };
  const forgetManifests = () => {
    manifests = null;
    byFile = null;
    addedFiles = null;
    overrides.clear();
  };
  const groupsOf = (list: OverlayVariant[]): LiveConfig['groups'] =>
    overlayGroups(list).map((group) => ({ id: group.id, members: group.members.map((m) => m.id) }));
  const liveConfig = (): LiveConfig => ({
    groups: groupsOf(readManifests()),
    active: currentActive(),
    ssr: ssrHost,
    endpoint: VARIANTS_ENDPOINT,
  });
  const overrideOf = (id: string, path: string): string | null => {
    const key = normalizePath(relative(vopts.root, path));
    const manifest = readManifests().find((v) => v.id === id);
    if (!manifest || !Object.hasOwn(manifest.files, key)) return null;
    const file = join(variantDir(vopts, id), key);
    return existsSync(file) ? file : null;
  };

  /**
   * How to dispatch `path`, or null to serve it whole: a script with at
   * least one variant copy, whose every version lists its exports plainly,
   * and which is not a route module a framework reads export by export.
   */
  const dispatchPlan = (path: string): { key: string; versions: (string | null)[]; names: string[] } | null => {
    if (!/\.[cm]?[jt]sx?$/.test(path)) return null;
    const ids = versionsByFile().get(path);
    if (!ids?.length) return null;
    const versions: (string | null)[] = [];
    const names = new Set<string>();
    const sources: [string | null, string][] = [];
    if (existsSync(path)) sources.push([null, path]);
    for (const id of ids) {
      const file = overrideOf(id, path);
      if (file) sources.push([id, file]);
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
    return { key: normalizePath(relative(vopts.root, path)), versions, names: [...names].sort() };
  };
  const namesChanged = (path: string): boolean => {
    const plan = dispatchPlan(path);
    return !plan || plan.names.join(',') !== dispatched.get(path);
  };
  let reloadPage: () => void = () => {};
  const swapWaiters = new Set<() => void>();

  /**
   * Which modules a file change updates in one environment (`null`: Vite 5,
   * which asks once for all of them). `undefined` lets Vite decide.
   */
  const hotModules = <M extends { id: string | null }>(
    changed: string,
    modulesOf: (file: string) => Iterable<M> | undefined,
    env: string | null,
  ): M[] | undefined => {
    if (!variantsOptions) return undefined;
    const client = env === null || env === 'client';
    // The module graph keys files by their forward-slash form, which is
    // what `join` produces on POSIX and not on Windows.
    if (isWithin(vDir, changed)) {
      overrides.clear();
      const hit = overrideSourcePath(vopts, changed);
      // The manifest, or a file directly in the variants dir: nothing the
      // browser has loaded. The panel re-lists variants when it opens.
      if (!hit || hit.file === MANIFEST) return [];
      const source = normalizePath(join(vopts.root, hit.file));
      // Live: the copy has a module of its own; update just that one.
      if (live && client && dispatched.has(source)) {
        if (namesChanged(source)) {
          reloadPage();
          return [];
        }
        return [...(modulesOf(source) ?? [])].filter((m) => versionOfId(m.id) === hit.id);
      }
      if (!currentActive().includes(hit.id)) return [];
      // The browser holds the real file's URL, so the override's edit has
      // to be delivered as if the real file changed.
      return [...(modulesOf(source) ?? [])];
    }
    // A change activate() reported. Vite hands this hook a forward-slash
    // path, and the swap is keyed the same way, so Windows paths match too.
    const path = normalizePath(changed);
    const seen = swapping.get(path);
    let swap = false;
    if (seen) {
      if (env === null) {
        swapping.delete(path);
        swap = true;
      } else if (!seen.has(env)) {
        seen.add(env);
        swap = true;
        for (const check of [...swapWaiters]) check();
      }
    }
    if (live && client && dispatched.has(path)) {
      // The dispatcher already holds every version; the tab switched itself.
      if (swap) return [];
      if (namesChanged(path)) {
        reloadPage();
        return [];
      }
      return [...(modulesOf(path) ?? [])].filter((m) => versionOfId(m.id) === BASE_VERSION);
    }
    // Let Vite compute the swap's update as usual.
    if (swap) return undefined;
    // The real source of an overridden file: the browser is showing the
    // override, so there is nothing to update from this edit.
    if (overridable(changed) && overrideFor(currentActive(), changed)) return [];
    return undefined;
  };

  const currentActive = (): string[] => {
    // A build takes its set from the environment: `ISOTONE_VARIANT=a,b`.
    if (isBuild) return parseVariantList(process.env.ISOTONE_VARIANT);
    if (activeIds === undefined) activeIds = readActive(vopts);
    return activeIds;
  };

  const overrideFor = (active: string[], path: string): string | null => {
    if (active.length === 0) return null;
    // Sorted: the same set in another order answers the same for every path.
    const key = `${[...active].sort().join(',')}\0${path}`;
    let hit = overrides.get(key);
    if (hit === undefined) {
      hit = resolveOverride(vopts, active, path);
      overrides.set(key, hit);
    }
    return hit;
  };

  /** Whether load() may swap `path` at all: a real file of the project the
   *  variants describe, not a dependency and not an override itself. */
  // Module ids reach load() with forward slashes on every platform, while a
  // watcher path is native; splitting on either separator covers both.
  const overridable = (path: string): boolean =>
    isAbsolute(path) &&
    !path.split(/[\\/]/).includes('node_modules') &&
    isWithin(vopts.root, path) &&
    !isWithin(vDir, path) &&
    !isAsset(path);

  // `satisfies`, not an annotation: the hooks are checked against vite's
  // types, but the object keeps its own shape, so `handleHotUpdate` stays a
  // plain method and drops into the structural type below.
  const plugin = {
    name: 'iso:iteration',
    enforce: 'pre',
    configResolved(config: ResolvedConfig) {
      isDev = config.command === 'serve';
      isBuild = config.command === 'build';
      isAsset = config.assetsInclude;
      file = resolve(config.root, options.file ?? DEFAULT_FILE);
      // Vite hands load() realpath'd module ids but leaves `config.root` as
      // configured, so a root reached through a symlink would never contain
      // any module and no override would ever apply. Canonicalize it here.
      vopts = {
        root: realDir(resolve(config.root, variantsOptions?.root ?? '.')),
        ...(variantsOptions?.dir ? { dir: variantsOptions.dir } : {}),
      };
      vDir = variantsDir(vopts);
      activeFile = join(vopts.root, ACTIVE_FILE);
      hasReact = (config.plugins ?? []).some((p) => /react/i.test(p.name));
      ssrHost = config.appType !== 'spa' && config.appType !== 'mpa';
      forgetManifests();
    },
    async resolveId(source: string, importer: string | undefined, opts: { ssr?: boolean; isEntry?: boolean } = {}) {
      if (!variantsOptions) return null;
      if (source === LIVE_MODULE) return RESOLVED_LIVE_MODULE;
      if (!importer) return null;
      // A dispatcher's own imports, `./file.tsx?isotone=<id>`: resolved here
      // so a version of a file only variants have still has an id.
      const marker = source.indexOf(`?${VERSION_QUERY}=`);
      if (live && marker > 0 && source.startsWith('./')) {
        const dir = dirname(importer.replace(/[?#].*$/, ''));
        return normalizePath(resolve(dir, source.slice(0, marker))) + source.slice(marker);
      }
      // A file a variant adds, imported by variant code. Vite's resolver
      // cannot find it on disk, so answer with the path the variant gives it.
      const added = filesOnlyInVariants();
      if (added.size === 0 || source.startsWith('\0')) return null;
      const bare = source.replace(/[?#].*$/, '');
      const leaf = bare.slice(bare.lastIndexOf('/') + 1).replace(/\.[cm]?[jt]sx?$/, '');
      const candidates = [...added.entries()].filter(([stem]) => stem.endsWith(`/${leaf}`) || stem.endsWith(`/${leaf}/index`));
      if (candidates.length === 0) return null;
      const resolved = await this.resolve(source, importer, { ...opts, skipSelf: true });
      if (resolved) return resolved;
      const importerPath = importer.replace(/[?#].*$/, '');
      const target = bare.startsWith('.') ? normalizePath(resolve(dirname(importerPath), bare)).replace(/\.[cm]?[jt]sx?$/, '') : null;
      // A relative import names the file exactly; an aliased one (`@/x/y`)
      // is matched on everything after its first segment.
      const tail = bare
        .split('/')
        .slice(1)
        .join('/')
        .replace(/\.[cm]?[jt]sx?$/, '');
      const hits = candidates.filter(([stem]) =>
        target
          ? stem === target || stem === `${target}/index`
          : tail !== '' && (stem.endsWith(`/${tail}`) || stem.endsWith(`/${tail}/index`)),
      );
      if (hits.length !== 1) return null;
      const paths = hits[0]?.[1] ?? [];
      return paths.length === 1 ? paths[0] : null;
    },
    load(id: string, opts?: { ssr?: boolean }) {
      if (!variantsOptions || SPECIAL_QUERY.test(id)) return null;
      if (id === RESOLVED_LIVE_MODULE) return { code: liveRuntimeModule(liveConfig()), map: null };
      // `?v=<hash>`, `?t=<timestamp>`, `?import`: vite's own request
      // decorations, never part of the path on disk.
      const path = id.replace(/[?#].*$/, '');
      if (!overridable(path)) return null;
      const query = id.slice(path.length).replace(/^\?/, '').replace(/#.*$/, '');
      const version = live ? new URLSearchParams(query).get(VERSION_QUERY) : null;
      if (version !== null) {
        const from = version === BASE_VERSION ? (existsSync(path) ? path : null) : overrideOf(version, path);
        return { code: from ? readFileSync(from, 'utf8') : 'export {};\n', map: null };
      }
      // The browser gets a dispatcher; a server render keeps the whole-file
      // swap, since the server cannot know which tab it renders for.
      if (live && !opts?.ssr && query === '') {
        const plan = dispatchPlan(path);
        if (plan) {
          dispatched.set(path, plan.names.join(','));
          const name = path.slice(path.lastIndexOf('/') + 1);
          return { code: dispatcherModule(plan.key, name, plan.versions, plan.names), map: null };
        }
      }
      const override = overrideFor(currentActive(), path);
      if (!override) return null;
      return { code: readFileSync(override, 'utf8'), map: null };
    },
    // Vite 6 and later call this once per environment and skip
    // handleHotUpdate; Vite 5 only knows handleHotUpdate.
    hotUpdate(this: { environment: DevEnvironment }, ctx: HotUpdateOptions): EnvironmentModuleNode[] | undefined {
      const env = this.environment;
      return hotModules(ctx.file, (f) => env.moduleGraph.getModulesByFile(f), env.name);
    },
    handleHotUpdate(ctx: HmrContext) {
      const { server } = ctx;
      return hotModules(ctx.file, (f) => server.moduleGraph.getModulesByFile(f), null) as HmrContext['modules'] | undefined;
    },
    configureServer(server) {
      if (!isDev) return;
      // Here, not at construction: a production build should not touch .git.
      ensureFileIgnored(file);

      // Say where the notes go, after Vite's own banner so it is not buried
      // under it. Portable setups fail quietly otherwise: a reviewer writes
      // notes and the agent looks in the wrong directory.
      server.httpServer?.once('listening', () => {
        const shown = relative(server.config.root, file) || file;
        server.config.logger.info(`  isotone  notes → ${shown}  (${NOTES_ENDPOINT})`);
        if (variantsOptions && existsSync(vDir)) {
          const shownDir = relative(server.config.root, vDir) || vDir;
          const n = listVariants(vopts).length;
          server.config.logger.info(`  isotone  variants → ${shownDir}  (${n} variant${n === 1 ? '' : 's'})`);
        }
        if (allowedHosts().network) {
          server.config.logger.warn('  isotone  exposed with --host: anyone on your network can read and write notes and switch variants');
        }
      });

      const updates = startUpdateCheck(server.config.root, options.checkForUpdates !== false);
      server.httpServer?.once('close', updates.dispose);
      if (options.checkForUpdates === 'note') {
        void updates.ready.then(() => autoUpdateNote(file, updates.getSnapshot())).catch(() => {});
      }
      const allowedHosts = () => {
        const { allowedHosts: hosts, host } = server.config.server ?? {};
        const network = host === true || (typeof host === 'string' && !isLoopback(host));
        return { names: Array.isArray(hosts) ? hosts : [], network };
      };
      server.middlewares.use(
        UPDATE_ENDPOINT,
        updateEndpoint(() => file, updates, allowedHosts),
      );
      server.middlewares.use(
        NOTES_ENDPOINT,
        notesEndpoint(() => file, allowedHosts),
      );

      if (variantsOptions) {
        // Read the pointer now, before anything can rewrite it: activate()
        // diffs the previous set against the new one, and the endpoint has
        // already written the file by the time it runs, so a lazy first read
        // would see the new set twice and switch nothing.
        activeIds = readActive(vopts);

        // Live switching needs the host's React for the wrappers and Vite 6's
        // per-environment hot updates, so the server render keeps its swap
        // while the browser's dispatchers are left alone.
        live = (variantsOptions.live ?? hasReact) && server.environments !== undefined;
        // A server render holds modules of its own, so a change to what a
        // variant covers has to reach those too or the HTML goes stale.
        const graphs = () =>
          server.environments
            ? Object.values(server.environments).map((env) => env.moduleGraph as unknown as typeof server.moduleGraph)
            : [server.moduleGraph];
        // Files a manifest named before it changed: one that left the variant
        // has no entry to be found by afterwards.
        const covered = new Set<string>();
        const signature = () => JSON.stringify(readManifests().map((v) => [v.id, v.group ?? '', Object.keys(v.files).sort()]));
        let listed = signature();
        // A dispatcher is written for one set of versions and names. When
        // either changes, the browser needs new dispatchers, which a hot
        // update cannot deliver: drop them and reload the page once.
        reloadPage = () => {
          if (reloadTimer) clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => {
            reloadTimer = null;
            // Files that were dispatchers, and files that have just gained a
            // variant and still hold their plain transform.
            const paths = new Set([...dispatched.keys(), ...versionsByFile().keys(), ...covered]);
            for (const graph of graphs()) {
              for (const path of paths) {
                for (const mod of graph.getModulesByFile(path) ?? []) graph.invalidateModule(mod as never);
              }
              const runtime = graph.getModuleById(RESOLVED_LIVE_MODULE);
              if (runtime) graph.invalidateModule(runtime as never);
            }
            covered.clear();
            dispatched.clear();
            server.ws.send({ type: 'full-reload', path: '*' });
          }, 50);
        };

        /**
         * Switch the browser to the set `next` without reloading the page.
         * Every file overridden by a variant that entered or left the set
         * is reported to Vite as if it had just been edited on disk: Vite
         * invalidates it, runs load() again (which now answers with the
         * other content) and sends the same hot update an editor save
         * would, so React Fast Refresh swaps the component in place and the
         * reviewer keeps their scroll, their form state and the open panel.
         * Variants in both sets are untouched, so switching one group leaves
         * the others' components alone. Files the browser has not loaded
         * are skipped; Vite decides on its own when a module cannot be
         * hot-swapped and falls back to a reload for that one, exactly as
         * it would for a hand edit.
         */
        const activate = (next: string[], removedFiles: string[] = []): Promise<void> => {
          const prev = currentActive();
          const changed = [...prev.filter((id) => !next.includes(id)), ...next.filter((id) => !prev.includes(id))];
          if (changed.length === 0 && removedFiles.length === 0) return Promise.resolve();
          activeIds = next;
          overrides.clear();
          // Forward-slash paths throughout: the module graph and the hot
          // update hooks key files that way on every platform.
          const sources = new Set<string>(removedFiles.map((file) => normalizePath(join(vopts.root, file))));
          for (const id of changed) {
            const manifest = readVariant(vopts, id);
            for (const key of Object.keys(manifest?.files ?? {})) {
              sources.add(normalizePath(join(vopts.root, key)));
            }
          }
          const emitted: string[] = [];
          for (const source of sources) {
            const loaded = server.moduleGraph.getModulesByFile(source);
            if (!loaded || loaded.size === 0) continue;
            swapping.set(source, new Set());
            emitted.push(source);
            server.watcher.emit('change', source);
          }
          // Live tabs switch themselves; this tells the ones still on the
          // server's default to follow it, once a reload would render it.
          const settled = serverSawSwap(emitted);
          if (live) void settled.then(() => server.ws.send({ type: 'custom', event: ACTIVE_EVENT, data: { active: next } }));
          return settled;
        };

        /**
         * Resolves once every server environment (an SSR render) has taken
         * the swap of `files`, or after a second. A tab that reloads right
         * after its POST would otherwise be rendered from the old files and
         * fail to hydrate.
         */
        const serverSawSwap = (files: string[]): Promise<void> => {
          const envs = Object.keys(server.environments ?? {}).filter((name) => name !== 'client');
          if (!live || files.length === 0 || envs.length === 0) return Promise.resolve();
          return new Promise<void>((done) => {
            const check = () => {
              const seen = files.every((file) => {
                const by = swapping.get(file);
                return !by || envs.every((env) => by.has(env));
              });
              if (!seen) return;
              finish();
            };
            const timer = setTimeout(() => finish(), 1000);
            const finish = () => {
              clearTimeout(timer);
              swapWaiters.delete(check);
              // The update itself goes out after the hook that marked it.
              setTimeout(done, 30);
            };
            swapWaiters.add(check);
            check();
          });
        };

        // The exclude helpers canonicalize through the filesystem, so the
        // active file's directory has to exist before its pattern can land;
        // the panel's first POST would otherwise leave an untracked file.
        mkdirSync(dirname(activeFile), { recursive: true });
        ensureFileIgnored(activeFile);
        if (variantsOptions.ignored) {
          mkdirSync(vDir, { recursive: true });
          ensureDirIgnored(vDir);
        }

        server.middlewares.use(
          VARIANTS_ENDPOINT,
          variantsEndpoint(() => vopts, activate, allowedHosts),
        );

        // The CLI's `variant use` writes the active file with no request to
        // this server, and an agent edits overrides in place: both have to
        // reach the browser. The active file may not exist yet, so watch its
        // directory; chokidar reports files that appear later.
        server.watcher.add(dirname(activeFile));
        server.watcher.add(vDir);
        server.watcher.on('all', (_event: string, changed: string) => {
          const path = resolve(changed);
          if (path === activeFile) {
            void activate(readActive(vopts));
          } else if (isWithin(vDir, path)) {
            // Covers adds and unlinks, which handleHotUpdate never sees.
            for (const variant of manifests ?? []) {
              for (const key of Object.keys(variant.files)) covered.add(normalizePath(join(vopts.root, key)));
            }
            forgetManifests();
            // A variant deleted by hand leaves its id in the file. Pages are
            // told this set, and a pick posts it back, so it has to go here.
            const stillActive = readActive(vopts);
            const activeChanged = stillActive.join() !== currentActive().join();
            if (activeChanged) void activate(stillActive);
            const now = signature();
            if (now !== listed) {
              listed = now;
              if (live || activeChanged || stillActive.length > 0) reloadPage();
            }
          }
        });
      }

      // The tab's variant store has to exist before the app's modules run,
      // so it rides in the document itself, with the server's current set.
      const liveScript = () => (live ? liveStoreScript(liveConfig()) : null);
      if (options.panel === false) {
        if (!live) return;
        server.middlewares.use((req, res, next) => {
          if (!(req.headers.accept ?? '').includes('text/html')) {
            next();
            return;
          }
          delete req.headers['if-none-match'];
          delete req.headers['if-modified-since'];
          injectHtmlResponse(res, null, liveScript);
          next();
        });
        return;
      }

      // A self-contained bundle keeps the panel out of the host's dependency
      // graph and works in React, Vue, Svelte and plain Vite apps alike.
      server.middlewares.use(BUNDLE_PATH, (_req, res) => {
        res.setHeader('content-type', 'text/javascript; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(readBundle());
      });
      const mountCode = mountModuleSource(options.rule ?? {}, options.key ?? '', variantsOptions !== null, options.shortcut, options.theme);

      server.middlewares.use((req, res, next) => {
        // Only navigations: buffering every response to look for </body>
        // would tax each of the hundreds of module requests a dev page makes.
        if (!(req.headers.accept ?? '').includes('text/html')) {
          next();
          return;
        }
        // Vite's ETag is computed from the document before the mount script
        // is appended, so a conditional request validates against the wrong
        // bytes: a browser holding a copy from before this plugin was added
        // gets 304 and never sees the panel. Ask for the full document.
        delete req.headers['if-none-match'];
        delete req.headers['if-modified-since'];
        injectHtmlResponse(res, mountCode, liveScript);
        next();
      });
    },
  } satisfies Plugin;

  return plugin;
}

/** `ISOTONE_VARIANT=a, b` → `['a', 'b']`; unset or blank → `[]`. */
function parseVariantList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}
