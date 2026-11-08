// Score an agent trial in one fixture app.
//
//   node scripts/trial/score.mjs <fixtureDir> <setup|loop> [--transcript <file.jsonl>] [--table <results.md>] [--tarball <file.tgz>]
//
// setup: Isotone is a devDependency installed from the trial tarball, the panel
//        is wired in behind a development-only check, the production build
//        succeeds and holds no panel code, AGENTS.md has the Isotone section,
//        and `isotone variant list` shows at least two variants or knobs.
// loop:  every note seed-notes.mjs wrote is done, the source diff since the
//        seed has a change that answers each one, and the build still passes.
//
// --transcript reads a Claude Code JSONL transcript and counts tool calls, Bash
// commands, isotone commands that exited non-zero, and reads of Isotone's
// built code (a sign the docs were not enough). Prints JSON; --table appends a
// row to a markdown table. Exits 1 when any check fails.
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { run, trialStateFile, walk } from './lib.mjs';

const USAGE =
  'Usage: node scripts/trial/score.mjs <fixtureDir> <setup|loop> [--transcript <file.jsonl>] [--table <results.md>] [--tarball <file.tgz>]';
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value;
};
const transcriptPath = flag('--transcript');
const tablePath = flag('--table');
const tarballFlag = flag('--tarball');
const [fixtureArg, scenario] = argv;
if (!fixtureArg || !['setup', 'loop'].includes(scenario)) {
  console.error(USAGE);
  process.exit(1);
}
const app = resolve(fixtureArg);
if (!existsSync(join(app, 'package.json'))) {
  console.error(`${app} has no package.json`);
  process.exit(1);
}

/** Strings that only Isotone's panel or endpoints put into built output. */
const MARKERS = ['isotone', '/api/iteration', '__isotone'];
/** Built output can name the app's absolute path or an ancestor (Next does), which may contain "isotone". */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ancestors = (path) => (dirname(path) === path ? [path] : [path, ...ancestors(dirname(path))]);
const OWN_PATHS = new RegExp(
  `(?:${
    [...ancestors(resolve(app)), ...ancestors(realpathSync(app))]
      .filter((path) => path.toLowerCase().includes('isotone'))
      .map(escapeRegExp)
      .join('|') || '(?!)'
  })[^\\s"'\`]*`,
  'g',
);
/** Directories that never hold the app's own source. */
const NOT_SOURCE = new Set(['node_modules', '.git', 'dist', '.next', '.isotone', 'out', 'build']);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|html?|vue|svelte|astro)$/;

const pkg = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const kind = deps.next ? 'next' : deps.vite ? 'vite' : 'plain';
const checks = [];
/** Record a check. `pass: null` means it does not apply to this fixture and is not counted. */
const check = (name, pass, detail = '') => checks.push({ name, pass, detail });
const read = (file) => readFileSync(file, 'utf8');
const rel = (file) => relative(app, file);

function isotone(args) {
  const bin = join(app, 'node_modules', 'isotone', 'dist', 'cli.js');
  if (!existsSync(bin)) return { status: 127, stdout: '', stderr: 'isotone is not installed' };
  return run(process.execPath, [bin, ...args], { cwd: app, env: { ...process.env, ISOTONE_UPDATE_CHECK: '0' } });
}

function productionBuild() {
  if (!pkg.scripts?.build) {
    check('production build succeeds', null, 'no build script (static HTML)');
    return false;
  }
  const result = run('npm', ['run', 'build'], {
    cwd: app,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', CI: '1' },
  });
  const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-5).join(' / ');
  check('production build succeeds', result.status === 0, result.status === 0 ? '' : tail);
  return result.status === 0;
}

function scoreSetup() {
  // 1. Installed as a devDependency, from this trial's tarball.
  const tarball = tarballFlag ?? readTarballTxt();
  const spec = pkg.devDependencies?.isotone;
  const installed = join(app, 'node_modules', 'isotone', 'package.json');
  const version = existsSync(installed) ? JSON.parse(read(installed)).version : null;
  const fromTarball = typeof spec === 'string' && (tarball ? spec.endsWith(basename(tarball)) : /\.tgz$/.test(spec));
  check(
    'isotone is a devDependency from the tarball',
    Boolean(fromTarball && version && !pkg.dependencies?.isotone),
    `devDependencies.isotone=${spec ?? '(none)'}${pkg.dependencies?.isotone ? ', also in dependencies' : ''}, installed=${version ?? '(none)'}`,
  );

  // 2. Wiring present, and every place that loads it behind a dev-only check.
  const files = walk(app, NOT_SOURCE).filter((file) => SOURCE_FILE.test(file));
  const viteConfigs = files.filter((file) => /(^|\/)vite\.config\.[cm]?[jt]s$/.test(file) && /['"]isotone\/vite['"]/.test(read(file)));
  const pluginWired = viteConfigs.some((file) => /\biteration\s*\(/.test(read(file)));
  const loaders = files.filter((file) => !viteConfigs.includes(file) && /isotone/.test(read(file)));
  const unguarded = loaders.filter((file) => !guarded(file));
  const wired = kind === 'vite' ? pluginWired || loaders.length > 0 : loaders.length > 0;
  check(
    'panel is wired in',
    wired,
    [
      viteConfigs.length ? `plugin in ${viteConfigs.map(rel).join(', ')}` : '',
      loaders.length ? `loaded in ${loaders.map(rel).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ') || 'no file references isotone',
  );
  check(
    'panel is behind a development-only check',
    wired && unguarded.length === 0,
    unguarded.length ? `unguarded: ${unguarded.map(rel).join(', ')}` : '',
  );

  // 3. The production build works and carries no panel.
  if (productionBuild()) {
    const outDir = kind === 'next' ? '.next' : 'dist';
    const built = walk(join(app, outDir), new Set(['cache'])).filter((file) => !/\.(?:nft\.json|map)$|\/trace$/.test(file));
    const hits = built.filter((file) => MARKERS.some((marker) => read(file).replace(OWN_PATHS, '').includes(marker)));
    check(
      'production build has no panel code',
      built.length > 0 && hits.length === 0,
      built.length === 0 ? `no files in ${outDir}` : hits.map(rel).slice(0, 5).join(', '),
    );
  } else if (pkg.scripts?.build) check('production build has no panel code', false, 'build failed');

  // 4. AGENTS.md carries the loop into later sessions.
  const agents = join(app, 'AGENTS.md');
  check('AGENTS.md has the Isotone section', existsSync(agents) && read(agents).includes('<!-- isotone:start'));

  // 5. The first run built at least two things to switch.
  const list = isotone(['variant', 'list']);
  const count = countRows(list.stdout, /^ID\s+LABEL/) + countRows(list.stdout, /^KNOB\s+KIND/);
  const skipped = list.stdout.split('\n').filter((line) => line.startsWith('Skipped'));
  check(
    'variant list shows at least 2 variants or knobs',
    list.status === 0 && count >= 2,
    `${count} listed${skipped.length ? `; ${skipped.join(' ')}` : ''}${list.status ? `; exit ${list.status}: ${list.stderr.trim()}` : ''}`,
  );
}

/** A file that loads Isotone from app code must only do so in development. */
function guarded(file) {
  const text = read(file);
  if (/\.html?$/.test(file)) {
    // Every <script> that mentions isotone must test for a localhost page.
    const scripts = text.match(/<script\b[\s\S]*?<\/script>/gi) ?? [];
    const loading = scripts.filter((tag) => /isotone/.test(tag));
    return loading.length > 0 && loading.every((tag) => /localhost/.test(tag) && /location\.hostname/.test(tag));
  }
  return /process\.env\.NODE_ENV|import\.meta\.env\.(?:DEV|PROD|MODE)|location\.hostname/.test(text);
}

/** Data rows under the header line that matches `header`, up to the next blank line. */
function countRows(text, header) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => header.test(line));
  if (start === -1) return 0;
  let n = 0;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.startsWith('Skipped')) break;
    n++;
  }
  return n;
}

function readTarballTxt() {
  const file = join(dirname(app), 'tarball.txt');
  return existsSync(file) ? read(file).trim() : null;
}

/** What answers each seeded note, matched against lines the agent added. */
const ANSWERS = {
  'sticky-header': /position\s*:\s*sticky|\bsticky\b/,
  'three-columns': /repeat\(\s*3\s*,|grid-cols-3|(?:1fr\s+){2}1fr|columns\s*:\s*3\b/,
  'get-started': /Get started/i,
};

function scoreLoop() {
  const statePath = trialStateFile(app);
  if (!existsSync(statePath)) {
    check('notes were seeded', false, 'run seed-notes.mjs on this fixture first');
    return;
  }
  const { base, notes: seeded } = JSON.parse(read(statePath));

  // 1. Every seeded note is closed.
  const listed = isotone(['--json', '--all']);
  let notes = [];
  try {
    notes = JSON.parse(listed.stdout);
  } catch {
    check('notes file is readable', false, `${listed.stderr.trim() || listed.stdout.slice(0, 200)}`);
  }
  for (const { key, id } of seeded) {
    const note = notes.find((n) => n.id === id);
    check(`note done: ${key}`, note?.done === true, note ? (note.done ? '' : 'still open') : `note ${id} is gone`);
  }

  // 2. The diff since the seed answers each note. A throwaway index stages
  // untracked files too, without touching the agent's index.
  const scratch = mkdtempSync(join(tmpdir(), 'isotone-trial-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') };
  run('git', ['read-tree', base], { cwd: app, env });
  run('git', ['add', '-A'], { cwd: app, env });
  const exclude = [':!.iteration-feedback.json', ':!.isotone', ':!package-lock.json', ':!pnpm-lock.yaml', ':!yarn.lock', ':!AGENTS.md'];
  const diff = run('git', ['diff', '--cached', '--unified=0', base, '--', '.', ...exclude], { cwd: app, env }).stdout;
  rmSync(scratch, { recursive: true, force: true });
  // Lines added per file, so each answer names where it landed.
  const added = new Map();
  let current = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) current = line.replace(/^\+\+\+ (?:b\/)?/, '');
    else if (line.startsWith('+') && current) added.set(current, `${added.get(current) ?? ''}${line.slice(1)}\n`);
  }
  for (const { key } of seeded) {
    const where = [...added].filter(([, text]) => ANSWERS[key]?.test(text)).map(([file]) => file);
    check(
      `source change for: ${key}`,
      where.length > 0,
      where.length
        ? `in ${where.join(', ')}`
        : added.size
          ? `not in the changed files: ${[...added.keys()].join(', ')}`
          : 'no source changes',
    );
  }

  // 3. The answer did not break the app.
  productionBuild();
}

/** Counts from a Claude Code JSONL transcript (the main session or a subagent's). */
function readTranscript(file) {
  const uses = [];
  const results = new Map();
  const times = [];
  for (const line of read(file).split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.timestamp) times.push(Date.parse(entry.timestamp));
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (entry.type === 'assistant' && part.type === 'tool_use') uses.push(part);
      if (entry.type === 'user' && part.type === 'tool_result') {
        const text = typeof part.content === 'string' ? part.content : (part.content ?? []).map((c) => c.text ?? '').join('\n');
        results.set(part.tool_use_id, { error: part.is_error === true || /^Exit code [1-9]/.test(text), text });
      }
    }
  }
  const bash = uses.filter((u) => u.name === 'Bash');
  // `npx isotone …`, `pnpm exec isotone …`, `node_modules/.bin/isotone …`, not `npm install -D isotone`.
  const isotoneCommand = /(?:npx\s+(?:--no-install\s+|-y\s+)?|exec\s+|\.bin\/|^|[;&|(]\s*)isotone(?=\s|$)/m;
  const isotoneRuns = bash.filter((u) => isotoneCommand.test(u.input?.command ?? ''));
  const failed = isotoneRuns.filter((u) => results.get(u.id)?.error);
  // Isotone's own files other than the shipped docs: built code, or the source repo.
  const internals = /node_modules\/isotone\/(?!docs\/|README|CHANGELOG|package\.json)|isotone[^\s'"]*\/(?:dist|src)\//;
  const docs = /node_modules\/isotone\/(?:docs\/|README|CHANGELOG)/;
  const touched = (u) =>
    [u.input?.file_path, u.input?.path, u.input?.pattern, u.input?.glob, u.name === 'Bash' ? u.input?.command : null]
      .filter(Boolean)
      .join(' ');
  const reading = uses.filter((u) => ['Read', 'Grep', 'Glob', 'Bash'].includes(u.name));
  const internalReads = reading.filter((u) => {
    const text = touched(u);
    return internals.test(text) && (u.name !== 'Bash' || /\b(?:cat|head|tail|sed|grep|rg|less|find|ls|awk)\b/.test(text));
  });
  return {
    toolCalls: uses.length,
    bashCommands: bash.length,
    isotoneCommands: isotoneRuns.length,
    isotoneFailures: failed.length,
    failedIsotoneCommands: failed.map((u) => u.input.command.slice(0, 200)),
    internalsReads: internalReads.length,
    internalsReadPaths: internalReads.map((u) => touched(u).slice(0, 200)),
    docsReads: reading.filter((u) => docs.test(touched(u))).length,
    webFetches: uses.filter((u) => u.name === 'WebFetch' || u.name === 'WebSearch').length,
    minutes: times.length > 1 ? Math.round((Math.max(...times) - Math.min(...times)) / 600) / 100 : null,
  };
}

if (scenario === 'setup') scoreSetup();
else scoreLoop();

const counted = checks.filter((c) => c.pass !== null);
const passed = counted.filter((c) => c.pass).length;
const report = {
  fixture: app,
  kind,
  scenario,
  pass: passed === counted.length,
  passed,
  total: counted.length,
  checks,
  ...(transcriptPath ? { transcript: readTranscript(resolve(transcriptPath)) } : {}),
};
console.log(JSON.stringify(report, null, 2));

if (tablePath) {
  const header =
    '| date | fixture | scenario | pass | checks | failed checks | tool calls | bash | isotone cmds | isotone failures | internals reads | docs reads | minutes |\n' +
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n';
  const t = report.transcript;
  const cell = (v) => (v === undefined || v === null ? '-' : String(v).replaceAll('|', '\\|'));
  const row = [
    new Date().toISOString().slice(0, 16).replace('T', ' '),
    basename(app),
    scenario,
    report.pass ? 'yes' : 'no',
    `${passed}/${counted.length}`,
    counted
      .filter((c) => !c.pass)
      .map((c) => c.name)
      .join('; ') || '-',
    t?.toolCalls,
    t?.bashCommands,
    t?.isotoneCommands,
    t?.isotoneFailures,
    t?.internalsReads,
    t?.docsReads,
    t?.minutes,
  ].map(cell);
  const existing = existsSync(tablePath) ? read(tablePath) : '';
  writeFileSync(tablePath, `${existing || header}| ${row.join(' | ')} |\n`);
}

process.exit(report.pass ? 0 : 1);
