/**
 * isotone — overlay variants store (node only).
 *
 * An overlay variant is a directory of alternative source files under
 * `.isotone/variants/<id>/`, mirrored at their repo-relative paths, plus
 * a `variant.json` manifest recording which git blob each override was made
 * from. That blob is the three-way merge base: when the real file moves on,
 * `syncVariant` diffs the override against what it started from and what
 * the file is now, the same way a branch rebases. Everything here is
 * synchronous and framework-free so the CLI and the Vite plugin (a
 * different owner) can both sit on top of it.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { IterationElement } from '../../core/index';
import {
  type ColorVariantAxis,
  type KnobAxis,
  OVERLAY_GROUP_ID,
  overlayGroups,
  type OverlayVariant,
  type OverlayVariantStatus,
  type RangeVariantAxis,
  type SelectVariantAxis,
} from '../../core/variants';
import { ensureFileIgnored } from '../fs/git-exclude';
import { type HandlerRequest, type HandlerResponse, jsonResponse } from '../http';
import { writeJson } from '../fs/atomic';
import { withFileLock } from '../fs/lock';
import { isEscaping, isWithin, toPosixPath } from '../fs/paths';

/** Default location of the variants tree, relative to the project root. */
export const DEFAULT_VARIANTS_DIR = '.isotone/variants';

/** Relative to root. Holds `{ "active": ["<id>", ...] }`, at most one id per
 *  group. The Vite plugin keeps this out of git; nothing here assumes that. */
export const ACTIVE_FILE = '.isotone/active.json';

/** Relative to root. A JSON array of {@link KnobAxis}; committed, since the
 *  defaults in it are part of the design. Missing or malformed reads as none. */
export const KNOBS_FILE = '.isotone/knobs.json';

export interface VariantsStoreOptions {
  /** Project root: Vite's root or the CLI's cwd. Absolute. */
  root: string;
  /** Variants directory, relative to root or absolute. Default {@link DEFAULT_VARIANTS_DIR}. */
  dir?: string;
}

interface ActiveFileShape {
  active: string[];
}

/** Agents in separate processes may edit the same manifest. Keep their
 * read-modify-write operations together, including promotion and removal. */
function mutateVariants<T>(opts: VariantsStoreOptions, change: () => T): T {
  return withFileLock(join(variantsDir(opts), '.mutation'), change);
}

/* ── paths ────────────────────────────────────────────────────────────── */

export function variantsDir(opts: VariantsStoreOptions): string {
  const dir = opts.dir ?? DEFAULT_VARIANTS_DIR;
  return isAbsolute(dir) ? dir : resolve(opts.root, dir);
}

export function variantDir(opts: VariantsStoreOptions, id: string): string {
  if (!isValidVariantId(id)) throw new Error(`Invalid variant id "${id}"`);
  return join(variantsDir(opts), id);
}

export function isValidVariantId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/**
 * Resolve `file` (repo-relative, or absolute inside root) against `root`
 * and return both the absolute path and its POSIX repo-relative manifest
 * key. Throws for anything that escapes root, so every caller that takes a
 * user-supplied path gets the same guard.
 */
function repoRelativeKey(root: string, file: string): { abs: string; key: string } {
  const abs = isAbsolute(file) ? resolve(file) : resolve(root, file);
  const rel = relative(root, abs);
  if (!rel || isEscaping(rel) || !isSafeManifestKey(toPosixPath(rel)) || !isWithin(root, abs, { realpath: true })) {
    throw new Error(`"${file}" escapes the project root`);
  }
  return { abs, key: toPosixPath(rel) };
}

/* ── manifest read/write ──────────────────────────────────────────────── */

/**
 * A manifest key is joined onto the variant dir and onto the project root,
 * so a key that climbs out of either (`../../x`, an absolute path, or a
 * backslash that Windows would read as a separator) would let a hand-edited
 * or checked-in variant.json reach files outside both trees. Such a manifest
 * is not a variant at all.
 */
function isSafeManifestKey(key: string): boolean {
  if (!key || isAbsolute(key) || /[\\:\0]/.test(key) || key === 'variant.json') return false;
  return !key.split('/').some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git');
}

function isPlausibleVariant(v: unknown): v is OverlayVariant {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.label === 'string' &&
    typeof o.createdAt === 'string' &&
    (o.route === undefined || typeof o.route === 'string') &&
    (o.description === undefined || typeof o.description === 'string') &&
    (o.group === undefined || (typeof o.group === 'string' && OVERLAY_GROUP_ID.test(o.group))) &&
    (o.groupLabel === undefined || typeof o.groupLabel === 'string') &&
    (o.section === undefined || typeof o.section === 'string') &&
    !!o.files &&
    typeof o.files === 'object' &&
    !Array.isArray(o.files) &&
    Object.entries(o.files).every(
      ([key, entry]) =>
        isSafeManifestKey(key) &&
        entry &&
        typeof entry === 'object' &&
        'base' in entry &&
        (entry.base === null || (typeof entry.base === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(entry.base))) &&
        (!('added' in entry) || entry.added === true),
    )
  );
}

export function readVariant(opts: VariantsStoreOptions, id: string): OverlayVariant | null {
  // An id that is not a valid directory name (`..`, a path with a slash)
  // would resolve to somewhere outside the variants dir; there is no
  // variant there by definition.
  if (!isValidVariantId(id)) return null;
  const file = join(variantDir(opts, id), 'variant.json');
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const dir = variantDir(opts, id);
    return isPlausibleVariant(data) &&
      data.id === id &&
      isWithin(variantsDir(opts), file, { realpath: true }) &&
      Object.keys(data.files).every(
        (key) => isWithin(opts.root, join(opts.root, key), { realpath: true }) && isWithin(dir, join(dir, key), { realpath: true }),
      )
      ? data
      : null;
  } catch {
    // Junk directory: unreadable or not JSON. listVariants skips it.
    return null;
  }
}

export function writeVariant(opts: VariantsStoreOptions, v: OverlayVariant): void {
  if (!isPlausibleVariant(v)) throw new Error('Invalid variant manifest');
  const dir = variantDir(opts, v.id);
  if (!isWithin(variantsDir(opts), dir, { realpath: true })) throw new Error('Variant directory escapes the variants tree');
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'variant.json'), v);
}

/** Whether a tracked file has drifted from what its override was derived
 *  from. `base: null` (never hashed, or the manifest was hand-edited to
 *  simulate an unreachable blob) counts as stale too: there's nothing to
 *  compare against, so we can't claim it's unchanged. */
function isStale(base: string | null, currentHash: string | null): boolean {
  return base === null || currentHash === null || currentHash !== base;
}

/** Every valid manifest, oldest first, without the per-file status that
 *  {@link listVariants} hashes for. */
export function readVariants(opts: VariantsStoreOptions): OverlayVariant[] {
  const dir = variantsDir(opts);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readVariant(opts, e.name))
    .filter((v): v is OverlayVariant => v !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function listVariants(opts: VariantsStoreOptions): OverlayVariantStatus[] {
  const dir = variantsDir(opts);
  if (!existsSync(dir)) return [];
  const root = resolve(opts.root);
  const ids = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const statuses: OverlayVariantStatus[] = [];
  const hashes = new Map<string, string | null>();
  for (const id of ids) {
    const manifest = readVariant(opts, id);
    if (!manifest) continue; // no manifest, or invalid JSON: not a variant
    const stale: string[] = [];
    const missing: string[] = [];
    for (const [file, entry] of Object.entries(manifest.files)) {
      const overrideAbs = join(dir, id, file);
      if (!existsSync(overrideAbs)) {
        missing.push(file);
        continue;
      }
      // A file the variant adds is current for as long as the project still
      // lacks it; once a real one appears, the two need a person.
      if (entry.added) {
        if (existsSync(join(root, file))) stale.push(file);
        continue;
      }
      const hashKey = `${entry.base?.length}:${file}`;
      if (!hashes.has(hashKey)) hashes.set(hashKey, hashFile(join(root, file), entry.base));
      if (isStale(entry.base, hashes.get(hashKey) ?? null)) stale.push(file);
    }
    statuses.push({ ...manifest, stale, missing });
  }
  statuses.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return statuses;
}

export function createVariant(
  opts: VariantsStoreOptions,
  input: {
    id: string;
    label?: string;
    route?: string;
    element?: IterationElement | null;
    note?: string;
    description?: string;
    group?: string;
    groupLabel?: string;
    section?: string;
  },
): OverlayVariant {
  return mutateVariants(opts, () => {
    if (!isValidVariantId(input.id)) {
      throw new Error(`Invalid variant id "${input.id}"`);
    }
    if (input.group !== undefined) assertGroupId(input.group);
    if (readVariant(opts, input.id)) {
      throw new Error(`Variant "${input.id}" already exists`);
    }
    const variant: OverlayVariant = {
      id: input.id,
      label: input.label || input.id,
      createdAt: new Date().toISOString(),
      files: {},
      ...(input.route !== undefined ? { route: input.route } : {}),
      ...(input.element !== undefined ? { element: input.element } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.group !== undefined ? { group: input.group } : {}),
      ...(input.groupLabel !== undefined ? { groupLabel: input.groupLabel } : {}),
      ...(input.section !== undefined ? { section: input.section } : {}),
    };
    writeVariant(opts, variant);
    return variant;
  });
}

function assertGroupId(group: string): void {
  if (!OVERLAY_GROUP_ID.test(group)) {
    throw new Error(`Invalid group id "${group}" (lowercase letters, digits and hyphens)`);
  }
}

/** Put an existing variant into a group, so two variants made separately
 *  become alternatives of one decision. `groupLabel` is left as it was
 *  unless given. */
export function setVariantGroup(opts: VariantsStoreOptions, id: string, group: string, groupLabel?: string): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    assertGroupId(group);
    manifest.group = group;
    if (groupLabel !== undefined) manifest.groupLabel = groupLabel;
    writeVariant(opts, manifest);
    return manifest;
  });
}

/**
 * Put an existing variant's selector in a panel section, or take it out of
 * every section with `''`. `undefined` removes the field, so the group label's
 * prefix (`"Header > Logo"`) decides again.
 */
export function setVariantSection(opts: VariantsStoreOptions, id: string, section: string | undefined): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    if (section === undefined) delete manifest.section;
    else manifest.section = section.replace(/\s+/g, ' ').trim();
    writeVariant(opts, manifest);
    return manifest;
  });
}

/**
 * Copy a real file into the variant. With `create`, the file is one the
 * project does not have yet: the variant gets an empty file at that path,
 * and the plugin resolves imports of it while the variant is loaded.
 */
export function addVariantFile(
  opts: VariantsStoreOptions,
  id: string,
  file: string,
  { create = false }: { create?: boolean } = {},
): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    const root = resolve(opts.root);
    const { abs: sourceAbs, key } = repoRelativeKey(root, file);
    // Idempotent: a file already tracked keeps its override and its base
    // untouched. Re-adding is a no-op, not a refresh (sync is how you refresh).
    if (Object.hasOwn(manifest.files, key)) return manifest;
    const destAbs = join(variantDir(opts, id), key);
    if (!isWithin(variantDir(opts, id), destAbs, { realpath: true })) throw new Error('Override path escapes the variant directory');
    if (create) {
      if (existsSync(sourceAbs)) throw new Error(`"${file}" already exists; add it without --new`);
      mkdirSync(dirname(destAbs), { recursive: true });
      if (!existsSync(destAbs)) writeFileSync(destAbs, '');
      manifest.files = { ...manifest.files, [key]: { base: null, added: true } };
      writeVariant(opts, manifest);
      return manifest;
    }
    if (!existsSync(sourceAbs)) throw new Error(`"${file}" does not exist. Use --new for a file the variant adds.`);
    mkdirSync(dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, readFileSync(sourceAbs));
    manifest.files = { ...manifest.files, [key]: { base: blobOf(sourceAbs) } };
    writeVariant(opts, manifest);
    return manifest;
  });
}

export function removeVariantFile(opts: VariantsStoreOptions, id: string, file: string): OverlayVariant {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    const root = resolve(opts.root);
    const { key } = repoRelativeKey(root, file);
    if (Object.hasOwn(manifest.files, key)) {
      delete manifest.files[key];
      rmSync(join(variantDir(opts, id), key), { force: true });
      writeVariant(opts, manifest);
    }
    return manifest;
  });
}

/** The marker `git merge-file` leaves at the top of a conflicted hunk, with
 *  the label `syncVariant` gives the override side. */
const CONFLICT_MARKER = '<<<<<<< variant';

/**
 * Land a variant: copy every override over its real file, then delete the
 * variant. Refuses when an override would silently discard work: a file
 * whose real source moved on since the override was made (run `syncVariant`
 * first) or an override still carrying merge conflict markers. `force`
 * skips both checks for the case where the reviewer has decided the
 * override wins as-is.
 */
export function promoteVariant(
  opts: VariantsStoreOptions,
  id: string,
  { force = false }: { force?: boolean } = {},
): { files: string[]; rebased: string[] } {
  return mutateVariants(opts, () => {
    // Checked before the manifest read so the rmSync below can never be
    // handed a directory the id escaped into.
    if (!isValidVariantId(id)) throw new Error(`Invalid variant id "${id}"`);
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    const active = readActive(opts);
    const root = resolve(opts.root);
    const vDir = variantDir(opts, id);
    const missing = Object.keys(manifest.files).filter((key) => !existsSync(join(vDir, key)));
    if (missing.length) throw new Error(`"${id}" has missing overrides: ${missing.join(', ')}. Restore or remove them before promoting.`);
    if (!force) {
      const status = listVariants(opts).find((v) => v.id === id);
      if (status?.stale.length) {
        // A null base is stale by definition, but the file did not necessarily
        // change: there was simply no git to record what it looked like.
        const reasons = status.stale.map((file) =>
          manifest.files[file]?.base === null
            ? `no base recorded for ${file} (not a git repo when the override was made)`
            : `${file} changed since the override was made`,
        );
        throw new Error(`"${id}" is stale (${reasons.join('; ')}). Run \`variant sync ${id}\` first, or promote with --force.`);
      }
      const conflicted = Object.keys(manifest.files).filter((key) => {
        const overrideAbs = join(vDir, key);
        return existsSync(overrideAbs) && readFileSync(overrideAbs, 'utf8').includes(CONFLICT_MARKER);
      });
      if (conflicted.length) {
        throw new Error(`"${id}" has unresolved conflict markers in ${conflicted.join(', ')}. Resolve them, or promote with --force.`);
      }
    }
    const siblings =
      overlayGroups(readVariants(opts))
        .find((g) => g.members.some((m) => m.id === id))
        ?.members.filter((m) => m.id !== id) ?? [];
    const files: string[] = [];
    const landed = new Map<string, { before: string | null; after: string | null }>();
    for (const key of Object.keys(manifest.files)) {
      const overrideAbs = join(vDir, key);
      const destAbs = join(root, key);
      const before = existsSync(destAbs) ? currentBlob(destAbs) : null;
      mkdirSync(dirname(destAbs), { recursive: true });
      writeFileSync(destAbs, readFileSync(overrideAbs));
      landed.set(key, { before, after: blobOf(destAbs) });
      files.push(key);
    }
    rmSync(vDir, { recursive: true, force: true });
    if (active.includes(id))
      writeActive(
        opts,
        active.filter((a) => a !== id),
      );
    return { files, rebased: rebaseSiblings(opts, siblings, landed) };
  });
}

/**
 * A sibling is another answer to the decision the promote just settled, so the
 * promoted file is what it now differs from: reading it as out of date would
 * only send someone to merge two alternatives into each other. Only a copy made
 * from the version the promote replaced moves. One that was already behind
 * stays stale, because the real file changed in ways nobody has looked at.
 */
function rebaseSiblings(
  opts: VariantsStoreOptions,
  siblings: OverlayVariant[],
  landed: Map<string, { before: string | null; after: string | null }>,
): string[] {
  const rebased: string[] = [];
  for (const sibling of siblings) {
    let moved = false;
    for (const [key, entry] of Object.entries(sibling.files)) {
      const change = landed.get(key);
      if (!change?.after || !(entry.added || (entry.base !== null && entry.base === change.before))) continue;
      sibling.files[key] = { base: change.after };
      moved = true;
    }
    if (!moved) continue;
    writeVariant(opts, sibling);
    rebased.push(sibling.id);
  }
  return rebased;
}

export function dropVariant(opts: VariantsStoreOptions, id: string): void {
  mutateVariants(opts, () => {
    // `variant drop ..` would otherwise resolve to the variants dir's parent
    // and rmSync it, recursively.
    if (!isValidVariantId(id)) throw new Error(`Invalid variant id "${id}"`);
    const active = readActive(opts);
    rmSync(variantDir(opts, id), { recursive: true, force: true });
    if (active.includes(id))
      writeActive(
        opts,
        active.filter((a) => a !== id),
      );
  });
}

/* ── git blob hashing ─────────────────────────────────────────────────── */

/** A failed lookup is an answer here (`null`), not something to print. */
const GIT_QUIET: ['ignore', 'pipe', 'ignore'] = ['ignore', 'pipe', 'ignore'];

/**
 * `git hash-object` looks up the repository from its cwd, not from the
 * path it's hashing, so every call here runs with cwd set to the file's own
 * directory — always inside the right repo regardless of where the caller's
 * process happens to be.
 */
export function blobOf(absPath: string): string | null {
  try {
    return execFileSync('git', ['hash-object', '--no-filters', '-w', absPath], {
      cwd: dirname(absPath),
      encoding: 'utf8',
      stdio: GIT_QUIET,
    }).trim();
  } catch {
    return null;
  }
}

export function currentBlob(absPath: string): string | null {
  try {
    return execFileSync('git', ['hash-object', '--no-filters', absPath], {
      cwd: dirname(absPath),
      encoding: 'utf8',
      stdio: GIT_QUIET,
    }).trim();
  } catch {
    return null;
  }
}

/** Git blob hashing is just a header and the file bytes. Existing bases tell
 * us the repository's hash format, avoiding a process per file on every poll. */
function hashFile(file: string, base: string | null): string | null {
  if (base === null) return null;
  try {
    const contents = readFileSync(file);
    return createHash(base.length === 64 ? 'sha256' : 'sha1')
      .update(`blob ${contents.length}\0`)
      .update(contents)
      .digest('hex');
  } catch {
    return null;
  }
}

function catFile(cwd: string, hash: string): string | null {
  try {
    return execFileSync('git', ['cat-file', '-p', hash], { cwd, encoding: 'utf8', stdio: GIT_QUIET });
  } catch {
    return null; // the blob isn't reachable (gc'd, or never written)
  }
}

/** Runs `git merge-file -p <override> <base> <current>`, capturing stdout
 *  whether it exits clean (0) or with conflict markers. execFileSync throws
 *  on a nonzero exit, but the thrown error still carries stdout and the exit
 *  status, so both are read from there. `status` is null when git never
 *  ran to completion (killed by a signal, or not found). */
function mergeFile(
  overrideAbs: string,
  baseAbs: string,
  currentAbs: string,
): {
  status: number | null;
  stdout: string;
} {
  try {
    const stdout = execFileSync(
      'git',
      ['merge-file', '-p', '-L', 'variant', '-L', 'base', '-L', 'default', overrideAbs, baseAbs, currentAbs],
      { encoding: 'utf8', stdio: GIT_QUIET },
    );
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: string };
    return { status: e.status ?? null, stdout: e.stdout ?? '' };
  }
}

/** `git merge-file` exits with the number of conflicts it left, so 1..127
 *  is a conflicted merge whose stdout still carries the whole file (with
 *  markers). 128 and up, or no status at all, is git failing outright. */
function isConflictStatus(status: number | null): boolean {
  return status !== null && status >= 1 && status <= 127;
}

/** The base a later sync merges from has to be in git's object store. A file
 *  git does not track yet is in there only if this writes it. */
function recordBase(absPath: string, hash: string): string {
  return blobOf(absPath) ?? hash;
}

export function syncVariant(opts: VariantsStoreOptions, id: string): { merged: string[]; conflicts: string[]; unchanged: string[] } {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    const root = resolve(opts.root);
    const vDir = variantDir(opts, id);

    const merged: string[] = [];
    const conflicts: string[] = [];
    const unchanged: string[] = [];
    let dirty = false;

    for (const [file, entry] of Object.entries(manifest.files)) {
      const currentAbs = join(root, file);
      const overrideAbs = join(vDir, file);
      if (entry.added) {
        // Nothing to merge into; a real file that appeared meanwhile is a
        // conflict for a person to settle.
        (existsSync(currentAbs) ? conflicts : unchanged).push(file);
        continue;
      }
      const currentHash = currentBlob(currentAbs);

      if (!isStale(entry.base, currentHash)) {
        unchanged.push(file);
        continue;
      }

      // No base to diff against (never hashed, or the blob is unreachable), or
      // no current file to merge into: nothing to three-way merge, so the
      // override is left as-is and flagged for a person to sort out.
      const baseContent = entry.base !== null ? catFile(dirname(currentAbs), entry.base) : null;
      if (baseContent === null || currentHash === null) {
        conflicts.push(file);
        continue;
      }

      const baseTmp = join(tmpdir(), `isotone-base-${randomUUID()}`);
      writeFileSync(baseTmp, baseContent);
      try {
        const result = mergeFile(overrideAbs, baseTmp, currentAbs);
        if (result.status === 0) {
          writeFileSync(overrideAbs, result.stdout);
          entry.base = recordBase(currentAbs, currentHash);
          dirty = true;
          merged.push(file);
        } else if (isConflictStatus(result.status)) {
          // The markers go into the override for a person to resolve, and the
          // base advances anyway, the way git records a conflicted merge:
          // the current file is now what the override was reconciled against,
          // so resolving the markers is all that stands between it and
          // promote. Left behind, the base would make the resolved file read
          // as stale and a second sync would re-conflict the same hunks; the
          // marker check in promoteVariant is the guard that remains.
          writeFileSync(overrideAbs, result.stdout);
          entry.base = recordBase(currentAbs, currentHash);
          dirty = true;
          conflicts.push(file);
        } else {
          // Git failed outright; its empty stdout must not replace the
          // override, and the base stays where it was.
          conflicts.push(file);
        }
      } finally {
        rmSync(baseTmp, { force: true });
      }
    }

    if (dirty) writeVariant(opts, manifest);
    return { merged, conflicts, unchanged };
  });
}

/* ── active variants / vite load() lookup ─────────────────────────── */

/**
 * The override that answers for `absSourcePath` under the active set, or
 * `null` when the real file stands. The first active variant whose manifest
 * names the file wins; `readActive` and the endpoint keep the set free of
 * two variants over one file, so in practice there is only ever one.
 */
export function resolveOverride(opts: VariantsStoreOptions, active: string[], absSourcePath: string): string | null {
  if (active.length === 0) return null;
  const root = resolve(opts.root);
  const relToRoot = relative(root, resolve(absSourcePath));
  if (isEscaping(relToRoot)) return null;
  const key = toPosixPath(relToRoot);
  for (const id of active) {
    const manifest = readVariant(opts, id);
    if (!manifest || !Object.hasOwn(manifest.files, key)) continue;
    const overrideAbs = join(variantDir(opts, id), key);
    if (existsSync(overrideAbs)) return overrideAbs;
  }
  return null;
}

export function overrideSourcePath(opts: VariantsStoreOptions, absOverridePath: string): { id: string; file: string } | null {
  const rel = relative(variantsDir(opts), resolve(absOverridePath));
  if (!rel || isEscaping(rel)) return null;
  const [id, ...rest] = toPosixPath(rel).split('/');
  if (!id || rest.length === 0) return null;
  return { id, file: rest.join('/') };
}

/**
 * Two active variants over the same file, as `[first, second, file]`, or
 * `null` when the set is consistent. `load` can only serve one copy of a
 * file, so such a set is refused by the endpoint and trimmed by
 * {@link readActive}. Ids without a manifest are skipped; the callers
 * check existence themselves.
 */
export function activeConflict(opts: VariantsStoreOptions, ids: string[]): [string, string, string] | null {
  const owner = new Map<string, string>();
  for (const id of ids) {
    const manifest = readVariant(opts, id);
    for (const file of Object.keys(manifest?.files ?? {})) {
      const first = owner.get(file);
      if (first !== undefined && first !== id) return [first, id, file];
      owner.set(file, id);
    }
  }
  return null;
}

/**
 * Variants in another group that override one of this variant's files. Groups
 * are independent selectors, so picking both of these fails at activation.
 */
export function crossGroupOverlaps(opts: VariantsStoreOptions, id: string): { file: string; other: string }[] {
  const variants = readVariants(opts);
  const self = variants.find((v) => v.id === id);
  if (!self) return [];
  const siblings = overlayGroups(variants).find((g) => g.members.some((m) => m.id === id))?.members ?? [];
  return variants.flatMap((other) =>
    other.id === id || siblings.includes(other)
      ? []
      : Object.keys(other.files)
          .filter((file) => Object.hasOwn(self.files, file))
          .map((file) => ({ file, other: other.id })),
  );
}

/**
 * The active set, cleaned: ids whose variant is gone (dropped or promoted
 * since the file was written) are dropped, and of two variants over one
 * file the later one is dropped, so `load` never has to choose. The file's
 * older shape, one id or `null`, still reads.
 */
/** The host's knobs, dropping entries that are not a usable axis. */
export function readKnobs(opts: VariantsStoreOptions): KnobAxis[] {
  const file = resolve(opts.root, KNOBS_FILE);
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  return parsed
    .filter((k): k is KnobAxis => {
      if (!k || typeof k !== 'object') return false;
      const a = k as Partial<KnobAxis>;
      if (typeof a.id !== 'string' || !isValidVariantId(a.id) || typeof a.label !== 'string') return false;
      if (
        a.route !== undefined &&
        typeof a.route !== 'string' &&
        (!Array.isArray(a.route) || !a.route.every((route) => typeof route === 'string'))
      )
        return false;
      if (
        a.showWhen !== undefined &&
        (!a.showWhen ||
          typeof a.showWhen.axis !== 'string' ||
          (a.showWhen.equals !== undefined && typeof a.showWhen.equals !== 'string') ||
          (a.showWhen.not !== undefined && typeof a.showWhen.not !== 'string'))
      )
        return false;
      if (a.section !== undefined && typeof a.section !== 'string') return false;
      if (a.kind === 'range') {
        const { min, max, step, defaultValue } = a as Partial<RangeVariantAxis>;
        if (typeof min !== 'number' || typeof max !== 'number' || typeof step !== 'number' || typeof defaultValue !== 'number')
          return false;
        return (
          [min, max, step, defaultValue, max - min].every(Number.isFinite) &&
          min < max &&
          step > 0 &&
          defaultValue >= min &&
          defaultValue <= max &&
          (a.unit === undefined || typeof a.unit === 'string')
        );
      }
      if (a.kind === 'color') {
        const c = a as Partial<ColorVariantAxis>;
        const hex = (value: unknown) => typeof value === 'string' && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value);
        return (
          hex(c.defaultColor) &&
          Array.isArray(c.swatches) &&
          c.swatches.every((s) => s && typeof s.id === 'string' && typeof s.label === 'string' && hex(s.value))
        );
      }
      if (a.kind === 'select') {
        const s = a as Partial<SelectVariantAxis>;
        return (
          Array.isArray(s.options) &&
          s.options.length > 0 &&
          s.options.every((o) => o && typeof o.id === 'string' && typeof o.label === 'string') &&
          s.options.some((o) => o.id === s.defaultOption)
        );
      }
      return false;
    })
    .filter((axis) => {
      if (seen.has(axis.id)) return false;
      seen.add(axis.id);
      return true;
    });
}

export function readActive(opts: VariantsStoreOptions): string[] {
  const file = join(resolve(opts.root), ACTIVE_FILE);
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = (JSON.parse(readFileSync(file, 'utf8')) as { active?: unknown }).active;
  } catch {
    return [];
  }
  const ids = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const kept: string[] = [];
  const seen = new Set<string>();
  const owner = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    seen.add(id);
    const manifest = readVariant(opts, id);
    if (!manifest) continue;
    const files = Object.keys(manifest.files);
    if (files.some((f) => owner.has(f))) continue;
    for (const f of files) owner.add(f);
    kept.push(id);
  }
  return kept;
}

export function writeActive(opts: VariantsStoreOptions, ids: string[]): void {
  const file = join(resolve(opts.root), ACTIVE_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const active = Array.from(new Set(ids));
  writeJson(file, { active } satisfies ActiveFileShape);
  // Which variants a machine is looking at is local state, never a commit;
  // the CLI writes this too, so the exclusion cannot live in the plugin alone.
  ensureFileIgnored(file);
}

/* ── the endpoint handler ─────────────────────────────────────────────── */

/**
 * The transport-agnostic core of the variants endpoint, mirroring
 * {@link import('../notes/store').notesResponse}. `req.url` is the path relative
 * to wherever the caller mounted `VARIANTS_ENDPOINT` ("/", "/active"), so
 * this function never needs to know the mount point.
 */
export function variantsResponse(opts: VariantsStoreOptions, req: HandlerRequest): HandlerResponse {
  const method = req.method ?? '';
  const path = (req.url ?? '/').split('?')[0] || '/';
  const json = jsonResponse;

  if (method === 'GET' && path === '/') {
    return json(200, { variants: listVariants(opts), active: readActive(opts), knobs: readKnobs(opts) });
  }

  if (method === 'POST' && path === '/active') {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return json(400, { error: 'body must be a JSON object' });
    }
    const raw = (body as { active?: unknown }).active;
    if (!Array.isArray(raw) || !raw.every((id) => typeof id === 'string')) {
      return json(400, { error: 'active must be an array of variant ids' });
    }
    const active = Array.from(new Set(raw as string[]));
    for (const id of active) {
      // Malformed, not merely unknown: a 404 would imply the shape was fine.
      if (!isValidVariantId(id)) return json(400, { error: `invalid variant id "${id}"` });
    }
    for (const id of active) {
      if (!readVariant(opts, id)) return json(404, { error: `unknown variant "${id}"` });
    }
    const conflict = activeConflict(opts, active);
    if (conflict) {
      const [a, b, file] = conflict;
      const groups = overlayGroups(readVariants(opts));
      const named = (id: string) => {
        const label = groups.find((group) => group.members.some((member) => member.id === id))?.label;
        return label ? `"${id}" (${label})` : `"${id}"`;
      };
      return json(409, {
        error: `${named(a)} and ${named(b)} both override ${file}; only one can be active`,
        conflict,
      });
    }
    writeActive(opts, active);
    return json(200, { active });
  }

  return json(405, { error: 'method not allowed' });
}
