/**
 * isotone/core — the framework-agnostic contract.
 *
 * The note record the CLI prints and the panel posts, and the variant axes a
 * host's own variant system hands the panel. No React, no Vite, no Node.
 *
 * This file only re-exports, and each name here is supported API:
 * tests/package/exports.test.ts lists them, so adding one is a deliberate act.
 */
export type { IsotoneElement, IsotoneNote, NoteContext, NoteReply, VariantReference, VariantRemoval } from './types';
export type { RouteGateOptions } from './routes';
export { combineVariantsSources, createVariantsSource } from './variants';
export type {
  ColorSwatch,
  ColorVariantAxis,
  RangeVariantAxis,
  SelectVariantAxis,
  VariantAction,
  VariantAxis,
  VariantAxisCondition,
  VariantOption,
  VariantSelections,
  VariantsSource,
} from './variants';
