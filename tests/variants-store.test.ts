import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

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
  syncVariant,
  variantDir,
  variantsDir,
  variantsResponse,
  writeActive,
  type VariantsStoreOptions,
} from '../src/variants-store';

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'iso-iterate-variants-')));
  dirs.push(root);
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
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
    expect(updated.files['src/Button.tsx'].base).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(join(variantDir(opts, 'headline-b'), 'src/Button.tsx'), 'utf8')).toBe(
      readFileSync(join(root, 'src', 'Button.tsx'), 'utf8'),
    );

    const listed = listVariants(opts);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('headline-b');
    expect(listed[0].stale).toEqual([]);
    expect(listed[0].missing).toEqual([]);
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
    const baseFirst = first.files['src/Button.tsx'].base;
    // Edit the override directly, the way a person would in their editor.
    writeFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'hand-edited override\n');
    const second = addVariantFile(opts, 'v1', 'src/Button.tsx');
    expect(second.files['src/Button.tsx'].base).toBe(baseFirst);
    expect(readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8')).toBe(
      'hand-edited override\n',
    );
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).not.toBe(
      'hand-edited override\n',
    );
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
    expect(() => createVariant(opts, { id: 'bad', group: 'Not An Id' })).toThrow(
      /Invalid group id/,
    );
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
      writeFileSync(
        join(variantDir(opts, 'first'), 'variant.json'),
        `${JSON.stringify(a, null, 2)}\n`,
      );
    }
    createVariant(opts, { id: 'second' });
    expect(listVariants(opts).map((v) => v.id)).toEqual(['first', 'second']);
  });
});

describe('stale detection', () => {
  it('flags a file stale after the real file changes underneath it', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    expect(listVariants(opts)[0].stale).toEqual([]);

    writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nEDITED\nline three\n');
    expect(listVariants(opts)[0].stale).toEqual(['src/Button.tsx']);
  });

  it('flags a file missing when the override was deleted off disk', () => {
    const { opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    rmSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'));
    expect(listVariants(opts)[0].missing).toEqual(['src/Button.tsx']);
  });
});

describe('sync', () => {
  it('merges cleanly when the edits land on different lines', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');

    // The override changes line three; the real file (independently) moves
    // line one. A clean three-way merge keeps both.
    writeFileSync(
      join(variantDir(opts, 'v1'), 'src/Button.tsx'),
      'line one\nline two\nOVERRIDE THREE\n',
    );
    writeFileSync(join(root, 'src', 'Button.tsx'), 'REAL ONE\nline two\nline three\n');

    const result = syncVariant(opts, 'v1');
    expect(result.merged).toEqual(['src/Button.tsx']);
    expect(result.conflicts).toEqual([]);
    const mergedText = readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8');
    expect(mergedText).toBe('REAL ONE\nline two\nOVERRIDE THREE\n');

    // The base advances, so the merged file reads as unchanged next time.
    expect(listVariants(opts)[0].stale).toEqual([]);
    expect(syncVariant(opts, 'v1').unchanged).toEqual(['src/Button.tsx']);
  });

  it('leaves conflict markers and reports a conflict when both sides touch the same line', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');

    writeFileSync(
      join(variantDir(opts, 'v1'), 'src/Button.tsx'),
      'line one\nVARIANT TWO\nline three\n',
    );
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
    expect(listVariants(opts)[0].stale).toEqual([]);
    expect(syncVariant(opts, 'v1')).toEqual({
      merged: [],
      conflicts: [],
      unchanged: ['src/Button.tsx'],
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
    writeFileSync(
      join(root, 'src', 'Long.tsx'),
      original.replace('line one', 'REAL ONE').replace('line last', 'REAL LAST'),
    );

    const result = syncVariant(opts, 'v1');
    expect(result.conflicts).toEqual(['src/Long.tsx']);
    expect(result.merged).toEqual([]);
    const withMarkers = readFileSync(join(variantDir(opts, 'v1'), 'src/Long.tsx'), 'utf8');
    expect(withMarkers.match(/<<<<<<< variant/g)).toHaveLength(2);
    expect(withMarkers).toContain('VARIANT ONE');
    expect(withMarkers).toContain('REAL ONE');
    expect(withMarkers).toContain('VARIANT LAST');
    expect(withMarkers).toContain('REAL LAST');
    expect(listVariants(opts)[0].stale).toEqual([]);
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
    manifest.files['src/Button.tsx'].base = null;
    writeFileSync(
      join(variantDir(opts, 'v1'), 'variant.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const before = readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8');
    writeFileSync(join(root, 'src', 'Button.tsx'), 'line one\nline two\nline three CHANGED\n');

    const result = syncVariant(opts, 'v1');
    expect(result.conflicts).toEqual(['src/Button.tsx']);
    expect(readFileSync(join(variantDir(opts, 'v1'), 'src/Button.tsx'), 'utf8')).toBe(before);
  });
});

describe('promote / drop', () => {
  it('promote lands overrides in the tree, deletes the dir, and clears active', () => {
    const { root, opts } = tempRepo();
    createVariant(opts, { id: 'v1' });
    addVariantFile(opts, 'v1', 'src/Button.tsx');
    writeFileSync(
      join(variantDir(opts, 'v1'), 'src/Button.tsx'),
      'promoted content\n',
    );
    createVariant(opts, { id: 'other' });
    writeActive(opts, ['other', 'v1']);

    const result = promoteVariant(opts, 'v1');
    expect(result.files).toEqual(['src/Button.tsx']);
    expect(readFileSync(join(root, 'src', 'Button.tsx'), 'utf8')).toBe('promoted content\n');
    expect(existsSync(variantDir(opts, 'v1'))).toBe(false);
    // Only the promoted one leaves the set.
    expect(readActive(opts)).toEqual(['other']);
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
  });

  it('refuses an id that is not a directory name, before anything is removed', () => {
    // `variant drop ..` resolved to the variants dir's parent, which is
    // `.iso-iterate/`, and one more level up is the project root.
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
    const file = join(root, '.iso-iterate', 'active.json');
    mkdirSync(join(root, '.iso-iterate'), { recursive: true });
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
    expect(resolveOverride(opts, both, join(root, 'src', 'Button.tsx'))).toBe(
      join(variantDir(opts, 'button-b'), 'src/Button.tsx'),
    );
    expect(resolveOverride(opts, both, join(root, 'src', 'Table.tsx'))).toBe(
      join(variantDir(opts, 'table-b'), 'src/Table.tsx'),
    );
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
    expect(resolveOverride(opts, ['v1'], join(root, 'src', 'Button.tsx'))).toBe(
      join(variantDir(opts, 'v1'), 'src/Button.tsx'),
    );
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
    writeFileSync(
      join(variantDir(opts, 'g'), 'src', 'Button.tsx'),
      '<<<<<<< variant\nx\n=======\ny\n>>>>>>> default\n',
    );
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
    manifest.files['src/Button.tsx'].base = null;
    writeFileSync(
      join(variantDir(opts, 'nb'), 'variant.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    expect(() => promoteVariant(opts, 'nb')).toThrow(
      /no base recorded for src\/Button\.tsx \(not a git repo when the override was made\)/,
    );
    expect(() => promoteVariant(opts, 'nb')).not.toThrow(/changed since/);
  });
});

describe('knobs file', () => {
  it('reads usable axes and drops the rest; missing or malformed is none', () => {
    const root = mkdtempSync(join(tmpdir(), 'iso-knobs-'));
    try {
      const opts = { root };
      expect(readKnobs(opts)).toEqual([]);
      mkdirSync(join(root, '.iso-iterate'), { recursive: true });
      writeFileSync(join(root, '.iso-iterate/knobs.json'), 'nope');
      expect(readKnobs(opts)).toEqual([]);
      writeFileSync(
        join(root, '.iso-iterate/knobs.json'),
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
