/**
 * isotone — core.
 *
 * The framework-agnostic half of the internal feedback loop. Holds the note
 * model, the element descriptor, the dev-store client (file-backed via a Vite
 * plugin, `localStorage` fallback), the route visibility matcher and the
 * variant sources. This module has no React and no Vite dependency and is
 * fully unit-testable in a `node` env.
 *
 * This file only re-exports: each name below is part of `isotone/core`.
 */
export type { IterationElement, IterationNote, NoteContext, NoteReply, VariantReference, VariantRemoval } from './types';
export { describeIterationElement, elementAsNode, type NodeLike } from './element';
export { isRouteVisible, type RouteGateOptions } from './routes';
export { createIterationStore, type IterationStoreConfig, type SaveLocation } from './notes-client';
export type { UpdateInfo, UpdateRequest } from './update';
export {
  applyKnobValues,
  axisDefault,
  axisSection,
  createOverlayVariantsSource,
  createVariantsSource,
  defaultSelections,
  formatRangeValue,
  isAxisVisible,
  isDirty,
  isValidSelection,
  KNOBS_EVENT,
  KNOBS_STORAGE_KEY,
  knobCssValue,
  knobDelta,
  knobsFor,
  knobVar,
  OVERLAY_DEFAULT_OPTION,
  OVERLAY_GROUP_ID,
  overlayAxes,
  overlayGroups,
  parseVariantParam,
  SECTION_SEPARATOR,
  sectionAxes,
  serializeVariantParam,
  splitSectionLabel,
  VARIANTS_ENDPOINT,
  variantAppliesTo,
  visibleAxes,
} from './variants';
export type {
  ColorSwatch,
  ColorVariantAxis,
  KnobAxis,
  LiveVariantSelection,
  OverlayGroup,
  OverlayVariant,
  OverlayVariantStatus,
  OverlayVariantsList,
  RangeVariantAxis,
  SectionedLabel,
  SelectVariantAxis,
  VariantAction,
  VariantAxis,
  VariantAxisCondition,
  VariantOption,
  VariantSection,
  VariantSelections,
  VariantsSource,
} from './variants';
