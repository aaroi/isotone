/**
 * Collected feedback: the record a deployed app's panel sends to the host's
 * own endpoint, and that `isotone/feedback` hands to the host's `save`.
 *
 * Unlike a development note it is written once and never read back through
 * Isotone: no agent closes it, and the host decides what happens to it.
 */
import type { IsotoneElement, VariantReference } from './types';

/** Longest name a reviewer signs feedback with. */
export const MAX_AUTHOR = 100;

/** Longest release label a host attaches. */
export const MAX_RELEASE = 200;

/** Largest request body the feedback route reads, in bytes: several times a
 *  note with fifty pinned elements, and small enough that parsing one is cheap. */
export const MAX_FEEDBACK_BODY = 262_144;

/** Most selectors whose current choice a record carries. */
export const MAX_SELECTIONS = 200;

/** What the reviewer's browser was like. Every field is optional: a browser
 *  may not report one, and the server drops any that is malformed. */
export interface FeedbackBrowser {
  /** The `User-Agent` header of the request, read by the server. */
  userAgent?: string;
  /** The browser's preferred language, e.g. "fi-FI". */
  language?: string;
  /** IANA time zone, e.g. "Europe/Helsinki". */
  timezone?: string;
  /** The screen, in CSS pixels. */
  screen?: { w: number; h: number };
  /** Device pixels per CSS pixel. */
  pixelRatio?: number;
  /** The operating system's light or dark preference. */
  colorScheme?: 'light' | 'dark';
  /** Whether the primary pointer is a finger. */
  touch?: boolean;
}

/** One piece of collected feedback, validated and bounded by the handler. */
export interface FeedbackEntry {
  /** Chosen by the browser, so a retried request saves once. */
  id: string;
  /**
   * SHA-256, in hex, of the secret the writer's browser keeps for this note.
   * Only a request carrying that secret may replace or remove the record, so
   * a store compares this before it changes one. The secret itself is never
   * stored.
   */
  keyHash: string;
  /** When it was written, never later than the server's clock. */
  createdAt: string;
  /** The name in the panel's name field. Typed by the reviewer, so not proof
   *  of who they are; see `identity`. */
  author: string;
  /** Who the host's `identify` says sent the request, when it is set. */
  identity?: string;
  feedback: string;
  /** The page's pathname, e.g. "/projects". */
  route: string;
  /** The page's full address, without its hash. */
  url?: string;
  /** The elements the reviewer pinned, in order. */
  elements: IsotoneElement[];
  /** The selector or option the feedback is about. */
  variant?: VariantReference;
  /** What every selector on the page was set to, by axis id. */
  selections?: Record<string, string>;
  /** The window, in CSS pixels. */
  viewport?: { w: number; h: number };
  browser: FeedbackBrowser;
  /** The host's label for the build, such as a commit or version. */
  release?: string;
  /** Whatever the host's `getPayload` returned, verbatim. */
  payload?: unknown;
}

/** How the panel reaches the host's feedback endpoint. */
export interface FeedbackClientConfig {
  /** Same-origin URL of the route that runs `feedback()` from `isotone/feedback`. */
  endpoint: string;
  /** The reviewer's name when the app knows it. The name field starts with
   *  it; the reviewer can still change it. */
  name?: string;
  /** A label for this build, such as a commit or version, saved with each record. */
  release?: string;
}
