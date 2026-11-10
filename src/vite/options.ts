/** The Vite plugin's options and the structural plugin type it returns. */
import type { ExperimentFlags } from '../core/experiments';
import type { RouteGateOptions } from '../core/routes';
import type { IsotoneShortcut, IsotoneTheme } from '../core/types';

export interface IsotoneViteOptions {
  /** Inject the bundled panel. false keeps endpoints and variants for a manual mount. */
  panel?: boolean;
  /** Background npm notice, at most once a day. false disables the check;
   *  'note' also files an update note for your agent once per new version. */
  checkForUpdates?: boolean | 'note';
  /** Defaults to auto (page background); system follows the OS preference. */
  theme?: IsotoneTheme;
  /** Defaults to Cmd/Ctrl+Shift+Period; customize or disable with false. */
  shortcut?: IsotoneShortcut | false;
  /** The key held to compare picks with the defaults. Defaults to Backquote; false disables it. */
  compareShortcut?: IsotoneShortcut | false;
  /** Where notes persist. Relative paths resolve against Vite's `root` (the
   *  directory of the app, whatever the shell's cwd), so a monorepo package
   *  started from the workspace root still writes next to its own config.
   *  Defaults to `.isotone/notes.json`, where a `.iteration-feedback.json`
   *  from before 1.3 is moved on the first dev server start; git-ignored
   *  automatically via `.git/info/exclude`, with the pattern anchored at the
   *  repository root. */
  file?: string;
  /** Route visibility rule (denylist/allowlist) for the injected panel. */
  rule?: RouteGateOptions;
  /** localStorage namespace override. */
  key?: string;
  /** Experiments to turn on: features that are off by default and may change
   *  or go away in any release. `.isotone/experiments.json`, which
   *  `isotone experiment on <id>` writes, wins over this. */
  experimental?: ExperimentFlags;
  /**
   * Overlay variants: alternative source files under `.isotone/variants/
   * <id>/<repo-relative path>` that `load` swaps in for the real ones while
   * the variant is active. On by default; `false` turns the whole feature
   * off (no endpoint, no watcher, no tab in the panel).
   */
  variants?:
    | false
    | {
        /** The project the manifests' file paths are relative to. Defaults to
         *  Vite's root. A sibling dev server that aliases into another package
         *  (a preview app rendering another package's source) points this at that
         *  package so the same variants apply to both. Relative to Vite's root
         *  or absolute. */
        root?: string;
        /** Where the variants live, relative to `root`. Default
         *  `.isotone/variants`. */
        dir?: string;
        /** Keep the variants dir out of git via `.git/info/exclude`. Off by
         *  default: the files are the reviewable artefact and commit with
         *  the change they propose. */
        ignored?: boolean;
        /**
         * Switch variants in the browser instead of recompiling files. Every
         * version of an overridden script is loaded once, components switch
         * by re-rendering, and the selection is kept in the tab's `?v=`.
         * On by default in a React project on Vite 6 or later; `false` swaps
         * whole files over HMR as before.
         */
        live?: boolean;
      };
}

/**
 * What `isotone()` hands back.
 *
 * Only `name` is public, and that is deliberate. isotone is consumed as a
 * linked (`file:` / workspace) dependency, so TypeScript resolves the `vite`
 * import from *this* package's `node_modules`, not the consumer's. Two vite
 * type instances are nominally incompatible — rollup's plugin container
 * carries a private `_pluginContextMap` — and a single unassignable entry
 * poisons the overload resolution for the consumer's whole `plugins: []`
 * array, so every other plugin in it errors too. Vite's own `Plugin` requires
 * nothing but `name`, so a structural shape drops into any vite version's
 * `PluginOption` while the hooks below stay checked against the real vite
 * types inside this file.
 */
export interface IsotonePlugin {
  name: string;
  /**
   * Declared with the loosest shape that still drops into vite's own
   * signature: a method, so its parameter is bivariant and vite's
   * `HmrContext` satisfies it, returning `void`, which any real return type
   * satisfies. The implementation returns vite's `ModuleNode[]`; naming that
   * type here would bring the nominal vite instance back.
   */
  handleHotUpdate?(ctx: { file: string }): void;
}
