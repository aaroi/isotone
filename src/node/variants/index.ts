/**
 * isotone — overlay variants store (node only).
 *
 * An overlay variant is a directory of alternative source files under
 * `.isotone/variants/<id>/`, mirrored at their repo-relative paths, plus
 * a `variant.json` manifest recording which git blob each override was made
 * from (unless the commit HEAD holds it, the blob is kept in the variant's own
 * `.isotone-base/`). That blob is the three-way merge base: when the real file moves on,
 * `syncVariant` diffs the override against what it started from and what
 * the file is now, the same way a branch rebases. Everything here is
 * synchronous and framework-free so the CLI and the Vite plugin (a
 * different owner) can both sit on top of it.
 */
export { ACTIVE_FILE, DEFAULT_VARIANTS_DIR, KNOBS_FILE, variantsDir } from './options';
export type { VariantsStoreOptions } from './options';
export { variantDir } from './paths';
export {
  addVariantFile,
  createVariant,
  hasConflictMarkers,
  filesWithoutBase,
  listVariants,
  readVariant,
  readVariants,
  removeVariantFile,
  setVariantGroup,
  setVariantSection,
} from './manifest';
export { dropVariant, promoteVariant } from './promote';
export { syncVariant, type SyncBlocker } from './sync';
export { hasGit, NO_GIT_SYNC } from './git';
export { activeConflict, crossGroupOverlaps, overrideSourcePath, readActive, resolveOverride, writeActive } from './active';
export { knobProblem, readKnobs } from './knobs';
export { variantsResponse } from './handler';
