/**
 * The notes endpoint: a transport-agnostic handler over the notes file that
 * the Vite plugin and `isotone serve` both render.
 */
import { randomUUID } from 'node:crypto';

import type { IsotoneElement } from '../../core/types';
import { NOTE_ID } from '../../core/id';
import { MAX_FEEDBACK_LENGTH, MAX_NOTES, MAX_ROUTE, PAYLOAD_MAX } from '../../core/limits';
import { updateNoteText } from '../../core/update';
import { LockBusyError, SERVER_LOCK_WAIT_MS, withFileLock } from '../fs/lock';
import { type HandlerRequest, type HandlerResponse, jsonResponse } from '../http';
import { notesProjectRoot, updateRequestOf } from '../update/request';
import { noteFingerprint, notesRevision, readNotes, replyView, type StoredNote, writeNotes } from './store';
import { diagnosticsOf, elementFields, elementOf, removalOf, variantOf, viewportOf, withinPayloadCap } from './validate';

/** The endpoint path the client calls. */
export const NOTES_ENDPOINT = '/api/isotone/notes';

/** The transport-agnostic result of a notes request — any runtime (Vite
 *  middleware, Next route handler, Bun serve, Vercel) can render it. */
export type NotesResponse = HandlerResponse;

/** A request the pure handler understands (framework-neutral). */
export type NotesRequest = HandlerRequest;

/**
 * The transport-agnostic core of the notes endpoint. Reads/writes the local
 * file and returns a `{ status, headers, body }` the caller renders. Works
 * under Vite middleware, Next route handler, Bun.serve, or Vercel.
 */
export function notesResponse(file: string, req: NotesRequest): NotesResponse {
  if (req.method === 'POST' || req.method === 'DELETE') {
    // A server must not freeze on someone else's lock: past a short wait it
    // answers 503 and the panel keeps the note to retry.
    try {
      return withFileLock(file, () => handleNotesRequest(file, req), { waitMs: SERVER_LOCK_WAIT_MS });
    } catch (error) {
      if (error instanceof LockBusyError) return jsonResponse(503, { error: error.message });
      throw error;
    }
  }
  return handleNotesRequest(file, req);
}

function handleNotesRequest(file: string, req: NotesRequest): NotesResponse {
  const method = req.method ?? '';
  const query = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams);
  const json = jsonResponse;

  if (method === 'GET') {
    // `?rev=<last>` is the panel's poll. The revision comes from the file's
    // metadata, so an unchanged store answers without reading or parsing the
    // file, however many notes it holds or how many tabs are polling. Servers
    // older than this ignore the parameter and send the plain array, which the
    // client treats as changed.
    const polled = query.rev !== undefined;
    const rev = polled ? notesRevision(file) : '';
    if (polled && rev === String(query.rev)) return json(200, { rev, unchanged: true });
    const route = String(query.route ?? '');
    const root = notesProjectRoot(file);
    const all = query.all !== undefined && String(query.all) !== '' && String(query.all) !== '0';
    const notes = polled ? readNotesAt(file, rev) : readNotes(file);
    // `?all=1` lists every note on every route, done ones included. `?route=`
    // scopes to a page; neither means the open backlog, which is what the
    // panel shows and polls.
    const rows = (all ? [...notes] : route ? notes.filter((n) => n.route === route) : notes.filter((n) => !n.done))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((note) => toItem(note, root));
    return json(200, polled ? { rev, notes: rows } : rows);
  }

  if (method === 'DELETE') {
    const id = String(query.id ?? '');
    if (!NOTE_ID.test(id)) return json(400, { error: 'id must be 1-64 letters, digits, - or _, not starting with -' });
    writeNotes(
      file,
      readNotes(file).filter((n) => n.id !== id),
    );
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
      diagnostics?: unknown;
    };
    // A body's `update` is never read: only the update endpoint writes one,
    // from the server's own check, and an update note cannot be edited.
    // Nor is `reply`: only the agent writes one, with `isotone --reply`.
    const { id, route, feedback, element, payload, viewport } = body;
    if (id !== undefined && id !== null && (typeof id !== 'string' || !NOTE_ID.test(id))) {
      return json(400, { error: 'id must be 1-64 letters, digits, - or _, not starting with -' });
    }
    if (typeof route !== 'string' || route === '') {
      return json(400, { error: 'route is required' });
    }
    // A page path, so a route cannot pass for a line of instructions to the agent.
    if (!route.startsWith('/')) return json(400, { error: 'route must start with /' });
    if (route.length > MAX_ROUTE) return json(400, { error: `route must be at most ${MAX_ROUTE} characters` });
    const cleanFeedback = typeof feedback === 'string' ? feedback.trim() : '';
    if (cleanFeedback === '') {
      return json(400, { error: 'feedback is required' });
    }
    if (cleanFeedback.length > MAX_FEEDBACK_LENGTH)
      return json(400, { error: `feedback must be at most ${MAX_FEEDBACK_LENGTH} characters` });
    if (payload !== undefined && !withinPayloadCap(payload)) {
      return json(400, {
        error: `payload exceeds ${PAYLOAD_MAX} bytes or is not serializable`,
      });
    }
    const cleanViewport = viewportOf(viewport);
    if (body.elements !== undefined && (!Array.isArray(body.elements) || body.elements.length > 50)) {
      return json(400, { error: 'elements must be an array of at most 50 elements' });
    }
    const elements =
      body.elements === undefined
        ? undefined
        : (body.elements as unknown[]).map(elementOf).filter((el): el is IsotoneElement => el !== null);
    const variant = body.variant === undefined ? undefined : variantOf(body.variant);
    const variantAction = removalOf(body.variantAction);
    if (body.variantAction !== undefined && !variantAction) return json(400, { error: 'Invalid variant action' });
    // Recorded once, with the note: an edit says nothing new about the page then.
    const diagnostics = diagnosticsOf(body.diagnostics);
    const cleanElement = element && typeof element === 'object' && !Array.isArray(element) ? elementFields(element) : null;
    const notes = readNotes(file);
    const defaultsRequest = cleanFeedback.startsWith('[set-defaults]');
    const previousDefaults =
      defaultsRequest && !notes.some((note) => note.id === id)
        ? notes
            .filter((n) => !n.done && n.route === route && n.feedback.startsWith('[set-defaults]'))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
        : undefined;
    const updateId = previousDefaults?.id ?? id;
    if (typeof updateId === 'string' && updateId !== '') {
      const existing = notes.find((n) => n.id === updateId && n.route === route);
      if (existing?.update !== undefined) {
        return json(409, { error: 'An update note is written by Isotone and cannot be edited. Delete it to cancel the update.' });
      }
      if (existing) {
        const before = noteFingerprint(existing);
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
        // An edit that lands just after the agent closed the note is new
        // feedback: reopen it, or the agent would never see it.
        if (existing.done && noteFingerprint(existing) !== before) {
          existing.done = false;
          existing.doneAt = null;
          delete existing.workingAt;
        }
        if (defaultsRequest && !existing.done) {
          existing.createdAt = new Date().toISOString();
          if (cleanViewport) existing.viewport = cleanViewport;
          writeNotes(
            file,
            notes.filter((n) => n.id === existing.id || n.done || n.route !== route || !n.feedback.startsWith('[set-defaults]')),
          );
        } else writeNotes(file, notes);
        return json(200, { id: existing.id });
      }
    }
    if (typeof id === 'string' && notes.some((note) => note.id === id)) {
      return json(409, { error: 'This note belongs to a different route' });
    }
    if (notes.length >= MAX_NOTES) {
      return json(409, { error: `The notes file holds ${MAX_NOTES} notes, the most it takes. Delete done notes from it to add more.` });
    }
    const newId = typeof id === 'string' ? id : randomUUID();
    // A note saved offline keeps the time it was written, but never one in
    // the future, which would sort it above everything for good.
    const sent = typeof body.createdAt === 'string' ? Date.parse(body.createdAt) : Number.NaN;
    const createdAt = new Date(Number.isFinite(sent) ? Math.min(sent, Date.now()) : Date.now()).toISOString();
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
      ...(diagnostics ? { diagnostics } : {}),
    });
    writeNotes(file, notes);
    return json(201, { id: newId });
  }

  return json(405, { error: 'method not allowed' });
}

// The last parse per file, keyed by revision: when the file changes, every
// polling tab gets its answer from one read and one parse.
const parsed = new Map<string, { rev: string; notes: StoredNote[] }>();
function readNotesAt(file: string, rev: string): StoredNote[] {
  const cached = parsed.get(file);
  if (cached && cached.rev === rev && rev !== 'none') return cached.notes;
  const notes = readNotes(file);
  parsed.set(file, { rev, notes });
  return notes;
}

function toItem(n: StoredNote, root: string) {
  const update = updateRequestOf(n.update, { root });
  const item: {
    id: string;
    route: string;
    feedback: string;
    element: IsotoneElement | null;
    done: boolean;
    createdAt: string;
    workingAt?: string;
    viewport?: { w: number; h: number };
    payload?: unknown;
  } = {
    id: n.id,
    route: n.route,
    // An update note says what the server's request says, whatever the file holds.
    feedback: update ? updateNoteText(update) : n.feedback,
    element: n.element,
    done: n.done,
    createdAt: n.createdAt,
  };
  // Absent stays absent: a host that never sends a payload should not start
  // seeing a null one appear in its notes.
  if (n.workingAt && !n.done) item.workingAt = n.workingAt;
  if (n.viewport !== undefined) item.viewport = n.viewport;
  if (n.payload !== undefined) item.payload = n.payload;
  return {
    ...item,
    ...(n.elements !== undefined ? { elements: n.elements } : {}),
    ...(n.variant !== undefined ? { variant: n.variant } : {}),
    ...(n.variantAction !== undefined ? { variantAction: n.variantAction } : {}),
    ...(diagnosticsOf(n.diagnostics) ? { diagnostics: diagnosticsOf(n.diagnostics) } : {}),
    // Only the server writes an update request; a malformed one, or one whose
    // directory is outside the project, is not shown.
    ...(update ? { update } : {}),
    // Only the CLI writes a reply; a hand-edited, malformed one is not shown.
    ...(replyView(n) ? { reply: replyView(n) } : {}),
  };
}
