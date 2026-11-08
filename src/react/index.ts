/**
 * isotone/react — the panel for an app that mounts it itself.
 *
 * `createVariantsSource` and its types come from isotone/core; they are here
 * too so a host's variant source and its mount share one import, as
 * docs/variants.md shows. Everything else of core stays in core.
 * tests/package/exports.test.ts lists every name.
 */
export { IsotonePanel, type IsotonePanelProps } from './IsotonePanel';
export { mountIsotone } from './IsotoneMount';
export type { IsotoneShortcut, IsotoneTheme, MountIsotoneOptions } from '../core/types';
export type { IsotoneStoreConfig } from '../core/notes-client';
export { createVariantsSource } from '../core/variants';
export type { VariantAxis, VariantSelections, VariantsSource } from '../core/variants';
