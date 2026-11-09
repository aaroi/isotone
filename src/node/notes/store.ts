/**
 * File-backed store for Isotone notes — shared by the Vite plugin (dev
 * server) and the CLI. Notes live in a gitignored JSON file on disk, no
 * database. The path comes from the plugin/CLI options. The HTTP endpoint
 * over this file is in `./handler`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

import type { IsotoneNote, NoteReply, NoteResolution } from '../../core/types';
import { NOTE_ID } from '../../core/id';
import { MAX_REPLY_LENGTH, MAX_RESOLUTION_LENGTH } from '../../core/limits';
import { writeJson } from '../fs/atomic';
import { withFileLock } from '../fs/lock';
import { updateRequestOf } from '../update/request';

/** A note as the file holds it: always with `doneAt`. */
export interface StoredNote extends IsotoneNote {
  doneAt: string | null;
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
    // A hand-edited or older file may hold an id no shell-safe command can
    // carry; it reads under a stable safe id instead, and keeps it on write.
    for (const note of data as StoredNote[]) if (!NOTE_ID.test(note.id)) note.id = safeIdFor(note.id);
    return data as StoredNote[];
  } catch (cause) {
    throw new Error(`Could not read notes from ${file}; the file has been left untouched.`, { cause });
  }
}

function safeIdFor(id: string): string {
  return `id-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`;
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
function replyOf(value: unknown): NoteReply | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<NoteReply>;
  if (typeof v.text !== 'string' || !v.text.trim() || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at))) return null;
  return {
    text: v.text.slice(0, MAX_REPLY_LENGTH),
    at: v.at,
    ...(typeof v.about === 'string' && v.about.length <= 64 ? { about: v.about } : {}),
  };
}

const isTime = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

/** A stored summary, bounded, or nothing. */
const summaryOf = (value: unknown) => (typeof value === 'string' && value.trim() ? { summary: value.slice(0, MAX_RESOLUTION_LENGTH) } : {});

/** How `--done` closed a note (when, and the agent's summary if it gave one), or null when missing or malformed. */
export function resolutionOf(value: unknown): NoteResolution | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as { summary?: unknown; at?: unknown };
  return isTime(v.at) ? { ...summaryOf(v.summary), at: v.at } : null;
}

/** When the reviewer reopened a closed note, what the agent had said, and whether the note was sent back unchanged; or null. */
export function reopenedOf(value: unknown): NonNullable<IsotoneNote['reopened']> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as { at?: unknown; summary?: unknown; unchanged?: unknown };
  if (!isTime(v.at)) return null;
  return { at: v.at, ...summaryOf(v.summary), ...(v.unchanged === true ? { unchanged: true as const } : {}) };
}

/** A stored time a reader can trust to be one, or undefined. */
export const timeOf = (value: unknown): string | undefined => (isTime(value) ? value : undefined);

/**
 * What the reviewer wrote: a reply asked about this answers itself once it
 * changes. Reopening a note unchanged is not an answer.
 */
export function contentFingerprint(note: StoredNote): string {
  return fingerprint(contentOf(note));
}

/**
 * What the agent was given for a note. A reviewer who edits a handed-out note
 * (to answer the agent's question, say) changes it, and the note is handed out
 * again. So does reopening it: the same text, refused once.
 */
export function noteFingerprint(note: StoredNote): string {
  const reopenedAt = reopenedOf(note.reopened)?.at;
  // Appended only when set, so notes never reopened keep the fingerprints they had.
  return fingerprint([...contentOf(note), ...(reopenedAt ? [reopenedAt] : [])]);
}

function contentOf(note: StoredNote): unknown[] {
  return [
    note.feedback,
    note.route,
    (note.elements ?? (note.element ? [note.element] : [])).map((element) => element.selector),
    note.variant ?? null,
    note.variantAction ?? null,
    updateRequestOf(note.update)?.to ?? null,
    // Appended only when present, so notes without edits keep the fingerprint they had.
    ...(note.styleEdits?.length ? [note.styleEdits] : []),
  ];
}

const fingerprint = (content: unknown[]) => createHash('sha256').update(JSON.stringify(content)).digest('base64url').slice(0, 16);

/**
 * A note's reply as readers see it. Once the note has changed since the agent
 * asked (the reviewer answers by editing it), the question is no longer
 * pending: it comes back marked `answered`.
 */
export function replyView(note: StoredNote): NoteReply | null {
  const reply = replyOf(note.reply);
  if (!reply) return null;
  return reply.about !== undefined && reply.about !== contentFingerprint(note) ? { ...reply, answered: true } : reply;
}
