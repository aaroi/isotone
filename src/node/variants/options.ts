/** Where the variants tree and its state files live, and the lock every change takes. */

import { join } from 'node:path';
import { withFileLock } from '../fs/lock';
import { variantsDir } from './paths';

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

export interface ActiveFileShape {
  active: string[];
}

/** Agents in separate processes may edit the same manifest. Keep their
 * read-modify-write operations together, including promotion and removal. */
export function mutateVariants<T>(opts: VariantsStoreOptions, change: () => T): T {
  return withFileLock(join(variantsDir(opts), '.mutation'), change);
}
