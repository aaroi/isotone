/**
 * Development-only notes, source variants and a self-contained panel for Vite.
 * Inject through the HTML response so SSR frameworks work too. The loader lives
 * in <head> and mounts after load, leaving the host's hydration and HMR alone.
 *
 * The plugin composes: ./overrides (what the variants store answers for a
 * path), ./switching (swapping the active set and the watcher), ./middleware
 * (the endpoints), and ./html-inject (the panel in each page).
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';

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
  type ViteDevServer,
} from 'vite';

import { VARIANTS_ENDPOINT } from '../core/variants';
import { blastFile } from '../node/blast';
import { defaultNotesFile, LEGACY_NOTES_FILE, NOTES_FILE } from '../node/notes/location';
import { ensureFileIgnored } from '../node/fs/git-exclude';
import { NOTES_ENDPOINT } from '../node/notes/handler';
import { startUpdateCheck, UPDATE_ENDPOINT } from '../node/update/check';
import { autoUpdateNote } from '../node/update/note';
import { listVariants } from '../node/variants';
import { isLoopback } from '../node/http';
import { mountModuleSource, servePanel } from './html-inject';
import {
  BASE_VERSION,
  dispatcherModule,
  LIVE_MODULE,
  liveRuntimeModule,
  liveStoreScript,
  RESOLVED_LIVE_MODULE,
  VERSION_QUERY,
} from './live';
import { type Gate, notesEndpoint, updateEndpoint, variantsEndpoint } from './middleware';
import type { IsotonePlugin, IsotoneViteOptions } from './options';
import { createOverrides } from './overrides';
import { createSwitching } from './switching';

export type { IsotonePlugin, IsotoneViteOptions } from './options';

/** Vite's own `server.fs.deny`, which a plugin that sets the option replaces
 *  unless it repeats it. */
const VITE_DENY = ['.env', '.env.*', '*.{crt,pem}', '**/.git/**'];

/**
 * Import queries that hand the file to one of vite's own loaders (assets,
 * workers, inline HTML scripts). Those read the file from disk themselves
 * and shape the module around it; a `pre` load returning the override's
 * text in their place would break the module, so such requests are left to
 * them and show the real file.
 */
const SPECIAL_QUERY = /[?&](raw|url|inline|no-inline|worker|sharedworker|html-proxy)(?:[&=]|$)/;

/** Say where the notes go after Vite's own banner, so it is not buried under
 *  it. Portable setups fail quietly otherwise: a reviewer writes notes and the
 *  agent looks in the wrong place. */
function announce(server: ViteDevServer, file: string, variantsDir: string | null, count: () => number): void {
  server.httpServer?.once('listening', () => {
    const { logger, root, server: config } = server.config;
    logger.info(`  isotone  notes → ${relative(root, file) || file}  (${NOTES_ENDPOINT})`);
    if (variantsDir && existsSync(variantsDir)) {
      const n = count();
      logger.info(`  isotone  variants → ${relative(root, variantsDir) || variantsDir}  (${n} variant${n === 1 ? '' : 's'})`);
    }
    const host = config?.host;
    if (host === true || (typeof host === 'string' && !isLoopback(host))) {
      logger.info('  isotone  the panel answers only this machine; other devices get the app alone');
    }
  });
}

export function isotone(options: IsotoneViteOptions = {}): IsotonePlugin {
  let file = resolve(options.file ?? NOTES_FILE);
  let isDev = false;
  let hasReact = false;
  let ssrHost = false;
  const variantsOptions = options.variants === false ? null : (options.variants ?? {});
  const overrides = createOverrides(variantsOptions ?? {});
  const switching = createSwitching(overrides);

  // `satisfies`, not an annotation: the hooks are checked against vite's
  // types, but the object keeps its own shape, so `handleHotUpdate` stays a
  // plain method and drops into the structural type below.
  const plugin = {
    name: 'isotone',
    enforce: 'pre',
    // Isotone's own files are read through its endpoints, never as static
    // files: keep Vite's file server from handing them out.
    config(config: { server?: { fs?: { deny?: string[] } } }) {
      // The default notes file and its Blast session are under `.isotone/`.
      const notes = options.file === undefined ? LEGACY_NOTES_FILE : basename(options.file);
      const own = [`**/${notes}`, `**/${basename(blastFile(notes))}`, '**/.isotone/**'];
      // Vite concatenates a plugin's array with the user's.
      return { server: { fs: { deny: config.server?.fs?.deny ? own : [...VITE_DENY, ...own] } } };
    },
    configResolved(config: ResolvedConfig) {
      isDev = config.command === 'serve';
      file = resolve(config.root, options.file ?? NOTES_FILE);
      overrides.configure(config);
      hasReact = (config.plugins ?? []).some((p) => /react/i.test(p.name));
      ssrHost = config.appType !== 'spa' && config.appType !== 'mpa';
    },
    async resolveId(source: string, importer: string | undefined, opts: { ssr?: boolean; isEntry?: boolean } = {}) {
      if (!variantsOptions) return null;
      if (source === LIVE_MODULE) return RESOLVED_LIVE_MODULE;
      if (!importer) return null;
      // A dispatcher's own imports, `./file.tsx?isotone=<id>`: resolved here
      // so a version of a file only variants have still has an id.
      const marker = source.indexOf(`?${VERSION_QUERY}=`);
      if (switching.live && marker > 0 && source.startsWith('./')) {
        const dir = dirname(importer.replace(/[?#].*$/, ''));
        return normalizePath(resolve(dir, source.slice(0, marker))) + source.slice(marker);
      }
      // A file a variant adds, imported by variant code. Vite's resolver
      // cannot find it on disk, so answer with the path the variant gives it.
      return overrides.addedFile(source, importer, () => this.resolve(source, importer, { ...opts, skipSelf: true }));
    },
    load(id: string, opts?: { ssr?: boolean }) {
      if (!variantsOptions || SPECIAL_QUERY.test(id)) return null;
      if (id === RESOLVED_LIVE_MODULE) return { code: liveRuntimeModule(overrides.liveConfig(ssrHost)), map: null };
      // `?v=<hash>`, `?t=<timestamp>`, `?import`: vite's own request
      // decorations, never part of the path on disk.
      const path = id.replace(/[?#].*$/, '');
      if (!overrides.overridable(path)) return null;
      const query = id.slice(path.length).replace(/^\?/, '').replace(/#.*$/, '');
      const version = switching.live ? new URLSearchParams(query).get(VERSION_QUERY) : null;
      // Only a file some variant tracks has versions. Any other path is left
      // to Vite, whose `server.fs.deny` keeps `.env` and `.git/` out of reach;
      // answering it here would read the file around that check.
      if (version !== null && overrides.versionsByFile().has(path)) {
        const from = version === BASE_VERSION ? (existsSync(path) ? path : null) : overrides.copyOf(version, path);
        return { code: from ? readFileSync(from, 'utf8') : 'export {};\n', map: null };
      }
      // The browser gets a dispatcher; a server render keeps the whole-file
      // swap, since the server cannot know which tab it renders for.
      if (switching.live && !opts?.ssr && query === '') {
        const plan = overrides.dispatchPlan(path);
        if (plan) {
          switching.dispatching(path, plan);
          const name = path.slice(path.lastIndexOf('/') + 1);
          return { code: dispatcherModule(plan.key, name, plan.versions, plan.names), map: null };
        }
      }
      const override = overrides.overrideFor(overrides.active(), path);
      return override ? { code: readFileSync(override, 'utf8'), map: null } : null;
    },
    // Vite 6 and later call this once per environment and skip
    // handleHotUpdate; Vite 5 only knows handleHotUpdate.
    hotUpdate(this: { environment: DevEnvironment }, ctx: HotUpdateOptions): EnvironmentModuleNode[] | undefined {
      if (!variantsOptions) return undefined;
      const env = this.environment;
      return switching.hotModules(ctx.file, (f) => env.moduleGraph.getModulesByFile(f), env.name);
    },
    handleHotUpdate(ctx: HmrContext) {
      if (!variantsOptions) return undefined;
      const { server } = ctx;
      return switching.hotModules(ctx.file, (f) => server.moduleGraph.getModulesByFile(f), null) as HmrContext['modules'] | undefined;
    },
    configureServer(server) {
      if (!isDev) return;
      // Here, not at construction: a production build should not touch .git
      // or move the notes.
      if (options.file === undefined)
        file = defaultNotesFile(server.config.root, (line) => server.config.logger.info(`  isotone  ${line}`));
      ensureFileIgnored(file);
      const allowedHosts: Gate = () => {
        const hosts = server.config.server?.allowedHosts;
        return Array.isArray(hosts) ? hosts : [];
      };
      announce(server, file, variantsOptions ? overrides.dir : null, () => listVariants(overrides.opts).length);

      const updates = startUpdateCheck(server.config.root, options.checkForUpdates !== false);
      server.httpServer?.once('close', updates.dispose);
      if (options.checkForUpdates === 'note') {
        void updates.ready.then(() => autoUpdateNote(file, updates.getSnapshot())).catch(() => {});
      }
      server.middlewares.use(
        UPDATE_ENDPOINT,
        updateEndpoint(() => file, updates, allowedHosts),
      );
      server.middlewares.use(
        NOTES_ENDPOINT,
        notesEndpoint(() => file, allowedHosts),
      );

      if (variantsOptions) {
        // Live switching needs the host's React for the wrappers and Vite 6's
        // per-environment hot updates, so the server render keeps its swap
        // while the browser's dispatchers are left alone.
        const live = (variantsOptions.live ?? hasReact) && server.environments !== undefined;
        const activate = switching.attach(server, { live, ignored: variantsOptions.ignored });
        server.middlewares.use(
          VARIANTS_ENDPOINT,
          variantsEndpoint(() => overrides.opts, activate, allowedHosts),
        );
      }

      // The tab's variant store has to exist before the app's modules run,
      // so it rides in the document itself, with the server's current set.
      const liveScript = switching.live ? () => liveStoreScript(overrides.liveConfig(ssrHost)) : null;
      const mount =
        options.panel === false
          ? null
          : mountModuleSource(options.rule ?? {}, options.key ?? '', variantsOptions !== null, options.shortcut, options.theme);
      servePanel(server.middlewares.use.bind(server.middlewares) as never, mount, liveScript);
    },
  } satisfies Plugin;

  return plugin;
}

/**
 * @deprecated Renamed to {@link isotone}; this alias goes in a later minor release.
 * @alias
 */
export const iteration: typeof isotone = isotone;
