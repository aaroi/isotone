import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { npm } from './npm.mjs';

// Size budgets, about 5% over the 1.3.0 build (panel bundle 349 kB, tarball
// 366 kB). Every host page loads the bundle, so growth should be a decision:
// raise a budget in the same change that needs it, and say why.
// Tarball raised to 405 kB (round 2 integration, 387 kB): the shipped note
// schema, the split Vite modules and the CLI's new guards.
// Bundle raised to 373.8 kB (motion pass, 371.8 kB): the fading selection key, crossfade and arrivals.
// Bundle raised to 384.5 kB and tarball to 415.5 kB (382.3 and 412.8 kB; hold to compare and the style digest of a pinned element):
// the Compare button, the page-wide key and the previews it switches, and the
// computed styles a pin records; 1.3.4 was 366 kB.
// Bundle raised to 391.5 kB and tarball to 420 kB (389.3 and 417.5 kB; scroll edges): the layered
// blur bands, the header and defaults-bar materials, the rim drawn over content and rows that recede.
// Bundle raised to 395 kB and tarball to 422.5 kB (393.8 and 420.8 kB; rolling figures): the component
// that rolls changed characters, and its notes in the shipped design guide and changelog.
// Tarball raised to 425.5 kB (423.9 kB; Default pinned per tab): the live store keeping `<group>:default`
// in `?v=`, the `--done` hint's per-note variant context, and their notes in the shipped docs.
// Tarball raised to 424.5 kB (424.4 kB; newcomer fixes): reading the key when an event has no code, knobs
// that clash with a group, and the notes on those, section names, colours and the variants directory.
// Bundle raised to 396.5 kB and tarball to 428.5 kB (395.1 and 427.4 kB; 1.5.0 shipped at 393.8 and
// 421.9 kB; per tab or shared): the panel's note on a link's unapplied ?v=, settled as the panel opens,
// init's switching paragraph, the variant commands' warning, and the guides and changelog that state it.
// Bundle raised to 397.5 kB and tarball to 429 kB (396.1 and 427.2 kB; a host source beside knobs):
// combining sources and the one set-defaults note across them, in every entry that mounts the panel,
// and the shipped docs that describe it.
// Tarball raised to 426 kB (425.1 kB; components compiled in parts): the part and reload handling
// in the Vite plugin, and the Vue, Svelte and Astro notes in the shipped variants guide and changelog.
// Tarball raised to 427.5 kB (426.5 kB; variants without Git): kept bases, the sync and
// stale messages that say why a copy can't merge, and their docs.
// Bundle raised to 397 kB and tarball to 428.5 kB (396.3 and 427.5 kB; note context): the selections a note
// records and their tags, and how `within` and `component` are read, with the note field in the agent
// guide, schema and changelog.
// Tarball raised to 423.5 kB (422.9 kB; copies obey fs.deny): the file check for every served copy,
// and its notes in the shipped variants guide and changelog.
// The figures above are each change on its own over 1.5.0. Merged together (#60 to #69), the bundle is
// 402.6 kB and the tarball 457.6 kB: bundle raised to 403.5 kB and tarball to 459 kB.
// Bundle raised to 405.5 kB and tarball to 464 kB (404.7 and 462.8 kB over integration/all; knobs without
// hydration errors): the adopted knob stylesheet, the page-wide record of what knobs wrote and the wait for
// React's hydration of <html>, and the Vite plugin's head script that applies stored values before the
// first paint, with their docs.
const BUDGET = { bundle: 405_500, tarball: 464_000 };

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
import { serveIsotone } from 'isotone/serve';
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
const app = await serveIsotone({ file: 'notes.json', port: 0, theme: 'system', checkForUpdates: false });
try {
  const bundle = await (await fetch(app.bundleUrl)).text();
  assert.ok(bundle.includes('window.__isotone'));
  assert.ok(bundle.includes('"theme":"system"'));
  const note = await fetch(app.url + '/api/isotone/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ route: '/', feedback: 'Package smoke test' }) });
  assert.equal(note.status, 201);
  assert.equal(JSON.parse(readFileSync('notes.json', 'utf8')).length, 1);
  // Blast is a CLI feature: no HTTP endpoint serves its session.
  assert.equal((await fetch(app.url + '/api/isotone/blast')).status, 404);
} finally { await app.close(); }
console.log('Packed package: isolated install, public imports, CLI, bundle and notes endpoint passed.');
`,
  );
  execFileSync(process.execPath, ['check.mjs'], { cwd: consumer, stdio: 'inherit' });
  typecheckAsConsumer(consumer);
  checkHeadScript(consumer);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

/**
 * Run the Vite plugin's inline `<head>` script, as the built plugin writes it into
 * a page, against a minimal DOM. The script carries functions as their source
 * text, so a build change that gave one an outside reference would break it in
 * the browser with every test still passing. Needs Vite, which
 * `typecheckAsConsumer` links in.
 * @param {string} consumer
 */
function checkHeadScript(consumer) {
  writeFileSync(
    join(consumer, 'head-script.mjs'),
    `
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isotone } from 'isotone/vite';

mkdirSync('.isotone', { recursive: true });
writeFileSync('.isotone/knobs.json', JSON.stringify([
  { kind: 'range', id: 'pad', label: 'Pad', min: 0, max: 40, step: 1, defaultValue: 8, unit: 'px' },
  { kind: 'select', id: 'ticks', label: 'Ticks', defaultOption: 'lines', options: [{ id: 'lines', label: 'Lines' }, { id: 'dots', label: 'Dots' }] },
]));

/** The head script the plugin writes into a page, for an app of this type with these plugins. */
function headScript(appType, plugins) {
  const plugin = isotone({ checkForUpdates: false, variants: { live: false } });
  const noop = () => {};
  plugin.configResolved({ root: process.cwd(), command: 'serve', assetsInclude: () => false, server: { fs: { strict: false } }, appType, plugins });
  const pages = [];
  plugin.configureServer({
    config: { root: process.cwd(), logger: { info: noop, warn: noop }, server: { fs: { strict: false, deny: [] } } },
    httpServer: null,
    middlewares: { use: (...args) => { if (typeof args[0] === 'function') pages.push(args[0]); } },
    watcher: { add: noop, on: noop, emit: noop },
    moduleGraph: { getModulesByFile: noop, invalidateModule: noop },
    ws: { send: noop },
    transformRequest: async () => null,
  });
  let html = '';
  const req = { method: 'GET', url: '/', headers: { host: 'localhost:5173', accept: 'text/html' }, socket: { remoteAddress: '127.0.0.1' }, on: noop };
  const res = { statusCode: 200, headersSent: false, setHeader: () => res, writeHead: () => res, write: () => true, end: (body) => { html = String(body ?? ''); } };
  const run = (i) => (pages[i] ? pages[i](req, res, () => run(i + 1)) : res.end('<!doctype html><html><head><title>app</title></head><body></body></html>'));
  run(0);
  const script = html.match(/<script data-isotone-head>([\\s\\S]*?)<\\/script>/);
  assert.ok(script, 'the plugin writes its head script into the page');
  return script[1];
}

/** Run it against just enough DOM: an adoptable sheet, <html> and storage. */
function runInPage(source) {
  const props = new Map();
  const attributes = new Map();
  class CSSStyleSheet {
    cssRules = [];
    insertRule() {
      this.cssRules.push({ style: { setProperty: (name, value, priority) => props.set(name, value + ' ' + priority) } });
    }
  }
  const window = { CSSStyleSheet };
  const document = {
    defaultView: window,
    adoptedStyleSheets: [],
    querySelector: () => null,
    documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
  };
  const localStorage = { getItem: () => JSON.stringify({ pad: '24', ticks: 'dots' }) };
  new Function('window', 'document', 'localStorage', source)(window, document, localStorage);
  return { props, attributes, window, document };
}

const spa = runInPage(headScript('spa', []));
assert.deepEqual(Object.fromEntries(spa.props), { '--knob-pad': '24px important', '--knob-ticks': 'dots important' });
assert.deepEqual(Object.fromEntries(spa.attributes), { 'data-knob-ticks': 'dots' });
assert.equal(spa.document.adoptedStyleSheets.length, 1);
assert.equal(spa.window.__isotoneHydrates, undefined);

const rendered = runInPage(headScript('custom', [{ name: 'react-router' }]));
assert.deepEqual(Object.fromEntries(rendered.props), { '--knob-pad': '24px important', '--knob-ticks': 'dots important' });
assert.deepEqual(Object.fromEntries(rendered.attributes), {});
assert.equal(rendered.window.__isotoneHydrates, true);
console.log('Packed head script: stored knob values apply from the built plugin, with select attributes held on a React server render.');
`,
  );
  execFileSync(process.execPath, ['head-script.mjs'], { cwd: consumer, stdio: 'inherit' });
}

/**
 * Compile a strict TypeScript file that uses every public subpath against the
 * packed declarations, as an app would, under both module resolutions an app
 * is likely to use. The peers' types (React, Vite, Node) are linked in from
 * this repository after the runtime checks, which require their absence.
 * @param {string} consumer
 */
function typecheckAsConsumer(consumer) {
  for (const name of ['@types', 'vite']) symlinkSync(join(root, 'node_modules', name), join(consumer, 'node_modules', name), 'junction');
  writeFileSync(
    join(consumer, 'consumer.ts'),
    `import { type IsotonePanelProps, IsotonePanel, mountIsotone } from 'isotone/react';
import { createVariantsSource, type IsotoneNote, type VariantAxis } from 'isotone/core';
import { type ServedIsotone, serveIsotone } from 'isotone/serve';
import { isotone } from 'isotone/vite';
import { runCli } from 'isotone/cli';
import type { PluginOption } from 'vite';

const plugins: PluginOption[] = [isotone()];
const panel: typeof IsotonePanel = (props: IsotonePanelProps) => IsotonePanel(props);
const unmount: () => void = mountIsotone({ theme: 'system' });
const axes: VariantAxis[] = [];
const source = createVariantsSource({ axes });
const notes: IsotoneNote[] = [];
const served: Promise<ServedIsotone> = serveIsotone({ file: 'notes.json', port: 0 });
const exit: Promise<number> = runCli(['--json']);
export { axes, exit, notes, panel, plugins, served, source, unmount };
`,
  );
  const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const strict = ['--noEmit', '--strict', '--skipLibCheck', 'false', '--target', 'es2022', '--lib', 'es2022,dom', 'consumer.ts'];
  for (const resolution of [
    ['--module', 'preserve', '--moduleResolution', 'bundler'],
    ['--module', 'node16', '--moduleResolution', 'node16'],
  ]) {
    execFileSync(process.execPath, [tsc, ...resolution, ...strict], { cwd: consumer, stdio: 'inherit' });
  }
  console.log('Packed declarations: a strict consumer compiles under bundler and node16 resolution.');
}
