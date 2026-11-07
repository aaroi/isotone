/**
 * Blast session state: one small JSON file next to the notes file, read and
 * written only by the CLI (the waiting command, `--status`, `--stop` and
 * `--extend`) and by the note commands' heartbeat. Nothing serves it over
 * HTTP. See `src/core/blast.ts` for the names and `docs/blast.md`.
 */
import { existsSync, readFileSync } from 'node:fs';

import { HEARTBEAT_MS, LIVE_HEARTBEAT_MS, BLAST, type BlastState } from './core/blast';
import { withFileLock, writeJson } from './file-store';
import { ensureFileIgnored, noteFingerprint, type StoredNote } from './store';
import { updateRequestOf } from './update-request';

export { BLAST } from './core/blast';
export { noteFingerprint } from './store';
export type { BlastState } from './core/blast';

/** The stored session. `seen` maps each handed-out note to its fingerprint. */
export interface BlastSession {
  version: 1;
  startedAt: string;
  endsAt: string;
  route: string | null;
  heartbeatAt: string | null;
  waiting: boolean;
  stoppedAt?: string;
  seen: Record<string, string>;
}

/** `.iteration-feedback.json` → `.iteration-feedback.blast.json`, beside it. */
export function blastFile(notesFile: string): string {
  return `${notesFile.replace(/\.json$/i, '')}${BLAST.stateSuffix}`;
}

const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** The session in `file`, or null when there is none or it is unreadable. */
export function readSession(file: string): BlastSession | null {
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as Partial<BlastSession>;
    if (!v || typeof v !== 'object' || !iso(v.startedAt) || !iso(v.endsAt)) return null;
    const seen =
      v.seen && typeof v.seen === 'object' && !Array.isArray(v.seen)
        ? Object.fromEntries(Object.entries(v.seen).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {};
    return {
      version: 1,
      startedAt: v.startedAt,
      endsAt: v.endsAt,
      route: typeof v.route === 'string' && v.route ? v.route : null,
      heartbeatAt: iso(v.heartbeatAt) ? v.heartbeatAt : null,
      waiting: v.waiting === true,
      ...(iso(v.stoppedAt) ? { stoppedAt: v.stoppedAt } : {}),
      seen,
    };
  } catch {
    return null;
  }
}

export function writeSession(file: string, session: BlastSession): void {
  const fresh = !existsSync(file);
  writeJson(file, session);
  // A local, per-checkout file like the notes; never committed.
  if (fresh) ensureFileIgnored(file);
}

/**
 * Read, change and write the session under the same lock the notes use, so
 * the waiting command and `--stop` or `--extend` never lose each other's writes.
 * `change` returns the new session, or null to leave the file alone.
 */
export function updateSession<T>(file: string, change: (session: BlastSession | null) => { session: BlastSession | null; result: T }): T {
  return withFileLock(file, () => {
    const before = readSession(file);
    const { session, result } = change(before);
    if (session) writeSession(file, session);
    return result;
  });
}

export function isEnded(session: BlastSession, now = Date.now()): boolean {
  return Boolean(session.stoppedAt) || Date.parse(session.endsAt) <= now;
}

/** Deadline not passed, and an agent seen within {@link LIVE_HEARTBEAT_MS}. */
export function isLive(session: BlastSession, now = Date.now()): boolean {
  return !isEnded(session, now) && session.heartbeatAt !== null && now - Date.parse(session.heartbeatAt) < LIVE_HEARTBEAT_MS;
}

export function publicState(session: BlastSession, now = Date.now()): BlastState {
  const ended = isEnded(session, now);
  return {
    startedAt: session.startedAt,
    endsAt: session.endsAt,
    route: session.route,
    heartbeatAt: session.heartbeatAt,
    // A killed command never clears its flag; a missed heartbeat does.
    waiting: !ended && session.waiting && session.heartbeatAt !== null && now - Date.parse(session.heartbeatAt) < HEARTBEAT_MS * 2.5,
    ...(session.stoppedAt ? { stoppedAt: session.stoppedAt } : {}),
    live: isLive(session, now),
    ended,
    now: new Date(now).toISOString(),
  };
}

/** Open notes in the session's scope that have not been handed out as they are now. */
export function unseenNotes(notes: StoredNote[], session: BlastSession): StoredNote[] {
  return (
    notes
      .filter((note) => !note.done)
      // An update request concerns the whole project, as in `npx isotone <route>`.
      .filter((note) => !session.route || note.route === session.route || Boolean(updateRequestOf(note.update)))
      // A question the reviewer has not answered yet (by editing the note) waits for them.
      .filter((note) => session.seen[note.id] !== noteFingerprint(note) && !isAwaitingAnswer(note))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  );
}

/** Notes handed out earlier, or waiting on an answer to the agent's question, that are still open. */
export function seenOpenNotes(notes: StoredNote[], session: BlastSession): StoredNote[] {
  return notes.filter((note) => !note.done && (note.id in session.seen || isAwaitingAnswer(note)));
}

/** The agent asked about this note and the reviewer has not edited it since. */
export function isAwaitingAnswer(note: StoredNote): boolean {
  return Boolean(note.reply?.about) && note.reply?.about === noteFingerprint(note);
}

/**
 * A sign of life from the agent outside the waiting command: `--working`,
 * `--done` and `--reply` call this, so a session stays live while the agent
 * works through a long batch. Never starts or revives a session.
 */
export function touchSession(notesFile: string, now = Date.now()): void {
  const file = blastFile(notesFile);
  if (!existsSync(file)) return;
  try {
    updateSession(file, (session) => ({
      session: session && !isEnded(session, now) ? { ...session, heartbeatAt: new Date(now).toISOString() } : null,
      result: undefined,
    }));
  } catch {
    /* A busy or unreadable session file never fails a note command. */
  }
}
