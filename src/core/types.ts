/**
 * Configuration types shared by the panel and the server-side adapters.
 *
 * They live in core so the Vite plugin, `isotone/serve` and `isotone/server`
 * can describe the panel's options without importing React.
 */
import type { RouteGateOptions } from './index';
import type { VariantsSource } from './variants';

/** Auto follows the page at the dock; system follows the OS preference. */
export type IterationTheme = 'auto' | 'light' | 'dark' | 'system';

export interface IterationShortcut {
  /** Physical key code, stable across keyboard layouts. Default: Period. */
  code: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface MountIterationOptions {
  /** Auto follows the page at the dock. System follows the OS preference. */
  theme?: IterationTheme;
  /** Local adapter endpoint for automatic update notices. */
  updateEndpoint?: string;
  /** Defaults to Cmd/Ctrl+Shift+Period. false disables keyboard access. */
  shortcut?: IterationShortcut | false;
  /** The notes endpoint the dev plugin serves (or a framework preset). Omit
   *  it and the panel has no Notes tab: a production host that only wants
   *  variants passes a source and nothing else. */
  endpoint?: string;
  /**
   * Variants for the panel. A `VariantsSource` is rendered as-is; `'overlay'`
   * builds the overlay adapter against the Vite plugin's same-origin
   * endpoint. `'knobs'` is the same adapter for a server that has knobs but no
   * file variants (`isotone serve`), and its empty list says so. With neither
   * this nor `endpoint`, nothing mounts.
   */
  variants?: VariantsSource | 'overlay' | 'knobs';
  /** Where `'overlay'` reads variants and knobs. Defaults to the Vite plugin's
   *  same-origin endpoint; `isotone serve` passes its own absolute URL. */
  variantsEndpoint?: string;
  /** Which tab a tabbed panel opens on until the reviewer picks one. */
  defaultTab?: 'variants' | 'notes';
  /** Optional localStorage namespace for multi-app origins. */
  key?: string;
  /** Route visibility rule; default hides auth/error pages. */
  rule?: RouteGateOptions;
  /** Override the auto-detected pathname (sub-apps). Default: pathname. */
  getRoute?: () => string;
  /** Host context attached to each new note as its opaque payload — see
   *  IterationPanelProps.getPayload. */
  getPayload?: () => unknown;
}
