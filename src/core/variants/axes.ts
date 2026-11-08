/** Variant axes: the select, range and colour decisions a page exposes. */

export interface VariantOption {
  /** Stable short id, e.g. "a", "b". */
  id: string;
  /** Short label (1–2 words); it renders as a segment and truncates. */
  label: string;
  /** Optional preview image URL. When every option of an axis has one, the
   *  panel renders the axis as a thumbnail grid. */
  image?: string;
  /** Optional secondary text shown as a tooltip on the option. */
  hint?: string;
}

/** Show an axis only while another axis holds (`equals`) or does not hold
 *  (`not`) a value. Exactly one of the two should be set. */
export interface VariantAxisCondition {
  axis: string;
  equals?: string;
  not?: string;
}

export interface SelectVariantAxis {
  kind?: 'select';
  id: string;
  label: string;
  options: VariantOption[];
  /** The primary option; what a host renders when nothing is selected. */
  defaultOption: string;
  showWhen?: VariantAxisCondition;
  /**
   * The part of the page the selector belongs to, shown as a section header in
   * the panel. Usually written as a label prefix instead (`"Header > Logo size"`);
   * see {@link axisSection}. When set, it wins over the prefix, and `''` keeps the
   * selector out of every section with its label shown as written.
   */
  section?: string;
}

export interface RangeVariantAxis {
  kind: 'range';
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** How the panel prints the value ("px", "°", "em"). Omitted: a 0–1 axis
   *  prints as a percentage, anything else as the raw number. */
  unit?: string;
  showWhen?: VariantAxisCondition;
  section?: string;
}

export interface ColorSwatch {
  id: string;
  label: string;
  /** Hex, e.g. "#ea382e". */
  value: string;
}

export interface ColorVariantAxis {
  kind: 'color';
  id: string;
  label: string;
  /** Hex. */
  defaultColor: string;
  /** Quick-pick presets shown as swatches (include the default). */
  swatches: ColorSwatch[];
  showWhen?: VariantAxisCondition;
  section?: string;
}

export type VariantAxis = SelectVariantAxis | RangeVariantAxis | ColorVariantAxis;

/** Axis id → selected value. Ranges stringify their number. */
export type VariantSelections = Record<string, string>;

export interface VariantAction {
  axisId: string;
  action: 'remove-option' | 'remove-axis' | 'keep-default' | 'keep-option';
  optionId?: string;
}
