// `isotone serve` through runCli: what it prints, that it really serves the
// notes endpoint, how it stops on a signal, and the errors an agent sees.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index';
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

  const posted = await fetch(`${url}/api/iteration/notes`, {
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
  await expect(fetch(`${url}/api/iteration/notes`)).rejects.toThrow();
});

it('names --port when the port is taken', async () => {
  const blocker = createServer();
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
