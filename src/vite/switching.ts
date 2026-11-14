/**
 * Switching variants in a running dev server: which modules a file change
 * updates, swapping the active set over HMR, and the watcher that brings CLI
 * changes and override edits to the browser. Live mode's dispatchers (see
 * ./live.ts) are tracked here, since a change to what they hold is a reload.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { normalizePath, type ViteDevServer } from 'vite';

import { ensureDirIgnored, ensureFileIgnored } from '../node/fs/git-exclude';
import { isWithin } from '../node/fs/paths';
import { overrideSourcePath, readVariant } from '../node/variants';
import { ACTIVE_EVENT, BASE_VERSION, RESOLVED_LIVE_MODULE, VERSION_QUERY } from './live';
import { isSingleFileComponent, type Overrides } from './overrides';

const MANIFEST = 'variant.json';

/** The version a module id names (`?isotone=<id>`), or null for any other module. */
function versionOfId(id: string | null): string | null {
  const at = id?.indexOf('?') ?? -1;
  if (!id || at < 0) return null;
  return new URLSearchParams(id.slice(at + 1)).get(VERSION_QUERY);
}

/** Swaps the active set; resolves once the browser and any SSR render have it. */
export type Activate = (next: string[], removedFiles?: string[]) => Promise<void>;

export function createSwitching(overrides: Overrides) {
  // Live mode: decided in configureServer, where the server's environments
  // show which Vite this is.
  let live = false;
  // The versions and export names each dispatcher was written with, by real
  // path. When either changes it needs a new dispatcher, which is a reload.
  const dispatched = new Map<string, string>();
  const planKey = (plan: { versions: (string | null)[]; names: string[] }) => `${plan.versions.join(',')}|${plan.names.join(',')}`;
  // Real source paths activate() is reporting as changed right now. Their
  // hot update must go through, where an ordinary edit of an overridden
  // real file is dropped (see hotModules). Each path keeps the
  // environments that have already seen the swap: Vite 6 and later ask every
  // environment about one change, the browser first and the server after.
  const swapping = new Map<string, Set<string>>();
  const swapWaiters = new Set<() => void>();

  /**
   * A switch of a Vue component, or an edit of its active copy, reloads the
   * page. plugin-vue's own hot update compares its last parse with the real
   * file on disk, which neither changes, so it would update nothing.
   */
  const reloadForComponent = (): [] => {
    reloadPage();
    return [];
  };

  const planChanged = (path: string): boolean => {
    const plan = overrides.dispatchPlan(path);
    return !plan || planKey(plan) !== dispatched.get(path);
  };

  /**
   * Which modules a file change updates in one environment (`null`: Vite 5,
   * which asks once for all of them). `undefined` lets Vite decide.
   */
  const hotModules = <M extends { id: string | null }>(
    changed: string,
    modulesOf: (file: string) => Iterable<M> | undefined,
    env: string | null,
    invalidate: (mod: M) => void,
  ): M[] | undefined => {
    const client = env === null || env === 'client';
    /**
     * The modules of `file` a page imports. A check request
     * (`<file>?isotone=<id>`, outside a dispatcher) leaves a module nothing
     * imports; in an update it would end the walk with a full reload, so it
     * is dropped from the graph instead and compiles afresh on its next
     * request. `checked` says whether there was one.
     */
    const pageModules = (file: string): { page: M[]; checked: boolean } => {
      const all = [...(modulesOf(file) ?? [])];
      const page = all.filter((m) => versionOfId(m.id) === null);
      for (const mod of all) if (versionOfId(mod.id) !== null) invalidate(mod);
      return { page, checked: page.length !== all.length };
    };
    // The module graph keys files by their forward-slash form, which is
    // what `join` produces on POSIX and not on Windows.
    if (isWithin(overrides.dir, changed)) {
      overrides.forgetAnswers();
      const hit = overrideSourcePath(overrides.opts, changed);
      // The manifest, or a file directly in the variants dir: nothing the
      // browser has loaded. The panel re-lists variants when it opens.
      if (!hit || hit.file === MANIFEST) return [];
      const source = normalizePath(join(overrides.opts.root, hit.file));
      // Live: the copy has a module of its own; update just that one.
      if (live && client && dispatched.has(source)) {
        if (planChanged(source)) {
          reloadPage();
          return [];
        }
        return [...(modulesOf(source) ?? [])].filter((m) => versionOfId(m.id) === hit.id);
      }
      // A check of any copy of this file compiles afresh on its next request.
      const { page } = pageModules(source);
      if (!overrides.active().includes(hit.id)) return [];
      // A component no page has loaded has nothing to reload.
      if (client && isSingleFileComponent(source)) return page.length > 0 ? reloadForComponent() : [];
      // The browser holds the real file's URL, so the override's edit has
      // to be delivered as if the real file changed.
      return page;
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
      if (planChanged(path)) {
        reloadPage();
        return [];
      }
      return [...(modulesOf(path) ?? [])].filter((m) => versionOfId(m.id) === BASE_VERSION);
    }
    if (swap && client && isSingleFileComponent(path)) return reloadForComponent();
    const { page, checked } = pageModules(path);
    // Let Vite compute the swap's update as usual.
    if (swap) return checked ? page : undefined;
    // The real source of an overridden file: the browser is showing the
    // override, so there is nothing to update from this edit.
    if (overrides.overridable(changed) && overrides.overrideFor(overrides.active(), changed)) return [];
    return checked ? page : undefined;
  };

  // The dev server, once attached: the swap reports to its watcher and
  // module graphs, and reloads go out over its socket.
  let dev: ViteDevServer | null = null;
  // Files a manifest named before it changed: one that left the variant
  // has no entry to be found by afterwards.
  const covered = new Set<string>();
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  /** Every module graph: a server render holds modules of its own, so a
   *  change to what a variant covers has to reach those too. */
  const graphs = (server: ViteDevServer) =>
    server.environments
      ? Object.values(server.environments).map((env) => env.moduleGraph as unknown as typeof server.moduleGraph)
      : [server.moduleGraph];

  // A dispatcher is written for one set of versions and names. When
  // either changes, the browser needs new dispatchers, which a hot
  // update cannot deliver: drop them and reload the page once.
  const reloadPage = (): void => {
    const server = dev;
    if (!server) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      // Files that were dispatchers, and files that have just gained a
      // variant and still hold their plain transform.
      const paths = new Set([...dispatched.keys(), ...overrides.versionsByFile().keys(), ...covered]);
      for (const graph of graphs(server)) {
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
   * Resolves once every server environment (an SSR render) has taken
   * the swap of `files`, or after a second. A tab that reloads right
   * after its POST would otherwise be rendered from the old files and
   * fail to hydrate.
   */
  const serverSawSwap = (server: ViteDevServer, files: string[]): Promise<void> => {
    const envs = Object.keys(server.environments ?? {}).filter((name) => name !== 'client');
    if (!live || files.length === 0 || envs.length === 0) return Promise.resolve();
    return new Promise<void>((done) => {
      const check = () => {
        const seen = files.every((file) => {
          const by = swapping.get(file);
          return !by || envs.every((env) => by.has(env));
        });
        if (seen) finish();
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
  const activate: Activate = (next, removedFiles = []) => {
    const server = dev;
    const prev = overrides.active();
    const changed = [...prev.filter((id) => !next.includes(id)), ...next.filter((id) => !prev.includes(id))];
    if (!server || (changed.length === 0 && removedFiles.length === 0)) return Promise.resolve();
    overrides.setActive(next);
    const root = overrides.opts.root;
    // Forward-slash paths throughout: the module graph and the hot
    // update hooks key files that way on every platform.
    const sources = new Set<string>(removedFiles.map((file) => normalizePath(join(root, file))));
    for (const id of changed) {
      for (const key of Object.keys(readVariant(overrides.opts, id)?.files ?? {})) {
        sources.add(normalizePath(join(root, key)));
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
    const settled = serverSawSwap(server, emitted);
    if (live) void settled.then(() => server.ws.send({ type: 'custom', event: ACTIVE_EVENT, data: { active: next } }));
    return settled;
  };

  /**
   * Bring changes made without this server to the browser: the CLI's
   * `variant use` writes the active file, and an agent edits overrides in
   * place. The active file may not exist yet, so its directory is watched;
   * chokidar reports files that appear later.
   */
  const watch = (server: ViteDevServer): void => {
    const signature = () => JSON.stringify(overrides.readManifests().map((v) => [v.id, v.group ?? '', Object.keys(v.files).sort()]));
    let listed = signature();
    const activeFile = overrides.activeFile;
    server.watcher.add(dirname(activeFile));
    server.watcher.add(overrides.dir);
    server.watcher.on('all', (_event: string, changed: string) => {
      const path = resolve(changed);
      if (path === activeFile) {
        void activate(overrides.readActive());
      } else if (isWithin(overrides.dir, path)) {
        // Covers adds and unlinks, which hot updates never see.
        for (const variant of overrides.cachedManifests()) {
          for (const key of Object.keys(variant.files)) covered.add(normalizePath(join(overrides.opts.root, key)));
        }
        overrides.forget();
        // A variant deleted by hand leaves its id in the file. Pages are
        // told this set, and a pick posts it back, so it has to go here.
        const stillActive = overrides.readActive();
        const activeChanged = stillActive.join() !== overrides.active().join();
        if (activeChanged) void activate(stillActive);
        const now = signature();
        if (now !== listed) {
          listed = now;
          if (live || activeChanged || stillActive.length > 0) reloadPage();
        }
      }
    });
  };

  /**
   * Wire the dev server: prime the active set, exclude its file from git,
   * and watch for changes. Returns the switch the variants endpoint calls.
   */
  const attach = (server: ViteDevServer, options: { live: boolean; ignored?: boolean }): Activate => {
    // Read the pointer now, before anything can rewrite it: activate()
    // diffs the previous set against the new one, and the endpoint has
    // already written the file by the time it runs, so a lazy first read
    // would see the new set twice and switch nothing.
    overrides.setActive(overrides.readActive());
    live = options.live;
    dev = server;
    // The exclude helpers canonicalize through the filesystem, so the
    // active file's directory has to exist before its pattern can land;
    // the panel's first POST would otherwise leave an untracked file.
    mkdirSync(dirname(overrides.activeFile), { recursive: true });
    ensureFileIgnored(overrides.activeFile);
    if (options.ignored) {
      mkdirSync(overrides.dir, { recursive: true });
      ensureDirIgnored(overrides.dir);
    }
    watch(server);
    return activate;
  };

  return {
    get live(): boolean {
      return live;
    },
    /** Record that `path` is served as the dispatcher `plan` describes. */
    dispatching(path: string, plan: { versions: (string | null)[]; names: string[] }): void {
      dispatched.set(path, planKey(plan));
    },
    hotModules,
    attach,
  };
}
