/**
 * The style editor's controls: the handful of properties a reviewer nudges
 * when something is "too tight" or "too small". Each field is one CSS
 * property, so a change previews and reads back as one declaration.
 */

type FieldKind = 'px' | 'number' | 'percent' | 'color';

export interface AdjustField {
  /** The CSS property previewed and recorded. Logical shorthands keep a pair of sides as one change. */
  property: string;
  label: string;
  group: 'Spacing' | 'Type' | 'Box';
  kind: FieldKind;
  /** The computed longhands the starting value is read from. */
  read: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  /** Shown only where it applies: a gap needs a flex or grid box, type needs text. */
  when?: 'gap' | 'text';
}

export const ADJUST_FIELDS: readonly AdjustField[] = [
  { property: 'padding-block', label: 'Pad ↕', group: 'Spacing', kind: 'px', read: ['padding-top', 'padding-bottom'], min: 0 },
  { property: 'padding-inline', label: 'Pad ↔', group: 'Spacing', kind: 'px', read: ['padding-left', 'padding-right'], min: 0 },
  { property: 'gap', label: 'Gap', group: 'Spacing', kind: 'px', read: ['row-gap', 'column-gap'], min: 0, when: 'gap' },
  { property: 'margin-block', label: 'Margin ↕', group: 'Spacing', kind: 'px', read: ['margin-top', 'margin-bottom'] },
  { property: 'margin-inline', label: 'Margin ↔', group: 'Spacing', kind: 'px', read: ['margin-left', 'margin-right'] },
  { property: 'font-size', label: 'Size', group: 'Type', kind: 'px', read: ['font-size'], min: 1, when: 'text' },
  {
    property: 'font-weight',
    label: 'Weight',
    group: 'Type',
    kind: 'number',
    read: ['font-weight'],
    min: 100,
    max: 900,
    step: 100,
    when: 'text',
  },
  { property: 'line-height', label: 'Line', group: 'Type', kind: 'px', read: ['line-height'], min: 0, when: 'text' },
  { property: 'color', label: 'Colour', group: 'Type', kind: 'color', read: ['color'], when: 'text' },
  { property: 'background-color', label: 'Fill', group: 'Box', kind: 'color', read: ['background-color'] },
  {
    property: 'border-radius',
    label: 'Radius',
    group: 'Box',
    kind: 'px',
    read: ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
    min: 0,
  },
  { property: 'opacity', label: 'Opacity', group: 'Box', kind: 'percent', read: ['opacity'], min: 0, max: 100 },
];

export const ADJUST_GROUPS = ['Spacing', 'Type', 'Box'] as const;

const round = (n: number) => Math.round(n * 100) / 100;

/** A computed value as the number a field shows, or null when it is not one (`normal`, `auto`, a mix of sides). */
export function fieldNumber(field: AdjustField, css: string): number | null {
  const parts = css.trim().split(/\s+/);
  if (parts.length !== 1) return null;
  const n = Number.parseFloat(parts[0] ?? '');
  if (!Number.isFinite(n)) return null;
  return round(field.kind === 'percent' ? n * 100 : n);
}

/** The number a field holds as the CSS value it previews and records. */
export function fieldCss(field: AdjustField, value: number): string {
  const bounded = Math.min(field.max ?? Number.POSITIVE_INFINITY, Math.max(field.min ?? Number.NEGATIVE_INFINITY, value));
  if (field.kind === 'percent') return String(round(bounded / 100));
  return field.kind === 'px' ? `${round(bounded)}px` : String(round(bounded));
}

/** Sides that agree as one value, else each in order: `16px` or `16px 8px`. */
export function joinSides(values: readonly string[]): string {
  return values.every((value) => value === values[0]) ? (values[0] ?? '') : values.join(' ');
}
