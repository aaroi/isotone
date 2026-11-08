/** Bringing a variant up to date with the real files it overrides. */

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { currentBlob, catFile, mergeFile, isConflictStatus, recordBase } from './git';
import { readVariant, writeVariant, isStale } from './manifest';
import { type VariantsStoreOptions, mutateVariants } from './options';
import { variantDir } from './paths';

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
