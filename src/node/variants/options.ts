/** Where the variants tree and its state files live, and the lock every change takes. */

import { isAbsolute, join, resolve } from 'node:path';
import { type FileLockOptions, withFileLock } from '../fs/lock';

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

export function variantsDir(opts: VariantsStoreOptions): string {
  const dir = opts.dir ?? DEFAULT_VARIANTS_DIR;
  return isAbsolute(dir) ? dir : resolve(opts.root, dir);
}

export interface ActiveFileShape {
  active: string[];
}

/** Agents in separate processes may edit the same manifest. Keep their
 * read-modify-write operations together, including promotion and removal. */
export function mutateVariants<T>(opts: VariantsStoreOptions, change: () => T, lock?: FileLockOptions): T {
  return withFileLock(join(variantsDir(opts), '.mutation'), change, lock);
}
