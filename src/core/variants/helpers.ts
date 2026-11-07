/** Pure helpers over axes and selections: defaults, validity, `?v=` params and visibility. */

import type { VariantAxisCondition, RangeVariantAxis, VariantAxis, VariantSelections } from './axes';

/** The selection a `keep-option` action makes permanent; colours keep the swatch value. */
export function keptValue(axis: VariantAxis, optionId: string | undefined): string {
  if (axis.kind === 'range') throw new Error('This selector has no options to keep.');
  const option = (axis.kind === 'color' ? axis.swatches : axis.options).find((o) => o.id === optionId);
  if (!option) throw new Error('This option is no longer available.');
  return 'value' in option ? option.value : option.id;
}

/** The primary value of an axis, as the selection string. */
export function axisDefault(axis: VariantAxis): string {
  if (axis.kind === 'range') return String(axis.defaultValue);
  if (axis.kind === 'color') return axis.defaultColor;
  return axis.defaultOption;
}

/** True when `value` is legal for the axis. */
export function isValidSelection(axis: VariantAxis, value: string): boolean {
  if (axis.kind === 'range') {
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) && n >= axis.min && n <= axis.max;
  }
  if (axis.kind === 'color') return /^#[0-9a-fA-F]{6}$/.test(value);
  return axis.options.some((o) => o.id === value);
}

export function defaultSelections(axes: VariantAxis[]): VariantSelections {
  return Object.fromEntries(axes.map((a) => [a.id, axisDefault(a)]));
}

/** `"headline:b,haze-speed:0.7"` → validated selections. Unknown axes and
 *  illegal values are dropped rather than failing the whole string. */
export function parseVariantParam(axes: VariantAxis[], raw: string): VariantSelections {
  const out = new Map<string, string>();
  const byId = new Map(axes.map((axis) => [axis.id, axis]));
  for (const pair of raw.split(',')) {
    const at = pair.indexOf(':');
    if (at < 0) continue;
    const axisId = pair.slice(0, at);
    const value = pair.slice(at + 1);
    const axis = byId.get(axisId);
    if (axis && isValidSelection(axis, value)) out.set(axisId, value);
  }
  return Object.fromEntries(out);
}

/** Non-default selections only, `""` when everything is at its default. */
export function serializeVariantParam(axes: VariantAxis[], selections: VariantSelections): string {
  return axes
    .filter((a) => selections[a.id] !== undefined && selections[a.id] !== axisDefault(a))
    .map((a) => `${a.id}:${selections[a.id]}`)
    .join(',');
}

/** Whether any axis differs from its default. */
export function isDirty(axes: VariantAxis[], selections: VariantSelections): boolean {
  return axes.some((a) => selections[a.id] !== undefined && selections[a.id] !== axisDefault(a));
}

/**
 * Whether an axis shows, given every axis and the current selections.
 * A hidden parent hides its children. Cycles are hidden, and long chains
 * are evaluated iteratively rather than consuming the call stack.
 */
export function isAxisVisible(axis: VariantAxis, axes: VariantAxis[], selections: VariantSelections, _depth = 0): boolean {
  return visibilityById(axes.includes(axis) ? axes : [...axes, axis], selections).get(axis.id) ?? false;
}

export function visibleAxes(axes: VariantAxis[], selections: VariantSelections): VariantAxis[] {
  const visibility = visibilityById(axes, selections);
  return axes.filter((axis) => visibility.get(axis.id));
}

function visibilityById(axes: VariantAxis[], selections: VariantSelections): Map<string, boolean> {
  const byId = new Map(axes.map((axis) => [axis.id, axis]));
  const visible = new Map<string, boolean>();
  for (const axis of axes) {
    const trail = new Set<string>();
    let current: VariantAxis | undefined = axis;
    let result = true;
    while (current) {
      const known = visible.get(current.id);
      if (known !== undefined) {
        result = known;
        break;
      }
      if (trail.has(current.id)) {
        result = false;
        break;
      }
      trail.add(current.id);
      const condition: VariantAxisCondition | undefined = current.showWhen;
      if (!condition) break;
      const parent = byId.get(condition.axis);
      const value = selections[condition.axis] ?? (parent ? axisDefault(parent) : undefined);
      if ((condition.equals !== undefined && value !== condition.equals) || (condition.not !== undefined && value === condition.not)) {
        result = false;
        break;
      }
      current = parent;
    }
    for (const id of trail) visible.set(id, result);
  }
  return visible;
}

/** How the panel prints a range value: its unit when declared, a percentage
 *  for a bare 0–1 axis, else the raw number. */
export function formatRangeValue(axis: RangeVariantAxis, value: string): string {
  if (axis.unit !== undefined) return `${value}${axis.unit}`;
  if (axis.min === 0 && axis.max === 1) return `${Math.round(Number(value) * 100)}%`;
  return value;
}
