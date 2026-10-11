/**
 * File-backed store for iteration notes — shared by the Vite plugin (dev
 * server) and the CLI. Notes live in a gitignored JSON file on disk, no
 * database. The path comes from the plugin/CLI options.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { IterationElement, NoteContext, VariantReference, VariantRemoval } from './core/index';
import { withFileLock, writeJson } from './file-store';

export interface StoredNote extends NoteContext {
  id: string;
  route: string;
  feedback: string;
  element: IterationElement | null;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  /** The window size the note was written at. Feedback about layout only
   *  means something at the breakpoint it was seen on, so the agent reads
   *  this next to the selector. Captured on create, kept on edit. */
  viewport?: { w: number; h: number };
  /** Host-specific context, stored and returned verbatim and never
   *  interpreted here. A host with state that gives a note its meaning — the
   *  knob settings a design note was written against, a feature-flag set, the
   *  selected tenant — nests it under this key so the note survives a
   *  round-trip through a store that knows nothing about it. Capped at
   *  {@link PAYLOAD_MAX} serialized bytes. */
  payload?: unknown;
}

/** Serialized-size ceiling for a note's opaque `payload`, in bytes. Generous
 *  next to normal review context and small
 *  enough that a runaway host is rejected rather than bloating the file. */
export const PAYLOAD_MAX = 65_536;

export function readNotes(file: string): StoredNote[] {
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || !data.every((note) => note && typeof note === 'object' &&
      typeof note.id === 'string' && typeof note.route === 'string' &&
      typeof note.feedback === 'string' && typeof note.createdAt === 'string')) {
      throw new Error('expected an array of notes');
    }
    return data as StoredNote[];
  } catch (cause) {
    throw new Error(`Could not read notes from ${file}; the file has been left untouched.`, { cause });
  }
}

export function writeNotes(file: string, notes: StoredNote[]): void {
  // A `file` option can point into a directory that does not exist yet
  // (`notes/here.json`); the first note creates it.
  writeJson(file, notes);
}

export function updateNotes(file: string, update: (notes: StoredNote[]) => StoredNote[]): void {
  withFileLock(file, () => writeNotes(file, update(readNotes(file))));
}

/**
 * Ensure the feedback file path is ignored by git via the repo-local
 * `.git/info/exclude` (never committed), so a consumer needs no `.gitignore`
 * edit. Idempotent and non-destructive; never fails the dev server.
 */
export function ensureFileIgnored(file: string): void {
  try {
    // Resolve through symlinks so the path is comparable with git's answer,
    // which is already canonical (macOS's /var → /private/var, for one).
    // The file itself may not exist yet, so canonicalize its directory.
    const dir = realpathSync(dirname(resolve(file)));
    const absolute = join(dir, basename(file));
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf8',
      // Outside a repo git writes "fatal: not a git repository" to stderr, and
      // inheriting it prints that over the server's own startup banner. The
      // throw is the signal we act on; the message is noise.
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const pattern = excludePattern(gitRoot, absolute);
    if (!pattern) return;
    const infoExclude = excludeFile(dir);
    const existing = existsSync(infoExclude) ? readFileSync(infoExclude, 'utf8') : '';
    if (hasExcludePattern(existing, pattern)) return;
    const marker = existing && !existing.endsWith('\n') ? '\n' : '';
    // One comment header per exclude file, however many patterns land under it.
    const heading = '# isotone (local dev feedback loop)';
    const comment = existing.includes(heading) ? '' : `${heading}\n`;
    mkdirSync(dirname(infoExclude), { recursive: true });
    writeFileSync(infoExclude, `${existing}${marker}${comment}${pattern}\n`);
  } catch {
    // A stray dev-only feedback file is non-fatal if we can't ignore it.
  }
}

/**
 * Like {@link ensureFileIgnored}, for a directory: the pattern gets a trailing
 * slash so it matches the tree, not a file of the same name. Used for the
 * overlay variants directory when a host opts out of committing it.
 */
export function ensureDirIgnored(dir: string): void {
  try {
    const absolute = realpathSync(resolve(dir));
    const gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: absolute,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const base = excludePattern(gitRoot, absolute);
    if (!base) return;
    const pattern = `${base}/`;
    const infoExclude = excludeFile(absolute);
    const existing = existsSync(infoExclude) ? readFileSync(infoExclude, 'utf8') : '';
    if (hasExcludePattern(existing, pattern) || hasExcludePattern(existing, base)) return;
    const marker = existing && !existing.endsWith('\n') ? '\n' : '';
    mkdirSync(dirname(infoExclude), { recursive: true });
    writeFileSync(
      infoExclude,
      `${existing}${marker}# isotone (local overlay variants)\n${pattern}\n`,
    );
  } catch {
    // Non-fatal, as above.
  }
}

/**
 * Where git reads the repo-local exclude file from, asked from `cwd`. Not
 * `<toplevel>/.git/info/exclude`: in a worktree `.git` is a file pointing at
 * the shared repository, and the exclude file lives in that common dir. Git
 * answers relative to the cwd when the file is under it, so resolve.
 */
function excludeFile(cwd: string): string {
  const reported = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  return resolve(cwd, reported);
}

/**
 * The gitignore pattern that matches exactly `absolute` from `gitRoot`: its
 * path relative to the root with a leading slash, since a leading slash
 * anchors a pattern to the root of the repository. An absolute filesystem
 * path is read the same way and so matches nothing when the dev server runs
 * in a subdirectory of the checkout. Null when the file is outside the repo,
 * where no exclude entry could cover it.
 */
export function excludePattern(gitRoot: string, absolute: string): string | null {
  const rel = relative(gitRoot, absolute);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return null;
  }
  return `/${rel.split(sep).join('/')}`;
}

/** Whether `exclude` already carries `pattern`, with or without the anchor.
 *  A hand-written bare `app/console/x.json` covers the file too (a pattern
 *  with a slash inside it is root-relative either way), so it counts. */
export function hasExcludePattern(exclude: string, pattern: string): boolean {
  const bare = pattern.replace(/^\//, '');
  return exclude
    .split(/\r?\n/)
    .some((line) => line.trim() === pattern || line.trim() === bare);
}

function toItem(n: StoredNote) {
  const item: {
    id: string;
    route: string;
    feedback: string;
    element: IterationElement | null;
    done: boolean;
    createdAt: string;
    viewport?: { w: number; h: number };
    payload?: unknown;
  } = {
    id: n.id,
    route: n.route,
    feedback: n.feedback,
    element: n.element,
    done: n.done,
    createdAt: n.createdAt,
  };
  // Absent stays absent: a host that never sends a payload should not start
  // seeing a null one appear in its notes.
  if (n.viewport !== undefined) item.viewport = n.viewport;
  if (n.payload !== undefined) item.payload = n.payload;
  return { ...item, ...(n.elements !== undefined ? { elements: n.elements } : {}),
    ...(n.variant !== undefined ? { variant: n.variant } : {}),
    ...(n.variantAction !== undefined ? { variantAction: n.variantAction } : {}) };
}

/** The transport-agnostic result of a notes request — any runtime (Vite
 *  middleware, Next route handler, Bun serve, Vercel) can render it. */
export interface NotesResponse {
  status: number;
  /** Response headers object (frameworks set them on their own res). */
  headers: Record<string, string>;
  /** The JSON payload to send. */
  body: unknown;
}

/** A request the pure handler understands (framework-neutral). */
export interface NotesRequest {
  method?: string;
  url?: string;
  body?: unknown;
}

/**
 * The transport-agnostic core of the notes endpoint. Reads/writes the local
 * file and returns a `{ status, headers, body }` the caller renders. Works
 * under Vite middleware, Next route handler, Bun.serve, or Vercel.
 */
export function notesResponse(file: string, req: NotesRequest): NotesResponse {
  if (req.method === 'POST' || req.method === 'DELETE') {
    return withFileLock(file, () => handleNotesRequest(file, req));
  }
  return handleNotesRequest(file, req);
}

function handleNotesRequest(file: string, req: NotesRequest): NotesResponse {
  const method = req.method ?? '';
  const query = Object.fromEntries(
    new URL(req.url ?? '/', 'http://localhost').searchParams,
  );
  const json = (status: number, body: unknown): NotesResponse => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body,
  });

  if (method === 'GET') {
    const route = String(query.route ?? '');
    const all = query.all !== undefined && String(query.all) !== '' && String(query.all) !== '0';
    const notes = readNotes(file);
    // `?all=1` is the panel's list: every note on every route, done ones
    // included, so feedback accumulates in one place whatever page is open.
    // `?route=` scopes to a page; neither means the agent's pending backlog.
    const rows = (
      all
        ? notes
        : route
          ? notes.filter((n) => n.route === route)
          : notes.filter((n) => !n.done)
    )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toItem);
    return json(200, rows);
  }

  if (method === 'DELETE') {
    const id = String(query.id ?? '');
    if (!id) return json(400, { error: 'id is required' });
    writeNotes(file, readNotes(file).filter((n) => n.id !== id));
    return json(200, { ok: true });
  }

  if (method === 'POST') {
    const body = (req.body ?? {}) as {
      id?: unknown;
      route?: unknown;
      feedback?: unknown;
      element?: unknown;
      payload?: unknown;
      viewport?: unknown;
      elements?: unknown;
      variant?: unknown;
      variantAction?: unknown;
      createdAt?: unknown;
    };
    const { id, route, feedback, element, payload, viewport } = body;
    if (id !== undefined && id !== null && (typeof id !== 'string' || !id || id.length > 200)) {
      return json(400, { error: 'id must be a non-empty string of at most 200 characters' });
    }
    if (typeof route !== 'string' || route === '') {
      return json(400, { error: 'route is required' });
    }
    const cleanFeedback = typeof feedback === 'string' ? feedback.trim() : '';
    if (cleanFeedback === '') {
      return json(400, { error: 'feedback is required' });
    }
    if (cleanFeedback.length > 4000) return json(400, { error: 'feedback must be at most 4000 characters' });
    if (payload !== undefined && !withinPayloadCap(payload)) {
      return json(400, {
        error: `payload exceeds ${PAYLOAD_MAX} bytes or is not serializable`,
      });
    }
    const cleanViewport = viewportOf(viewport);
    if (body.elements !== undefined && (!Array.isArray(body.elements) || body.elements.length > 50)) {
      return json(400, { error: 'elements must be an array of at most 50 elements' });
    }
    const elements = body.elements === undefined ? undefined : (body.elements as unknown[]).map(elementOf).filter((el): el is IterationElement => el !== null);
    const variant = body.variant === undefined ? undefined : variantOf(body.variant);
    const variantAction = removalOf(body.variantAction);
    if (body.variantAction !== undefined && !variantAction) return json(400, { error: 'Invalid variant action' });
    let cleanElement: IterationElement | null = null;
    if (element && typeof element === 'object' && !Array.isArray(element)) {
      cleanElement = {
        tag: cap(String((element as { tag?: unknown }).tag ?? ''), 30),
        text: cap(String((element as { text?: unknown }).text ?? ''), 120),
        selector: cap(
          String((element as { selector?: unknown }).selector ?? ''),
          300,
        ),
      };
    }
    const notes = readNotes(file);
    const defaultsRequest = cleanFeedback.startsWith('[set-defaults]');
    const previousDefaults = defaultsRequest && !notes.some((note) => note.id === id)
      ? notes.filter(n => !n.done && n.route === route && n.feedback.startsWith('[set-defaults]')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      : undefined;
    const updateId = previousDefaults?.id ?? id;
    if (typeof updateId === 'string' && updateId !== '') {
      const existing = notes.find((n) => n.id === updateId && n.route === route);
      if (existing) {
        if (previousDefaults) {
          delete existing.elements;
          delete existing.variant;
          delete existing.variantAction;
          delete existing.payload;
        }
        existing.feedback = cleanFeedback;
        existing.element = cleanElement;
        if (elements !== undefined) {
          existing.elements = elements;
          existing.element = elements[0] ?? null;
        } else if (existing.elements) existing.element = existing.elements[0] ?? null;
        if (variant !== undefined) existing.variant = variant;
        if (variantAction) existing.variantAction = variantAction;
        // An omitted payload leaves the stored one alone, so a host that only
        // sends it on the first save does not lose it on the next autosave.
        if (payload !== undefined) existing.payload = payload;
        if (defaultsRequest && !existing.done) {
          existing.createdAt = new Date().toISOString();
          if (cleanViewport) existing.viewport = cleanViewport;
          writeNotes(file, notes.filter(n => n.id === existing.id || n.done || n.route !== route || !n.feedback.startsWith('[set-defaults]')));
        } else writeNotes(file, notes);
        return json(200, { id: existing.id });
      }
    }
    if (typeof id === 'string' && notes.some((note) => note.id === id)) {
      return json(409, { error: 'This note belongs to a different route' });
    }
    const newId = typeof id === 'string' ? id : randomUUID();
    const createdAt = typeof body.createdAt === 'string' && Number.isFinite(Date.parse(body.createdAt))
      ? new Date(body.createdAt).toISOString() : new Date().toISOString();
    notes.push({
      id: newId,
      route,
      feedback: cleanFeedback,
      element: cleanElement,
      done: false,
      doneAt: null,
      createdAt,
      ...(cleanViewport ? { viewport: cleanViewport } : {}),
      ...(payload !== undefined ? { payload } : {}),
      ...(elements !== undefined ? { elements, element: elements[0] ?? null } : {}),
      ...(variant !== undefined ? { variant } : {}),
      ...(variantAction ? { variantAction } : {}),
    });
    writeNotes(file, notes);
    return json(201, { id: newId });
  }

  return json(405, { error: 'method not allowed' });
}

function cap(v: string, max: number): string {
  return v.slice(0, max);
}

function elementOf(value: unknown): IterationElement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<IterationElement>;
  if (typeof v.selector !== 'string' || !v.selector) return null;
  return { tag: cap(String(v.tag ?? ''), 30), text: cap(String(v.text ?? ''), 120), selector: cap(v.selector, 300) };
}

function variantOf(value: unknown): VariantReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<VariantReference>;
  if (typeof v.axisId !== 'string' || typeof v.label !== 'string') return null;
  return { axisId: cap(v.axisId, 200), label: cap(v.label, 200),
    ...(typeof v.optionId === 'string' ? { optionId: cap(v.optionId, 200) } : {}),
    ...(typeof v.optionLabel === 'string' ? { optionLabel: cap(v.optionLabel, 200) } : {}),
    ...(typeof v.value === 'string' ? { value: cap(v.value, 200) } : {}) };
}

/** A sane `{ w, h }` from an untrusted viewport value, else null. */
function viewportOf(v: unknown): { w: number; h: number } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const w = Math.round(Number((v as { w?: unknown }).w));
  const h = Math.round(Number((v as { h?: unknown }).h));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0 || w > 100_000 || h > 100_000) return null;
  return { w, h };
}

/** Whether an opaque payload is serializable and inside {@link PAYLOAD_MAX}. */
function withinPayloadCap(payload: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8') <= PAYLOAD_MAX;
  } catch {
    return false; // circular or otherwise unserializable
  }
}

/** The endpoint path the client calls. */
export const NOTES_ENDPOINT = '/api/iteration/notes';

function removalOf(value: unknown): VariantRemoval | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<VariantRemoval>;
  if (typeof v.axisId !== 'string' || !v.axisId || v.axisId.length > 200 || !['remove-option', 'remove-axis', 'keep-default'].includes(v.action ?? '')) return;
  if (v.action === 'remove-option' && (typeof v.optionId !== 'string' || !v.optionId || v.optionId.length > 200)) return;
  return { axisId: v.axisId, action: v.action as VariantRemoval['action'], ...(typeof v.optionId === 'string' ? { optionId: v.optionId.slice(0, 200) } : {}) };
}
