/** Landing a variant over the real files, and dropping one. */

import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { overlayGroups, type OverlayVariant } from '../../core/variants/overlay';
import { readActive, writeActive } from './active';
import { blobOf, currentBlob } from './git';
import { readVariant, writeVariant, readVariants, listVariants } from './manifest';
import { type VariantsStoreOptions, mutateVariants } from './options';
import { variantDir, isValidVariantId } from './paths';

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
    const files = Object.keys(manifest.files);
    const before = new Map(files.map((key) => [key, existsSync(join(root, key)) ? currentBlob(join(root, key)) : null]));
    landFiles(files.map((key) => ({ from: join(vDir, key), to: join(root, key) })));
    const landed = new Map(files.map((key) => [key, { before: before.get(key) ?? null, after: blobOf(join(root, key)) }]));
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
 * Copy every file or none: each copy is written beside its target first, and
 * only once all are written do they replace the targets. A failure puts back
 * what had already been replaced.
 */
function landFiles(copies: { from: string; to: string }[]): void {
  const staged: { to: string; temp: string; original: Buffer | null; replaced: boolean }[] = [];
  try {
    for (const { from, to } of copies) {
      const original = existsSync(to) ? readFileSync(to) : null;
      mkdirSync(dirname(to), { recursive: true });
      const temp = `${to}.${randomUUID()}.tmp`;
      staged.push({ to, temp, original, replaced: false });
      writeFileSync(temp, readFileSync(from), { flag: 'wx' });
      if (original) chmodSync(temp, statSync(to).mode);
    }
    for (const entry of staged) {
      renameSync(entry.temp, entry.to);
      entry.replaced = true;
    }
  } catch (error) {
    for (const entry of staged) {
      if (entry.replaced) {
        if (entry.original) writeFileSync(entry.to, entry.original);
        else rmSync(entry.to, { force: true });
      } else rmSync(entry.temp, { force: true });
    }
    throw error;
  }
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
