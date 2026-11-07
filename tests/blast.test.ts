import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { blastFile, blastResponse, readSession, touchSession } from '../src/blast';
import { runBlast, ENDED_EXIT } from '../src/cli/blast';
import { runCli } from '../src/cli/run';
import { BLAST, BLAST_CLI, formatDuration, parseDuration, blastPrompt, timeLeft } from '../src/core/blast';
import { readNotes, type StoredNote, updateNotes, writeNotes } from '../src/store';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

/** Short timings: real files and watches, quick enough for a unit test. */
const FAST = { debounceMs: 120, maxDebounceMs: 600, pollMs: 40, heartbeatMs: 100, endedGraceMs: 300 };

function project() {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-blast-')));
  dirs.push(cwd);
  const notes = join(cwd, '.iteration-feedback.json');
  writeNotes(notes, []);
  const text = { out: '', err: '' };
  const io = {
    cwd,
    stdout: { write: (s: string) => { text.out += s; } },
    stderr: { write: (s: string) => { text.err += s; } },
  };
  const take = () => { const value = text.out; text.out = ''; text.err = ''; return value; };
  return { cwd, notes, io, text, take, state: () => readSession(blastFile(notes)) };
}

function note(id: string, extra: Partial<StoredNote> = {}): StoredNote {
  return { id, route: '/', feedback: `Note ${id}`, element: null, done: false, doneAt: null, createdAt: new Date().toISOString(), ...extra };
}

function add(file: string, ...items: StoredNote[]) {
  updateNotes(file, (notes) => [...notes, ...items]);
}

const later = (ms: number, work: () => void) => new Promise<void>((done) => setTimeout(() => { work(); done(); }, ms));

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

  it('builds the prompt the panel copies from the shared name', () => {
    const prompt = blastPrompt(45);
    expect(prompt).toContain(`${BLAST_CLI} --for 45m`);
    expect(prompt).toContain(`Isotone ${BLAST.name} session for 45 minutes`);
    expect(prompt).toContain('--working');
    expect(prompt).toContain('--reply');
    expect(blastPrompt(60)).toContain('--for 1h');
  });
});

describe(`isotone ${BLAST.command}`, () => {
  it('hands out the open backlog at once and starts a session', async () => {
    const p = project();
    add(p.notes, note('backlog1', { createdAt: new Date(Date.now() - 60_000).toISOString() }));
    // The file was written just now, so the debounce applies; it is short here.
    const code = await runBlast(['--for', '10s', '--every', '2s'], p.io, FAST);
    expect(code).toBe(0);
    const output = p.take();
    expect(output).toContain(`${BLAST.name} session started`);
    expect(output).toContain('Never install or upgrade packages');
    expect(output).toContain('1 new note');
    expect(output).toContain('Note backlog1');
    expect(p.state()?.seen).toHaveProperty('backlog1');
    expect(p.state()?.waiting).toBe(false);
  });

  it('blocks until notes arrive, then batches a burst into one hand-out', async () => {
    const p = project();
    const started = Date.now();
    const waiting = runBlast(['--for', '10s', '--every', '3s', '--json'], p.io, FAST);
    await later(250, () => add(p.notes, note('first')));
    await later(60, () => add(p.notes, note('second')));
    expect(await waiting).toBe(0);
    const elapsed = Date.now() - started;
    const result = JSON.parse(p.take());
    expect(result.type).toBe('batch');
    expect(result.notes.map((n: StoredNote) => n.id)).toEqual(['first', 'second']);
    expect(result.notes[0].doneCommand).toBe('npx isotone --done first');
    expect(result.started).toBe(true);
    expect(result.next).toBe(`${BLAST_CLI} --json`);
    // It waited for the quiet time after the second note, not just the first.
    expect(elapsed).toBeGreaterThanOrEqual(250 + 60 + FAST.debounceMs);
  });

  it('checks in at --every, resumes without --for and never hands a note out twice', async () => {
    const p = project();
    add(p.notes, note('one', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    expect(await runBlast(['--for', '20s', '--every', '400ms'], p.io, FAST)).toBe(0);
    p.take();
    const endsAt = p.state()?.endsAt;
    // `one` is still open (not fixed yet) but was handed out: a check-in follows.
    expect(await runBlast([], p.io, FAST)).toBe(0);
    const checkin = p.take();
    expect(checkin).toMatch(/No new notes · (\d+ min|under a minute) left · run `npx isotone blast` again/);
    expect(checkin).toContain('1 note you were given is still open');
    expect(p.state()?.endsAt).toBe(endsAt);
    // Re-running the start command continues the same session.
    expect(await runBlast(['--for', '20s', '--every', '400ms', '--json'], p.io, FAST)).toBe(0);
    const again = JSON.parse(p.take());
    expect(again.type).toBe('checkin');
    expect(again.stillOpen).toEqual(['one']);
    expect(again.notice).toContain('Continuing the running session');
    expect(p.state()?.endsAt).toBe(endsAt);
    // Still visible to `--json`.
    await runCli(['--json'], p.io);
    expect(JSON.parse(p.take()).map((n: StoredNote) => n.id)).toEqual(['one']);
  });

  it('hands an edited note out again, so a reviewer can answer a question', async () => {
    const p = project();
    add(p.notes, note('ask', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    await runBlast(['--for', '20s', '--every', '300ms'], p.io, FAST);
    p.take();
    expect(await runCli(['--reply', 'ask', 'Which of the two buttons?'], p.io)).toBe(0);
    expect(p.take()).toContain('The note stays open');
    expect(readNotes(p.notes)[0].reply?.text).toBe('Which of the two buttons?');
    const waiting = runBlast(['--json'], p.io, FAST);
    await later(100, () => updateNotes(p.notes, (notes) => { notes[0].feedback = 'Note ask. The primary one.'; return notes; }));
    expect(await waiting).toBe(0);
    const batch = JSON.parse(p.take());
    expect(batch.type).toBe('batch');
    expect(batch.notes[0].feedback).toBe('Note ask. The primary one.');
    expect(batch.notes[0].reply.text).toBe('Which of the two buttons?');
  });

  it('holds back a note with an unanswered question, even in a new session', async () => {
    const p = project();
    add(p.notes, note('q', { createdAt: new Date(Date.now() - 5_000).toISOString() }), note('plain', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    await runCli(['--reply', 'q', 'Which one?'], p.io);
    p.take();
    expect(await runBlast(['--for', '10s', '--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    expect(JSON.parse(p.take()).notes.map((n: StoredNote) => n.id)).toEqual(['plain']);
    expect(await runBlast(['--new', '--for', '10s', '--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    const checkin = JSON.parse(p.take());
    expect(checkin.notes.map((n: StoredNote) => n.id)).toEqual(['plain']);
    await runBlast(['--stop'], p.io, FAST);
    p.take();
    expect(await runBlast(['--json'], p.io, FAST)).toBe(ENDED_EXIT);
    expect(JSON.parse(p.take()).stillOpen).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'q', awaitingAnswer: true })]));
  });

  it('only hands out its route, plus update notes', async () => {
    const p = project();
    const old = new Date(Date.now() - 5_000).toISOString();
    add(p.notes, note('home', { createdAt: old }), note('pricing', { route: '/pricing', createdAt: old }),
      note('upgrade', { createdAt: old, update: { from: '1.0.0', to: '1.1.0', command: 'pnpm add -D --exact isotone@1.1.0', cwd: '/app', manager: 'pnpm' } }));
    expect(await runBlast(['/pricing', '--for', '10s', '--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    expect(JSON.parse(p.take()).notes.map((n: StoredNote) => n.id)).toEqual(['home', 'pricing', 'upgrade'].filter((id) => id !== 'home'));
    expect(p.state()?.route).toBe('/pricing');
    expect(await runBlast(['/', '--json'], p.io, FAST)).toBe(1);
    expect(p.text.err).toContain('session for /pricing is running');
  });

  it('ends at the deadline with a distinct status, and keeps saying so', async () => {
    const p = project();
    add(p.notes, note('left', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    await runBlast(['--for', '700ms', '--every', '5s'], p.io, FAST);
    p.take();
    expect(await runBlast([], p.io, FAST)).toBe(ENDED_EXIT);
    const over = p.take();
    expect(over).toContain(`${BLAST.name} session over (time is up)`);
    expect(over).toContain('do not run `npx isotone blast` again');
    expect(over).toContain('[left');
    // The same start command right after the end does not start another.
    expect(await runBlast(['--for', '10s', '--json'], p.io, FAST)).toBe(ENDED_EXIT);
    expect(JSON.parse(p.take())).toMatchObject({ type: 'ended', ended: true, reason: 'time', stillOpen: [{ id: 'left' }] });
    // A while later, or with --new, it does.
    await later(FAST.endedGraceMs + 50, () => {});
    add(p.notes, note('fresh', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    await later(FAST.debounceMs, () => {});
    expect(await runBlast(['--for', '10s', '--every', '300ms', '--json'], p.io, FAST)).toBe(0);
    // A new session hands out what is open, including what the last one saw.
    expect(JSON.parse(p.take()).notes.map((n: StoredNote) => n.id)).toEqual(['left', 'fresh']);
  });

  it('picks up Extend and Stop from the endpoint while it waits', async () => {
    const p = project();
    const waiting = runBlast(['--for', '10s', '--every', '5s', '--json'], p.io, FAST);
    await later(150, () => {});
    const before = Date.parse(p.state()?.endsAt ?? '');
    expect(blastResponse(p.notes, { method: 'POST', body: { action: 'extend' } }).status).toBe(200);
    expect(Date.parse(p.state()?.endsAt ?? '') - before).toBe(15 * 60_000);
    const started = Date.now();
    expect(blastResponse(p.notes, { method: 'POST', body: { action: 'stop' } }).status).toBe(200);
    expect(await waiting).toBe(ENDED_EXIT);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(JSON.parse(p.take())).toMatchObject({ type: 'ended', reason: 'stopped-panel' });
    expect(blastResponse(p.notes, { method: 'POST', body: { action: 'extend' } }).status).toBe(409);
  });

  it('--stop, --status and --extend from the CLI', async () => {
    const p = project();
    expect(await runBlast(['--status'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain(`No ${BLAST.name} session`);
    const waiting = runBlast(['--for', '10m', '--every', '5s'], p.io, FAST);
    await later(150, () => {});
    expect(await runBlast(['--status'], p.io, FAST)).toBe(0);
    expect(p.take()).toMatch(/Blast · 10 min left[\s\S]*agent waiting for notes/);
    expect(await runBlast(['--extend', '5m'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain('15 min left');
    expect(await runBlast(['--stop'], p.io, FAST)).toBe(0);
    expect(await waiting).toBe(ENDED_EXIT);
    expect(p.take()).toContain('stopped with `npx isotone blast --stop`');
    expect(await runBlast(['--stop'], p.io, FAST)).toBe(0);
    expect(p.take()).toContain('No Blast session is running');
  });

  it('--stream prints one JSON line per batch until the end', async () => {
    const p = project();
    const running = runBlast(['--for', '1500ms', '--stream'], p.io, FAST);
    await later(150, () => add(p.notes, note('s1')));
    await later(400, () => add(p.notes, note('s2'), note('s3')));
    expect(await running).toBe(ENDED_EXIT);
    const lines = p.take().trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((line) => line.type)).toEqual(['started', 'batch', 'batch', 'ended']);
    expect(lines[1].notes.map((n: StoredNote) => n.id)).toEqual(['s1']);
    expect(lines[2].notes.map((n: StoredNote) => n.id)).toEqual(['s2', 's3']);
    expect(lines[3]).toMatchObject({ ended: true, reason: 'time', stillOpen: ['s1', 's2', 's3'] });
  });

  it('two waiting commands never get the same note', async () => {
    const p = project();
    await runBlast(['--for', '10s', '--every', '200ms'], p.io, FAST);
    const a = runBlast(['--every', '1s', '--json'], { ...p.io, stdout: { write: () => {} } }, FAST);
    const b = runBlast(['--every', '1s', '--json'], { ...p.io, stdout: { write: () => {} } }, FAST);
    await later(100, () => add(p.notes, note('only')));
    await Promise.all([a, b]);
    // One batch and one check-in; the note is recorded once.
    expect(Object.keys(p.state()?.seen ?? {})).toEqual(['only']);
  });

  it('rejects bad input before touching files', async () => {
    const p = project();
    for (const args of [['--for', '30'], ['--every', 'soon'], ['pricing'], ['--for', '9h'], ['--stop', '--status']]) {
      expect(await runBlast(args, p.io, FAST)).toBe(1);
    }
    expect(p.state()).toBeNull();
  });

  it('caps --every and says so', async () => {
    const p = project();
    add(p.notes, note('x', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    await runBlast(['--for', '30m', '--every', '20m'], p.io, FAST);
    expect(p.take()).toContain('--every is capped at 9m');
    expect(p.state()?.every).toBe(9 * 60_000);
  });

  it('keeps a session live through note commands, and reads a malformed file as none', async () => {
    const p = project();
    add(p.notes, note('w', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    await runBlast(['--for', '10s', '--every', '200ms'], p.io, FAST);
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

describe('the session endpoint', () => {
  it('reads the public state without the hand-out record', async () => {
    const p = project();
    expect(blastResponse(p.notes, { method: 'GET' }).body).toEqual({ session: null });
    add(p.notes, note('g', { createdAt: new Date(Date.now() - 5_000).toISOString() }));
    await runBlast(['--for', '10m', '--every', '200ms'], p.io, FAST);
    const { body } = blastResponse(p.notes, { method: 'GET' }) as { body: { session: Record<string, unknown> } };
    expect(body.session).toMatchObject({ live: true, ended: false, route: null, every: 200 });
    expect(body.session).not.toHaveProperty('seen');
  });

  it('accepts only extend and stop', () => {
    const p = project();
    for (const body of [undefined, {}, { action: 'start' }, { action: 'extend', endsAt: '2100-01-01' }]) {
      const result = blastResponse(p.notes, { method: 'POST', body });
      expect([400, 409]).toContain(result.status);
    }
    expect(readSession(blastFile(p.notes))).toBeNull();
    expect(blastResponse(p.notes, { method: 'DELETE' }).status).toBe(405);
  });

  it('caps an extension at eight hours ahead', () => {
    const p = project();
    const now = Date.now();
    writeFileSync(blastFile(p.notes), JSON.stringify({ version: 1, startedAt: new Date(now).toISOString(), endsAt: new Date(now + 7.9 * 3_600_000).toISOString(), every: 300_000, route: null, heartbeatAt: new Date(now).toISOString(), waiting: true, seen: {} }));
    blastResponse(p.notes, { method: 'POST', body: { action: 'extend' } }, now);
    expect(Date.parse(readSession(blastFile(p.notes))?.endsAt ?? '')).toBe(now + 8 * 3_600_000);
  });
});
