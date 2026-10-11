import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'iso-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args, cwd) => execFileSync(npm, args, {
  cwd, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(scratch, 'cache') },
});

try {
  const [packed] = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], root));
  assert.ok(packed.files.some(({ path }) => path === 'dist/isotone.global.js'), 'build before checking the package');
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  run(['install', '--offline', '--ignore-scripts', '--omit=peer', '--no-audit', '--no-fund', '--package-lock=false', join(scratch, packed.filename)], consumer);
  writeFileSync(join(consumer, 'check.mjs'), `
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runCli } from 'isotone/cli';
import * as core from 'isotone/core';
import { readNotes } from 'isotone/server';
import { serveIteration } from 'isotone/serve';

assert.equal(existsSync('node_modules/react'), false, 'standalone must not require React');
assert.equal(existsSync('node_modules/vite'), false, 'standalone must not require Vite');
assert.equal(typeof core.createIterationStore, 'function');
let output = '';
const io = { cwd: process.cwd(), stdout: { write: text => { output += text; } }, stderr: { write: text => { throw new Error(text); } } };
assert.equal(await runCli(['init', '--yes', '--json'], io), 0);
assert.equal(JSON.parse(output).approach, 'serve');
assert.equal(existsSync('AGENTS.md'), true);
assert.match(execFileSync(process.execPath, ['node_modules/isotone/dist/cli.js', '--help'], { encoding: 'utf8' }), /--json/);
const app = await serveIteration({ file: 'notes.json', port: 0, theme: 'system', checkForUpdates: false });
try {
  const bundle = await (await fetch(app.bundleUrl)).text();
  assert.ok(bundle.includes('window.__isotone'));
  assert.ok(bundle.includes('"theme":"system"'));
  const note = await fetch(app.url + '/api/iteration/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ route: '/', feedback: 'Package smoke test' }) });
  assert.equal(note.status, 201);
  assert.equal(readNotes('notes.json').length, 1);
} finally { await app.close(); }
console.log('Packed package: isolated install, public imports, CLI, bundle and notes endpoint passed.');
`);
  execFileSync(process.execPath, ['check.mjs'], { cwd: consumer, stdio: 'inherit' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
