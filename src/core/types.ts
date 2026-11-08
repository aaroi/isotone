/**
 * The note model, and the configuration types shared by the panel and the
 * servers. They live in core so the Vite plugin and `isotone/serve` can
 * describe notes and the panel's options without importing React.
 */
import type { RouteGateOptions } from './routes';
import type { UpdateRequest } from './update';
import type { VariantsSource } from './variants';

/** A UI element picked with the panel's selector mode. */
export interface IterationElement {
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

export interface NoteContext {
  /** Pending instruction: deleting its note cancels it before the agent acts. */
  variantAction?: VariantRemoval;
  elements?: IterationElement[];
  variant?: VariantReference | null;
  /** The user's request to upgrade Isotone, built by the local server from
   *  its own update check. At most one is open at a time. */
  update?: UpdateRequest;
  /** The agent's question or remark about the note, written with
   *  `isotone --reply <id> "<text>"`. Only the CLI writes it; the panel shows it
   *  under the note, and the reviewer answers by editing the note. */
  reply?: NoteReply;
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
export interface IterationNote extends NoteContext {
  id: string;
  /** The route the note was written on, e.g. "/projects". */
  route: string;
  feedback: string;
  element: IterationElement | null;
  done: boolean;
  doneAt?: string | null;
  /** Set while an agent says it is working on the note. Stale after a while. */
  workingAt?: string | null;
  createdAt: string;
  /** The window size the note was written at — layout feedback only means
   *  something at the breakpoint it was seen on. */
  viewport?: { w: number; h: number };
  /** Host-specific context the store round-trips without interpreting — see
   *  `StoredNote.payload`. */
  payload?: unknown;
}

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
