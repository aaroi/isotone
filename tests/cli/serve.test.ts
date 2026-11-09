// `isotone serve` through runCli: what it prints, that it really serves the
// notes endpoint, how it stops on a signal, and the errors an agent sees.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index';
import { type ServedIsotone, serveIsotone } from '../../src/serve/index';
import { captureIo } from '../helpers/cli';

const dirs: string[] = [];
const blockers: Server[] = [];
function root() {
  const dir = mkdtempSync(join(tmpdir(), 'iso-serve-cli-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(blockers.splice(0).map((server) => new Promise((done) => server.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('serves the notes file it prints, and exits 0 once a signal closes it', async () => {
  const cwd = root();
  const io = captureIo(cwd);
  const before = new Set(process.listeners('SIGTERM'));
  const exit = runCli(['serve', '--port', '0', '--no-update-check', '--file', 'review.json'], io);
  await expect.poll(() => io.text.out, { timeout: 5000 }).toContain('isotone serving on http://127.0.0.1:');
  const url = /serving on (\S+)/.exec(io.text.out)?.[1] ?? '';
  expect(io.text.out).toContain(`notes  ${join(cwd, 'review.json')}`);
  expect(io.text.out).toContain(`panel  ${url}/isotone.js`);

  const posted = await fetch(`${url}/api/isotone/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: url },
    body: JSON.stringify({ route: '/', feedback: 'Served through the CLI' }),
  });
  expect(posted.status).toBe(201);
  expect(JSON.parse(readFileSync(join(cwd, 'review.json'), 'utf8'))[0].feedback).toBe('Served through the CLI');

  // Deliver SIGTERM to the handler serve installed, without signalling the test runner.
  const stop = process.listeners('SIGTERM').filter((listener) => !before.has(listener));
  expect(stop).toHaveLength(1);
  (stop[0] as () => void)();
  expect(await exit).toBe(0);
  expect(process.listeners('SIGTERM').filter((listener) => !before.has(listener))).toHaveLength(0);
  await expect(fetch(`${url}/api/isotone/notes`)).rejects.toThrow();
});

it('names --port when the port is taken', async () => {
  // It reads, as a real server would, so it sees the probe hang up.
  const blocker = createServer((socket) => socket.resume());
  blockers.push(blocker);
  await new Promise<void>((done) => blocker.listen(0, '127.0.0.1', done));
  const port = (blocker.address() as { port: number }).port;
  const io = captureIo(root());
  expect(await runCli(['serve', '--port', String(port), '--no-update-check'], io)).toBe(1);
  expect(io.text.err).toContain(`Port ${port} is already in use`);
  expect(io.text.err).toContain('Pass --port <n>');
});

it.each([
  [['serve', 'extra'], 'serve does not take positional arguments.'],
  [['serve', '--port', '70000'], 'Port must be an integer between 0 and 65535.'],
  [['serve', '--host', '0.0.0.0', '--port', '0'], 'binds only to localhost'],
])('refuses %j with a clear message', async (args, message) => {
  const io = captureIo(root());
  expect(await runCli(args, io)).toBe(1);
  expect(io.text.err).toContain(message);
});

describe('several checkouts of one project', () => {
  const servers: ServedIsotone[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((served) => served.close()));
  });

  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });

  /** A repository and a second worktree of it. */
  function worktrees() {
    const main = root();
    git(main, 'init', '-q');
    git(main, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init', '--allow-empty');
    const tree = join(root(), 'tree');
    git(main, 'worktree', 'add', '-q', tree);
    return { main, tree };
  }

  function scripts(dir: string, script: string) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'shop', scripts: { isotone: script } }));
  }

  async function serveIn(dir: string, file = '.isotone/notes.json') {
    const served = await serveIsotone({ file: join(dir, file), projectRoot: dir, port: 0, checkForUpdates: false });
    servers.push(served);
    return served;
  }

  it('says whose it is', async () => {
    const dir = root();
    const served = await serveIn(dir);
    const owner = await (await fetch(`${served.url}/api/isotone/server`)).json();
    expect(owner).toMatchObject({ root: dir, file: join(dir, '.isotone/notes.json') });
    expect(typeof owner.isotone).toBe('string');
  });

  it('names the checkout holding the port when serve cannot start', async () => {
    const first = root();
    const served = await serveIn(first);
    const io = captureIo(root());
    expect(await runCli(['serve', '--port', String(served.port), '--no-update-check'], io)).toBe(1);
    expect(io.text.err).toContain(`Port ${served.port} is taken by the isotone serve in ${first}`);
    expect(io.text.err).toContain('save their notes there, not in this checkout');
    expect(io.text.err).toContain('Several checkouts at once');
  });

  it('says so when the port is held by this checkout already', async () => {
    const dir = root();
    const served = await serveIn(dir);
    const io = captureIo(dir);
    expect(await runCli(['serve', '--port', String(served.port), '--no-update-check'], io)).toBe(1);
    expect(io.text.err).toContain(`isotone serve is already running for this project on port ${served.port}`);

    const other = captureIo(dir);
    expect(await runCli(['serve', '--port', String(served.port), '--no-update-check', '--file', 'other.json'], other)).toBe(1);
    expect(other.text.err).toContain('taken by the isotone serve in this directory');
  });

  it('warns the notes CLI and Blast when the project port is another worktree’s', async () => {
    const { main, tree } = worktrees();
    const served = await serveIn(main);
    scripts(tree, `isotone serve --port ${served.port}`);
    const io = captureIo(tree);
    expect(await runCli(['--json'], io)).toBe(0);
    expect(JSON.parse(io.text.out)).toEqual([]);
    expect(io.text.err).toContain(`the isotone serve on port ${served.port} belongs to another checkout, ${main}`);
    expect(io.text.err).toContain(join(main, '.isotone/notes.json'));
    expect(io.text.err).toContain('Several checkouts at once');

    const blast = captureIo(tree);
    expect(await runCli(['blast', 'start', '--json'], blast)).toBe(0);
    expect(blast.text.err).toContain('belongs to another checkout');
  });

  it('points at --file when this checkout serves another notes file', async () => {
    const { main } = worktrees();
    const served = await serveIn(main, 'review.json');
    scripts(main, `isotone serve --port ${served.port} --file review.json`);
    const io = captureIo(main);
    expect(await runCli([], io)).toBe(0);
    expect(io.text.err).toContain('saves notes to another file');
    expect(io.text.err).toContain('Pass --file review.json');
    expect(io.text.err).not.toContain('another checkout');
  });

  it('stays quiet for its own server, another repository’s, and per-checkout ports', async () => {
    const { main, tree } = worktrees();
    const served = await serveIn(main);
    scripts(main, `isotone serve --port ${served.port}`);
    const own = captureIo(main);
    expect(await runCli([], own)).toBe(0);
    expect(own.text.err).not.toContain('Warning');

    const other = worktrees().tree;
    scripts(other, `isotone serve --port ${served.port}`);
    const elsewhere = captureIo(other);
    expect(await runCli([], elsewhere)).toBe(0);
    expect(elsewhere.text.err).not.toContain('Warning');

    scripts(tree, 'isotone serve --port $((PORT + 20000))');
    const computed = captureIo(tree);
    expect(await runCli([], computed)).toBe(0);
    expect(computed.text.err).not.toContain('Warning');
  });

  it('still reports a broken notes file as an error', async () => {
    const dir = root();
    mkdirSync(join(dir, '.isotone'));
    writeFileSync(join(dir, '.isotone/notes.json'), '{ not json');
    const io = captureIo(dir);
    expect(await runCli([], io)).toBe(1);
    expect(io.text.err).toContain('Could not read notes');
  });
});
