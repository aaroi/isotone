/** Paths inside the variants tree, and the guard every user-supplied path goes through. */

import { isAbsolute, join, relative, resolve } from 'node:path';
import { isEscaping, isWithin, toPosixPath } from '../fs/paths';
import { isSafeManifestKey } from './manifest';
import { DEFAULT_VARIANTS_DIR, type VariantsStoreOptions } from './options';

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
export function repoRelativeKey(root: string, file: string): { abs: string; key: string } {
  const abs = isAbsolute(file) ? resolve(file) : resolve(root, file);
  const rel = relative(root, abs);
  if (!rel || isEscaping(rel) || !isSafeManifestKey(toPosixPath(rel)) || !isWithin(root, abs, { realpath: true })) {
    throw new Error(`"${file}" escapes the project root`);
  }
  return { abs, key: toPosixPath(rel) };
}
