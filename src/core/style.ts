/**
 * isotone — style edits (experimental).
 *
 * The framework-free half of visual style editing: which properties the
 * inspector offers, how computed values are normalized, compared and grouped
 * across several elements, and how the result is described to a coding agent.
 * Nothing here touches the DOM at import time, so the server and the CLI can
 * validate and print style edits too. Reading rules from a live document lives
 * in `style-source.ts`.
 */

/** One CSS property change the reviewer previewed, recorded for the agent. */
export interface StyleChange {
  /** CSS property in kebab case, e.g. `padding-top`. */
  property: string;
  /** The computed value before the edit. Colours are hex when they are sRGB. */
  from: string;
  /** The value the reviewer chose, as they entered it. */
  to: string;
  /** The value written in the rule that set it, e.g. `var(--card-padding)`. */
  declared?: string;
  /** Selector of that rule, `style attribute` for inline styles. Ends in
   *  `(inherited)` when an ancestor sets an inherited property. */
  rule?: string;
  /** Custom properties the declared value reads, with their current values. */
  tokens?: Record<string, string>;
  /** Custom properties whose value already equals `to`. */
  matches?: string[];
}

/** The style changes for one pinned element. `selector` matches an entry in
 *  the note's `elements`, which carries the full element descriptor. */
export interface StyleEdit {
  selector: string;
  /** The element's class list when it was edited. */
  classes?: string[];
  changes: StyleChange[];
}

export type StyleSection = 'layout' | 'spacing' | 'size' | 'typography' | 'fill';
export type StyleKind = 'length' | 'number' | 'color' | 'keyword' | 'text';

export interface StyleProperty {
  name: string;
  section: StyleSection;
  kind: StyleKind;
  /** Short field label. */
  label: string;
  step?: number;
  min?: number;
  max?: number;
  /** Bare numbers stay unitless (line-height, opacity, font-weight). */
  unitless?: boolean;
  options?: readonly string[];
  /** Inherited by default, so an ancestor's rule may set it. */
  inherited?: boolean;
  /** Other property names whose declarations also set this one. */
  shorthands?: readonly string[];
  /** Longhands that make a rule a candidate for this property. */
  longhands?: readonly string[];
}

const sides = (prefix: string, suffix = '') =>
  ['top', 'right', 'bottom', 'left'].map((side) => `${prefix}-${side}${suffix}`);
const corners = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((corner) => `border-${corner}-radius`);

/** The inspector's properties, in display order. */
export const STYLE_PROPERTIES: readonly StyleProperty[] = [
  { name: 'display', section: 'layout', kind: 'keyword', label: 'Display',
    options: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents', 'none'] },
  { name: 'flex-direction', section: 'layout', kind: 'keyword', label: 'Direction',
    options: ['row', 'column', 'row-reverse', 'column-reverse'], shorthands: ['flex-flow'] },
  { name: 'flex-wrap', section: 'layout', kind: 'keyword', label: 'Wrap',
    options: ['nowrap', 'wrap', 'wrap-reverse'], shorthands: ['flex-flow'] },
  { name: 'grid-template-columns', section: 'layout', kind: 'text', label: 'Columns', shorthands: ['grid-template', 'grid'] },
  { name: 'align-items', section: 'layout', kind: 'keyword', label: 'Align',
    options: ['normal', 'stretch', 'flex-start', 'start', 'center', 'end', 'flex-end', 'baseline'], shorthands: ['place-items'] },
  { name: 'justify-content', section: 'layout', kind: 'keyword', label: 'Justify',
    options: ['normal', 'flex-start', 'start', 'center', 'end', 'flex-end', 'space-between', 'space-around', 'space-evenly', 'stretch'], shorthands: ['place-content'] },
  { name: 'gap', section: 'layout', kind: 'length', label: 'Gap', step: 1, min: 0, longhands: ['row-gap', 'column-gap'] },
  ...sides('margin').map((name): StyleProperty => ({ name, section: 'spacing', kind: 'length', label: name.slice(7, 8).toUpperCase(), step: 1, shorthands: ['margin'] })),
  ...sides('padding').map((name): StyleProperty => ({ name, section: 'spacing', kind: 'length', label: name.slice(8, 9).toUpperCase(), step: 1, min: 0, shorthands: ['padding'] })),
  { name: 'width', section: 'size', kind: 'length', label: 'W', step: 1, min: 0 },
  { name: 'height', section: 'size', kind: 'length', label: 'H', step: 1, min: 0 },
  { name: 'font-size', section: 'typography', kind: 'length', label: 'Size', step: 1, min: 0, inherited: true, shorthands: ['font'] },
  { name: 'font-weight', section: 'typography', kind: 'keyword', label: 'Weight', inherited: true, unitless: true,
    options: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], shorthands: ['font'] },
  { name: 'line-height', section: 'typography', kind: 'length', label: 'Line', step: 1, min: 0, inherited: true, unitless: true, shorthands: ['font'] },
  { name: 'letter-spacing', section: 'typography', kind: 'length', label: 'Letter', step: 0.1, inherited: true },
  { name: 'color', section: 'typography', kind: 'color', label: 'Colour', inherited: true },
  { name: 'text-align', section: 'typography', kind: 'keyword', label: 'Align', inherited: true,
    options: ['start', 'left', 'center', 'right', 'end', 'justify'] },
  { name: 'background-color', section: 'fill', kind: 'color', label: 'Fill', shorthands: ['background'] },
  { name: 'border-width', section: 'fill', kind: 'length', label: 'Border', step: 1, min: 0,
    shorthands: ['border'], longhands: sides('border', '-width') },
  { name: 'border-style', section: 'fill', kind: 'keyword', label: 'Style',
    options: ['none', 'solid', 'dashed', 'dotted', 'double'], shorthands: ['border'], longhands: sides('border', '-style') },
  { name: 'border-color', section: 'fill', kind: 'color', label: 'Stroke', shorthands: ['border'], longhands: sides('border', '-color') },
  { name: 'border-radius', section: 'fill', kind: 'length', label: 'Radius', step: 1, min: 0, longhands: corners },
  { name: 'box-shadow', section: 'fill', kind: 'text', label: 'Shadow' },
  { name: 'opacity', section: 'fill', kind: 'number', label: 'Opacity', step: 0.01, min: 0, max: 1, unitless: true },
];

export const STYLE_PROPERTY = new Map(STYLE_PROPERTIES.map((property) => [property.name, property]));

export const STYLE_SECTIONS: readonly { id: StyleSection; label: string }[] = [
  { id: 'layout', label: 'Layout' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'size', label: 'Size' },
  { id: 'typography', label: 'Typography' },
  { id: 'fill', label: 'Fill and border' },
];

/** Property name to value, for the catalogue above. */
export type StyleValues = Record<string, string>;

/** Anything with `getPropertyValue`: a `CSSStyleDeclaration` or a test fake. */
export interface StyleReader {
  getPropertyValue(name: string): string;
}

/**
 * The catalogue's values from a computed style. Colours in `rgb()` notation
 * become hex, which is shorter to read and what most source code uses; other
 * colour spaces (`oklch()`, `color()`) are kept as the browser wrote them.
 */
export function readStyleValues(style: StyleReader, properties: readonly StyleProperty[] = STYLE_PROPERTIES): StyleValues {
  const values: StyleValues = {};
  for (const property of properties) {
    let value = style.getPropertyValue(property.name).trim();
    // Shorthands that a browser does not serialize (`gap` in older engines,
    // `border-width` with unequal sides) fall back to their first longhand.
    if (!value && property.longhands) value = style.getPropertyValue(property.longhands[0]).trim();
    values[property.name] = property.kind === 'color' ? normalizeColor(value)
      // Layout lands on fractions of a pixel. A tenth is precise enough to read
      // and keeps 314.656px and 314.672px from showing as Mixed.
      : property.kind === 'length' ? value.replace(/(-?\d*\.\d+)px/g, (_, n: string) => `${formatNumber(Math.round(Number.parseFloat(n) * 10) / 10)}px`)
        : value;
  }
  return values;
}

/** `rgb(…)`/`rgba(…)` → `#rrggbb` or `#rrggbbaa`; `transparent` for zero alpha. */
export function normalizeColor(value: string): string {
  const rgba = parseRgb(value);
  if (!rgba) return value.trim();
  const [r, g, b, a] = rgba;
  if (a === 0) return 'transparent';
  const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(a * 255) : ''}`;
}

/** `[r, g, b, a]` from `rgb()`, `rgba()` or hex, else null. */
export function parseRgb(value: string): [number, number, number, number] | null {
  const text = value.trim().toLowerCase();
  if (text === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text);
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    const n = (i: number) => Number.parseInt(digits.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), digits.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(text);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (part: string) => (part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part));
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
  const out: [number, number, number, number] = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
  return out.every(Number.isFinite) ? out : null;
}

/** A single number and unit, e.g. `18px`, `1.5`, `-0.02em`. Null for anything else. */
export function parseLength(value: string): { n: number; unit: string } | null {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(value.trim());
  if (!match) return null;
  return { n: Number.parseFloat(match[1]), unit: match[2].toLowerCase() };
}

/** Format a stepped number without float noise: 0.30000000000000004 → 0.3. */
export function formatNumber(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** What the reviewer typed, completed: a bare number in a length field means pixels. */
export function normalizeInput(value: string, property: StyleProperty): string {
  const text = value.trim();
  const length = parseLength(text);
  if (length && length.unit === '' && property.kind === 'length' && !property.unitless) return `${formatNumber(length.n)}px`;
  return text;
}

/**
 * `value` moved by `delta` in its own unit, clamped to the property's range.
 * Null when the value is not a single number (`auto`, `calc()`, a list).
 * `normal` letter spacing counts as zero.
 */
export function nudgeValue(value: string, delta: number, property: StyleProperty): string | null {
  const text = value.trim();
  const length = parseLength(text) ?? (property.name === 'letter-spacing' && text === 'normal' ? { n: 0, unit: 'px' } : null);
  if (!length) return null;
  let n = length.n + delta;
  if (property.min !== undefined) n = Math.max(property.min, n);
  if (property.max !== undefined) n = Math.min(property.max, n);
  const unit = length.unit || (property.kind === 'length' && !property.unitless ? 'px' : '');
  return `${formatNumber(n)}${unit}`;
}

/**
 * The value a field shows across several elements, and the distinct values
 * behind a Mixed field so the reviewer can narrow the edit to one of them.
 */
export interface MixedValue {
  /** The shared value, or null when the elements differ. */
  value: string | null;
  mixed: boolean;
  /** Each distinct value with the indices of the elements that have it, most common first. */
  options: { value: string; indices: number[] }[];
}

export function mixedValue(values: readonly string[]): MixedValue {
  const byValue = new Map<string, number[]>();
  values.forEach((value, index) => {
    const list = byValue.get(value);
    if (list) list.push(index);
    else byValue.set(value, [index]);
  });
  const options = [...byValue].map(([value, indices]) => ({ value, indices }))
    .sort((a, b) => b.indices.length - a.indices.length || a.indices[0] - b.indices[0]);
  const mixed = options.length > 1;
  return { value: mixed ? null : (options[0]?.value ?? null), mixed, options };
}

/** A stable key over the catalogue's values: equal keys mean an identical style. */
export function styleSignature(values: StyleValues, properties: readonly StyleProperty[] = STYLE_PROPERTIES): string {
  return properties.map((property) => `${property.name}:${values[property.name] ?? ''}`).join(';');
}

export interface StyleGroup {
  key: string;
  /** Indices into the input, in input order. */
  indices: number[];
  /** What sets this group apart from the others, e.g. `padding-top 24px`. Empty with one group. */
  label: string;
}

/**
 * Group elements whose styles are identical, largest group first. Each label
 * names the first property (in catalogue order) whose value tells the groups
 * apart, so "padding-top 18px ×2" and "padding-top 24px ×1" read side by side.
 */
export function groupBySignature(items: readonly StyleValues[], properties: readonly StyleProperty[] = STYLE_PROPERTIES): StyleGroup[] {
  const groups = new Map<string, number[]>();
  items.forEach((values, index) => {
    const key = styleSignature(values, properties);
    const list = groups.get(key);
    if (list) list.push(index);
    else groups.set(key, [index]);
  });
  const result = [...groups].map(([key, indices]) => ({ key, indices, label: '' }))
    .sort((a, b) => b.indices.length - a.indices.length || a.indices[0] - b.indices[0]);
  if (result.length < 2) return result;
  const differing = properties.filter((property) =>
    new Set(result.map((group) => items[group.indices[0]][property.name])).size > 1);
  for (const group of result) {
    const first = items[group.indices[0]];
    // Add differing properties, most telling first, until no other group
    // shares the whole label.
    const chosen: StyleProperty[] = [];
    let rivals = result.filter((other) => other !== group);
    const rank = (property: StyleProperty) => rivals.filter((other) => items[other.indices[0]][property.name] === first[property.name]).length;
    while (rivals.length && chosen.length < 3) {
      const next = differing.filter((property) => !chosen.includes(property)).sort((a, b) => rank(a) - rank(b))[0];
      if (!next) break;
      chosen.push(next);
      rivals = rivals.filter((other) => items[other.indices[0]][next.name] === first[next.name]);
    }
    chosen.sort((a, b) => properties.indexOf(a) - properties.indexOf(b));
    group.label = chosen.map((property) => `${property.name} ${first[property.name] || 'none'}`).join(', ');
  }
  return result;
}

/** Changes from `before` to the edited values, in catalogue order. Unchanged values are left out. */
export function diffStyleValues(before: StyleValues, edited: Partial<StyleValues>): StyleChange[] {
  const order = (name: string) => {
    const index = STYLE_PROPERTIES.findIndex((property) => property.name === name);
    return index === -1 ? STYLE_PROPERTIES.length : index;
  };
  return Object.entries(edited)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
    .filter(([property, to]) => !sameValue(before[property] ?? '', to, property))
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([property, to]) => ({ property, from: before[property] ?? '', to: to.trim() }));
}

/** Whether two values are the same for a property, ignoring case, spacing and hex/rgb notation. */
export function sameValue(a: string, b: string, property?: string): boolean {
  const kind = property ? STYLE_PROPERTY.get(property)?.kind : undefined;
  const clean = (v: string) => (kind === 'color' ? normalizeColor(v) : v).trim().toLowerCase().replace(/\s+/g, ' ');
  if (clean(a) === clean(b)) return true;
  // `18` and `18px` mean the same for a length field.
  const x = parseLength(a);
  const y = parseLength(b);
  if (kind === 'length' && x && y && x.n === y.n && (x.unit || 'px') === (y.unit || 'px')) return true;
  return false;
}

/** Edits that share one change set read as one line with several elements. */
export function groupStyleEdits(edits: readonly StyleEdit[]): { selectors: string[]; changes: StyleChange[] }[] {
  const groups = new Map<string, { selectors: string[]; changes: StyleChange[] }>();
  for (const edit of edits) {
    const key = edit.changes.map((change) => `${change.property}:${change.from}>${change.to}`).join(';');
    const group = groups.get(key);
    if (group) group.selectors.push(edit.selector);
    else groups.set(key, { selectors: [edit.selector], changes: edit.changes });
  }
  return [...groups.values()];
}

/** `padding-top 18px → 24px`. */
export function describeChange(change: StyleChange): string {
  return `${change.property} ${change.from || '(unset)'} → ${change.to}`;
}

/**
 * One readable sentence for a note that only carries style edits, e.g.
 * `Style: padding-top 18px → 24px, color #111 → #333 (3 elements)`.
 */
export function summarizeStyleEdits(edits: readonly StyleEdit[], max = 280): string {
  const groups = groupStyleEdits(edits.filter((edit) => edit.changes.length));
  if (!groups.length) return '';
  const parts = groups.map((group) => {
    const changes = group.changes.map(describeChange).join(', ');
    return group.selectors.length > 1 ? `${changes} (${group.selectors.length} elements)` : changes;
  });
  const text = `Style: ${parts.join('; ')}`;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Lines for the CLI's text output, indented under the element they apply to. */
export function describeStyleEdit(edit: StyleEdit, indent = '    '): string[] {
  const lines: string[] = [];
  if (edit.classes?.length) lines.push(`${indent}classes: ${edit.classes.join(' ')}`);
  for (const change of edit.changes) {
    const context = [
      change.rule ? `rule ${change.rule}` : '',
      change.declared && change.declared !== change.from ? `declared ${change.declared}` : '',
      change.tokens && Object.keys(change.tokens).length
        ? Object.entries(change.tokens).map(([name, value]) => `${name}: ${value || '(unset)'}`).join(', ')
        : '',
      change.matches?.length ? `to equals ${change.matches.join(', ')}` : '',
    ].filter(Boolean).join('; ');
    lines.push(`${indent}style: ${describeChange(change)}${context ? `  (${context})` : ''}`);
  }
  return lines;
}

/* ---------------------------------------------------------------------------
 * Validation at the store boundary. Malformed edits and changes are dropped;
 * every string is bounded, like the element descriptor's fields.
 * ------------------------------------------------------------------------- */

export const MAX_STYLE_EDITS = 50;
const MAX_CHANGES = 60;
const PROPERTY_NAME = /^-{0,2}[a-z][a-z0-9-]*$/;
const TOKEN_NAME = /^--[A-Za-z0-9_-]+$/;
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

const text = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : undefined;

function changeOf(value: unknown): StyleChange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.property !== 'string' || v.property.length > 60 || !PROPERTY_NAME.test(v.property)) return null;
  const to = text(v.to, 300);
  if (to === undefined) return null;
  const change: StyleChange = { property: v.property, from: typeof v.from === 'string' ? v.from.slice(0, 300) : '', to };
  const declared = text(v.declared, 300);
  if (declared) change.declared = declared;
  const rule = text(v.rule, 300);
  if (rule) change.rule = rule;
  if (v.tokens && typeof v.tokens === 'object' && !Array.isArray(v.tokens)) {
    const tokens = Object.entries(v.tokens)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && TOKEN_NAME.test(entry[0]) && entry[0].length <= 100 && !UNSAFE.has(entry[0]))
      .slice(0, 12)
      .map(([name, value]): [string, string] => [name, value.slice(0, 200)]);
    if (tokens.length) change.tokens = Object.fromEntries(tokens);
  }
  if (Array.isArray(v.matches)) {
    const matches = v.matches.filter((name): name is string => typeof name === 'string' && TOKEN_NAME.test(name) && name.length <= 100).slice(0, 8);
    if (matches.length) change.matches = matches;
  }
  return change;
}

/**
 * Clean `styleEdits` from an untrusted note body. Undefined when absent,
 * null when it is not an array or holds too many edits.
 */
export function styleEditsOf(value: unknown, maxSelector = 2000): StyleEdit[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_STYLE_EDITS) return null;
  const edits: StyleEdit[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const v = item as Record<string, unknown>;
    if (typeof v.selector !== 'string' || !v.selector) continue;
    if (!Array.isArray(v.changes)) continue;
    const changes = v.changes.slice(0, MAX_CHANGES).map(changeOf).filter((change): change is StyleChange => change !== null);
    if (!changes.length) continue;
    const edit: StyleEdit = { selector: v.selector.slice(0, maxSelector), changes };
    if (Array.isArray(v.classes)) {
      const classes = v.classes.filter((name): name is string => typeof name === 'string' && name !== '').slice(0, 40).map((name) => name.slice(0, 120));
      if (classes.length) edit.classes = classes;
    }
    edits.push(edit);
  }
  return edits;
}
