/** Paths inside the variants tree, and the guard every user-supplied path goes through. */

import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  const typed = relative(root, isAbsolute(file) ? resolve(file) : resolve(root, file));
  if (!typed || isEscaping(typed)) throw new Error(`"${file}" escapes the project root`);
  const rel = onDiskCase(root, typed);
  const abs = join(root, rel);
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
