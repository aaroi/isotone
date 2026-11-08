// Seed three open review notes into a fixture app, as the panel would save them.
//
//   node scripts/trial/seed-notes.mjs <fixtureDir>
//
// Run it after the setup trial (Isotone must be installed in the fixture). It
// first commits whatever the setup left, so the loop trial's diff shows only
// the agent's answer to the notes, then POSTs the notes to the installed
// package's own `isotone serve` endpoint, the same path the panel's save takes. The base commit and note ids go to
// .git/isotone-trial.json for score.mjs.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { git, trialStateFile } from './lib.mjs';

/** The notes, matched to the fixture page (the same DOM in all three fixtures). */
const SEEDED = [
  {
    key: 'sticky-header',
    feedback: 'Make the header sticky so the nav stays visible while I scroll the trails.',
    viewport: { w: 1280, h: 800 },
    element: {
      tag: 'header',
      text: 'Trail Finder Trails Maps About',
      selector: '#app > header:nth-child(1)',
      attributes: { class: 'site-header' },
      rect: { x: 0, y: 0, w: 1280, h: 59 },
    },
  },
  {
    key: 'three-columns',
    feedback: 'Cards should be 3 columns on desktop, two looks sparse at this width.',
    viewport: { w: 1440, h: 900 },
    element: {
      tag: 'section',
      text: 'Ridge Loop 8.2 km Open ridgeline with views over the lake. Cedar Hollow 5.4 km Shaded forest path',
      selector: '#app > main:nth-child(2) > section:nth-child(2)',
      attributes: { class: 'card-grid', 'aria-label': 'Featured trails' },
      within: ['Featured trails'],
      rect: { x: 192, y: 320, w: 1056, h: 1180 },
    },
  },
  {
    key: 'get-started',
    feedback: 'The button label should say "Get started", not "Sign up".',
    viewport: { w: 390, h: 844 },
    element: {
      tag: 'button',
      text: 'Sign up',
      selector: '#app > main:nth-child(2) > section:nth-child(1) > button:nth-child(3)',
      attributes: { class: 'cta', type: 'button' },
      within: ['Find your next trail'],
      rect: { x: 32, y: 260, w: 104, h: 45 },
    },
  },
];

const [fixtureArg] = process.argv.slice(2);
if (!fixtureArg) {
  console.error('Usage: node scripts/trial/seed-notes.mjs <fixtureDir>');
  process.exit(1);
}
const app = resolve(fixtureArg);
const server = join(app, 'node_modules', 'isotone', 'dist', 'serve.js');
if (!existsSync(server)) {
  console.error(`Isotone is not installed in ${app}. Run the setup trial first, or: npm install -D "$(cat <outDir>/tarball.txt)"`);
  process.exit(1);
}
if (!existsSync(join(app, '.git'))) {
  console.error(`${app} is not a Git repository; create fixtures with prepare.mjs.`);
  process.exit(1);
}

// Commit the setup's result so the loop's diff is the agent's answer alone.
git(app, ['add', '-A']);
const commit = git(app, ['commit', '-q', '-m', 'Trial: state after setup']);
if (commit.status !== 0 && !/nothing to commit/.test(commit.stdout + commit.stderr)) {
  throw new Error(`Could not commit the setup state: ${commit.stderr}`);
}
const base = git(app, ['rev-parse', 'HEAD']).stdout.trim();

const { serveIteration } = await import(pathToFileURL(server).href);
const file = join(app, '.iteration-feedback.json');
const notes = [];
const served = await serveIteration({ file, port: 0, checkForUpdates: false });
try {
  for (const note of SEEDED) {
    const response = await fetch(`${served.url}/api/iteration/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        route: '/',
        feedback: note.feedback,
        element: note.element,
        elements: [note.element],
        viewport: note.viewport,
      }),
    });
    const body = await response.json();
    if (response.status !== 201) throw new Error(`The notes endpoint refused "${note.key}": ${JSON.stringify(body)}`);
    notes.push({ key: note.key, id: body.id });
  }
} finally {
  await served.close();
}

const statePath = trialStateFile(app);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
writeFileSync(statePath, `${JSON.stringify({ ...state, base, notes }, null, 2)}\n`);
console.log(`Seeded ${notes.length} open notes into ${file}:`);
for (const { key, id } of notes) console.log(`  ${id}  ${key}`);
console.log(`Base commit for the loop diff: ${base}`);
