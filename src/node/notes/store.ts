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
import { MAX_CHOICE_LENGTH, MAX_REPLY_CHOICES, MAX_REPLY_LENGTH, MAX_RESOLUTION_LENGTH } from '../../core/limits';
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

const isTime = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

/** A stored reply, or null when it is missing or malformed. Malformed choices or an answer are dropped on their own. */
function replyOf(value: unknown): NoteReply | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<Record<keyof NoteReply, unknown>>;
  if (typeof v.text !== 'string' || !v.text.trim() || !isTime(v.at)) return null;
  // A hand edit may repeat one; each is a key in the panel, so the list stays distinct.
  const choices = Array.isArray(v.choices)
    ? [
        ...new Set(
          v.choices.filter(
            (choice): choice is string => typeof choice === 'string' && choice.trim() !== '' && choice.length <= MAX_CHOICE_LENGTH,
          ),
        ),
      ]
    : [];
  const answer = v.answer as { text?: unknown; at?: unknown } | null | undefined;
  return {
    text: v.text.slice(0, MAX_REPLY_LENGTH),
    at: v.at,
    ...(choices.length ? { choices: choices.slice(0, MAX_REPLY_CHOICES) } : {}),
    ...(answer && typeof answer === 'object' && typeof answer.text === 'string' && answer.text.trim() && isTime(answer.at)
      ? { answer: { text: answer.text.slice(0, MAX_REPLY_LENGTH), at: answer.at } }
      : {}),
    ...(typeof v.about === 'string' && v.about.length <= 64 ? { about: v.about } : {}),
  };
}

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
 * again. So does reopening it (the same text, refused once) and answering the
 * question in the panel.
 */
export function noteFingerprint(note: StoredNote): string {
  const reopenedAt = reopenedOf(note.reopened)?.at;
  const answeredAt = replyOf(note.reply)?.answer?.at;
  // Appended only when set, so notes never reopened or answered keep the fingerprints they had.
  return fingerprint([...contentOf(note), ...(reopenedAt ? [reopenedAt] : []), ...(answeredAt ? [{ answeredAt }] : [])]);
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
 * A note's reply as readers see it. Once the reviewer has answered in the
 * panel, or the note has changed since the agent asked (an edit answers too),
 * the question is no longer pending: it comes back marked `answered`.
 */
export function replyView(note: StoredNote): NoteReply | null {
  const reply = replyOf(note.reply);
  if (!reply) return null;
  return reply.answer || editedSinceAsked(note, reply) ? { ...reply, answered: true } : reply;
}

/** The note has changed since the agent asked about it. */
export function editedSinceAsked(note: StoredNote, reply = replyOf(note.reply)): boolean {
  return reply?.about !== undefined && reply.about !== contentFingerprint(note);
}
