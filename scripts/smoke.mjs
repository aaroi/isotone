// Smoke-test the packed package in fresh apps across the supported peers.
//
//   node scripts/smoke.mjs [<isotone.tgz>] [vite:react ...]
//                                        e.g. node scripts/smoke.mjs 5:18 8:19
//
// Each pair installs the packed tarball (the given one, or a fresh `npm pack`
// of this checkout) with that Vite and React major into a new temporary app
// (network required). Third-party packages resolve only to versions published
// at least a week ago, as Dependabot's cooldown does, so a just-published
// compromised release never runs here. It checks what a user of the package
// relies on:
//   - a production `vite build` contains no panel and no endpoint, though the
//     app imports `isotone/react` behind `import.meta.env.DEV` as documented;
//   - the dev server injects the panel into an HTML navigation and serves its
//     bundle;
//   - a same-origin notes POST is stored and the CLI lists it, while a POST
//     from a foreign Origin is refused;
//   - `isotone/react` mounts the panel with the app's own React (in jsdom).
// Run `pnpm build` first when packing this checkout. Without pairs it runs
// every supported Vite major, with the oldest and newest React on each end.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { npm } from './npm.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const given = args[0]?.endsWith('.tgz') ? resolve(/** @type {string} */ (args.shift())) : undefined;
const pairs = (args.length ? args : ['5:18', '6:18', '7:19', '8:19']).map((pair) => {
  const match = /^(\d+):(\d+)$/.exec(pair);
  if (!match) throw new Error(`Expected <vite major>:<react major>, received ${JSON.stringify(pair)}`);
  return { vite: match[1] ?? '', react: match[2] ?? '' };
});
const JSDOM = `jsdom@${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies.jsdom}`;
const BEFORE = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const scratch = mkdtempSync(join(tmpdir(), 'iso-smoke-'));
/** @param {string[]} args @param {string} cwd */
const run = (args, cwd) => npm(args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });

/** Every file under `dir`, recursively. @param {string} dir @returns {string[]} */
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const DEV_CHECK = `
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const [expectedReact] = process.argv.slice(2);
// No dependency scan: the app has no dependencies to pre-bundle, and closing
// the server mid-scan prints a spurious error.
const server = await createServer({
  configFile: './vite.config.mjs',
  logLevel: 'warn',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0 },
});
await server.listen();
const base = server.resolvedUrls.local[0].replace(/\\/$/, '');
const notes = base + '/api/isotone/notes';
const post = (origin, feedback) =>
  fetch(notes, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ route: '/', feedback }),
  });
try {
  const html = await (await fetch(base + '/', { headers: { accept: 'text/html' } })).text();
  assert.match(html, /<script type="module" data-isotone-inject>/, 'the dev server injects the panel');
  const bundle = await fetch(base + '/@isotone/panel.js');
  assert.equal(bundle.status, 200, 'the panel bundle is served');
  assert.match(await bundle.text(), /__isotone/);

  assert.equal((await post(base, 'Smoke note')).status, 201, 'a same-origin note is stored');
  assert.equal((await post('https://evil.example', 'Foreign note')).status, 403, 'a foreign origin is refused');
  const listed = JSON.parse(execFileSync(process.execPath, ['node_modules/isotone/dist/bin.js', '--json'], { encoding: 'utf8' }));
  const texts = JSON.stringify(listed);
  assert.ok(texts.includes('Smoke note'), 'the CLI lists the stored note');
  assert.ok(!texts.includes('Foreign note'), 'the refused note was not stored');

  // isotone/react with the app's own React, in jsdom.
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: base + '/', pretendToBeVisual: true });
  for (const key of Object.getOwnPropertyNames(dom.window)) {
    if (!(key in globalThis)) globalThis[key] = dom.window[key];
  }
  for (const key of ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
  }
  class Inert { observe() {} unobserve() {} disconnect() {} }
  dom.window.ResizeObserver ??= Inert;
  dom.window.IntersectionObserver ??= Inert;
  globalThis.ResizeObserver ??= Inert;
  globalThis.IntersectionObserver ??= Inert;
  dom.window.matchMedia ??= (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.matchMedia = dom.window.matchMedia;

  const { version } = await import('react');
  assert.equal(version.split('.')[0], expectedReact, 'the app resolves the requested React');
  const { mountIsotone } = await import('isotone/react');
  const off = mountIsotone({ endpoint: notes });
  const deadline = Date.now() + 10_000;
  let panel = null;
  while (Date.now() < deadline) {
    panel = document.querySelector('[data-isotone]')?.shadowRoot?.querySelector('button') ?? null;
    if (panel) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(panel, 'isotone/react renders the panel into its shadow root');
  off();
  dom.window.close();
  console.log('  dev server, notes endpoint, CLI and isotone/react (React ' + version + ') passed');
} finally {
  await server.close();
}
`;

try {
  /** @type {[{ filename: string, files: { path: string }[] }]} */
  const [packed] = JSON.parse(
    run(['pack', '--ignore-scripts', '--json', ...(given ? ['--dry-run', given] : ['--pack-destination', scratch])], root),
  );
  assert.ok(
    packed.files.some(({ path }) => path === 'dist/isotone.global.js'),
    'run pnpm build before the smoke test',
  );
  const tarball = given ?? join(scratch, packed.filename);

  for (const { vite, react } of pairs) {
    const label = `Vite ${vite} + React ${react}`;
    const started = Date.now();
    console.log(`${label}: installing`);
    const app = join(scratch, `vite${vite}-react${react}`);
    mkdirSync(app);
    writeFileSync(join(app, 'package.json'), '{"private":true,"type":"module"}\n');
    writeFileSync(
      join(app, 'index.html'),
      '<!doctype html>\n<html><head><title>Smoke</title></head><body><main id="app">Smoke app</main><script type="module" src="/main.js"></script></body></html>\n',
    );
    writeFileSync(
      join(app, 'main.js'),
      [
        "document.getElementById('app').dataset.ready = 'true';",
        // The documented React mount: a dynamic import behind the development check.
        'if (import.meta.env.DEV) {',
        "  import('isotone/react').then(({ mountIsotone }) => mountIsotone({}));",
        '}',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(app, 'vite.config.mjs'),
      "import { defineConfig } from 'vite';\nimport { isotone } from 'isotone/vite';\n\nexport default defineConfig({ plugins: [isotone()] });\n",
    );
    writeFileSync(join(app, 'dev-check.mjs'), DEV_CHECK);
    run(
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        '--loglevel=error',
        `--before=${BEFORE}`,
        tarball,
        `vite@${vite}`,
        `react@${react}`,
        `react-dom@${react}`,
        JSDOM,
      ],
      app,
    );
    const installed = JSON.parse(readFileSync(join(app, 'node_modules/vite/package.json'), 'utf8')).version;
    assert.equal(installed.split('.')[0], vite, `installed Vite ${installed}`);

    // Production build: the plugin must leave nothing behind.
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--logLevel', 'warn'], {
      cwd: app,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    for (const file of files(join(app, 'dist'))) {
      const text = readFileSync(file, 'utf8');
      for (const marker of ['isotone', '/api/isotone', '__isotone']) {
        assert.ok(!text.includes(marker), `${file} contains ${marker} after a production build`);
      }
    }
    console.log(`  production build (Vite ${installed}) contains no panel`);

    execFileSync(process.execPath, ['dev-check.mjs', react], {
      cwd: app,
      stdio: 'inherit',
      env: { ...process.env, ISOTONE_UPDATE_CHECK: '0', NODE_ENV: 'development' },
      timeout: 120_000,
    });
    console.log(`${label}: passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
