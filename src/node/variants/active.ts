/** The active variants, and what the Vite plugin's load() swaps in for a source file. */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { overlayGroups } from '../../core/variants/overlay';
import { writeJson } from '../fs/atomic';
import { ensureFileIgnored } from '../fs/git-exclude';
import { isEscaping, toPosixPath } from '../fs/paths';
import { readVariant, readVariants } from './manifest';
import { ACTIVE_FILE, type VariantsStoreOptions, type ActiveFileShape, variantsDir } from './options';
import { variantDir } from './paths';

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
