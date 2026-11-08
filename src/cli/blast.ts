/**
 * `npx isotone blast`: the user's coding agent keeps acting on notes for a set
 * time. `start` opens a session and prints how to run it. Each bare run then
 * blocks until new notes arrive, prints them as one batch and exits; the agent
 * acts on them and runs it again. Between batches it prints a check-in every
 * `--every` (or never, with `--every off`), and at the deadline a clear end.
 * Every output names its own next step, so an agent that lost the start text
 * (to a compacted context, say) still knows what to do.
 * It costs nothing while idle: it sleeps on a directory watch with a slow stat
 * poll as a fallback. Isotone never runs the agent.
 */
import { type FSWatcher, statSync, watch } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  BLAST,
  BLAST_CLI,
  BLAST_GUARDRAILS,
  BLAST_REMINDER,
  DEFAULT_EVERY_MS,
  DEFAULT_FOR_MS,
  HEARTBEAT_MS,
  MAX_BATCH,
  MAX_EVERY_MS,
  MAX_SESSION_MS,
  blastLoop,
  formatDuration,
  DURATION,
  parseDuration,
  timeLeft,
} from '../core/blast';
import {
  type BlastSession,
  blastFile,
  isAwaitingAnswer,
  isEnded,
  isLive,
  publicState,
  readSession,
  seenOpenNotes,
  unseenNotes,
  updateSession,
} from '../node/blast';
import { noteFingerprint, notesRevision, readNotes, type StoredNote } from '../node/notes/store';
import { notesProjectRoot } from '../node/update/request';
import { LockBusyError } from '../node/fs/lock';
import { findNotesFile, noteRecord, printNotes } from './notes';
import { oneLine, shellQuote, toJson } from './text';
import { type CliIO, errOut, has, out, parseArgs, valueFor } from './util';

/** Exit status once the session is over, so an agent or script can tell it apart. */
export const ENDED_EXIT = 3;

interface BlastTiming {
  /** Quiet time after the last change to the notes before a batch is handed out. */
  debounceMs: number;
  /** A steady stream of notes is handed out after this long regardless. */
  maxDebounceMs: number;
  /** Fallback poll, for file systems where watching misses events. */
  pollMs: number;
  heartbeatMs: number;
}

const TIMING: BlastTiming = { debounceMs: 3_000, maxDebounceMs: 15_000, pollMs: 2_000, heartbeatMs: HEARTBEAT_MS };

const COMMANDS = ['start', 'status', 'stop', 'extend'] as const;
type Command = (typeof COMMANDS)[number] | 'wait';

type Outcome =
  | { type: 'batch'; notes: StoredNote[]; more: number; session: BlastSession }
  | { type: 'checkin'; session: BlastSession }
  | { type: 'ended'; session: BlastSession | null }
  | { type: 'interrupted' };

function help(io: CliIO): void {
  out(io, `Usage: isotone ${BLAST.command} start [30m] [<route>]      start a session and print how to run it`);
  out(io, `       isotone ${BLAST.command} [--every 90s|off]          wait for the next batch of notes`);
  out(io, `       isotone ${BLAST.command} status | stop | extend <duration>`);
  out(io);
  out(io, `${BLAST.name} lets your coding agent keep acting on notes for a set time. A bare run waits`);
  out(io, 'for new notes, prints them as one batch and exits 0. With none by --every it prints a');
  out(io, `check-in and exits 0. At the deadline it prints "${BLAST.name} session over" and exits ${ENDED_EXIT}.`);
  out(io);
  out(io, '  start [duration]    session length, e.g. 45m or 1h (default 30m, at most 8h)');
  out(io, '  <route>             with start: hand out only these notes (/items, /items/*)');
  out(io, '  --every <duration>  check-in interval (default 90s, at most 9m); keep it under your');
  out(io, '                      command timeout. `off` waits for a batch or the end only');
  out(io, '  --json              print JSON');
  out(io, '  --file <path>       another notes file');
}

export async function runBlast(argv: string[], io: CliIO, timingOverrides: Partial<BlastTiming> = {}): Promise<number> {
  const timing = { ...TIMING, ...timingOverrides };
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    help(io);
    return 0;
  }
  const first = argv[0] ?? '';
  const command: Command = (COMMANDS as readonly string[]).includes(first) ? (first as Command) : 'wait';
  const rest = command === 'wait' ? argv : argv.slice(1);
  let durationMs: number | undefined;
  let route: string | null = null;
  let every: number | null = DEFAULT_EVERY_MS;
  let everyArg = '';
  try {
    const positionals = parseArgs(rest, ['--every', '--file'], ['--json'], `${BLAST_CLI} --help`);
    if (command !== 'wait' && has(rest, '--every')) throw new Error('--every applies to the waiting run, `npx isotone blast`.');
    for (const arg of positionals) {
      // `start 30` could mean minutes or the route /30: say which to write.
      if (/^\d+$/.test(arg) && command === 'start')
        throw new Error(`"${arg}" needs a unit, such as ${arg}m, or a leading slash for the route /${arg}.`);
      const duration = DURATION.test(arg) || /^\d+$/.test(arg);
      if (duration && (command === 'start' || command === 'extend') && durationMs === undefined) durationMs = parseDuration(arg);
      else if (!duration && command === 'start' && !route) route = arg;
      else if (!duration && command === 'wait')
        throw new Error(`A route is set when the session starts: \`${BLAST_CLI} start 30m ${shellQuote(arg)}\`.`);
      else throw new Error(`Unexpected "${arg}". Run \`${BLAST_CLI} --help\`.`);
    }
    if (command === 'extend' && durationMs === undefined) throw new Error('Say how much time to add, such as `extend 15m`.');
    if (command === 'start' && durationMs !== undefined && durationMs > MAX_SESSION_MS)
      throw new Error(`A session can be at most ${formatDuration(MAX_SESSION_MS)}.`);
    everyArg = valueFor(rest, '--every') ?? '';
    if (everyArg === 'off') every = null;
    else if (everyArg) every = parseDuration(everyArg);
    if (every !== null && every > MAX_EVERY_MS)
      throw new Error(
        `--every is at most ${formatDuration(MAX_EVERY_MS)}, to stay under agent command timeouts. In a background task, use --every off.`,
      );
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
  const json = has(rest, '--json');
  const fileText = valueFor(rest, '--file');
  const notesFile = findNotesFile(io.cwd, fileText).file;
  const file = blastFile(notesFile);
  const fileFlag = fileText ? ` --file ${shellQuote(fileText)}` : '';

  switch (command) {
    case 'status':
      return status(io, file, json, fileFlag);
    case 'stop':
      return stop(io, file, json, fileFlag);
    case 'extend':
      return extend(io, file, durationMs ?? 0, json);
    case 'start':
      return start(io, file, durationMs ?? DEFAULT_FOR_MS, route, json, fileFlag);
  }
  const next = `${BLAST_CLI}${everyArg ? ` --every ${everyArg}` : ''}${json ? ' --json' : ''}${fileFlag}`;
  return wait(io, notesFile, file, { every, json, next }, timing);
}

function start(io: CliIO, file: string, durationMs: number, route: string | null, json: boolean, fileFlag: string): number {
  const now = Date.now();
  const result = updateSession<{ running: BlastSession } | { started: BlastSession }>(file, (session) => {
    // Never take over a session an agent is still in: two agents would each
    // be handed half the notes. One no agent has touched for a while is abandoned.
    if (session && isLive(session, now)) return { session: null, result: { running: session } };
    const fresh: BlastSession = {
      version: 1,
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + durationMs).toISOString(),
      route,
      heartbeatAt: new Date(now).toISOString(),
      waiting: false,
      seen: {},
    };
    return { session: fresh, result: { started: fresh } };
  });
  if ('running' in result) {
    const { running } = result;
    const seen = Math.max(0, Math.round((now - Date.parse(running.heartbeatAt ?? running.startedAt)) / 1000));
    errOut(
      io,
      `A ${BLAST.name} session is already running (${timeLeft(Date.parse(running.endsAt) - now)}, agent seen ${seen}s ago). Run \`${BLAST_CLI}${fileFlag}\` to continue it, or end it first with \`${BLAST_CLI} stop${fileFlag}\`.`,
    );
    return 1;
  }
  const { started } = result;
  const next = `${BLAST_CLI}${json ? ' --json' : ''}${fileFlag}`;
  if (json) {
    out(io, toJson({ type: 'started', endsAt: started.endsAt, route, next, loop: blastLoop(next), guardrails: BLAST_GUARDRAILS }));
    return 0;
  }
  out(
    io,
    `${BLAST.name} session started: ${formatDuration(durationMs)}, ${route === null ? 'all routes' : oneLine(route)}, until ${clock(started.endsAt)}.`,
  );
  for (const line of blastLoop(next)) out(io, line);
  out(io, 'While you act on notes by yourself:');
  for (const rule of BLAST_GUARDRAILS) out(io, `- ${rule}`);
  return 0;
}

interface WaitOptions {
  every: number | null;
  json: boolean;
  next: string;
}

async function wait(io: CliIO, notesFile: string, file: string, options: WaitOptions, timing: BlastTiming): Promise<number> {
  const now = Date.now();
  // Continue the session, or report its end: a bare run never starts one.
  // A busy lock only skips this heartbeat.
  const session =
    unlessBusy(() =>
      updateSession(file, (s) => {
        if (!s || isEnded(s, now)) return { session: null, result: s };
        const continued = { ...s, heartbeatAt: new Date(now).toISOString(), waiting: true };
        return { session: continued, result: continued };
      }),
    ) ?? readSession(file);
  if (!session || isEnded(session, now)) return reportEnded(io, notesFile, session, options.json);
  const root = notesProjectRoot(notesFile);
  const outcome = await waitOnce(notesFile, file, options.every ?? Number.POSITIVE_INFINITY, timing);
  if (outcome.type === 'interrupted') return 130;
  if (outcome.type === 'ended') return reportEnded(io, notesFile, outcome.session, options.json);
  const left = timeLeft(Date.parse(outcome.session.endsAt) - Date.now());
  if (outcome.type === 'checkin') {
    if (options.json) out(io, toJson({ type: 'checkin', notes: [], timeLeft: left, endsAt: outcome.session.endsAt, next: options.next }));
    else out(io, `No new notes · ${left} · run \`${options.next}\` again`);
    return 0;
  }
  if (options.json) {
    const notes = outcome.notes.map((n) => noteRecord(n, root));
    out(io, toJson({ type: 'batch', notes, more: outcome.more, timeLeft: left, endsAt: outcome.session.endsAt, next: options.next }));
    return 0;
  }
  const more = outcome.more ? ` · ${outcome.more} more next run` : '';
  out(io, `${BLAST.name} · ${outcome.notes.length} new note${outcome.notes.length === 1 ? '' : 's'}${more} · ${left}`);
  printNotes(io, outcome.notes, root);
  out(io, BLAST_REMINDER);
  out(io, `Act on these one at a time, then run \`${options.next}\` again.`);
  return 0;
}

/** A busy lock (another writer for over two seconds) is skipped, never fatal, while a session waits. */
function unlessBusy<T>(work: () => T): T | undefined {
  try {
    return work();
  } catch (error) {
    if (error instanceof LockBusyError) return undefined;
    throw error;
  }
}

type EndReason = 'time' | 'stopped' | 'none';

function endReason(session: BlastSession | null): EndReason {
  return !session ? 'none' : session.stoppedAt ? 'stopped' : 'time';
}

const WHY: Record<EndReason, string> = { time: 'time is up', stopped: `stopped with \`${BLAST_CLI} stop\``, none: 'there is no session' };

/** Local time with its zone, such as `14:30 GMT+2`, so no one reads it as UTC. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function reportEnded(io: CliIO, notesFile: string, session: BlastSession | null, json: boolean): number {
  if (session?.waiting) {
    try {
      updateSession(blastFile(notesFile), (s) => ({ session: s?.waiting ? { ...s, waiting: false } : null, result: undefined }));
    } catch {
      /* Reporting the end matters more. */
    }
  }
  const reason = endReason(session);
  const open = session ? seenOpenNotes(readNotesSafe(notesFile), session) : [];
  if (json) {
    out(
      io,
      toJson({
        type: 'ended',
        reason,
        stillOpen: open.map((n) => ({
          id: n.id,
          route: n.route,
          feedback: n.feedback.slice(0, 120),
          ...(isAwaitingAnswer(n) ? { awaitingAnswer: true } : {}),
        })),
      }),
    );
    return ENDED_EXIT;
  }
  out(io, `${BLAST.name} session over (${WHY[reason]}).`);
  out(
    io,
    `Stop now: do not run \`${BLAST_CLI}\` again. Give the user a short summary of what you changed${open.length ? ' and what is still open' : ''}.`,
  );
  if (open.length) {
    out(io, 'Still open:');
    for (const n of open)
      out(
        io,
        `- [${oneLine(n.id.slice(0, 8))}] ${oneLine(n.route)} — ${oneLine(n.feedback, 80)}${isAwaitingAnswer(n) ? ' (you asked; waiting for the reviewer)' : ''}`,
      );
  }
  return ENDED_EXIT;
}

function status(io: CliIO, file: string, json: boolean, fileFlag: string): number {
  const session = readSession(file);
  const state = session ? publicState(session) : null;
  if (json) {
    out(io, toJson({ session: state }));
    return 0;
  }
  const startHint = `Start one with \`${BLAST_CLI} start 30m${fileFlag}\`.`;
  if (!session || !state) {
    out(io, `No ${BLAST.name} session. ${startHint}`);
    return 0;
  }
  if (state.ended) {
    out(io, `${BLAST.name} session over (${WHY[endReason(session)]}), ended ${clock(session.stoppedAt ?? session.endsAt)}. ${startHint}`);
    return 0;
  }
  const beat = session.heartbeatAt ? `${Math.round((Date.now() - Date.parse(session.heartbeatAt)) / 1000)}s ago` : 'never';
  out(
    io,
    `${BLAST.name} · ${timeLeft(Date.parse(session.endsAt) - Date.now())} · ends ${clock(session.endsAt)} · ${session.route === null ? 'all routes' : oneLine(session.route)}`,
  );
  out(
    io,
    `agent ${state.waiting ? 'waiting for notes' : state.live ? 'working' : 'not seen recently'} · last heartbeat ${beat} · ${Object.keys(session.seen).length} note(s) handed out`,
  );
  return 0;
}

function stop(io: CliIO, file: string, json: boolean, fileFlag: string): number {
  const now = Date.now();
  const stopped = updateSession(file, (session) => {
    if (!session || isEnded(session, now)) return { session: null, result: null };
    const next = { ...session, endsAt: new Date(now).toISOString(), stoppedAt: new Date(now).toISOString() };
    return { session: next, result: next };
  });
  if (json) {
    out(io, toJson({ stopped: Boolean(stopped), session: stopped ? publicState(stopped, now) : null }));
    return 0;
  }
  out(
    io,
    stopped ? `${BLAST.name} session stopped. A waiting \`${BLAST_CLI}${fileFlag}\` ends now.` : `No ${BLAST.name} session is running.`,
  );
  return 0;
}

function extend(io: CliIO, file: string, ms: number, json: boolean): number {
  const now = Date.now();
  const extended = updateSession(file, (session) => {
    if (!session || isEnded(session, now)) return { session: null, result: null };
    const next = { ...session, endsAt: new Date(Math.min(Date.parse(session.endsAt) + ms, now + MAX_SESSION_MS)).toISOString() };
    return { session: next, result: next };
  });
  if (json) {
    out(io, toJson({ extended: Boolean(extended), session: extended ? publicState(extended, now) : null }));
    return 0;
  }
  if (!extended) {
    errOut(io, `No ${BLAST.name} session is running.`);
    return 1;
  }
  out(io, `${BLAST.name} extended · ${timeLeft(Date.parse(extended.endsAt) - now)}`);
  return 0;
}

function readNotesSafe(file: string): StoredNote[] {
  try {
    return readNotes(file);
  } catch {
    return [];
  }
}

function mtime(file: string): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Wait for one batch, a check-in (`every` after starting) or the end. Wakes on
 * any change in the notes file's directory, which holds the session file too,
 * and on a slow poll; each wake costs one stat and one small read. Elapsed
 * time is measured on the monotonic clock, so a wall-clock change never
 * stretches a wait past the agent's command timeout.
 */
async function waitOnce(notesFile: string, file: string, every: number, timing: BlastTiming): Promise<Outcome> {
  const started = performance.now();
  let revision = notesRevision(notesFile);
  // A note sent a moment ago may be the first of a burst: wait out the quiet time.
  let lastChange = started - Math.max(0, Date.now() - mtime(notesFile));
  let firstPending: number | undefined;
  let lastBeat = started;
  let notes = readNotesSafe(notesFile);
  let wake = () => {};
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
    wake();
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dirname(notesFile), { persistent: false }, () => wake());
    watcher.on('error', () => {});
  } catch {
    /* The poll covers file systems that cannot be watched. */
  }
  const beat = (waiting: boolean) => {
    const at = Date.now();
    unlessBusy(() =>
      updateSession(file, (s) => ({
        session: s && !isEnded(s, at) ? { ...s, heartbeatAt: new Date(at).toISOString(), waiting } : null,
        result: undefined,
      })),
    );
  };
  // Claim under the lock: two waiting commands never get the same note.
  // Undefined when the lock is busy, so the claim waits for the next wake.
  const claim = () =>
    unlessBusy(() =>
      updateSession(file, (s) => {
        const at = Date.now();
        if (!s || isEnded(s, at)) return { session: null, result: null };
        const latest = readNotesSafe(notesFile);
        const unseen = unseenNotes(latest, s);
        const batch = unseen.slice(0, MAX_BATCH);
        const open = new Set(latest.filter((n) => !n.done).map((n) => n.id));
        // Closed and deleted notes leave the record, so it stays small and
        // a reopened note is handed out again.
        const seen = Object.fromEntries(Object.entries(s.seen).filter(([id]) => open.has(id)));
        for (const note of batch) seen[note.id] = noteFingerprint(note);
        const session = { ...s, seen, waiting: false, heartbeatAt: new Date(at).toISOString() };
        return { session, result: { batch, more: unseen.length - batch.length, session } };
      }),
    );
  try {
    while (true) {
      if (interrupted) {
        beat(false);
        return { type: 'interrupted' };
      }
      const now = performance.now();
      const session = readSession(file);
      if (!session || isEnded(session)) return { type: 'ended', session };
      const current = notesRevision(notesFile);
      if (current !== revision) {
        revision = current;
        lastChange = now;
        notes = readNotesSafe(notesFile);
      }
      const due = now >= started + every;
      let wakeAt = Math.min(
        started + every,
        now + Date.parse(session.endsAt) - Date.now(),
        lastBeat + timing.heartbeatMs,
        now + timing.pollMs,
      );
      if (unseenNotes(notes, session).length) {
        firstPending ??= now;
        const readyAt = Math.min(lastChange + timing.debounceMs, firstPending + timing.maxDebounceMs);
        // At a check-in, notes still settling are handed out rather than left waiting.
        if (now >= readyAt || due) {
          const claimed = claim();
          if (claimed === null) continue;
          if (claimed?.batch.length) return { type: 'batch', notes: claimed.batch, more: claimed.more, session: claimed.session };
          if (claimed) firstPending = undefined;
        } else wakeAt = Math.min(wakeAt, readyAt);
      } else firstPending = undefined;
      if (due) {
        beat(false);
        return { type: 'checkin', session };
      }
      if (now - lastBeat >= timing.heartbeatMs) {
        beat(true);
        lastBeat = now;
      }
      await new Promise<void>((done) => {
        const timer = setTimeout(finish, Math.max(5, wakeAt - performance.now()));
        function finish() {
          clearTimeout(timer);
          wake = () => {};
          done();
        }
        wake = finish;
      });
    }
  } finally {
    watcher?.close();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
