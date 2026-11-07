/**
 * `npx isotone blast`: the user's coding agent keeps acting on notes for a set
 * time. The command blocks until new notes arrive, prints them as one batch
 * and exits; the agent acts on them and runs it again. Between batches it
 * prints a check-in every `--every`, and at the deadline a clear end. It costs
 * nothing while idle: it sleeps on a directory watch with a slow stat poll as
 * a fallback. Isotone never runs the agent.
 */
import { type FSWatcher, statSync, watch } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  BLAST, BLAST_CLI, BLAST_GUARDRAILS, DEFAULT_EVERY_MS, DEFAULT_FOR_MS, HEARTBEAT_MS, MAX_EVERY_MS,
  MAX_SESSION_MS, formatDuration, parseDuration, timeLeft,
} from '../core/blast';
import {
  type BlastSession, blastFile, isAwaitingAnswer, isEnded, isLive, noteFingerprint, publicState, readSession,
  seenOpenNotes, unseenNotes, updateSession,
} from '../blast';
import { notesRevision, readNotes, type StoredNote } from '../store';
import { notesProjectRoot } from '../update-request';
import { noteRecord, printNotes } from './run';
import { type CliIO, errOut, has, out, parseArgs, valueFor } from './util';

/** Exit status once the session is over, so an agent or script can tell it apart. */
export const ENDED_EXIT = 3;

export interface BlastTiming {
  /** Quiet time after the last change to the notes before a batch is handed out. */
  debounceMs: number;
  /** A steady stream of notes is handed out after this long regardless. */
  maxDebounceMs: number;
  /** Fallback poll, for file systems where watching misses events. */
  pollMs: number;
  heartbeatMs: number;
  /**
   * A bare run (an agent continuing) this soon after the end is told only to
   * stop; a later one is also told how to start a new session. Runs with
   * `--for` or `--new` start a new session whenever the last one is over.
   */
  endedGraceMs: number;
}

const TIMING: BlastTiming = {
  debounceMs: 3_000, maxDebounceMs: 15_000, pollMs: 2_000, heartbeatMs: HEARTBEAT_MS, endedGraceMs: 2 * 60_000,
};

type Outcome =
  | { type: 'batch'; notes: StoredNote[]; session: BlastSession }
  | { type: 'checkin'; session: BlastSession }
  | { type: 'ended'; session: BlastSession | null }
  | { type: 'interrupted' };

function help(io: CliIO): void {
  out(io, `Usage: isotone ${BLAST.command} [--for 30m] [--every 5m] [<route>] [--json] [--stream]`);
  out(io, `       isotone ${BLAST.command} --status | --stop | --extend 15m`);
  out(io);
  out(io, `${BLAST.name} lets your coding agent keep acting on notes for a set time. It waits for`);
  out(io, 'new notes, prints them as one batch and exits 0. With none by --every it prints a');
  out(io, `check-in and exits 0. Run it again after each, without --for. At the deadline it`);
  out(io, `prints "${BLAST.name} session over" and exits ${ENDED_EXIT}.`);
  out(io);
  out(io, '  --for <duration>    session length, e.g. 45m or 1h (default 30m)');
  out(io, '  --every <duration>  check-in interval (default 5m, at most 9m); keep it under');
  out(io, '                      your command timeout, e.g. --every 90s for a 2-minute one');
  out(io, '  <route>             hand out only this page\'s notes');
  out(io, '  --stream            stay running and print one JSON line per batch until the end');
  out(io, '  --json              print the batch, check-in or end as JSON');
  out(io, '  --status            show the session; --stop ends it; --extend adds time');
  out(io, '  --new               start a new session: the first run of a session, with --for.');
  out(io, '                      It replaces an abandoned session, and refuses a live one.');
  out(io, '  --file <path>       another notes file');
}

export async function runBlast(args: string[], io: CliIO, timingOverrides: Partial<BlastTiming> = {}): Promise<number> {
  const timing = { ...TIMING, ...timingOverrides };
  if (args[0] === '--help' || args[0] === '-h' || args[0] === 'help') { help(io); return 0; }
  let routes: string[];
  let forMs: number | undefined;
  let everyMs: number | undefined;
  let extendMs: number | undefined;
  try {
    routes = parseArgs(args, ['--for', '--every', '--file', '--extend'], ['--json', '--stream', '--stop', '--status', '--new']);
    if (routes.length > 1) throw new Error('Give at most one route.');
    if (routes[0] && !routes[0].startsWith('/')) throw new Error(`A route starts with "/", such as /pricing; got "${routes[0]}".`);
    const modes = ['--stop', '--status', '--extend', '--stream'].filter((flag) => has(args, flag));
    if (modes.length > 1) throw new Error(`Use only one of ${modes.join(', ')}.`);
    const forText = valueFor(args, '--for'), everyText = valueFor(args, '--every'), extendText = valueFor(args, '--extend');
    if (forText) forMs = parseDuration(forText);
    if (everyText) everyMs = parseDuration(everyText);
    if (extendText) extendMs = parseDuration(extendText);
    if (forMs !== undefined && forMs > MAX_SESSION_MS) throw new Error(`--for can be at most ${formatDuration(MAX_SESSION_MS)}.`);
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
  const json = has(args, '--json');
  const notesFile = resolve(io.cwd, valueFor(args, '--file') ?? '.iteration-feedback.json');
  const file = blastFile(notesFile);
  const fileFlag = valueFor(args, '--file') ? ` --file ${valueFor(args, '--file')}` : '';
  const next = `${BLAST_CLI}${json ? ' --json' : ''}${fileFlag}`;

  if (has(args, '--status')) return status(io, file, json);
  if (has(args, '--stop')) return stop(io, file, json);
  if (extendMs !== undefined) return extend(io, file, extendMs, json);

  let notice = '';
  if (everyMs !== undefined && everyMs > MAX_EVERY_MS) {
    notice = `--every is capped at ${formatDuration(MAX_EVERY_MS)}, so one wait stays under common agent command timeouts.`;
    everyMs = MAX_EVERY_MS;
  }
  const route = routes[0] ?? null;
  const now = Date.now();
  // Start, continue or report the end, in one step under the session lock.
  type Begun = { session: BlastSession; started: boolean } | { ended: BlastSession } | { error: string };
  let begun: Begun;
  try {
    begun = updateSession<Begun>(file, (session) => {
      const fresh = (): BlastSession => ({
        version: 1, startedAt: new Date(now).toISOString(), endsAt: new Date(now + (forMs ?? DEFAULT_FOR_MS)).toISOString(),
        every: everyMs ?? DEFAULT_EVERY_MS, route, heartbeatAt: new Date(now).toISOString(), waiting: true, seen: {},
      });
      const starting = forMs !== undefined || has(args, '--new');
      if (!session) {
        const started = fresh();
        return { session: started, result: { session: started, started: true } };
      }
      if (isEnded(session, now)) {
        // A first run (`--for`, as the documented prompt has it with `--new`)
        // starts the next session, however recently the last one ended. A bare
        // run is an agent continuing a session that is over: it stops.
        if (starting) {
          const started = fresh();
          return { session: started, result: { session: started, started: true } };
        }
        return { session: null, result: { ended: session } };
      }
      // `--new` never takes over a session an agent is still in: two agents
      // would share one session, each handed half the notes.
      if (has(args, '--new') && isLive(session, now)) {
        return { session: null, result: { error: `A ${BLAST.name} session is already running (${timeLeft(Date.parse(session.endsAt) - now)}, agent seen ${Math.max(0, Math.round((now - Date.parse(session.heartbeatAt ?? session.startedAt)) / 1000))}s ago). Run \`${BLAST_CLI}\` to continue it, or stop it first with \`${BLAST_CLI} --stop\` and run this again.` } };
      }
      // A session no agent has touched for a while is abandoned: a new `--for`
      // or `--new` replaces it, so notes the last agent saw are handed out again.
      if (starting && !isLive(session, now)) {
        const started = fresh();
        return { session: started, result: { session: started, started: true } };
      }
      if (routes[0] && route !== session.route) {
        return { session: null, result: { error: `A ${BLAST.name} session for ${session.route ?? 'all routes'} is running (${timeLeft(Date.parse(session.endsAt) - now)}). Run \`${BLAST_CLI}\` without a route to continue it, or \`${BLAST_CLI} --stop\` first.` } };
      }
      if (forMs !== undefined) notice ||= `Continuing the running session (${timeLeft(Date.parse(session.endsAt) - now)}); --for applies to a new one. Use --extend to add time.`;
      const continued = { ...session, heartbeatAt: new Date(now).toISOString(), waiting: true, ...(everyMs !== undefined ? { every: everyMs } : {}) };
      return { session: continued, result: { session: continued, started: false } };
    });
  } catch (error) {
    errOut(io, (error as Error).message);
    return 1;
  }
  if ('error' in begun) { errOut(io, begun.error); return 1; }
  if ('ended' in begun) return reportEnded(io, notesFile, begun.ended, json, false, timing.endedGraceMs);

  if (!json && !has(args, '--stream')) {
    if (begun.started) {
      const s = begun.session;
      out(io, `${BLAST.name} session started: ${formatDuration(Date.parse(s.endsAt) - Date.parse(s.startedAt))}, check-ins every ${formatDuration(s.every)}, ${s.route ?? 'all routes'}.`);
      out(io, 'While you act on notes by yourself:');
      for (const rule of BLAST_GUARDRAILS) out(io, `- ${rule}`);
      out(io);
    }
    if (notice) out(io, notice);
  }

  if (has(args, '--stream')) return stream(io, notesFile, file, timing, begun.started);

  const outcome = await waitOnce(notesFile, file, begun.session.every, timing);
  const started = begun.started;
  if (outcome.type === 'interrupted') return 130;
  if (outcome.type === 'ended') return reportEnded(io, notesFile, outcome.session, json, true);
  const left = Date.parse(outcome.session.endsAt) - Date.now();
  if (outcome.type === 'batch') {
    if (json) {
      out(io, JSON.stringify({
        type: 'batch', notes: outcome.notes.map((n) => noteRecord(n, notesProjectRoot(notesFile))), timeLeft: timeLeft(left), endsAt: outcome.session.endsAt, next,
        ...(started ? { started: true, guardrails: BLAST_GUARDRAILS } : {}), ...(notice ? { notice } : {}),
      }, null, 2));
    } else {
      out(io, `${BLAST.name} · ${outcome.notes.length} new note${outcome.notes.length === 1 ? '' : 's'} · ${timeLeft(left)}`);
      printNotes(io, outcome.notes, notesProjectRoot(notesFile));
      out(io);
      out(io, `Act on these one at a time, then run \`${next}\` again.`);
    }
    return 0;
  }
  const open = seenOpenNotes(readNotesSafe(notesFile), outcome.session);
  if (json) {
    out(io, JSON.stringify({
      type: 'checkin', notes: [], timeLeft: timeLeft(left), endsAt: outcome.session.endsAt, stillOpen: open.map((n) => n.id), next,
      ...(started ? { started: true, guardrails: BLAST_GUARDRAILS } : {}), ...(notice ? { notice } : {}),
    }, null, 2));
  } else {
    out(io, `No new notes · ${timeLeft(left)} · run \`${next}\` again`);
    if (open.length) out(io, `${open.length} note${open.length === 1 ? '' : 's'} you were given ${open.length === 1 ? 'is' : 'are'} still open; \`npx isotone --json\` lists ${open.length === 1 ? 'it' : 'them'}.`);
  }
  return 0;
}

/** `--stream`: one JSON line per batch, until the deadline. */
async function stream(io: CliIO, notesFile: string, file: string, timing: BlastTiming, started: boolean): Promise<number> {
  const first = readSession(file);
  out(io, JSON.stringify({ type: 'started', resumed: !started, endsAt: first?.endsAt, guardrails: BLAST_GUARDRAILS }));
  while (true) {
    const outcome = await waitOnce(notesFile, file, Number.POSITIVE_INFINITY, timing);
    if (outcome.type === 'interrupted') return 130;
    if (outcome.type === 'ended') {
      const open = outcome.session ? seenOpenNotes(readNotesSafe(notesFile), outcome.session) : [];
      out(io, JSON.stringify({ type: 'ended', ended: true, reason: endReason(outcome.session), stillOpen: open.map((n) => n.id) }));
      return ENDED_EXIT;
    }
    if (outcome.type === 'batch') {
      out(io, JSON.stringify({ type: 'batch', notes: outcome.notes.map((n) => noteRecord(n, notesProjectRoot(notesFile))), timeLeft: timeLeft(Date.parse(outcome.session.endsAt) - Date.now()), endsAt: outcome.session.endsAt }));
      // Still listening: the heartbeat keeps the session live.
      updateSession(file, (s) => ({ session: s && !isEnded(s) ? { ...s, waiting: true, heartbeatAt: new Date().toISOString() } : null, result: undefined }));
    }
  }
}

function endReason(session: BlastSession | null): 'time' | 'stopped-cli' | 'removed' {
  if (!session) return 'removed';
  if (session.stoppedBy === 'cli' || session.stoppedAt) return 'stopped-cli';
  return 'time';
}

function reportEnded(io: CliIO, notesFile: string, session: BlastSession | null, json: boolean, justNow: boolean, graceMs = 0): number {
  if (session) {
    try { updateSession(blastFile(notesFile), (s) => ({ session: s?.waiting ? { ...s, waiting: false } : null, result: undefined })); } catch { /* Reporting the end matters more. */ }
  }
  const reason = endReason(session);
  const open = session ? seenOpenNotes(readNotesSafe(notesFile), session) : [];
  if (json) {
    out(io, JSON.stringify({ type: 'ended', ended: true, reason, stillOpen: open.map((n) => ({ id: n.id, route: n.route, feedback: n.feedback.slice(0, 120), ...(isAwaitingAnswer(n) ? { awaitingAnswer: true } : {}) })) }, null, 2));
    return ENDED_EXIT;
  }
  const why = reason === 'time' ? 'time is up' : reason === 'stopped-cli' ? `stopped with \`${BLAST_CLI} --stop\`` : 'its state file was removed';
  out(io, `${BLAST.name} session over (${why}).`);
  out(io, `Stop now: do not run \`${BLAST_CLI}\` again. Give the user a short summary of what you changed${open.length ? ' and what is still open' : ''}.`);
  if (open.length) {
    out(io, 'Still open:');
    for (const n of open) out(io, `- [${n.id.slice(0, 8)}] ${n.route} — ${n.feedback.slice(0, 80)}${isAwaitingAnswer(n) ? ' (you asked; waiting for the reviewer)' : ''}`);
  }
  // Right after the end, a bare run is the agent's own next step: it only needs
  // to stop. Later, it is more likely someone looking to start again.
  const ago = session ? Date.now() - Date.parse(session.stoppedAt ?? session.endsAt) : 0;
  if (!justNow && session && ago > graceMs) {
    out(io, `(It ended ${ago < 60_000 ? 'under a minute' : `${Math.round(ago / 60_000)} min`} ago. To start a new session: \`${BLAST_CLI} --for 30m --new\`.)`);
  }
  return ENDED_EXIT;
}

function status(io: CliIO, file: string, json: boolean): number {
  const session = readSession(file);
  const state = session ? publicState(session) : null;
  if (json) { out(io, JSON.stringify({ session: state }, null, 2)); return 0; }
  if (!session || !state) { out(io, `No ${BLAST.name} session. Start one with \`${BLAST_CLI} --for 30m --new\`.`); return 0; }
  if (state.ended) { out(io, `${BLAST.name} session over (${endReason(session).replace('-', ' by ')}). Ended ${new Date(session.stoppedAt ?? session.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`); return 0; }
  const beat = session.heartbeatAt ? `${Math.round((Date.now() - Date.parse(session.heartbeatAt)) / 1000)}s ago` : 'never';
  out(io, `${BLAST.name} · ${timeLeft(Date.parse(session.endsAt) - Date.now())} · ends ${new Date(session.endsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · check-ins every ${formatDuration(session.every)} · ${session.route ?? 'all routes'}`);
  out(io, `agent ${state.waiting ? 'waiting for notes' : state.live ? 'working' : 'not seen recently'} · last heartbeat ${beat} · ${Object.keys(session.seen).length} note(s) handed out`);
  return 0;
}

function stop(io: CliIO, file: string, json: boolean): number {
  const now = Date.now();
  const stopped = updateSession(file, (session) => {
    if (!session || isEnded(session, now)) return { session: null, result: null };
    const next = { ...session, endsAt: new Date(now).toISOString(), stoppedAt: new Date(now).toISOString(), stoppedBy: 'cli' as const };
    return { session: next, result: next };
  });
  if (json) { out(io, JSON.stringify({ stopped: Boolean(stopped), session: stopped ? publicState(stopped, now) : null }, null, 2)); return 0; }
  out(io, stopped ? `${BLAST.name} session stopped. A waiting \`${BLAST_CLI}\` ends now.` : `No ${BLAST.name} session is running.`);
  return 0;
}

function extend(io: CliIO, file: string, ms: number, json: boolean): number {
  const now = Date.now();
  const extended = updateSession(file, (session) => {
    if (!session || isEnded(session, now)) return { session: null, result: null };
    const next = { ...session, endsAt: new Date(Math.min(Date.parse(session.endsAt) + ms, now + MAX_SESSION_MS)).toISOString() };
    return { session: next, result: next };
  });
  if (json) { out(io, JSON.stringify({ extended: Boolean(extended), session: extended ? publicState(extended, now) : null }, null, 2)); return 0; }
  if (!extended) { errOut(io, `No ${BLAST.name} session is running.`); return 1; }
  out(io, `${BLAST.name} extended · ${timeLeft(Date.parse(extended.endsAt) - now)}`);
  return 0;
}

function readNotesSafe(file: string): StoredNote[] {
  try { return readNotes(file); } catch { return []; }
}

function mtime(file: string): number {
  try { return statSync(file).mtimeMs; } catch { return 0; }
}

/**
 * Wait for one batch, a check-in (`every` after starting) or the end. Wakes on
 * any change in the notes file's directory, which holds the session file too,
 * and on a slow poll; each wake costs one stat and one small read.
 */
async function waitOnce(notesFile: string, file: string, every: number, timing: BlastTiming): Promise<Outcome> {
  const started = Date.now();
  let revision = notesRevision(notesFile);
  // A note sent a moment ago may be the first of a burst: wait out the quiet time.
  let lastChange = mtime(notesFile);
  let firstPending: number | undefined;
  let lastBeat = started;
  let notes = readNotesSafe(notesFile);
  let wake = () => {};
  let interrupted = false;
  const onSignal = () => { interrupted = true; wake(); };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(dirname(notesFile), { persistent: false }, () => wake());
    watcher.on('error', () => {});
  } catch { /* The poll covers file systems that cannot be watched. */ }
  const beat = (now: number, waiting: boolean) => updateSession(file, (s) => ({
    session: s && !isEnded(s, now) ? { ...s, heartbeatAt: new Date(now).toISOString(), waiting } : null, result: undefined,
  }));
  try {
    while (true) {
      if (interrupted) {
        beat(Date.now(), false);
        return { type: 'interrupted' };
      }
      const now = Date.now();
      const session = readSession(file);
      if (!session || isEnded(session, now)) return { type: 'ended', session };
      const current = notesRevision(notesFile);
      if (current !== revision) {
        revision = current;
        lastChange = Math.max(now, mtime(notesFile));
        notes = readNotesSafe(notesFile);
      }
      let wakeAt = Math.min(started + every, Date.parse(session.endsAt), lastBeat + timing.heartbeatMs, now + timing.pollMs);
      if (unseenNotes(notes, session).length) {
        firstPending ??= now;
        const readyAt = Math.min(lastChange + timing.debounceMs, firstPending + timing.maxDebounceMs);
        if (now >= readyAt) {
          // Claim under the lock: two waiting commands never get the same note.
          const claimed = updateSession(file, (s) => {
            if (!s || isEnded(s, now)) return { session: null, result: null };
            const latest = readNotesSafe(notesFile);
            const batch = unseenNotes(latest, s);
            const open = new Set(latest.filter((n) => !n.done).map((n) => n.id));
            // Closed and deleted notes leave the record, so it stays small and
            // a reopened note is handed out again.
            const seen = Object.fromEntries(Object.entries(s.seen).filter(([id]) => open.has(id)));
            for (const note of batch) seen[note.id] = noteFingerprint(note);
            const nextSession = { ...s, seen, waiting: false, heartbeatAt: new Date(now).toISOString() };
            return { session: nextSession, result: { batch, session: nextSession } };
          });
          if (!claimed) continue;
          if (claimed.batch.length) return { type: 'batch', notes: claimed.batch, session: claimed.session };
          firstPending = undefined;
          continue;
        }
        wakeAt = Math.min(wakeAt, readyAt);
      } else firstPending = undefined;
      if (now >= started + every) {
        beat(now, false);
        return { type: 'checkin', session };
      }
      if (now - lastBeat >= timing.heartbeatMs) {
        beat(now, true);
        lastBeat = now;
      }
      await new Promise<void>((done) => {
        const timer = setTimeout(finish, Math.max(5, wakeAt - Date.now()));
        function finish() { clearTimeout(timer); wake = () => {}; done(); }
        wake = finish;
      });
    }
  } finally {
    watcher?.close();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
