import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import {
  activeConflict,
  addVariantFile,
  createVariant,
  dropVariant,
  listVariants,
  promoteVariant,
  readActive,
  readKnobs,
  readVariant,
  removeVariantFile,
  resolveOverride,
  setVariantGroup,
  setVariantSection,
  syncVariant,
  variantDir,
  variantsDir,
  variantsResponse,
  writeActive,
  type VariantsStoreOptions,
} from '../../src/node/variants';
import { tempGitRepo } from '../helpers/fs';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

/** A real git repo with one committed file, so blob hashing and merge-file
 *  have something to work against. `git hash-object -w` needs a repo to
 *  write into; `git merge-file` needs none, but the fixture is the same
 *  either way. */
function tempRepo(): { root: string; opts: VariantsStoreOptions } {
  const root = tempGitRepo('isotone-variants-', dirs);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nline two\nline three\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return { root, opts: { root } };
}

describe('create / add / list', () => {
  it('creates a variant, adds a file, and lists it with no stale/missing files', () => {
    const { root, opts } = tempRepo();
    const variant = createVariant(opts, { id: 'headline-b', label: 'Headline B' });
    expect(variant.id).toBe('headline-b');
    expect(existsSync(join(variantDir(opts, 'headline-b'), 'variant.json'))).toBe(true);

    const updated = addVariantFile(opts, 'headline-b', 'src/Button.tsx');
    expect(updated.files['src/Button.tsx']).toBeDefined();
    expect(updated.files['src/Button.tsx']?.base).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(join(variantDir(opts, 'headline-b'), 'src/Button.tsx'), 'utf8')).toBe(
      readFileSync(join(root, 'src', 'Button.tsx'), 'utf8'),
    );

    const listed = listVariants(opts);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe('headline-b');
    expect(listed[0]?.stale).toEqual([]);
    expect(listed[0]?.missing).toEqual([]);
  });

  it('records a file under its on-disk spelling when the filesystem ignores case', () => {
    const { root, opts } = tempRepo();
    // Only meaningful where `src/button.tsx` opens `src/Button.tsx`.
    if (!existsSync(join(root, 'SRC', 'button.tsx'))) return;
    createVariant(opts, { id: 'v1' });
    expect(Object.keys(addVariantFile(opts, 'v1', 'SRC/button.tsx').files)).toEqual(['src/Button.tsx']);
    expect(resolveOverride(opts, ['v1'], join(root, 'src', 'Button.tsx'))).toBe(join(variantDir(opts, 'v1'), 'src/Button.tsx'));
    expect(Object.keys(removeVariantFile(opts, 'v1', 'src/BUTTON.tsx').files)).toEqual([]);
  });

  it('refuses to copy a file that looks like a secret into a variant', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    mkdirSync(join(root, '.aws'));
    const names = ['.env', '.env.local', 'server.pem', 'id_rsa', '.npmrc', '.envrc', '.dev.vars', 'credentials.json'];
    names.push('gcp-credentials-prod.json', 'release.keystore', '.aws/config');
    for (const name of names) {
      writeFileSync(join(root, name), 'SECRET=1\n');
      expect(() => addVariantFile(opts, 'v1', name)).toThrow(/looks like a secret.*Ask the user/);
      expect(existsSync(join(variantDir(opts, 'v1'), name))).toBe(false);
    }
    writeFileSync(join(root, '.env.example'), 'SECRET=\n');
    expect(Object.keys(addVariantFile(opts, 'v1', '.env.example').files)).toEqual(['.env.example']);
    // Whatever the project keeps out of git stays out of variants too.
    writeFileSync(join(root, '.gitignore'), 'private.txt\n');
    writeFileSync(join(root, 'private.txt'), 'token\n');
    expect(() => addVariantFile(opts, 'v1', 'private.txt')).toThrow(/Git ignores.*Ask the user before copying it with --force/);
    // A deliberate copy goes through.
    expect(Object.keys(addVariantFile(opts, 'v1', 'private.txt', { force: true }).files)).toContain('private.txt');
    expect(Object.keys(addVariantFile(opts, 'v1', '.envrc', { force: true }).files)).toContain('.envrc');
  });

  it('keeps the variants lock out of git, since the variants dir is committed', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('/.isotone/variants/.mutation.*');
  });

  it('rejects an invalid or duplicate id', () => {
    const { opts } = tempRepo();
    expect(() => createVariant(opts, { id: 'Bad_ID' })).toThrow();
    createVariant(opts, { id: 'ok' });
    expect(() => createVariant(opts, { id: 'ok' })).toThrow();
  });

  it('is idempotent on a file already tracked', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    const first = addVariantFile(opts, 'v1', 'src/Button.tsx');
    const baseFirst = first.files['src/Button.tsx']?.base;
    // Edit the override directly, the way a person would in their editor.
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'hand-edited override\n');
    const second = addVariantFile(opts, 'v1', 'src/Button.tsx');
    expect(second.files['src/Button.tsx']?.base).toBe(baseFirst);
    expect(readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8')).toBe('hand-edited override\n');
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).not.toBe('hand-edited override\n');
  });

  it('tolerates junk directories: no manifest, and invalid JSON', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'real' });
    mkdirSync(join(variantsDir(opts), 'empty-dir'));
    mkdirSync(join(variantsDir(opts), 'broken'));
    writeFileSync(join(variantsDir(opts), 'broken', 'variant.json'), '{ not json');

    const listed = listVariants(opts);
    expect(listed.map((v) => v.id)).toEqual(['real']);
  });

  it('records and validates a group', () => {
    const { opts } = tempRepo();
    const grouped = createVariant(opts, { id: 'tabs', group: 'settings', groupLabel: 'Settings' });
    expect(grouped.group).toBe('settings');
    expect(grouped.groupLabel).toBe('Settings');
    expect(() => createVariant(opts, { id: 'bad', group: 'Not An Id' })).toThrow(/Invalid group id/);
    expect(readVariant(opts, 'bad')).toBeNull();

    createVariant(opts, { id: 'accordion' });
    expect(setVariantGroup(opts, 'accordion', 'settings').group).toBe('settings');
    expect(readVariant(opts, 'accordion')?.groupLabel).toBeUndefined();
    expect(setVariantGroup(opts, 'accordion', 'settings', 'Layout').groupLabel).toBe('Layout');
    expect(readVariant(opts, 'accordion')?.group).toBe('settings');
    expect(() => setVariantGroup(opts, 'nope', 'settings')).toThrow(/No variant/);
    expect(() => setVariantGroup(opts, 'accordion', '..')).toThrow(/Invalid group id/);
  });

  it('sorts by createdAt', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'first' });
    // Manifests carry millisecond timestamps; force a gap so order is stable
    // rather than a coin-flip on how fast two Date.now() calls land.
    const a = readVariant(opts, 'first');
    if (a) {
      a.createdAt = '2020-01-01T00:00:00.000Z';
      writeFileSync(join(variantDir(opts, 'first'), 'variant.json'), `${JSON.stringify(a, null, 2)}\n`);
    }
    createVariant(opts, { id: 'second' });
    expect(listVariants(opts).map((v) => v.id)).toEqual(['first', 'second']);
  });
});

describe('sections', () => {
  it('stores a selector section on the manifest and rejects one that is not text', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'logo-b', group: 'logo', section: 'Header' });
    expect(readVariant(opts, 'logo-b')?.section).toBe('Header');
    expect(setVariantSection(opts, 'logo-b', '  Top   bar ').section).toBe('Top bar');
    expect(setVariantSection(opts, 'logo-b', undefined)).not.toHaveProperty('section');
    expect(() => setVariantSection(opts, 'nope', 'Header')).toThrow('No variant "nope"');
    const file = join(variantDir(opts, 'logo-b'), 'variant.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), section: 3 }));
    expect(readVariant(opts, 'logo-b')).toBeNull();
  });
});

describe('stale detection', () => {
  it('flags a file stale after the real file changes underneath it', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    expect(listVariants(opts)[0]?.stale).toEqual([]);

    writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nEDITED\nline three\n');
    expect(listVariants(opts)[0]?.stale).toEqual(['src/Button.tsx']);
  });

  it('flags a file missing when the override was deleted off disk', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    rmSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'));
    expect(listVariants(opts)[0]?.missing).toEqual(['src/Button.tsx']);
  });
});

describe('sync', () => {
  it('merges cleanly when the edits land on different lines', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');

    // The override changes line three; the real file (independently) moves
    // line one. A clean three-way merge keeps both.
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'line one\nline two\nOVERRIDE THREE\n');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'REAL ONE\nline two\nline three\n');

    const result = syncVariant(opts, 'v1');
    expect(result.merged).toEqual(['src/Button.tsx']);
    expect(result.conflicts).toEqual([]);
    const mergedText = readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8');
    expect(mergedText).toBe('REAL ONE\nline two\nOVERRIDE THREE\n');

    // The base advances, so the merged file reads as unchanged next time.
    expect(listVariants(opts)[0]?.stale).toEqual([]);
    expect(syncVariant(opts, 'v1').unchanged).toEqual(['src/Button.tsx']);
  });

  it('leaves conflict markers and reports a conflict when both sides touch the same line', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');

    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'line one\nVARIANT TWO\nline three\n');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nREAL TWO\nline three\n');

    const result = syncVariant(opts, 'v1');
    expect(result.conflicts).toEqual(['src/Button.tsx']);
    expect(result.merged).toEqual([]);
    const withMarkers = readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8');
    expect(withMarkers).toContain('<<<<<<< variant');
    expect(withMarkers).toContain('VARIANT TWO');
    expect(withMarkers).toContain('REAL TWO');
    expect(withMarkers).toContain('>>>>>>> default');

    // The base advances, as after a conflicted git merge: the override is
    // now reconciled against the current file, so a second sync has nothing
    // to redo and resolving the markers is all that stands before promote.
    expect(listVariants(opts)[0]?.stale).toEqual([]);
    expect(syncVariant(opts, 'v1')).toEqual({
      merged: [],
      conflicts: [],
      unchanged: ['src/Button.tsx'],
      blocked: {},
    });
    expect(() => promoteVariant(opts, 'v1')).toThrow(/conflict markers/);
  });

  it('writes the markers when more than one hunk conflicts', () => {
    // git merge-file exits with the number of conflicts, so two hunks is an
    // exit status of 2. Read as git failing, that left the override untouched
    // and stale forever. Hunks closer than four unchanged lines are joined
    // into one conflict, hence the padding.
    const { root, opts } = tempRepo();
    const original = 'line one\nmid 1\nmid 2\nmid 3\nmid 4\nline last\n';
    writeFileSync(join(root, 'src', 'Long.tsx'), original);
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Long.tsx');
    writeFileSync(
      join(variantDir(opts, 'v1'), 'src/Long.tsx'),
      original.replace('line one', 'VARIANT ONE').replace('line last', 'VARIANT LAST'),
    );
    writeFileSync(join(root, 'src', 'Long.tsx'), original.replace('line one', 'REAL ONE').replace('line last', 'REAL LAST'));

    const result = syncVariant(opts, 'v1');
    expect(result.conflicts).toEqual(['src/Long.tsx']);
    expect(result.merged).toEqual([]);
    const withMarkers = readFileSync(join(variantDir(opts, 'v1'), 'src/Long.tsx'), 'utf8');
    expect(withMarkers.match(/<<<<<<< variant/g)).toHaveLength(2);
    expect(withMarkers).toContain('VARIANT ONE');
    expect(withMarkers).toContain('REAL ONE');
    expect(withMarkers).toContain('VARIANT LAST');
    expect(withMarkers).toContain('REAL LAST');
    expect(listVariants(opts)[0]?.stale).toEqual([]);
  });

  it('reports a conflict without touching the override when the base is unreachable', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');

    // Simulate a base blob nobody can look up any more, by writing it
    // straight into the manifest rather than deleting from git's object
    // store (which git makes deliberately hard to do to a single blob).
    const manifest = readVariant(opts, 'v1');
    if (!manifest) throw new Error('expected manifest');
    const entry = manifest.files['src/Button.tsx'];
    assert(entry);
    entry.base = null;
    writeFileSync(join(variantDir(opts, 'v1'), 'variant.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nline two\nline three CHANGED\n');

    const result = syncVariant(opts, 'v1');
    expect(result.conflicts).toEqual([]);
    expect(result.blocked).toEqual({ 'src/Button.tsx': 'no-base' });
    expect(readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8')).toBe(before);
  });

  it('takes the real file as the base of a copy that has none while the two are identical', () => {
    // A copy made outside Git by Isotone 1.5.0 and earlier, never edited:
    // nothing can be lost, so sync records a base instead of giving up.
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    const manifest = readVariant(opts, 'v1');
    assert(manifest?.files['src/Button.tsx']);
    manifest.files['src/Button.tsx'].base = null;
    writeFileSync(join(variantDir(opts, 'v1'), 'variant.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(listVariants(opts)[0]?.stale).toEqual(['src/Button.tsx']);

    expect(syncVariant(opts, 'v1')).toEqual({ merged: [], conflicts: [], unchanged: ['src/Button.tsx'], blocked: {} });
    expect(readVariant(opts, 'v1')?.files['src/Button.tsx']?.base).toMatch(/^[0-9a-f]{40}$/);
    expect(listVariants(opts)[0]?.stale).toEqual([]);
  });
});

/** A project with no Git repository anywhere above it. */
function tempProject(): { root: string; opts: VariantsStoreOptions } {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'isotone-nogit-')));
  dirs.push(root);
  // Git must not find a repository above the temp dir either.
  vi.stubEnv('GIT_CEILING_DIRECTORIES', dirname(root));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nline two\nline three\n');
  return { root, opts: { root } };
}

/** What git would name the bytes, computed without it. */
function sha1Blob(contents: string): string {
  return createHash('sha1')
    .update(`blob ${Buffer.byteLength(contents)}\0`)
    .update(contents)
    .digest('hex');
}

describe('outside a Git repository', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('records a base the copy is current against, kept in the variant, until the real file changes', () => {
    const { root, opts } = tempProject();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    const original = 'line one\nline two\nline three\n';
    const base = readVariant(opts, 'v1')?.files['src/Button.tsx']?.base;
    expect(base).toBe(sha1Blob(original));
    expect(readFileSync(join(variantDir(opts, 'v1'), '.isotone-base', base as string), 'utf8')).toBe(original);
    // Committed beside the bases, so no checkout rewrites their line endings.
    expect(readFileSync(join(variantDir(opts, 'v1'), '.isotone-base', '.gitattributes'), 'utf8')).toBe(
      '* -text -filter -ident -working-tree-encoding\n',
    );
    expect(listVariants(opts)[0]?.stale).toEqual([]);

    writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nline two\nline three, changed\n');
    expect(listVariants(opts)[0]?.stale).toEqual(['src/Button.tsx']);
  });

  it('syncs a clean merge from the kept base, and keeps only the new base', () => {
    const { root, opts } = tempProject();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'line one\nline two\nOVERRIDE THREE\n');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'REAL ONE\nline two\nline three\n');

    expect(syncVariant(opts, 'v1')).toEqual({ merged: ['src/Button.tsx'], conflicts: [], unchanged: [], blocked: {} });
    expect(readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8')).toBe('REAL ONE\nline two\nOVERRIDE THREE\n');
    expect(listVariants(opts)[0]?.stale).toEqual([]);
    expect(readdirSync(join(variantDir(opts, 'v1'), '.isotone-base'))).toEqual([
      '.gitattributes',
      sha1Blob('REAL ONE\nline two\nline three\n'),
    ]);
  });

  it('writes conflict markers when both sides change a line, and advances the base', () => {
    const { root, opts } = tempProject();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'line one\nVARIANT TWO\nline three\n');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nREAL TWO\nline three\n');

    const result = syncVariant(opts, 'v1');
    expect(result.conflicts).toEqual(['src/Button.tsx']);
    expect(result.blocked).toEqual({});
    const copy = readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8');
    expect(copy).toContain('<<<<<<< variant');
    expect(copy).toContain('VARIANT TWO');
    expect(copy).toContain('REAL TWO');
    expect(listVariants(opts)[0]).toMatchObject({ stale: [], conflicts: ['src/Button.tsx'] });
  });

  it('still syncs a copy made before `git init`, and hands its base to Git once a commit holds it', () => {
    const { root, opts } = tempProject();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'line one\nline two\nOVERRIDE THREE\n');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'REAL ONE\nline two\nline three\n');

    expect(syncVariant(opts, 'v1').merged).toEqual(['src/Button.tsx']);
    expect(listVariants(opts)[0]?.stale).toEqual([]);
    // No commit holds the new base yet: in Git's store it would be a dangling blob, out of a
    // teammate's reach and pruned by `git gc`, so the variant keeps it.
    expect(readdirSync(join(variantDir(opts, 'v1'), '.isotone-base'))).toEqual([
      '.gitattributes',
      sha1Blob('REAL ONE\nline two\nline three\n'),
    ]);

    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
    writeFileSync(join(root, 'src', 'Button.tsx'), 'REAL ONE, AGAIN\nline two\nline three\n');
    git('add', 'src/Button.tsx');
    git('commit', '-q', '-m', 'button');
    expect(syncVariant(opts, 'v1').merged).toEqual(['src/Button.tsx']);
    // The commit holds the new base, so the variant keeps no copy.
    expect(existsSync(join(variantDir(opts, 'v1'), '.isotone-base'))).toBe(false);
  });

  it('says Git is missing instead of merging when it is not installed', () => {
    const { root, opts } = tempProject();
    vi.stubEnv('PATH', '');
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    expect(listVariants(opts)[0]?.stale).toEqual([]);
    writeFileSync(join(root, 'src', 'Button.tsx'), 'REAL ONE\nline two\nline three\n');
    expect(listVariants(opts)[0]?.stale).toEqual(['src/Button.tsx']);

    const result = syncVariant(opts, 'v1');
    expect(result.blocked).toEqual({ 'src/Button.tsx': 'no-git' });
    expect(readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8')).toBe('line one\nline two\nline three\n');
  });

  it('refuses a bases directory that is a link, and never deletes through one', () => {
    // Variants are committed, so a link can arrive in a pull request.
    const { root, opts } = tempProject();
    mkdirSync(join(root, 'precious'));
    writeFileSync(join(root, 'precious', 'data.txt'), 'keep\n');
    createVariant(opts, { id: 'v' });
    symlinkSync(join(root, 'precious'), join(variantDir(opts, 'v'), '.isotone-base'));

    expect(() => addVariantFile(opts, 'v', 'src/Button.tsx')).toThrow(/not a plain directory/);
    expect(readdirSync(join(root, 'precious'))).toEqual(['data.txt']);
  });

  it('keeps `.isotone-base/` out of reach of `variant add`, in any case', () => {
    const { root, opts } = tempProject();
    mkdirSync(join(root, '.Isotone-Base'));
    writeFileSync(join(root, '.Isotone-Base', 'x.ts'), '');
    createVariant(opts, { id: 'v' });
    expect(() => addVariantFile(opts, 'v', '.Isotone-Base/x.ts')).toThrow(/reserve/);
  });

  it('refuses a bases directory that is a file, leaving the variant untouched', () => {
    // What a checkout with `core.symlinks=false` makes of a committed link.
    const { opts } = tempProject();
    createVariant(opts, { id: 'v' });
    const manifest = readFileSync(join(variantDir(opts, 'v'), 'variant.json'), 'utf8');
    writeFileSync(join(variantDir(opts, 'v'), '.isotone-base'), '../../../precious');

    expect(() => addVariantFile(opts, 'v', 'src/Button.tsx')).toThrow(/is not a plain directory of kept bases, so "v" was left unchanged/);
    expect(() => setVariantGroup(opts, 'v', 'g')).toThrow(/not a plain directory/);
    expect(readFileSync(join(variantDir(opts, 'v'), 'variant.json'), 'utf8')).toBe(manifest);
    expect(existsSync(join(variantDir(opts, 'v'), 'src'))).toBe(false);
  });

  it('prunes only files named like a kept base', () => {
    const { opts } = tempProject();
    createVariant(opts, { id: 'v' });
    addVariantFile(opts, 'v', 'src/Button.tsx');
    writeFileSync(join(variantDir(opts, 'v'), '.isotone-base', 'README'), 'mine\n');
    removeVariantFile(opts, 'v', 'src/Button.tsx');
    expect(readdirSync(join(variantDir(opts, 'v'), '.isotone-base'))).toEqual(['README']);
  });

  it('lands nothing when an alternative’s bases directory would be refused', () => {
    const { root, opts } = tempProject();
    mkdirSync(join(root, 'precious'));
    createVariant(opts, { id: 'a', group: 'g' });
    createVariant(opts, { id: 'b', group: 'g' });
    addVariantFile(opts, 'a', 'src/Button.tsx');
    addVariantFile(opts, 'b', 'src/Button.tsx');
    writeFileSync(join(variantDir(opts, 'a'), 'src/Button.tsx'), 'promoted\n');
    rmSync(join(variantDir(opts, 'b'), '.isotone-base'), { recursive: true });
    symlinkSync(join(root, 'precious'), join(variantDir(opts, 'b'), '.isotone-base'));

    expect(() => promoteVariant(opts, 'a')).toThrow(/not a plain directory/);
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).toBe('line one\nline two\nline three\n');
    expect(readVariant(opts, 'a')).not.toBeNull();
  });

  it('does not offer `variant sync` from promote when Git is not installed', () => {
    const { root, opts } = tempProject();
    vi.stubEnv('PATH', '');
    createVariant(opts, { id: 'v' });
    addVariantFile(opts, 'v', 'src/Button.tsx');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'changed\n');
    expect(() => promoteVariant(opts, 'v')).toThrow(/Git is not installed, so `variant sync` cannot merge.*then promote with --force\.$/);
  });

  it('never merges from a kept base that no longer matches its hash', () => {
    const { root, opts } = tempProject();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    const base = readVariant(opts, 'v1')?.files['src/Button.tsx']?.base as string;
    // A crash or a bad checkout left part of it.
    writeFileSync(join(variantDir(opts, 'v1'), '.isotone-base', base), 'line one\n');
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'line one\nline two\nOVERRIDE THREE\n');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'REAL ONE\nline two\nline three\n');

    expect(syncVariant(opts, 'v1').blocked).toEqual({ 'src/Button.tsx': 'failed' });
    expect(readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8')).toBe('line one\nline two\nOVERRIDE THREE\n');
  });

  it('rebases alternatives made before a SHA-256 `git init` when one is promoted', () => {
    // Their kept bases are SHA-1, the new repository hashes in SHA-256: the
    // promoted file's old version has to be compared in the base's format.
    const { root, opts } = tempProject();
    createVariant(opts, { id: 'a', group: 'g' });
    createVariant(opts, { id: 'b', group: 'g' });
    addVariantFile(opts, 'a', 'src/Button.tsx');
    addVariantFile(opts, 'b', 'src/Button.tsx');
    execFileSync('git', ['init', '-q', '--object-format=sha256', root]);
    writeFileSync(join(variantDir(opts, 'a'), 'src/Button.tsx'), 'line one\nline two\nA THREE\n');
    writeFileSync(join(variantDir(opts, 'b'), 'src/Button.tsx'), 'B ONE\nline two\nline three\n');

    expect(promoteVariant(opts, 'a').rebased).toEqual(['b']);
    expect(readVariant(opts, 'b')?.files['src/Button.tsx']?.base).toMatch(/^[0-9a-f]{64}$/);
    // b is an alternative to what was promoted, not a copy behind it.
    expect(syncVariant(opts, 'b').unchanged).toEqual(['src/Button.tsx']);
    expect(readFileSync(join(variantDir(opts, 'b'), 'src/Button.tsx'), 'utf8')).toBe('B ONE\nline two\nline three\n');
  });

  it('rebases a promoted variant’s alternatives onto the landed file', () => {
    const { root, opts } = tempProject();
    createVariant(opts, { id: 'a', group: 'button' });
    createVariant(opts, { id: 'b', group: 'button' });
    addVariantFile(opts, 'a', 'src/Button.tsx');
    addVariantFile(opts, 'b', 'src/Button.tsx');
    writeFileSync(join(variantDir(opts, 'a'), 'src/Button.tsx'), 'promoted\n');

    expect(promoteVariant(opts, 'a').rebased).toEqual(['b']);
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).toBe('promoted\n');
    expect(listVariants(opts)[0]).toMatchObject({ id: 'b', stale: [] });
    expect(readdirSync(join(variantDir(opts, 'b'), '.isotone-base'))).toEqual(['.gitattributes', sha1Blob('promoted\n')]);
  });
});

describe('promote / drop', () => {
  it('promote lands overrides in the tree, deletes the dir, and clears active', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'promoted content\n');
    createVariant(opts, { id: 'other' });
    writeActive(opts, ['other', 'v1']);

    const result = promoteVariant(opts, 'v1');
    expect(result.files).toEqual(['src/Button.tsx']);
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).toBe('promoted content\n');
    expect(existsSync(variantDir(opts, 'v1'))).toBe(false);
    // Only the promoted one leaves the set.
    expect(readActive(opts)).toEqual(['other']);
  });

  it('promote changes no real file when one of them cannot be written', () => {
    const { root, opts } = tempRepo();
    writeFileSync(join(root, 'src', 'Card.tsx'), 'real card\n');
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    addVariantFile(opts, 'v1', 'src/Card.tsx');
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'override button\n');
    // The second target is now a directory, so it cannot be replaced.
    rmSync(join(root, 'src', 'Card.tsx'));
    mkdirSync(join(root, 'src', 'Card.tsx'));
    expect(() => promoteVariant(opts, 'v1', { force: true })).toThrow();
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).toBe('line one\nline two\nline three\n');
    expect(readVariant(opts, 'v1')).not.toBeNull();
  });

  it('drop deletes the variant and takes it out of the active set', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    createVariant(opts, { id: 'v2' });
    writeActive(opts, ['v2']);

    dropVariant(opts, 'v1');
    expect(existsSync(variantDir(opts, 'v1'))).toBe(false);
    expect(readActive(opts)).toEqual(['v2']); // untouched: v1 wasn't active

    dropVariant(opts, 'v2');
    expect(readActive(opts)).toEqual([]);
    // The last one takes the empty variants directory with it.
    expect(existsSync(variantsDir(opts))).toBe(false);
  });

  it('keeps the variants directory while it holds anything else', () => {
    const { opts, root } = tempRepo();
    createVariant(opts, { id: 'v1' });
    writeFileSync(join(variantsDir(opts), 'README.md'), '# Overlay variants\n');
    dropVariant(opts, 'v1');
    expect(readFileSync(join(variantsDir(opts), 'README.md'), 'utf8')).toBe('# Overlay variants\n');

    rmSync(join(variantsDir(opts), 'README.md'));
    createVariant(opts, { id: 'v2' });
    addVariantFile(opts, 'v2', 'src/Button.tsx');
    writeFileSync(join(variantDir(opts, 'v2'), 'src/Button.tsx'), 'override\n');
    promoteVariant(opts, 'v2');
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).toBe('override\n');
    expect(existsSync(variantsDir(opts))).toBe(false);
    // Making a variant again recreates it.
    createVariant(opts, { id: 'v3' });
    expect(readVariant(opts, 'v3')).not.toBeNull();
  });

  it('refuses an id that is not a directory name, before anything is removed', () => {
    // `variant drop ..` resolved to the variants dir's parent, which is
    // `.isotone/`, and one more level up is the project root.
    const { opts } = tempRepo();
    createVariant(opts, { id: 'keep' });
    expect(() => dropVariant(opts, '..')).toThrow(/Invalid variant id/);
    expect(() => dropVariant(opts, '../..')).toThrow(/Invalid variant id/);
    expect(() => promoteVariant(opts, '..')).toThrow(/Invalid variant id/);
    expect(() => promoteVariant(opts, '..', { force: true })).toThrow(/Invalid variant id/);
    expect(existsSync(variantsDir(opts))).toBe(true);
    expect(existsSync(join(variantDir(opts, 'keep'), 'variant.json'))).toBe(true);
    expect(readVariant(opts, '..')).toBeNull();
  });
});

describe('active file', () => {
  it('reads [] when absent, round-trips a set, and drops a deleted variant', () => {
    const { opts } = tempRepo();
    expect(readActive(opts)).toEqual([]);

    createVariant(opts, { id: 'v1' });
    createVariant(opts, { id: 'v2' });
    writeActive(opts, ['v1', 'v2', 'v1']);
    expect(readActive(opts)).toEqual(['v1', 'v2']);

    dropVariant(opts, 'v1');
    // Simulate a stale pointer written by another process, rather than one
    // dropVariant already cleared.
    writeActive(opts, ['v1', 'v2']);
    expect(readActive(opts)).toEqual(['v2']);
  });

  it('still reads the one-id shape older versions wrote', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    const file = join(root, '.isotone', 'active.json');
    mkdirSync(join(root, '.isotone'), { recursive: true });
    writeFileSync(file, JSON.stringify({ active: 'v1' }));
    expect(readActive(opts)).toEqual(['v1']);
    writeFileSync(file, JSON.stringify({ active: null }));
    expect(readActive(opts)).toEqual([]);
    writeFileSync(file, '{ not json');
    expect(readActive(opts)).toEqual([]);
  });

  it('keeps the first of two variants over the same file, so load is never ambiguous', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'a' });
    addVariantFile(opts, 'a', 'src/Button.tsx');
    createVariant(opts, { id: 'b' });
    addVariantFile(opts, 'b', 'src/Button.tsx');
    createVariant(opts, { id: 'c' });
    writeActive(opts, ['a', 'b', 'c']);
    expect(readActive(opts)).toEqual(['a', 'c']);
    expect(activeConflict(opts, ['a', 'b'])).toEqual(['a', 'b', 'src/Button.tsx']);
    expect(activeConflict(opts, ['a', 'c'])).toBeNull();
  });
});

describe('resolveOverride over a set', () => {
  it('answers each file from whichever active variant overrides it', () => {
    const { root, opts } = tempRepo();
    writeFileSync(join(root, 'src', 'Table.tsx'), 'table\n');
    createVariant(opts, { id: 'button-b' });
    addVariantFile(opts, 'button-b', 'src/Button.tsx');
    createVariant(opts, { id: 'table-b' });
    addVariantFile(opts, 'table-b', 'src/Table.tsx');

    const both = ['button-b', 'table-b'];
    expect(resolveOverride(opts, both, join(root, 'src', 'Button.tsx'))).toBe(join(variantDir(opts, 'button-b'), 'src/Button.tsx'));
    expect(resolveOverride(opts, both, join(root, 'src', 'Table.tsx'))).toBe(join(variantDir(opts, 'table-b'), 'src/Table.tsx'));
    expect(resolveOverride(opts, ['table-b'], join(root, 'src', 'Button.tsx'))).toBeNull();
    expect(resolveOverride(opts, [], join(root, 'src', 'Button.tsx'))).toBeNull();
  });
});

describe('variantsResponse', () => {
  function get(opts: VariantsStoreOptions) {
    return variantsResponse(opts, { method: 'GET', url: '/' });
  }
  function postActive(opts: VariantsStoreOptions, body: unknown) {
    return variantsResponse(opts, { method: 'POST', url: '/active', body });
  }

  it('GETs the listing and the active set', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    writeActive(opts, ['v1']);
    const res = get(opts);
    expect(res.status).toBe(200);
    const body = res.body as { variants: Array<{ id: string }>; active: string[] };
    expect(body.variants.map((v) => v.id)).toEqual(['v1']);
    expect(body.active).toEqual(['v1']);
  });

  it('POSTs /active to replace the set, and to clear with []', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    createVariant(opts, { id: 'v2' });
    const res = postActive(opts, { active: ['v1', 'v2'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: ['v1', 'v2'] });
    expect(readActive(opts)).toEqual(['v1', 'v2']);
    expect(postActive(opts, { active: ['v2'] }).status).toBe(200);
    expect(readActive(opts)).toEqual(['v2']);
    expect(postActive(opts, { active: [] }).status).toBe(200);
    expect(readActive(opts)).toEqual([]);
  });

  it('409s a set where two variants override the same file, naming them', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'a' });
    addVariantFile(opts, 'a', 'src/Button.tsx');
    createVariant(opts, { id: 'b' });
    addVariantFile(opts, 'b', 'src/Button.tsx');
    writeActive(opts, ['a']);
    const res = postActive(opts, { active: ['a', 'b'] });
    expect(res.status).toBe(409);
    expect((res.body as { conflict: unknown }).conflict).toEqual(['a', 'b', 'src/Button.tsx']);
    // Nothing written: the reviewer keeps what they had.
    expect(readActive(opts)).toEqual(['a']);
  });

  it('404s an unknown id, leaving the set alone', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    writeActive(opts, ['v1']);
    expect(postActive(opts, { active: ['v1', 'nope'] }).status).toBe(404);
    expect(readActive(opts)).toEqual(['v1']);
  });

  it('400s an id that is not a variant id at all', () => {
    const { opts } = tempRepo();
    expect(postActive(opts, { active: ['..'] }).status).toBe(400);
    expect(postActive(opts, { active: ['../x'] }).status).toBe(400);
    expect(postActive(opts, { active: ['Upper'] }).status).toBe(400);
    expect(readActive(opts)).toEqual([]);
  });

  it('400s a malformed body, the old one-id shape included', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    expect(postActive(opts, { active: 'v1' }).status).toBe(400);
    expect(postActive(opts, { active: [42] }).status).toBe(400);
    expect(postActive(opts, { id: 'v1' }).status).toBe(400);
    expect(postActive(opts, 'nonsense').status).toBe(400);
    expect(postActive(opts, {}).status).toBe(400);
  });

  it('405s anything else', () => {
    const { opts } = tempRepo();
    expect(variantsResponse(opts, { method: 'DELETE', url: '/' }).status).toBe(405);
    expect(variantsResponse(opts, { method: 'GET', url: '/active' }).status).toBe(405);
  });
});

describe('path escape rejected', () => {
  it('treats ordinary prototype-property filenames as real files', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'filenames' });
    for (const file of ['constructor', '__proto__']) {
      writeFileSync(join(root, file), file);
      addVariantFile(opts, 'filenames', file);
      expect(readFileSync(join(variantDir(opts, 'filenames'), file), 'utf8')).toBe(file);
      expect(Object.hasOwn(readVariant(opts, 'filenames')?.files ?? {}, file)).toBe(true);
    }
  });
  it.skipIf(process.platform === 'win32')('rejects source and override symlinks outside their owning tree', () => {
    const { root, opts } = tempRepo();
    const outside = mkdtempSync(join(tmpdir(), 'iso-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'secret.txt'), 'Do not touch');
    createVariant(opts, { id: 'safe' });
    symlinkSync(outside, join(root, 'linked'), 'dir');
    expect(() => addVariantFile(opts, 'safe', 'linked/secret.txt')).toThrow(/escapes/);
    addVariantFile(opts, 'safe', 'src/Button.tsx');
    const copy = join(variantDir(opts, 'safe'), 'src/Button.tsx');
    rmSync(copy);
    symlinkSync(join(outside, 'secret.txt'), copy);
    expect(readVariant(opts, 'safe')).toBeNull();
    expect(resolveOverride(opts, ['safe'], join(root, 'src/Button.tsx'))).toBeNull();
    expect(() => promoteVariant(opts, 'safe', { force: true })).toThrow();
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('Do not touch');
  });

  it('rejects mismatched ids, invalid file entries and repository metadata', () => {
    const { opts } = tempRepo();
    const manifest = createVariant(opts, { id: 'safe' });
    const file = join(variantDir(opts, 'safe'), 'variant.json');
    for (const bad of [
      { ...manifest, id: '../outside' },
      { ...manifest, files: { 'src/a.ts': null } },
      { ...manifest, files: { 'src/a.ts': { base: '--help' } } },
      { ...manifest, files: { '.git/config': { base: null } } },
      { ...manifest, files: { 'variant.json': { base: null } } },
      { ...manifest, files: { './a.ts': { base: null } } },
      // A case-insensitive filesystem opens the bases directory under this key.
      { ...manifest, files: { [`.ISOTONE-BASE/${'a'.repeat(40)}`]: { base: null } } },
    ]) {
      writeFileSync(file, JSON.stringify(bad));
      expect(readVariant(opts, 'safe')).toBeNull();
      expect(listVariants(opts)).toEqual([]);
    }
  });
  it('refuses to add a file outside the project root', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    expect(() => addVariantFile(opts, 'v1', '../outside.txt')).toThrow();
  });

  it('resolveOverride never resolves a source path outside root', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    writeActive(opts, ['v1']);
    expect(resolveOverride(opts, ['v1'], join(root, '..', 'elsewhere.tsx'))).toBeNull();
    expect(resolveOverride(opts, ['v1'], join(root, 'src', 'Button.tsx'))).toBe(join(variantDir(opts, 'v1'), 'src/Button.tsx'));
  });

  it('removeVariantFile also rejects an escaping path', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    expect(() => removeVariantFile(opts, 'v1', '../outside.txt')).toThrow();
  });

  it('treats a manifest whose file keys escape as no variant', () => {
    // The keys are joined onto the variant dir and onto the project root by
    // promote, sync, resolveOverride and listVariants alike, so a hand-written
    // or checked-in manifest must not be able to point them outside either.
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'ok' });
    const escaping = (key: string) =>
      JSON.stringify({
        id: 'bad',
        label: 'bad',
        createdAt: '2026-09-01T00:00:00.000Z',
        files: { [key]: { base: null } },
      });
    mkdirSync(variantDir(opts, 'bad'), { recursive: true });
    for (const key of ['../../x', '/etc/passwd', 'src\\..\\..\\x', 'a/../../x']) {
      writeFileSync(join(variantDir(opts, 'bad'), 'variant.json'), escaping(key));
      expect(readVariant(opts, 'bad')).toBeNull();
      expect(listVariants(opts).map((v) => v.id)).toEqual(['ok']);
      expect(resolveOverride(opts, ['bad'], join(root, 'x'))).toBeNull();
      expect(() => promoteVariant(opts, 'bad', { force: true })).toThrow(/No variant/);
      expect(() => syncVariant(opts, 'bad')).toThrow(/No variant/);
    }
    // A plain nested key is still fine.
    writeFileSync(join(variantDir(opts, 'bad'), 'variant.json'), escaping('src/x.ts'));
    expect(readVariant(opts, 'bad')).not.toBeNull();
  });
});

describe('promoteVariant guards', () => {
  it('never deletes a variant when an override is missing, even when forced', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'incomplete' });
    addVariantFile(opts, 'incomplete', 'src/Button.tsx');
    const original = readFileSync(join(root, 'src/Button.tsx'), 'utf8');
    rmSync(join(variantDir(opts, 'incomplete'), 'src/Button.tsx'));
    expect(() => promoteVariant(opts, 'incomplete', { force: true })).toThrow(/missing overrides/);
    expect(readVariant(opts, 'incomplete')).not.toBeNull();
    expect(readFileSync(join(root, 'src/Button.tsx'), 'utf8')).toBe(original);
  });
  it('refuses a stale variant and a conflicted override unless forced', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'g' });
    addVariantFile(opts, 'g', 'src/Button.tsx');
    const original = readFileSync(join(root, 'src', 'Button.tsx'), 'utf8');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'moved\n');
    expect(() => promoteVariant(opts, 'g')).toThrow(/stale/);
    // The real file back where the override started from: only the markers
    // block promotion now.
    writeFileSync(join(root, 'src', 'Button.tsx'), original);
    writeFileSync(join(variantDir(opts, 'g'), 'src', 'Button.tsx'), '<<<<<<< variant\nx\n=======\ny\n>>>>>>> default\n');
    expect(() => promoteVariant(opts, 'g')).toThrow(/conflict markers/);
    expect(promoteVariant(opts, 'g', { force: true }).files).toEqual(['src/Button.tsx']);
  });

  it('says there is no base, not that the file changed, when none was recorded', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'nb' });
    addVariantFile(opts, 'nb', 'src/Button.tsx');
    // What an override made outside a git repo looks like in the manifest.
    const manifest = readVariant(opts, 'nb');
    if (!manifest) throw new Error('expected manifest');
    const entry = manifest.files['src/Button.tsx'];
    assert(entry);
    entry.base = null;
    writeFileSync(join(variantDir(opts, 'nb'), 'variant.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => promoteVariant(opts, 'nb')).toThrow(/no base recorded for src\/Button\.tsx \(not a git repo when the override was made\)/);
    expect(() => promoteVariant(opts, 'nb')).not.toThrow(/changed since/);
    // Sync has nothing to merge from, so it is not the advice.
    expect(() => promoteVariant(opts, 'nb')).toThrow(/Compare it with the real file by hand, then promote with --force\.$/);
  });
});

describe('knobs file', () => {
  it('reads usable axes and drops the rest; missing or malformed is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'iso-knobs-'));
    try {
      const opts = { root };
      expect(readKnobs(opts)).toEqual([]);
      mkdirSync(join(root, '.isotone'), { recursive: true });
      writeFileSync(join(root, '.isotone/knobs.json'), 'nope');
      expect(readKnobs(opts)).toEqual([]);
      writeFileSync(
        join(root, '.isotone/knobs.json'),
        JSON.stringify([
          { kind: 'range', id: 'fade', label: 'Fade', min: 0, max: 1, step: 0.1, defaultValue: 0 },
          { kind: 'range', id: 'Bad Id', label: 'x', min: 0, max: 1, step: 0.1, defaultValue: 0 },
          { kind: 'range', id: 'nomin', label: 'x', max: 1, step: 0.1, defaultValue: 0 },
          { kind: 'color', id: 'ink', label: 'Ink', defaultColor: '#fff', swatches: [] },
          'junk',
        ]),
      );
      expect(readKnobs(opts).map((k) => k.id)).toEqual(['fade', 'ink']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('selector requests', () => {
  it('does not mutate variants through the old management endpoint', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'one', group: 'button' });
    const response = variantsResponse(opts, { method: 'POST', url: '/manage', body: { axisId: 'button', action: 'remove-axis' } });
    expect(response.status).toBe(405);
    expect(listVariants(opts).map((v) => v.id)).toEqual(['one']);
  });
});

describe('files a variant adds', () => {
  it('starts an empty copy that stays current until the project gets the file', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'n' });
    expect(() => addVariantFile(opts, 'n', 'src/New.tsx')).toThrow(/--new/);
    expect(() => addVariantFile(opts, 'n', 'src/Button.tsx', { create: true })).toThrow(/already exists/);
    addVariantFile(opts, 'n', 'src/New.tsx', { create: true });
    expect(readVariant(opts, 'n')?.files['src/New.tsx']).toEqual({ base: null, added: true });
    expect(readFileSync(join(variantDir(opts, 'n'), 'src', 'New.tsx'), 'utf8')).toBe('');
    expect(listVariants(opts)[0]?.stale).toEqual([]);
    expect(syncVariant(opts, 'n')).toEqual({ merged: [], conflicts: [], unchanged: ['src/New.tsx'], blocked: {} });

    // Someone created the real file meanwhile: a person has to decide.
    writeFileSync(join(root, 'src', 'New.tsx'), 'export {};\n');
    expect(listVariants(opts)[0]?.stale).toEqual(['src/New.tsx']);
    expect(syncVariant(opts, 'n').blocked).toEqual({ 'src/New.tsx': 'appeared' });
  });

  it('promotes by creating the file', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'n' });
    addVariantFile(opts, 'n', 'src/New.tsx', { create: true });
    writeFileSync(join(variantDir(opts, 'n'), 'src', 'New.tsx'), 'export const n = 1;\n');
    expect(promoteVariant(opts, 'n').files).toEqual(['src/New.tsx']);
    expect(readFileSync(join(root, 'src', 'New.tsx'), 'utf8')).toBe('export const n = 1;\n');
  });
});
