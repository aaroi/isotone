import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { npm } from './npm.mjs';

// Size budgets, about 5% over the 1.3.0 build (panel bundle 349 kB, tarball
// 366 kB). Every host page loads the bundle, so growth should be a decision:
// raise a budget in the same change that needs it, and say why.
// Tarball raised to 405 kB (round 2 integration, 387 kB): the shipped note
// schema, the split Vite modules and the CLI's new guards.
const BUDGET = { bundle: 367_000, tarball: 405_000 };

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'iso-package-'));
/** @param {string[]} args @param {string} cwd */
const run = (args, cwd) => npm(args, { cwd, env: { ...process.env, npm_config_cache: join(scratch, 'cache') } });

try {
  /** @type {[{ filename: string, size: number, files: { path: string, size: number }[] }]} */
  const [packed] = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], root));
  const bundle = packed.files.find(({ path }) => path === 'dist/isotone.global.js');
  assert.ok(bundle, 'build before checking the package');
  assert.ok(bundle.size <= BUDGET.bundle, `dist/isotone.global.js is ${bundle.size} bytes, over its ${BUDGET.bundle}-byte budget`);
  assert.ok(packed.size <= BUDGET.tarball, `the packed tarball is ${packed.size} bytes, over its ${BUDGET.tarball}-byte budget`);
  assert.ok(
    packed.files.some(({ path }) => path === 'docs/blast.md'),
    'the Blast guide ships with the package',
  );
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  run(
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--omit=peer',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      join(scratch, packed.filename),
    ],
    consumer,
  );
  writeFileSync(
    join(consumer, 'check.mjs'),
    `
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { runCli } from 'isotone/cli';
import * as core from 'isotone/core';
import { serveIteration } from 'isotone/serve';
import { createRequire } from 'node:module';

assert.equal(existsSync('node_modules/react'), false, 'standalone must not require React');
// Every subpath resolves for require() too. The package is ESM-only, so a
// require() either loads it (Node 22 require(esm)) or fails with an ESM error,
// never with ERR_PACKAGE_PATH_NOT_EXPORTED.
const require = createRequire(import.meta.url);
assert.equal(require('isotone/package.json').name, 'isotone');
assert.equal((await import('isotone/package.json', { with: { type: 'json' } })).default.name, 'isotone');
for (const entry of ['react', 'core', 'serve', 'vite', 'cli']) {
  assert.ok(require.resolve('isotone/' + entry).endsWith('.js'), entry);
}
for (const entry of ['core', 'serve', 'cli']) {
  try { require('isotone/' + entry); } catch (error) {
    assert.notEqual(error.code, 'ERR_PACKAGE_PATH_NOT_EXPORTED', entry);
    assert.match(error.code ?? '', /^ERR_REQUIRE_(ESM|ASYNC_MODULE)$/, entry + ': ' + error.message);
  }
}
assert.equal(existsSync('node_modules/vite'), false, 'standalone must not require Vite');
assert.equal(typeof core.createVariantsSource, 'function');
let output = '';
const io = { cwd: process.cwd(), stdout: { write: text => { output += text; } }, stderr: { write: text => { throw new Error(text); } } };
assert.equal(await runCli(['init', '--yes', '--json'], io), 0);
assert.equal(JSON.parse(output).approach, 'serve');
assert.equal(existsSync('AGENTS.md'), true);
assert.match(execFileSync(process.execPath, ['node_modules/isotone/dist/bin.js', '--help'], { encoding: 'utf8' }), /--json/);
assert.match(execFileSync(process.execPath, ['node_modules/isotone/dist/bin.js', 'blast', 'status'], { encoding: 'utf8' }), /No Blast session/);
// A reader that stops early (\`| head\`) ends the output quietly, not with a stack trace.
const early = spawn(process.execPath, ['node_modules/isotone/dist/bin.js', '--help'], { stdio: ['ignore', 'pipe', 'pipe'] });
early.stdout.destroy();
let earlyErr = '';
early.stderr.on('data', (chunk) => { earlyErr += chunk; });
assert.equal(await new Promise((resolve) => early.on('close', resolve)), 0, earlyErr);
assert.equal(earlyErr, '');
const app = await serveIteration({ file: 'notes.json', port: 0, theme: 'system', checkForUpdates: false });
try {
  const bundle = await (await fetch(app.bundleUrl)).text();
  assert.ok(bundle.includes('window.__isotone'));
  assert.ok(bundle.includes('"theme":"system"'));
  const note = await fetch(app.url + '/api/iteration/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ route: '/', feedback: 'Package smoke test' }) });
  assert.equal(note.status, 201);
  assert.equal(JSON.parse(readFileSync('notes.json', 'utf8')).length, 1);
  // Blast is a CLI feature: no HTTP endpoint serves its session.
  assert.equal((await fetch(app.url + '/api/iteration/blast')).status, 404);
} finally { await app.close(); }
console.log('Packed package: isolated install, public imports, CLI, bundle and notes endpoint passed.');
`,
  );
  execFileSync(process.execPath, ['check.mjs'], { cwd: consumer, stdio: 'inherit' });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
