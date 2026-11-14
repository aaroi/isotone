/** Bringing a variant up to date with the real files it overrides. */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { hashFile, hasGit, mergeFile, isConflictStatus, readBase, recordBase } from './git';
import { readVariant, writeVariant, isStale } from './manifest';
import { type VariantsStoreOptions, mutateVariants } from './options';
import { baseStore, variantDir } from './paths';

/**
 * Why a file was left as it was instead of merged:
 * - `no-base`: the manifest records no base, as Isotone 1.5.0 and earlier did
 *   for a copy made outside a Git repository;
 * - `base-missing`: the recorded base can no longer be read;
 * - `no-file`: the real file is gone;
 * - `appeared`: the variant adds the file, and the project now has its own;
 * - `no-git`: Git is not installed, so nothing can merge;
 * - `git-failed`: `git merge-file` failed outright.
 */
export type SyncBlocker = 'no-base' | 'base-missing' | 'no-file' | 'appeared' | 'no-git' | 'git-failed';

export interface SyncResult {
  merged: string[];
  /** Merged with conflict markers for a person to resolve. */
  conflicts: string[];
  unchanged: string[];
  /** Left as they were, and why. */
  blocked: Record<string, SyncBlocker>;
}

export function syncVariant(opts: VariantsStoreOptions, id: string): SyncResult {
  return mutateVariants(opts, () => {
    const manifest = readVariant(opts, id);
    if (!manifest) throw new Error(`No variant "${id}"`);
    const root = resolve(opts.root);
    const vDir = variantDir(opts, id);
    const store = baseStore(opts, id);

    const merged: string[] = [];
    const conflicts: string[] = [];
    const unchanged: string[] = [];
    const blocked: Record<string, SyncBlocker> = {};
    let dirty = false;
    let git: boolean | undefined;

    for (const [file, entry] of Object.entries(manifest.files)) {
      const currentAbs = join(root, file);
      const overrideAbs = join(vDir, file);
      if (entry.added) {
        // Nothing to merge into; a real file that appeared meanwhile is a
        // conflict for a person to settle.
        if (existsSync(currentAbs)) blocked[file] = 'appeared';
        else unchanged.push(file);
        continue;
      }

      if (entry.base === null) {
        // Nothing to diff against. A copy still identical to the real file
        // has nothing to lose, though, so that file becomes its base.
        const base = sameBytes(overrideAbs, currentAbs) ? recordBase(currentAbs, store) : null;
        if (base === null) {
          blocked[file] = 'no-base';
          continue;
        }
        entry.base = base;
        dirty = true;
        unchanged.push(file);
        continue;
      }

      const currentHash = hashFile(currentAbs, entry.base);
      if (!isStale(entry.base, currentHash)) {
        unchanged.push(file);
        continue;
      }
      // No current file to merge into, or nothing to merge with: the override
      // is left as-is and flagged for a person to sort out.
      if (currentHash === null) {
        blocked[file] = 'no-file';
        continue;
      }
      git ??= hasGit();
      if (!git) {
        blocked[file] = 'no-git';
        continue;
      }
      const baseContent = readBase(dirname(currentAbs), entry.base, store);
      if (baseContent === null) {
        blocked[file] = 'base-missing';
        continue;
      }

      const baseTmp = join(tmpdir(), `isotone-base-${randomUUID()}`);
      writeFileSync(baseTmp, baseContent);
      try {
        const result = mergeFile(overrideAbs, baseTmp, currentAbs);
        if (result.status === 0) {
          writeFileSync(overrideAbs, result.stdout);
          entry.base = recordBase(currentAbs, store) ?? currentHash;
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
          entry.base = recordBase(currentAbs, store) ?? currentHash;
          dirty = true;
          conflicts.push(file);
        } else {
          // Git failed outright; its empty stdout must not replace the
          // override, and the base stays where it was.
          blocked[file] = 'git-failed';
        }
      } finally {
        rmSync(baseTmp, { force: true });
      }
    }

    if (dirty) writeVariant(opts, manifest);
    return { merged, conflicts, unchanged, blocked };
  });
}

function sameBytes(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}
