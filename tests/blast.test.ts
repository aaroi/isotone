import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { blastFile, readSession, touchSession } from '../src/node/blast';
import { runBlast, ENDED_EXIT } from '../src/cli/blast';
import { runCli } from '../src/cli/run';
import { BLAST, BLAST_CLI, formatDuration, parseDuration, timeLeft } from '../src/core/blast';
import { notesResponse } from '../src/node/notes/handler';
import { readNotes, type StoredNote, updateNotes, writeNotes } from '../src/node/notes/store';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

/** Short timings: real files and watches, quick enough for a unit test. */
const FAST = { debounceMs: 120, maxDebounceMs: 600, pollMs: 40, heartbeatMs: 100 };

function project() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-blast-')));
  dirs.push(cwd);
  const notes = join(cwd, '.iteration-feedback.json');
  writeNotes(notes, []);
  const text = { out: '', err: '' };
  const io = {
    cwd,
    stdout: {
      write: (s: string) => {
        text.out += s;
      },
    },
    stderr: {
      write: (s: string) => {
        text.err += s;
      },
    },
  };
  const take = () => {
    const value = text.out;
    text.out = '';
    text.err = '';
    return value;
  };
  return { cwd, notes, io, text, take, state: () => readSession(blastFile(notes)) };
}

function note(id: string, extra: Partial<StoredNote> = {}): StoredNote {
  return {
    id,
    route: '/',
    feedback: `Note ${id}`,
    element: null,
    done: false,
    doneAt: null,
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

function add(file: string, ...items: StoredNote[]) {
  updateNotes(file, (notes) => [...notes, ...items]);
}

/** A second terminal in the same project, for `--stop` or `--extend` while a command waits. */
function other(cwd: string) {
  return { cwd, stdout: { write: () => {} }, stderr: { write: () => {} } };
}

/** The ready-to-paste prompt in docs/blast.md, which is how users start a session. */
const DOC_PROMPT =
  /## Starting a session[\s\S]*?```text\n([\s\S]*?)```/.exec(readFileSync(new URL('../docs/blast.md', import.meta.url), 'utf8'))?.[1] ?? '';

/** `start`, quietly. */
async function start(p: ReturnType<typeof project>, ...args: string[]) {
  const code = await runBlast(['start', ...args], p.io, FAST);
  p.take();
  return code;
}

const old = () => new Date(Date.now() - 5_000).toISOString();

const later = (ms: number, work: () => void) =>
  new Promise<void>((done) =>
    setTimeout(() => {
      work();
      done();
    }, ms),
  );

describe('durations and copy', () => {
  it('parses 30s, 5m, 1h and combinations, and rejects bare numbers', () => {
    expect(parseDuration('30s')).toBe(30_000);
    expect(parseDuration('5m')).toBe(300_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('1h30m')).toBe(5_400_000);
    expect(parseDuration(' 90S ')).toBe(90_000);
    expect(parseDuration('250ms')).toBe(250);
    for (const bad of ['30', 'm', '5 m', '-5m', '0m', '5d', '']) expect(() => parseDuration(bad)).toThrow();
  });

  it('formats time left and durations', () => {
    expect(timeLeft(31 * 60_000 + 5_000)).toBe('32 min left');
    expect(timeLeft(65 * 60_000)).toBe('1 h 5 min left');
    expect(timeLeft(20_000)).toBe('under a minute left');
    expect(formatDuration(45 * 60_000)).toBe('45m');
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
  });

  it('documents a one-line prompt that uses the real command', () => {
    expect(DOC_PROMPT.trim().split('\n')).toHaveLength(1);
    expect(DOC_PROMPT).toContain(`Isotone ${BLAST.name} session for 45 minutes: \`${BLAST_CLI} start 45m\``);
  });
});

describe(`isotone ${BLAST.command} start`, () => {
  it('starts a session and prints the loop and guardrails, without waiting', async () => {
    const p = project();
    expect(await runBlast(['start', '45m'], p.io, FAST)).toBe(0);
    const output = p.take();
    expect(output).toContain(`${BLAST.name} session started: 45m, all routes`);
    expect(output).toContain(`Now run \`${BLAST_CLI}\``);
    expect(output).toContain('--every off');
    expect(output).toContain('--working');
    expect(output).toContain('exit 3');
    expect(output).toContain('Never install or upgrade packages');
    expect(p.state()?.waiting).toBe(false);
    expect(Date.parse(p.state()?.endsAt ?? '') - Date.now()).toBeGreaterThan(44 * 60_000);
  });

  it('prints the same as one JSON object', async () => {
    const p = project();
    expect(await runBlast(['start', '--json', '--file', '.iteration-feedback.json'], p.io, FAST)).toBe(0);
    const started = JSON.parse(p.take());
    expect(started).toMatchObject({ type: 'started', route: null, next: `${BLAST_CLI} --json --file .iteration-feedback.json` });
    expect(started.loop[0]).toContain(started.next);
    expect(started.guardrails.length).toBeGreaterThan(0);
  });

  it('refuses while an agent is in a live session, and replaces an abandoned one', async () => {
    const p = project();
    await start(p, '10m');
    const before = p.state();
    expect(await runBlast(['start', '30m'], p.io, FAST)).toBe(1);
    expect(p.text.err).toContain('session is already running');
    expect(p.text.err).toContain(`${BLAST_CLI} stop`);
    expect(p.state()?.startedAt).toBe(before?.startedAt);
    // No agent for longer than a live session allows: it is abandoned.
    writeFileSync(blastFile(p.notes), JSON.stringify({ ...before, heartbeatAt: new Date(Date.now() - 16 * 60_000).toISOString() }));
    p.take();
    expect(await start(p, '30m')).toBe(0);
    expect(p.state()?.startedAt).not.toBe(before?.startedAt);
  });

  it('starts again right after stop, and after the time runs out', async () => {
    const p = project();
    await start(p, '10m');
    await runBlast(['stop'], p.io, FAST);
    expect(await start(p, '10m')).toBe(0);
    expect(p.state()?.stoppedAt).toBeUndefined();
    await later(10, () =>
      writeFileSync(blastFile(p.notes), JSON.stringify({ ...p.state(), endsAt: new Date(Date.now() - 1).toISOString() })),
    );
    expect(await start(p, '10m')).toBe(0);
    expect(Date.parse(p.state()?.endsAt ?? '') - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it('still accepts the 1.2.0 flags', async () => {
    const p = project();
    add(p.notes, note('legacy', { createdAt: old() }));
    expect(await runBlast(['--for', '10m', '--new', '--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    const [started, batch] = p
      .take()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(started.type).toBe('started');
    expect(batch).toMatchObject({ type: 'batch', notes: [{ id: 'legacy' }] });
    expect(await runBlast(['--status'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain('10 min left');
    expect(await runBlast(['--extend', '5m'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain('15 min left');
    expect(await runBlast(['--stop'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain('session stopped');
  });
});

describe(`isotone ${BLAST.command}`, () => {
  it('hands out the open backlog at once', async () => {
    const p = project();
    add(p.notes, note('backlog1', { createdAt: new Date(Date.now() - 60_000).toISOString() }));
    await start(p, '10s');
    // The file was written just now, so the debounce applies; it is short here.
    expect(await runBlast(['--every', '2s'], p.io, FAST)).toBe(0);
    const output = p.take();
    expect(output).toContain('1 new note');
    expect(output).toContain('Note backlog1');
    expect(output).toContain(`then run \`${BLAST_CLI} --every 2s\` again`);
    expect(p.state()?.seen).toHaveProperty('backlog1');
    expect(p.state()?.waiting).toBe(false);
  });

  it('blocks until notes arrive, then batches a burst into one hand-out', async () => {
    const p = project();
    await start(p, '10s');
    const started = Date.now();
    const waiting = runBlast(['--every', '3s', '--json'], p.io, FAST);
    await later(250, () => add(p.notes, note('first')));
    await later(60, () => add(p.notes, note('second')));
    expect(await waiting).toBe(0);
    const elapsed = Date.now() - started;
    const output = p.take();
    expect(output.trim().split('\n')).toHaveLength(1);
    const result = JSON.parse(output);
    expect(result.type).toBe('batch');
    expect(result.notes.map((n: StoredNote) => n.id)).toEqual(['first', 'second']);
    expect(result.notes[0].doneCommand).toBe('npx isotone --done first');
    expect(result.next).toBe(`${BLAST_CLI} --every 3s --json`);
    // It waited for the quiet time after the second note, not just the first.
    expect(elapsed).toBeGreaterThanOrEqual(250 + 60 + FAST.debounceMs);
  });

  it('checks in at --every and never hands a note out twice', async () => {
    const p = project();
    add(p.notes, note('one', { createdAt: old() }));
    await start(p, '20s');
    expect(await runBlast(['--every', '400ms'], p.io, FAST)).toBe(0);
    p.take();
    // `one` is still open (not fixed yet) but was handed out: a check-in follows.
    expect(await runBlast(['--every', '400ms'], p.io, FAST)).toBe(0);
    const checkin = p.take();
    expect(checkin).toMatch(/No new notes · (\d+ min|under a minute) left · run `npx isotone blast --every 400ms` again/);
    expect(checkin).toContain('1 note you were given is still open');
    expect(await runBlast(['--every', '400ms', '--json'], p.io, FAST)).toBe(0);
    expect(JSON.parse(p.take())).toMatchObject({ type: 'checkin', stillOpen: ['one'] });
    // Still visible to `--json`.
    await runCli(['--json'], p.io);
    expect(JSON.parse(p.take()).map((n: StoredNote) => n.id)).toEqual(['one']);
  });

  it('--every off waits for a batch or the end, with no check-in', async () => {
    const p = project();
    await start(p, '10s');
    const started = Date.now();
    const waiting = runBlast(['--every', 'off', '--json'], p.io, { ...FAST, heartbeatMs: 50 });
    await later(700, () => add(p.notes, note('late')));
    expect(await waiting).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
    expect(JSON.parse(p.take())).toMatchObject({ type: 'batch', notes: [{ id: 'late' }], next: `${BLAST_CLI} --every off --json` });
  });

  it('never starts a session: with none it says so and exits as over', async () => {
    const p = project();
    expect(await runBlast([], p.io, FAST)).toBe(ENDED_EXIT);
    expect(p.take()).toContain('there is no session');
    expect(p.state()).toBeNull();
    expect(await runBlast(['--json'], p.io, FAST)).toBe(ENDED_EXIT);
    expect(JSON.parse(p.take())).toMatchObject({ type: 'ended', reason: 'none', stillOpen: [] });
  });

  it('hands an edited note out again, so a reviewer can answer a question', async () => {
    const p = project();
    add(p.notes, note('ask', { createdAt: old() }));
    await start(p, '20s');
    await runBlast(['--every', '300ms'], p.io, FAST);
    p.take();
    expect(await runCli(['--reply', 'ask', 'Which of the two buttons?'], p.io)).toBe(0);
    expect(p.take()).toContain('The note stays open');
    expect(readNotes(p.notes)[0].reply?.text).toBe('Which of the two buttons?');
    const waiting = runBlast(['--json'], p.io, FAST);
    await later(100, () =>
      updateNotes(p.notes, (notes) => {
        notes[0].feedback = 'Note ask. The primary one.';
        return notes;
      }),
    );
    expect(await waiting).toBe(0);
    const batch = JSON.parse(p.take());
    expect(batch.type).toBe('batch');
    expect(batch.notes[0].feedback).toBe('Note ask. The primary one.');
    expect(batch.notes[0].reply.text).toBe('Which of the two buttons?');
    // The edit answered it: no longer a pending question, anywhere it is read.
    expect(batch.notes[0].reply.answered).toBe(true);
    await runCli(['--json'], p.io);
    expect(JSON.parse(p.take())[0].reply).toMatchObject({ text: 'Which of the two buttons?', answered: true });
    await runCli([], p.io);
    expect(p.take()).toContain('↩ you asked, and the reviewer has since edited the note: Which of the two buttons?');
    const [row] = notesResponse(p.notes, { method: 'GET', url: '/' }).body as StoredNote[];
    expect(row.reply?.answered).toBe(true);
  });

  it('keeps a question pending until the note changes', async () => {
    const p = project();
    add(p.notes, note('wait', { createdAt: old() }));
    await runCli(['--reply', 'wait', 'Which page?'], p.io);
    p.take();
    const [row] = notesResponse(p.notes, { method: 'GET', url: '/' }).body as StoredNote[];
    expect(row.reply).toMatchObject({ text: 'Which page?' });
    expect(row.reply?.answered).toBeUndefined();
    await runCli([], p.io);
    expect(p.take()).toContain('↩ you asked: Which page?');
  });

  it('holds back a note with an unanswered question, even in a new session', async () => {
    const p = project();
    add(p.notes, note('q', { createdAt: old() }), note('plain', { createdAt: old() }));
    await runCli(['--reply', 'q', 'Which one?'], p.io);
    await start(p, '10s');
    expect(await runBlast(['--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    expect(JSON.parse(p.take()).notes.map((n: StoredNote) => n.id)).toEqual(['plain']);
    await runBlast(['stop'], p.io, FAST);
    await start(p, '10s');
    expect(await runBlast(['--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    expect(JSON.parse(p.take()).notes.map((n: StoredNote) => n.id)).toEqual(['plain']);
    await runBlast(['stop'], p.io, FAST);
    p.take();
    expect(await runBlast(['--json'], p.io, FAST)).toBe(ENDED_EXIT);
    expect(JSON.parse(p.take()).stillOpen).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'q', awaitingAnswer: true })]));
  });

  it('only hands out its route, plus update notes', async () => {
    const p = project();
    add(
      p.notes,
      note('home', { createdAt: old() }),
      note('pricing', { route: '/pricing', createdAt: old() }),
      note('upgrade', {
        createdAt: old(),
        update: { from: '1.0.0', to: '1.1.0', command: 'pnpm add -D --exact isotone@1.1.0', cwd: '/app', manager: 'pnpm' },
      }),
    );
    expect(await start(p, '10s', '/pricing')).toBe(0);
    expect(p.state()?.route).toBe('/pricing');
    expect(await runBlast(['--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    expect(JSON.parse(p.take()).notes.map((n: StoredNote) => n.id)).toEqual(['pricing', 'upgrade']);
    expect(await runBlast(['/', '--json'], p.io, FAST)).toBe(1);
    expect(p.text.err).toContain('A route is set when the session starts');
  });

  it('ends at the deadline with a distinct status, and keeps saying so', async () => {
    const p = project();
    add(p.notes, note('left', { createdAt: old() }));
    await start(p, '700ms');
    await runBlast(['--every', '5s'], p.io, FAST);
    p.take();
    expect(await runBlast([], p.io, FAST)).toBe(ENDED_EXIT);
    const over = p.take();
    expect(over).toContain(`${BLAST.name} session over (time is up)`);
    expect(over).toContain('do not run `npx isotone blast` again');
    expect(over).toContain('[left');
    expect(over).not.toContain('start');
    expect(await runBlast(['--json'], p.io, FAST)).toBe(ENDED_EXIT);
    expect(JSON.parse(p.take())).toMatchObject({ type: 'ended', reason: 'time', stillOpen: [{ id: 'left' }] });
    expect(await runBlast(['status'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain(`Start one with \`${BLAST_CLI} start 30m\``);
  });

  it('picks up extend and stop from another terminal while it waits', async () => {
    const p = project();
    await start(p, '10s');
    const waiting = runBlast(['--every', '5s', '--json'], p.io, FAST);
    await later(150, () => {});
    const before = Date.parse(p.state()?.endsAt ?? '');
    expect(await runBlast(['extend', '15m'], other(p.cwd), FAST)).toBe(0);
    expect(Date.parse(p.state()?.endsAt ?? '') - before).toBe(15 * 60_000);
    const started = Date.now();
    expect(await runBlast(['stop'], other(p.cwd), FAST)).toBe(0);
    expect(await waiting).toBe(ENDED_EXIT);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(JSON.parse(p.take())).toMatchObject({ type: 'ended', reason: 'stopped' });
    expect(await runBlast(['extend', '15m'], other(p.cwd), FAST)).toBe(1);
  });

  it('status, stop and extend', async () => {
    const p = project();
    expect(await runBlast(['status'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain(`No ${BLAST.name} session`);
    await start(p, '10m');
    const waiting = runBlast(['--every', '5s'], p.io, FAST);
    await later(150, () => {});
    expect(await runBlast(['status'], p.io, FAST)).toBe(0);
    expect(p.take()).toMatch(/Blast · 10 min left[\s\S]*agent waiting for notes/);
    expect(await runBlast(['extend', '5m'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain('15 min left');
    expect(await runBlast(['stop'], p.io, FAST)).toBe(0);
    expect(await waiting).toBe(ENDED_EXIT);
    expect(p.take()).toContain('stopped with `npx isotone blast stop`');
    expect(await runBlast(['stop'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain('No Blast session is running');
  });

  it('--stream prints one JSON line per batch until the end', async () => {
    const p = project();
    await start(p, '1500ms');
    const running = runBlast(['--stream'], p.io, FAST);
    await later(150, () => add(p.notes, note('s1')));
    await later(400, () => add(p.notes, note('s2'), note('s3')));
    expect(await running).toBe(ENDED_EXIT);
    const lines = p
      .take()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(['batch', 'batch', 'ended']);
    expect(lines[0].notes.map((n: StoredNote) => n.id)).toEqual(['s1']);
    expect(lines[1].notes.map((n: StoredNote) => n.id)).toEqual(['s2', 's3']);
    expect(lines[2]).toMatchObject({ reason: 'time', stillOpen: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
  });

  it('two waiting commands never get the same note', async () => {
    const p = project();
    await start(p, '10s');
    const a = runBlast(['--every', '1s', '--json'], { ...p.io, stdout: { write: () => {} } }, FAST);
    const b = runBlast(['--every', '1s', '--json'], { ...p.io, stdout: { write: () => {} } }, FAST);
    await later(100, () => add(p.notes, note('only')));
    await Promise.all([a, b]);
    // One batch and one check-in; the note is recorded once.
    expect(Object.keys(p.state()?.seen ?? {})).toEqual(['only']);
  });

  it('rejects bad input before touching files', async () => {
    const p = project();
    for (const args of [
      ['start', '30'],
      ['--every', 'soon'],
      ['pricing'],
      ['start', '9h'],
      ['start', '--every', '1m'],
      ['extend'],
      ['stop', '/x'],
    ]) {
      expect(await runBlast(args, p.io, FAST)).toBe(1);
    }
    expect(p.state()).toBeNull();
  });

  it('caps --every and says so', async () => {
    const p = project();
    add(p.notes, note('x', { createdAt: old() }));
    await start(p, '30m');
    await runBlast(['--every', '20m'], p.io, FAST);
    const output = p.take();
    expect(output).toContain('--every is capped at 9m');
    expect(output).toContain(`run \`${BLAST_CLI} --every 9m\` again`);
  });

  it('keeps a session live through note commands, and reads a malformed file as none', async () => {
    const p = project();
    add(p.notes, note('w', { createdAt: old() }));
    await start(p, '10s');
    await runBlast(['--every', '200ms'], p.io, FAST);
    const file = blastFile(p.notes);
    const beat = p.state()?.heartbeatAt;
    await later(20, () => runCli(['--working', 'w'], p.io));
    expect(p.state()?.heartbeatAt).not.toBe(beat);
    writeFileSync(file, '{ not json');
    expect(readSession(file)).toBeNull();
    touchSession(p.notes);
    expect(readSession(file)).toBeNull();
  });
});

describe('the session state', () => {
  it('status --json shows the public state without the hand-out record', async () => {
    const p = project();
    expect(await runBlast(['status', '--json'], p.io, FAST)).toBe(0);
    expect(JSON.parse(p.take())).toEqual({ session: null });
    await start(p, '10m');
    expect(await runBlast(['status', '--json'], p.io, FAST)).toBe(0);
    const { session } = JSON.parse(p.take()) as { session: Record<string, unknown> };
    expect(session).toMatchObject({ live: true, ended: false, route: null });
    expect(session).not.toHaveProperty('seen');
  });

  it('caps an extension at eight hours ahead', async () => {
    const p = project();
    const now = Date.now();
    writeFileSync(
      blastFile(p.notes),
      JSON.stringify({
        version: 1,
        startedAt: new Date(now).toISOString(),
        endsAt: new Date(now + 7.9 * 3_600_000).toISOString(),
        route: null,
        heartbeatAt: new Date(now).toISOString(),
        waiting: true,
        seen: {},
      }),
    );
    expect(await runBlast(['extend', '1h'], p.io, FAST)).toBe(0);
    const endsAt = Date.parse(readSession(blastFile(p.notes))?.endsAt ?? '');
    expect(endsAt).toBeLessThanOrEqual(Date.now() + 8 * 3_600_000);
    expect(endsAt).toBeGreaterThanOrEqual(now + 8 * 3_600_000);
  });

  it('reads a 1.2.0 session file, which also stored every and stoppedBy', async () => {
    const p = project();
    const now = Date.now();
    writeFileSync(
      blastFile(p.notes),
      JSON.stringify({
        version: 1,
        startedAt: new Date(now).toISOString(),
        endsAt: new Date(now + 60_000).toISOString(),
        every: 300_000,
        route: null,
        heartbeatAt: new Date(now).toISOString(),
        waiting: false,
        stoppedBy: 'cli',
        seen: {},
      }),
    );
    expect(readSession(blastFile(p.notes))).toMatchObject({ route: null, seen: {} });
  });
});
