/**
 * isotone — variants: the framework-free model.
 *
 * A variant axis is one tunable decision about a page: a discrete choice
 * (select), a continuous value (range) or a colour. The panel renders axes;
 * where their state lives is the host's business. Two hosts ship today:
 *
 * - A host with its own variant system (its own axes and
 *   `useVariant` hooks) hands the panel a {@link VariantsSource} over that
 *   state. The panel is then a view; the host still owns `?v=` sync,
 *   defaults and promotion.
 * - A host with no variant system gets the overlay adapter: alternative
 *   source files under `.isotone/variants/<id>/…` that the Vite plugin
 *   swaps in for the real ones while a variant is active. The browser sees
 *   one select axis per group of alternatives, on the route they belong to
 *   ({@link overlayGroups}, {@link createOverlayVariantsSource}).
 *
 * Everything in this module is pure or DOM-free and runs in a `node` test.
 */
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
} from './axes';
export { axisSection, sectionAxes, splitSectionLabel } from './sections';
export type { SectionedLabel, VariantSection } from './sections';
export {
  axisDefault,
  formatRangeValue,
  isDirty,
  parseVariantParam,
  serializeVariantParam,
  visibleAxes,
} from './helpers';
export { createVariantsSource } from './source';
export type { VariantsSource } from './source';
export {
  KNOBS_STORAGE_KEY,
  OVERLAY_DEFAULT_OPTION,
  VARIANTS_ENDPOINT,
  applyKnobValues,
  createOverlayVariantsSource,
  knobCssValue,
  knobDelta,
  knobVar,
  knobsFor,
  overlayAxes,
  overlayGroups,
  variantAppliesTo,
} from './overlay';
export type { KnobAxis, OverlayVariant, OverlayVariantStatus, OverlayVariantsList } from './overlay';
