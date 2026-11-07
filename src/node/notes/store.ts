/**
 * File-backed store for iteration notes — shared by the Vite plugin (dev
 * server) and the CLI. Notes live in a gitignored JSON file on disk, no
 * database. The path comes from the plugin/CLI options. The HTTP endpoint
 * over this file is in `./handler`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

import type { IterationElement, NoteContext, NoteReply } from '../../core/types';
import { MAX_REPLY_LENGTH } from '../../core/limits';
import { writeJson } from '../fs/atomic';
import { withFileLock } from '../fs/lock';
import { updateRequestOf } from '../update/request';

export interface StoredNote extends NoteContext {
  id: string;
  route: string;
  feedback: string;
  element: IterationElement | null;
  done: boolean;
  doneAt: string | null;
  /** When an agent said it started on this note (`isotone --working <id>`).
   *  Cleared when the note is closed or reopened. */
  workingAt?: string | null;
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

export function readNotes(file: string): StoredNote[] {
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (
      !Array.isArray(data) ||
      !data.every(
        (note) =>
          note &&
          typeof note === 'object' &&
          typeof note.id === 'string' &&
          typeof note.route === 'string' &&
          typeof note.feedback === 'string' &&
          typeof note.createdAt === 'string',
      )
    ) {
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
 * A cheap fingerprint of the notes file. Every store write replaces the file
 * by rename, which gives it a new inode; an in-place edit by hand changes the
 * nanosecond mtime or the size. A missing file has its own revision.
 */
export function notesRevision(file: string): string {
  try {
    const stat = statSync(file, { bigint: true });
    return `${stat.ino.toString(36)}.${stat.mtimeNs.toString(36)}.${stat.size.toString(36)}`;
  } catch {
    return 'none';
  }
}

/** A stored reply, or null when it is missing or malformed. */
export function replyOf(value: unknown): NoteReply | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<NoteReply>;
  if (typeof v.text !== 'string' || !v.text.trim() || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null;
  return {
    text: v.text.slice(0, MAX_REPLY_LENGTH),
    at: v.at,
    ...(typeof v.about === 'string' && v.about.length <= 64 ? { about: v.about } : {}),
  };
}

/**
 * What the agent was given for a note. A reviewer who edits a handed-out note
 * (to answer the agent's question, say) changes it, and the note is handed out
 * again.
 */
export function noteFingerprint(note: StoredNote): string {
  const update = updateRequestOf(note.update);
  const content = JSON.stringify([
    note.feedback,
    note.route,
    (note.elements ?? (note.element ? [note.element] : [])).map((element) => element.selector),
    note.variant ?? null,
    note.variantAction ?? null,
    update?.to ?? null,
  ]);
  return createHash('sha256').update(content).digest('base64url').slice(0, 16);
}

/**
 * A note's reply as readers see it. Once the note has changed since the agent
 * asked (the reviewer answers by editing it), the question is no longer
 * pending: it comes back marked `answered`.
 */
export function replyView(note: StoredNote): NoteReply | null {
  const reply = replyOf(note.reply);
  if (!reply) return null;
  return reply.about !== undefined && reply.about !== noteFingerprint(note) ? { ...reply, answered: true } : reply;
}
