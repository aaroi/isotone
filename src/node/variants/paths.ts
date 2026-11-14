/** Paths inside the variants tree, and the guard every user-supplied path goes through. */

import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isEscaping, isWithin, toPosixPath } from '../fs/paths';
import { type VariantsStoreOptions, variantsDir } from './options';

export function variantDir(opts: VariantsStoreOptions, id: string): string {
  if (!isValidVariantId(id)) throw new Error(`Invalid variant id "${id}"`);
  return join(variantsDir(opts), id);
}

/** Inside a variant's directory: the bases git could not store, because the
 *  copy was made or synced outside a repository. Named by blob hash. */
const BASES_DIR = '.isotone-base';

/** A kept base, or one being written. Nothing else in the store is ever deleted. */
export const BASE_FILE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?(?:\.[a-f0-9-]{36}\.tmp)?$/;

/** The first path segment, which a case-insensitive filesystem reads in any case. */
function isReserved(key: string): boolean {
  return key.split('/')[0]?.toLowerCase() === BASES_DIR;
}

/**
 * The variant's kept-bases directory. Variants are committed and shared, so
 * anything but a plain directory of regular base files (a link, a file, a
 * checkout that turned a link into either) is refused before anything is written.
 */
export function baseStore(opts: VariantsStoreOptions, id: string): string {
  const dir = variantDir(opts, id);
  const store = join(dir, BASES_DIR);
  const stat = lstatSync(store, { throwIfNoEntry: false });
  const sound =
    !stat ||
    (stat.isDirectory() &&
      isWithin(dir, store, { realpath: true }) &&
      readdirSync(store, { withFileTypes: true }).every((entry) => entry.isFile() || !BASE_FILE.test(entry.name)));
  if (!sound) throw new Error(`${store} is not a plain directory of kept bases, so "${id}" was left unchanged. Remove it.`);
  return store;
}

/**
 * A manifest key is joined onto the variant dir and onto the project root,
 * so a key that climbs out of either (`../../x`, an absolute path, or a
 * backslash that Windows would read as a separator) would let a hand-edited
 * or checked-in variant.json reach files outside both trees. Such a manifest
 * is not a variant at all.
 */
export function isSafeManifestKey(key: string): boolean {
  if (!key || isAbsolute(key) || /[\\:\0]/.test(key) || key === 'variant.json' || isReserved(key)) return false;
  return !key.split('/').some((segment) => !segment || segment === '.' || segment === '..' || segment === '.git');
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
export function repoRelativeKey(root: string, file: string): { abs: string; key: string } {
  const typed = relative(root, isAbsolute(file) ? resolve(file) : resolve(root, file));
  if (!typed || isEscaping(typed)) throw new Error(`"${file}" escapes the project root`);
  const rel = onDiskCase(root, typed);
  const abs = join(root, rel);
  if (isReserved(toPosixPath(rel))) throw new Error(`"${file}" is under ${BASES_DIR}/, which variants reserve for their bases`);
  if (!isSafeManifestKey(toPosixPath(rel)) || !isWithin(root, abs, { realpath: true })) {
    throw new Error(`"${file}" escapes the project root`);
  }
  return { abs, key: toPosixPath(rel) };
}

/**
 * `rel` with each existing segment spelled as it is on disk. On a
 * case-insensitive filesystem `src/app.tsx` opens `src/App.tsx`, but Vite
 * asks for the real spelling, so a key in the typed case would never match.
 */
function onDiskCase(root: string, rel: string): string {
  let dir = root;
  const segments: string[] = [];
  for (const segment of rel.split(sep)) {
    let name = segment;
    if (existsSync(join(dir, segment))) {
      try {
        const names = readdirSync(dir);
        if (!names.includes(segment)) {
          const matches = names.filter((n) => n.toLowerCase() === segment.toLowerCase());
          if (matches.length === 1) name = matches[0] as string;
        }
      } catch {
        /* Unlistable: keep the typed name. */
      }
    }
    segments.push(name);
    dir = join(dir, name);
  }
  return segments.join(sep);
}
