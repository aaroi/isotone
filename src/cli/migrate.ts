import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { version } from '../../package.json';
import { type CliIO, out, parseArgs, valueFor } from './util';

const OLD = 'iso-iterate';
const NEW = 'isotone';
const TEXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.jsonc', '.md', '.mdx', '.html', '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.yaml', '.yml', '.toml', '.sh']);
const SKIP = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.nuxt', '.output', 'coverage', '.turbo']);
const LOCKS = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb']);
type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';
interface Edit { path: string; before: string; after: string; mode: number; gitExclude?: boolean }
interface Move { from: string; to: string }
interface Plan {
  root: string;
  edits: Edit[];
  moves: Move[];
  blobs: Map<string, string>;
  conflicts: string[];
  install: { cwd: string; command: string } | null;
  installs: Array<{ cwd: string; command: string }>;
  warnings: string[];
}

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).trimEnd();
}

function renamed(text: string): string {
  const keys: string[] = [];
  const protect = (match: string, prefix: string, quote: string, value: string) => {
    if (value === 'iso-iterate-feedback' || value === 'iso-iterate:knobs') return match;
    const index = keys.push(value) - 1;
    return `${prefix}${quote}\u0000KEY${index}\u0000${quote}`;
  };
  const protectedText = text
    .replace(/(\b(?:key|storageKey)\s*:\s*|["'](?:key|storageKey)["']\s*:\s*)(["'`])([\s\S]*?)\2/g, protect)
    .replace(/(\b(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\(\s*)(["'`])([\s\S]*?)\2/g, protect);
  let result = protectedText.replace(/\biso-iterate@\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?/g, `${NEW}@${version}`)
    .replaceAll(OLD, NEW).replaceAll('iso-iter-', 'isotone-')
    .replaceAll('isoIterate', 'isotone').replaceAll('IsoIterate', 'Isotone')
    .replaceAll('ISO_ITERATE', 'ISOTONE').replaceAll('ISO_VARIANT', 'ISOTONE_VARIANT');
  keys.forEach((value, index) => { result = result.replaceAll(`\u0000KEY${index}\u0000`, value); });
  return result;
}

function present(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}

function textContents(buffer: Buffer): string | null {
  if (buffer.includes(0)) return null;
  const text = buffer.toString('utf8');
  return Buffer.from(text).compare(buffer) === 0 && !feedback(text) ? text : null;
}

function safeFile(root: string, path: string): boolean {
  const parts = relative(root, path).split(/[\\/]/);
  if (parts.includes('..') || parts.some(part => SKIP.has(part))) return false;
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) return false; } catch { return false; }
  }
  return lstatSync(path).isFile();
}

function walk(directory: string, visit: (path: string) => void, legacy: (path: string) => void, skipped?: (path: string) => void): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) { if (entry.name === `.${OLD}`) legacy(path); continue; }
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      if (present(join(path, '.git'))) { skipped?.(path); continue; }
      if (entry.name === `.${OLD}`) legacy(path);
      else if (entry.name !== '.isotone') walk(path, visit, legacy, skipped);
    } else if (entry.isFile()) visit(path);
  }
}

function json(text: string): Record<string, unknown> | null {
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

function feedback(text: string): boolean {
  try {
    const data = JSON.parse(text);
    return Array.isArray(data) && data.some(note => note && typeof note === 'object' && typeof note.feedback === 'string' && typeof note.id === 'string');
  } catch { return false; }
}

function packageText(text: string, path: string, conflicts: string[]): string {
  const pkg = json(text);
  if (!pkg) { conflicts.push(`Invalid package.json: ${path}`); return text; }
  for (const key of ['overrides', 'resolutions', 'pnpm']) {
    if (JSON.stringify(pkg[key])?.includes(OLD)) conflicts.push(`Legacy package in ${path} (${key}). Review custom overrides/resolutions before migrating.`);
  }
  let changed = false;
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  if (sections.some(key => Object.hasOwn(Object(pkg[key]), OLD)) && sections.some(key => Object.hasOwn(Object(pkg[key]), NEW))) {
    conflicts.push(`Both package names exist in ${path}. Resolve their dependency declarations before migrating.`);
    return text;
  }
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg[key];
    if (!deps || typeof deps !== 'object' || Array.isArray(deps) || !Object.hasOwn(deps, OLD)) continue;
    const values = deps as Record<string, unknown>;
    values[NEW] = version;
    delete values[OLD];
    changed = true;
  }
  if (!changed) return renamed(text);
  // Preserve the manifest's indentation and final newline. Other fields retain their values.
  const indent = /\n([\t ]+)"/.exec(text)?.[1] ?? '  ';
  return renamed(JSON.stringify(pkg, null, indent)) + (text.endsWith('\n') ? '\n' : '');
}

function installStep(root: string, override?: Manager): { install: Plan['install']; warning?: string } {
  let directory = root;
  let manager = override;
  while (true) {
    const pkg = existsSync(join(directory, 'package.json')) ? json(readFileSync(join(directory, 'package.json'), 'utf8')) : null;
    const declared = typeof pkg?.packageManager === 'string' ? /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager)?.[1] as Manager | undefined : undefined;
    const found = new Set<Manager>();
    if (existsSync(join(directory, 'package-lock.json')) || existsSync(join(directory, 'npm-shrinkwrap.json'))) found.add('npm');
    if (existsSync(join(directory, 'pnpm-lock.yaml'))) found.add('pnpm');
    if (existsSync(join(directory, 'yarn.lock'))) found.add('yarn');
    if (existsSync(join(directory, 'bun.lock')) || existsSync(join(directory, 'bun.lockb'))) found.add('bun');
    if (declared || found.size || dirname(directory) === directory || existsSync(join(directory, '.git'))) {
      if (!manager && typeof pkg?.packageManager === 'string' && !declared) return { install: null, warning: 'Unsupported packageManager; run its install command to regenerate the lockfile.' };
      if (!manager && !declared && found.size > 1) return { install: null, warning: 'Multiple lockfiles: pass --manager npm, pnpm, yarn or bun for an install command.' };
      manager ??= declared ?? [...found][0] ?? 'npm';
      const command = `${manager} install`;
      return { install: { cwd: pkg || found.size ? directory : root, command } };
    }
    directory = dirname(directory);
  }
}

function planMigration(cwd: string, manager?: Manager): Plan {
  let root = resolve(cwd);
  let tracked: string[] | null = null;
  try { root = git(root, ['rev-parse', '--show-toplevel']); tracked = git(root, ['ls-files', '-z']).split('\0').filter(Boolean); } catch { /* Known project files work without Git. */ }
  const plan: Plan = { root, edits: [], moves: [], blobs: new Map(), conflicts: [], install: null, installs: [], warnings: [] };
  const candidates = new Set<string>();
  const legacyRoots = new Set<string>();
  const addLegacy = (path: string) => {
    if (legacyRoots.has(path)) return;
    legacyRoots.add(path);
    if (lstatSync(path).isSymbolicLink()) { plan.conflicts.push(`Legacy directory is a symlink: ${relative(root, path)}. Migrate its target separately.`); return; }
    const destination = join(dirname(path), '.isotone');
    if (present(destination)) plan.conflicts.push(`Both ${relative(root, path)} and ${relative(root, destination)} exist; nothing will be overwritten.`);
    plan.moves.push({ from: path, to: destination });
    walk(path, file => candidates.add(file), nested => plan.conflicts.push(`Nested legacy directory: ${relative(root, nested)}`));
  };
  if (tracked) for (const file of tracked) candidates.add(join(root, file));
  // Untracked source stays outside the Git migration. Conventional root setup files
  // and private variant copies must still migrate in newly onboarded repositories.
  walk(root, path => {
    const name = basename(path);
    if (!tracked || dirname(path) === root && (['AGENTS.md', 'package.json', '.gitignore', '.npmignore'].includes(name) || /^(?:vite|next|react-router|svelte|astro|nuxt)\.config\./.test(name))) candidates.add(path);
  }, addLegacy, path => plan.warnings.push(`Separate Git checkout skipped: ${relative(root, path)}. Migrate it separately.`));
  if (tracked) {
    const exclude = resolve(root, git(root, ['rev-parse', '--git-path', 'info/exclude']));
    if (existsSync(exclude) && lstatSync(exclude).isFile() && !lstatSync(exclude).isSymbolicLink()) {
      const before = readFileSync(exclude, 'utf8');
      const after = renamed(before);
      if (before !== after) plan.edits.push({ path: exclude, before, after, mode: lstatSync(exclude).mode, gitExclude: true });
    }
  }
  for (const file of candidates) {
    const name = basename(file);
    if (LOCKS.has(name) || name === '.iteration-feedback.json' || !safeFile(root, file)) continue;
    if (relative(root, file).split(/[\\/]/).some(part => part !== `.${OLD}` && renamed(part) !== part)) {
      plan.conflicts.push(`Legacy name in a file path: ${relative(root, file)}. Rename that file or directory and its local references before migrating.`);
      continue;
    }
    if (!TEXT.has(extname(file)) && !['.gitignore', '.npmignore'].includes(name)) continue;
    const before = textContents(readFileSync(file));
    if (before === null) continue;
    for (const match of before.matchAll(/\biso-iterate@([^\s"'`;,)}\]]+)/g)) {
      if (!/^(?:latest|\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?)$/.test(match[1])) {
        plan.conflicts.push(`Custom package version constraint in ${relative(root, file)}. Replace it with the desired Isotone version before migrating.`);
      }
    }
    const after = name === 'package.json' ? packageText(before, relative(root, file), plan.conflicts) : renamed(before);
    if (after !== before) plan.edits.push({ path: file, before, after, mode: lstatSync(file).mode });
  }
  // Rename the stored merge base as well as the override. Existing host edits
  // stay stale; a package/import rename alone must not create a false conflict.
  if (tracked) for (const file of candidates) {
    if (basename(file) !== 'variant.json' || !safeFile(root, file) || ![...legacyRoots].some(path => file.startsWith(`${path}/`))) continue;
    const before = readFileSync(file, 'utf8');
    const existing = plan.edits.find(edit => edit.path === file);
    const data = json(existing?.after ?? before);
    if (!data?.files || typeof data.files !== 'object') continue;
    let changed = false;
    for (const [key, entry] of Object.entries(data.files)) {
      if (!TEXT.has(extname(key)) && !['.gitignore', '.npmignore'].includes(basename(key))) continue;
      if (!entry || typeof entry !== 'object' || typeof entry.base !== 'string' || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(entry.base)) continue;
      let base: string | null;
      try { base = textContents(execFileSync('git', ['cat-file', 'blob', entry.base], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })); } catch { continue; }
      if (base === null || basename(key) === '.iteration-feedback.json') continue;
      const after = basename(key) === 'package.json' ? packageText(base, key, []) : renamed(base);
      if (after === base) continue;
      const hash = createHash(entry.base.length === 64 ? 'sha256' : 'sha1').update(`blob ${Buffer.byteLength(after)}\0`).update(after).digest('hex');
      entry.base = hash;
      plan.blobs.set(hash, after);
      changed = true;
    }
    if (changed) {
      const after = `${JSON.stringify(data, null, 2)}\n`;
      if (existing) existing.after = after;
      else plan.edits.push({ path: file, before, after, mode: lstatSync(file).mode });
    }
  }
  const packages = plan.edits.filter(edit => basename(edit.path) === 'package.json' && edit.before.includes(`"${OLD}"`));
  for (const edit of packages) {
    const step = installStep(dirname(edit.path), manager);
    if (step.install && !plan.installs.some(existing => existing.cwd === step.install?.cwd && existing.command === step.install.command)) plan.installs.push(step.install);
    if (step.warning) plan.warnings.push(`${relative(root, edit.path)}: ${step.warning}`);
  }
  plan.install = plan.installs.length === 1 ? plan.installs[0] : null;
  if (!tracked) plan.warnings.push('No Git repository: review the changed text files before installing.');
  return plan;
}

function atomicWrite(path: string, text: string, mode: number): void {
  const temporary = `${path}.${randomUUID()}.migrate`;
  try { writeFileSync(temporary, text, { flag: 'wx', mode }); renameSync(temporary, path); }
  finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

function apply(plan: Plan): void {
  for (const edit of plan.edits) if (!(edit.gitExclude ? lstatSync(edit.path).isFile() && !lstatSync(edit.path).isSymbolicLink() : safeFile(plan.root, edit.path)) || readFileSync(edit.path, 'utf8') !== edit.before) throw new Error(`File changed during migration: ${relative(plan.root, edit.path)}. Run the preview again.`);
  for (const move of plan.moves) if (present(move.to) || lstatSync(move.from).isSymbolicLink()) throw new Error(`Directory changed during migration: ${relative(plan.root, move.from)}.`);
  const written: Edit[] = [], moved: Move[] = [];
  try {
    for (const [hash, contents] of plan.blobs) if (git(plan.root, ['hash-object', '--no-filters', '-w', '--stdin'], contents) !== hash) throw new Error('Could not preserve a variant merge base.');
    for (const edit of plan.edits) { atomicWrite(edit.path, edit.after, edit.mode); written.push(edit); }
    for (const move of plan.moves) { renameSync(move.from, move.to); moved.push(move); }
  } catch (error) {
    for (const move of moved.reverse()) renameSync(move.to, move.from);
    for (const edit of written.reverse()) atomicWrite(edit.path, edit.before, edit.mode);
    throw error;
  }
}

export function runMigrate(args: string[], io: CliIO): number {
  if (args.some(arg => arg === '--help' || arg === '-h')) {
    out(io, 'Usage: isotone migrate [--write] [--json] [--manager npm|pnpm|yarn|bun]');
    out(io, 'Preview migration from iso-iterate. --write applies it; installing remains an explicit next step.');
    return 0;
  }
  if (parseArgs(args, ['--manager'], ['--write', '--json']).length) throw new Error('migrate does not take positional arguments.');
  const manager = valueFor(args, '--manager');
  if (manager && !['npm', 'pnpm', 'yarn', 'bun'].includes(manager)) throw new Error('--manager must be npm, pnpm, yarn or bun.');
  const plan = planMigration(io.cwd, manager as Manager | undefined);
  const write = args.includes('--write');
  const changed = plan.edits.length > 0 || plan.moves.length > 0;
  if (write && !plan.conflicts.length) apply(plan);
  const summary = {
    root: plan.root, version, applied: write && !plan.conflicts.length && changed,
    edits: plan.edits.map(edit => relative(plan.root, edit.path)),
    moves: plan.moves.map(move => ({ from: relative(plan.root, move.from), to: relative(plan.root, move.to) })),
    conflicts: plan.conflicts, warnings: plan.warnings, install: changed ? plan.install : null, installs: changed ? plan.installs : [],
  };
  if (args.includes('--json')) out(io, JSON.stringify(summary, null, 2));
  else {
    out(io, `${plan.conflicts.length ? 'Blocked' : write ? 'Applied' : 'Preview'}: ${plan.root}`);
    for (const file of summary.edits) out(io, `  edit ${file}`);
    for (const move of summary.moves) out(io, `  move ${move.from} → ${move.to}`);
    for (const message of [...plan.conflicts, ...plan.warnings]) out(io, message);
    if (!changed && !plan.conflicts.length) out(io, 'No migration changes needed.');
    else if (!write && !plan.conflicts.length) out(io, 'Review this plan, then run isotone migrate --write.');
    if (!plan.conflicts.length) for (const step of summary.installs) out(io, `After applying, run ${step.command} from ${step.cwd}, then restart the dev server. Lockfiles and feedback are unchanged by migration.`);
  }
  return plan.conflicts.length ? 1 : 0;
}
