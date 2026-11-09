/**
 * The note model, and the configuration types shared by the panel and the
 * servers. They live in core so the Vite plugin and `isotone/serve` can
 * describe notes and the panel's options without importing React.
 */
import type { ExperimentFlags } from './experiments';
import type { RouteGateOptions } from './routes';
import type { StyleEdit } from './style-edits';
import type { UpdateRequest } from './update';
import type { VariantsSource } from './variants';

/** A UI element picked with the panel's selector mode. */
export interface IsotoneElement {
  /** Lowercase tag name, e.g. "button". */
  tag: string;
  /** Trimmed text-content snippet (may be empty for visual elements). */
  text: string;
  /** CSS path to the element. A pin made in a browser matches only this element. */
  selector: string;
  /** Identifying attributes: role, name, aria-label, data-*, class and so on. */
  attributes?: Record<string, string>;
  /** React components around the element, outermost first. */
  component?: string[];
  /** `file:line` of the JSX, where the host's React still records it. */
  source?: string;
  /** Labelled or headed ancestors, outermost first. */
  within?: string[];
  /** The closest ancestor's text, for an element with none of its own. */
  near?: string;
  /** Where it sat on the page when pinned, in CSS pixels from the document's corner. */
  rect?: { x: number; y: number; w: number; h: number };
  /** How it looked when pinned: the computed styles that differ from a plain
   *  box (spacing, type, colours as hex, layout), so "bigger" has a "from". */
  styles?: Record<string, string>;
}

/** A durable reference to a selector or one of its options, not a DOM path. */
export interface VariantReference {
  axisId: string;
  label: string;
  optionId?: string;
  optionLabel?: string;
  value?: string;
}

export interface VariantRemoval {
  axisId: string;
  action: 'remove-option' | 'remove-axis' | 'keep-default' | 'keep-option';
  optionId?: string;
}

/** Trouble on the page in the minutes before a note was written. */
export interface NoteDiagnostics {
  /** Uncaught errors and unhandled rejections, oldest first. */
  errors?: { message: string; source?: string; at: string; count?: number }[];
  /** Requests that failed: a 4xx or 5xx answer, or an element that did not load. Paths only, no query. */
  requests?: { url: string; status?: number; at: string; count?: number }[];
}

export interface NoteContext {
  /** What the reviewer changed with the style editor, per pinned element:
   *  exact property values to make in the source. */
  styleEdits?: StyleEdit[];
  /** Recorded by the panel when the note was first sent; never edited. */
  diagnostics?: NoteDiagnostics;
  /** Pending instruction: deleting its note cancels it before the agent acts. */
  variantAction?: VariantRemoval;
  elements?: IsotoneElement[];
  variant?: VariantReference | null;
  /** The user's request to upgrade Isotone, built by the local server from
   *  its own update check. At most one is open at a time. */
  update?: UpdateRequest;
  /** The agent's question or remark about the note, written with
   *  `isotone --reply <id> "<text>"`. Only the CLI writes it; the panel shows it
   *  under the note, and the reviewer answers by editing the note. */
  reply?: NoteReply;
  /** Written by `isotone --done`: when, and with `-m "<text>"` what the agent
   *  said it changed. Only the CLI writes it; the panel shows the closed note
   *  for checking only when it is there. */
  resolution?: NoteResolution;
  /** When the reviewer looked at the closed note and said it looks good. The
   *  panel stops showing it. */
  checkedAt?: string;
  /** The reviewer reopened the closed note: when, what the agent had said
   *  when closing it, and whether they sent the note back without changing
   *  it, so the agent knows its fix fell short. */
  reopened?: { at: string; summary?: string; unchanged?: true };
}

export interface NoteResolution {
  summary?: string;
  at: string;
}

export interface NoteReply {
  text: string;
  at: string;
  /** A fingerprint of the note as it was when the agent asked. Until the
   *  reviewer edits the note, Blast does not hand it out again. */
  about?: string;
  /** Set when the note has changed since the agent asked: the reviewer's
   *  edit answered the question, so it is no longer pending. */
  answered?: boolean;
}

/** A note written in the panel, read and answered by the coding agent. */
export interface IsotoneNote extends NoteContext {
  id: string;
  /** The route the note was written on, e.g. "/projects". */
  route: string;
  feedback: string;
  element: IsotoneElement | null;
  done: boolean;
  doneAt?: string | null;
  /** When an agent said it started on this note (`isotone --working <id>`).
   *  Cleared when the note is closed or reopened; stale after a while. */
  workingAt?: string | null;
  createdAt: string;
  /** The window size the note was written at. Feedback about layout only
   *  means something at the breakpoint it was seen on, so the agent reads
   *  this next to the selector. Captured on create, kept on edit. */
  viewport?: { w: number; h: number };
  /** Host-specific context, stored and returned verbatim and never
   *  interpreted. A host with state that gives a note its meaning — the
   *  knob settings a design note was written against, a feature-flag set, the
   *  selected tenant — nests it under this key so the note survives a
   *  round-trip through a store that knows nothing about it. Capped at
   *  `PAYLOAD_MAX` serialized bytes. */
  payload?: unknown;
}

export interface IsotoneStoreConfig {
  /** Absolute or same-origin URL of the notes endpoint. Must be set (by the
   *  Vite plugin's `isotone()` options or a framework preset) for a shared
   *  file-backed store; when omitted, only localStorage persists. */
  endpoint?: string | null;
  /** localStorage namespace. Default-scoped to the package; set it per hosted
   *  app when two apps share an origin. */
  key?: string;
}

/** Auto follows the page at the dock; system follows the OS preference. */
export type IsotoneTheme = 'auto' | 'light' | 'dark' | 'system';

export interface IsotoneShortcut {
  /** Physical key code, stable across keyboard layouts. Default: Period. */
  code: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface MountIsotoneOptions {
  /** Auto follows the page at the dock. System follows the OS preference. */
  theme?: IsotoneTheme;
  /** Local adapter endpoint for automatic update notices. */
  updateEndpoint?: string;
  /** Defaults to Cmd/Ctrl+Shift+Period. false disables keyboard access. */
  shortcut?: IsotoneShortcut | false;
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
   *  IsotonePanelProps.getPayload. */
  getPayload?: () => unknown;
  /** Experiments to turn on: features that are off by default and may change
   *  or go away in any release. `isotone experiment` lists them. */
  experimental?: ExperimentFlags;
}
