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

import type { IterationElement } from './index';
import { request } from './request';
import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from './browser-storage';

/* ── Axes ─────────────────────────────────────────────────────────────── */

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
  /** Panel grouping: a hairline separates consecutive different sections. */
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
  action: 'remove-option' | 'remove-axis' | 'keep-default';
  optionId?: string;
}

/* ── Pure helpers ─────────────────────────────────────────────────────── */

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
export function serializeVariantParam(
  axes: VariantAxis[],
  selections: VariantSelections,
): string {
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
export function isAxisVisible(
  axis: VariantAxis,
  axes: VariantAxis[],
  selections: VariantSelections,
  _depth = 0,
): boolean {
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
      if (known !== undefined) { result = known; break; }
      if (trail.has(current.id)) { result = false; break; }
      trail.add(current.id);
      const condition: VariantAxisCondition | undefined = current.showWhen;
      if (!condition) break;
      const parent = byId.get(condition.axis);
      const value = selections[condition.axis] ?? (parent ? axisDefault(parent) : undefined);
      if ((condition.equals !== undefined && value !== condition.equals) ||
        (condition.not !== undefined && value === condition.not)) { result = false; break; }
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

/* ── The source contract ──────────────────────────────────────────────── */

/**
 * What the panel renders variants from. The host owns the state; the panel
 * reads it through these calls and re-renders on `subscribe` notifications.
 * Every method must be safe to call at any time after mount, including
 * before the host has any axes (return `[]`).
 */
export interface VariantsSource {
  /** The axes for the current page. May change over time (route change). */
  getAxes(): VariantAxis[];
  /** The current selections. Missing keys mean "at default". */
  getSelections(): VariantSelections;
  setSelection(axisId: string, value: string): void;
  /** Return every axis to its default. */
  reset(): void;
  /** Notify on any change to axes or selections. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** A recoverable transport error; notify subscribers when it changes. */
  getError?: () => string | null;
  /**
   * When present, the panel shows "Save as defaults" and calls this with the
   * current selections. A host that promotes by editing source (one that
   * files a `[set-defaults]` note for the agent) implements it; a host
   * whose variants are whole alternatives (the overlay adapter) leaves it
   * out and promotes from the CLI instead.
   */
  saveDefaults?: (selections: VariantSelections) => Promise<void> | void;
  /** Panel heading; defaults to "Variants". */
  title?: string;
  /** Optional durable host mutation. Reject to leave the UI unchanged. */
  manage?: (action: VariantAction) => Promise<void> | void;
}

/**
 * A `VariantsSource` over plain state, for hosts that just want to hand the
 * panel an axes array and be told when a selection changes. Handles
 * subscriptions, validation and defaults. `onChange` fires after every
 * selection or reset with the full selections.
 */
export function createVariantsSource(init: {
  axes: VariantAxis[];
  selections?: VariantSelections;
  onChange?: (selections: VariantSelections) => void;
  saveDefaults?: VariantsSource['saveDefaults'];
  title?: string;
  /** Persist edited definitions in a host's own storage, before notifying. */
  onManage?: (axes: VariantAxis[], selections: VariantSelections, action: VariantAction) => Promise<void> | void;
}): VariantsSource & {
  /** Replace the axes (route change); selections not valid for the new set
   *  are dropped. */
  setAxes(axes: VariantAxis[]): void;
  /** Replace the selections wholesale (URL hydration). */
  setSelections(selections: VariantSelections): void;
} {
  let axes = init.axes;
  let selections = defaultSelections(axes);
  for (const axis of axes) {
    const value = init.selections?.[axis.id];
    if (value !== undefined && isValidSelection(axis, value)) selections[axis.id] = value;
  }
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const changed = () => {
    init.onChange?.({ ...selections });
    emit();
  };
  return {
    title: init.title,
    saveDefaults: init.saveDefaults,
    getAxes: () => axes,
    getSelections: () => selections,
    async manage(action) {
      const axis = axes.find((a) => a.id === action.axisId);
      if (!axis) throw new Error('This selector is no longer available.');
      let next = [...axes];
      const picks = { ...selections };
      if (action.action === 'remove-option') {
        if (axis.kind === 'range') throw new Error('This selector has no removable options.');
        if (axis.kind === 'color') {
          const swatch = axis.swatches.find(s => s.id === action.optionId);
          if (!swatch || swatch.value.toLowerCase() === axis.defaultColor.toLowerCase()) throw new Error('Keep the default colour, or remove the whole selector.');
          const swatches = axis.swatches.filter(s => s.id !== action.optionId);
          if (picks[axis.id]?.toLowerCase() === swatch.value.toLowerCase()) picks[axis.id] = axis.defaultColor;
          next = next.map(a => a.id === axis.id ? { ...axis, swatches } : a);
        } else {
          if (action.optionId === axis.defaultOption) throw new Error('Keep the default option, or remove the whole selector.');
          if (!axis.options.some((o) => o.id === action.optionId)) throw new Error('This option is no longer available.');
          const options = axis.options.filter((o) => o.id !== action.optionId);
          if (picks[axis.id] === action.optionId) picks[axis.id] = axis.defaultOption;
          next = next.map((a) => a.id === axis.id ? { ...axis, options } : a);
          if (options.length === 1) next = next.filter((a) => a.id !== axis.id);
        }
      } else {
        next = next.filter((a) => a.id !== axis.id);
        if (action.action === 'keep-default') picks[axis.id] = axisDefault(axis);
        else delete picks[axis.id];
      }
      // A dependent control cannot outlive the decision that reveals it.
      const kept = new Set(next.map((a) => a.id));
      const removed = new Set(axes.filter((a) => !kept.has(a.id)).map((a) => a.id));
      const children = new Map<string, string[]>();
      for (const a of next) {
        if (!a.showWhen) continue;
        const dependents = children.get(a.showWhen.axis) ?? [];
        dependents.push(a.id);
        children.set(a.showWhen.axis, dependents);
      }
      // Set iteration includes newly added descendants and terminates on cycles.
      for (const id of removed) for (const child of children.get(id) ?? []) removed.add(child);
      next = next.filter((a) => !removed.has(a.id));
      for (const id of removed) if (id !== axis.id) delete picks[id];
      await init.onManage?.(next, picks, action);
      axes = next;
      selections = picks;
      changed();
    },
    setSelection(axisId, value) {
      const axis = axes.find((a) => a.id === axisId);
      if (!axis || !isValidSelection(axis, value)) return;
      if (selections[axisId] === value) return;
      selections = { ...selections, [axisId]: value };
      changed();
    },
    reset() {
      selections = defaultSelections(axes);
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setAxes(next) {
      axes = next;
      const kept: VariantSelections = defaultSelections(next);
      for (const a of next) {
        const v = selections[a.id];
        if (v !== undefined && isValidSelection(a, v)) kept[a.id] = v;
      }
      selections = kept;
      emit();
    },
    setSelections(next) {
      selections = { ...defaultSelections(axes) };
      for (const a of axes) {
        const v = next[a.id];
        if (v !== undefined && isValidSelection(a, v)) selections[a.id] = v;
      }
      changed();
    },
  };
}

/* ── The overlay adapter's wire shape ─────────────────────────────── */

/**
 * One overlay variant: a directory of alternative source files that the dev
 * server swaps in for the real ones while the variant is active. Stored as
 * `variant.json` in `.isotone/variants/<id>/`, with the files mirrored
 * under it at their repo-relative paths.
 */
export interface OverlayVariant {
  /** Directory name. Lowercase, `a-z0-9-` only. */
  id: string;
  /** Panel label. Defaults to the id. */
  label: string;
  /** The route the variant belongs to; `""` (or absent) shows on every route.
   *  Only a scope string, like a note's route. */
  route?: string;
  /** The element the variant was asked about — the handle, not a boundary;
   *  the changed files may affect more than this element. */
  element?: IterationElement | null;
  /** The note id the variant answers, when it came from one. */
  note?: string;
  /** What the variant tries, in a sentence. */
  description?: string;
  /**
   * The decision this variant is one answer to. Variants in the same group
   * are alternatives of one element and share a selector in the panel;
   * activating one deactivates its siblings. Same shape as an id. Absent,
   * the group is inferred from file overlap (see {@link overlayGroups}).
   */
  group?: string;
  /** What the panel calls the group's selector. Any member may carry it. */
  groupLabel?: string;
  createdAt: string;
  /**
   * Repo-relative source path → what the override was derived from. `base`
   * is the git blob id of the real file when the override was made (`null`
   * when the file was not hashable), so a later change to the real file can
   * be detected and three-way merged into the override.
   */
  files: Record<string, { base: string | null }>;
}

/** An overlay variant as the endpoint lists it: the manifest plus what the
 *  server computed about it. */
export interface OverlayVariantStatus extends OverlayVariant {
  /** Files whose real source has changed since the override was made. */
  stale: string[];
  /** Files the manifest names but the variant directory no longer holds. */
  missing: string[];
}

/**
 * A knob: a range or colour axis the host declares in `.isotone/knobs.json`
 * next to its overlay variants. The panel renders it as a slider (or a colour
 * pick) on the routes it names, and the value reaches the page as a CSS
 * custom property on `<html>`, `--knob-<id>`, with the axis unit appended
 * (`--knob-fade-from: 40%`). The host reads it with a fallback that is the
 * committed default: `var(--knob-fade-from, 0%)`. "Save as defaults" files
 * the moved knobs in the same `[set-defaults]` note as the variant picks, so
 * the agent writes the numbers into the source and the knob file.
 */
export type KnobAxis = (RangeVariantAxis | ColorVariantAxis) & {
  /** Route pattern(s) the knob belongs on, like a variant's `route`; absent means every route. */
  route?: string | string[];
};

/** `GET` body of the variants endpoint. */
export interface OverlayVariantsList {
  variants: OverlayVariantStatus[];
  /** The active variant ids, at most one per group; `[]` is the default. */
  active: string[];
  /** The host's knobs, every route; the client filters by route. */
  knobs?: KnobAxis[];
}

/** The custom property a knob writes: `--knob-<id>`. */
export function knobVar(id: string): string {
  return `--knob-${id}`;
}

/** The property's value: a range carries its unit, a colour is its hex. */
export function knobCssValue(axis: KnobAxis, value: string): string {
  return axis.kind === 'range' ? `${value}${axis.unit ?? ''}` : value;
}

/** The knobs that belong on `route`. */
export function knobsFor(knobs: KnobAxis[] | undefined, route: string): KnobAxis[] {
  return (knobs ?? []).filter((k) => {
    const patterns = k.route === undefined ? [undefined] : ([] as (string | undefined)[]).concat(k.route);
    return patterns.some((p) => variantAppliesTo(p, route));
  });
}

/** Write every knob's value onto the root element; missing values clear the property. */
export function applyKnobValues(
  knobs: KnobAxis[],
  values: VariantSelections,
  root: { style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } },
): void {
  for (const k of knobs) {
    const v = values[k.id];
    if (v === undefined || v === axisDefault(k)) root.style.removeProperty(knobVar(k.id));
    else root.style.setProperty(knobVar(k.id), knobCssValue(k, v));
  }
}

/** The knobs that sit off their default, with the value the panel showed. */
export function knobDelta(
  knobs: KnobAxis[],
  values: VariantSelections,
): { axis: KnobAxis; value: string; shown: string }[] {
  return knobs.flatMap((k) => {
    const v = values[k.id];
    if (v === undefined || v === axisDefault(k)) return [];
    const shown = k.kind === 'range' ? formatRangeValue(k, v) : v;
    return [{ axis: k, value: v, shown }];
  });
}

/** The endpoint path the client calls. */
export const VARIANTS_ENDPOINT = '/api/iteration/variants';

/** Where the browser keeps knob values between reloads. */
export const KNOBS_STORAGE_KEY = 'isotone:knobs';

/** The option id that means "no variant, the real files". */
export const OVERLAY_DEFAULT_OPTION = 'default';

/** The shape an explicit `group` has to take: an id, like a variant's. */
export const OVERLAY_GROUP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A set of alternatives to one decision, as the panel renders it. */
export interface OverlayGroup<T extends OverlayVariant = OverlayVariant> {
  /** The explicit `group`, else a slug of the sorted member ids. */
  id: string;
  label: string;
  /** In listing order. */
  members: T[];
}

/**
 * Partition variants into the decisions they answer. An explicit `group`
 * wins; the rest are joined by file overlap, because two copies of the same
 * file can never both be active, so variants sharing a file are alternatives
 * whether or not anyone said so. Overlap is transitive (connected
 * components): if A shares a file with B and B with C, all three are one
 * group even when A and C touch different files.
 *
 * The label is any member's `groupLabel`, else the basename of a file every
 * member overrides (the element's own file, in practice), else a lone
 * member's label, else the group id. Pure, so the panel, the CLI and the
 * tests all agree on the grouping.
 */
export function overlayGroups<T extends OverlayVariant>(variants: T[]): OverlayGroup<T>[] {
  const explicit = new Map<string, T[]>();
  const loose: T[] = [];
  for (const v of variants) {
    if (v.group) {
      const members = explicit.get(v.group) ?? [];
      members.push(v);
      explicit.set(v.group, members);
    } else {
      loose.push(v);
    }
  }

  // Union-find over the loose variants, keyed by index into `loose`.
  const parent = loose.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const owner = new Map<string, number>();
  loose.forEach((v, i) => {
    for (const file of Object.keys(v.files)) {
      const other = owner.get(file);
      if (other === undefined) owner.set(file, i);
      else parent[find(i)] = find(other);
    }
  });
  const inferred = new Map<number, T[]>();
  loose.forEach((v, i) => {
    const root = find(i);
    const members = inferred.get(root) ?? [];
    members.push(v);
    inferred.set(root, members);
  });

  // Emit in listing order of each group's first member, so a new variant
  // appends a selector instead of reshuffling the ones the reviewer knows.
  const groups: OverlayGroup<T>[] = [];
  const index = new Map(loose.map((variant, i) => [variant, i]));
  const seen = new Set<T[]>();
  for (const v of variants) {
    const members = v.group ? explicit.get(v.group) : inferred.get(find(index.get(v) ?? 0));
    if (!members) continue;
    if (seen.has(members)) continue;
    seen.add(members);
    const id = v.group ?? members.map((m) => m.id).sort().join('+');
    groups.push({ id, label: groupLabel(id, members), members });
  }
  return groups;
}

function groupLabel(id: string, members: OverlayVariant[]): string {
  const named = members.find((m) => m.groupLabel);
  if (named?.groupLabel) return named.groupLabel;
  const [first, ...rest] = members;
  const shared = Object.keys(first?.files ?? {}).find((file) =>
    rest.every((m) => Object.hasOwn(m.files, file)),
  );
  if (shared) return shared.slice(shared.lastIndexOf('/') + 1);
  if (members.length === 1 && first) return first.label || first.id;
  return id;
}

/**
 * The overlay adapter's axes for `route`: one select per group that has a
 * member on this route (a member made for it or for every route), with
 * Default plus those members. A selector belongs to the page its element is
 * on and nowhere else, active or not: an active variant
 * made for another route keeps applying, since the file swap is global, but
 * the place to switch it back is that route's page. Pure, so the panel and
 * the tests can build it from a listing.
 */
/**
 * Does a variant scoped to `pattern` belong on `route`? No pattern means
 * everywhere; an exact route means that page; a pattern ending in `/*`
 * means the base and every page under it, so a variant made on one
 * detail page (`/items/42`) can be filed for `/items/*` and show on all.
 */
export function variantAppliesTo(pattern: string | undefined, route: string): boolean {
  if (!pattern) return true;
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2);
    return route === base || route.startsWith(`${base}/`);
  }
  return pattern === route;
}

export function overlayAxes(list: OverlayVariantsList, route: string): SelectVariantAxis[] {
  const axes: SelectVariantAxis[] = [];
  for (const group of overlayGroups(list.variants)) {
    const mine = group.members.filter((v) => variantAppliesTo(v.route, route));
    if (mine.length === 0) continue;
    axes.push({
      id: group.id,
      label: group.label,
      defaultOption: OVERLAY_DEFAULT_OPTION,
      options: [
        { id: OVERLAY_DEFAULT_OPTION, label: 'Default', hint: 'The committed source' },
        ...mine.map((v) => ({ id: v.id, label: v.label || v.id, hint: overlayHint(v) })),
      ],
    });
  }
  return axes;
}

function overlayHint(v: OverlayVariantStatus): string {
  const parts: string[] = [];
  if (v.description) parts.push(v.description);
  if (v.element) {
    parts.push(`↳ <${v.element.tag}>${v.element.text ? ` "${v.element.text}"` : ''}`);
  }
  const files = Object.keys(v.files);
  if (files.length) parts.push(files.join(', '));
  if (v.stale.length) parts.push(`stale: ${v.stale.join(', ')}`);
  if (v.missing.length) parts.push(`missing: ${v.missing.join(', ')}`);
  return parts.join('\n');
}

/**
 * A `VariantsSource` over the overlay endpoint. One select axis per group on
 * the route; choosing an option replaces that group's active member and
 * posts the whole active set, and the server answers by hot-swapping the
 * files, so nothing here has to re-render anything. `refresh()` re-reads
 * the listing; the panel calls it when it opens.
 */
export function createOverlayVariantsSource(cfg: {
  /** Absolute or same-origin URL of the variants endpoint. */
  endpoint: string;
  getRoute: () => string;
  /** Where knob values live between reloads; omit for none (tests). Default: `localStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** The element knobs write their properties on. Default: `document.documentElement`. */
  knobRoot?: Parameters<typeof applyKnobValues>[2] | null;
}): VariantsSource & {
  refresh(): Promise<void>;
  readonly list: OverlayVariantsList | null;
  /** The knobs on the current route and their values, for the save note. */
  readonly knobs: { axes: KnobAxis[]; values: VariantSelections };
} {
  let list: OverlayVariantsList | null = null;
  let error: string | null = null;
  let intended: string[] | null = null;
  let activation: Promise<void> | null = null;
  let revision = 0;
  let refreshRevision = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const selects = (): SelectVariantAxis[] => (list ? overlayAxes(list, cfg.getRoute()) : []);
  const knobAxes = (): KnobAxis[] => knobsFor(list?.knobs, cfg.getRoute());
  const axes = (): VariantAxis[] => [...selects(), ...knobAxes()];

  // Knob values are review-time state, kept in the browser rather than on
  // the server: a slider is a look, not a file swap.
  const storage = (() => {
    if (cfg.storage !== undefined) return cfg.storage;
    try { return typeof localStorage === 'undefined' ? null : localStorage; }
    catch { return null; }
  })();
  const knobRoot =
    cfg.knobRoot === undefined
      ? typeof document === 'undefined'
        ? null
        : document.documentElement
      : cfg.knobRoot;
  let knobValues: VariantSelections = (() => {
    const parse = (raw: string | null): VariantSelections => {
      try {
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.fromEntries(Object.entries(parsed).filter((entry) => typeof entry[1] === 'string')) : {};
      } catch { return {}; }
    };
    try {
      return storage ? parse(readBrowserStorage(storage, KNOBS_STORAGE_KEY, (current, previous) =>
        JSON.stringify({ ...parse(previous), ...parse(current) }))) : {};
    } catch {
      return {};
    }
  })();
  const persistKnobs = () => {
    try {
      if (!storage) return;
      if (Object.keys(knobValues).length === 0) removeBrowserStorage(storage, KNOBS_STORAGE_KEY);
      else writeBrowserStorage(storage, KNOBS_STORAGE_KEY, JSON.stringify(knobValues));
    } catch {
      // Storage full or blocked: the values still apply for this page view.
    }
  };
  const applyKnobs = () => {
    if (knobRoot) applyKnobValues(list?.knobs ?? [], knobValues, knobRoot);
  };
  async function drainActivations(): Promise<void> {
    while (intended !== null) {
      const active = intended;
      const sentRevision = revision;
      try {
        const res = await request(`${cfg.endpoint}/active`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active }),
        });
        if (!res.ok) throw new Error(`Activating variants failed (${res.status}). Try again.`);
        if (list) list = { ...list, active };
        error = null;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Could not activate this variant. Try again.';
      }
      // Newer picks include the full intended set, including other groups.
      // Completing or failing an older request must not discard that intent.
      if (sentRevision === revision) intended = null;
      emit();
    }
  }
  function activate(active: string[]): void {
    intended = active;
    revision++;
    error = null;
    emit();
    scheduleActivation();
  }
  function scheduleActivation(): void {
    if (activation) return;
    activation = Promise.resolve().then(drainActivations).finally(() => {
      activation = null;
      if (intended !== null) scheduleActivation();
    });
  }
  return {
    title: 'Variants',
    getError: () => error,
    get list() {
      return list;
    },
    get knobs() {
      return { axes: knobAxes(), values: { ...knobValues } };
    },
    async refresh() {
      const refreshId = ++refreshRevision;
      const startedRevision = revision;
      const wasActivating = activation !== null;
      const next = await request(cfg.endpoint, undefined, async (res) => {
        if (!res.ok) throw new Error(`Loading variants failed (${res.status})`);
        return await res.json() as OverlayVariantsList;
      });
      if (refreshId !== refreshRevision) return;
      // An older GET must not roll back a successful POST that finished while
      // the listing was loading. Definitions can still refresh independently.
      const previousKnobs = list?.knobs ?? [];
      list = list && (wasActivating || activation !== null || startedRevision !== revision)
        ? { ...next, active: list.active } : next;
      if (knobRoot) applyKnobValues(previousKnobs, {}, knobRoot);
      const valid = new Map((list.knobs ?? []).map((knob) => [knob.id, knob]));
      knobValues = Object.fromEntries(Object.entries(knobValues).filter(([id, value]) => {
        const knob = valid.get(id);
        return knob && isValidSelection(knob, value);
      }));
      applyKnobs();
      emit();
    },
    getAxes: axes,
    async manage(action) {
      const next = await request(`${cfg.endpoint}/manage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...action, route: cfg.getRoute() }),
      }, async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? 'Could not update this selector.');
        }
        return await res.json() as OverlayVariantsList;
      });
      const previousKnobs = list?.knobs ?? [];
      list = next;
      const previous = previousKnobs.find(k => k.id === action.axisId);
      if (action.action === 'remove-option' && previous?.kind === 'color') {
        const removed = previous.swatches.find(s => s.id === action.optionId);
        if (removed && knobValues[previous.id]?.toLowerCase() === removed.value.toLowerCase()) delete knobValues[previous.id];
      }
      if (knobRoot) applyKnobValues(previousKnobs, {}, knobRoot);
      const remaining = new Set(list.knobs?.map((k) => k.id));
      knobValues = Object.fromEntries(Object.entries(knobValues).filter(([id]) => remaining.has(id)));
      persistKnobs();
      applyKnobs();
      emit();
    },
    getSelections() {
      const active = new Set(intended ?? list?.active ?? []);
      const picks = Object.fromEntries(
        selects().map((axis) => [
          axis.id,
          axis.options.find((o) => active.has(o.id))?.id ?? OVERLAY_DEFAULT_OPTION,
        ]),
      );
      for (const k of knobAxes()) picks[k.id] = knobValues[k.id] ?? axisDefault(k);
      return picks;
    },
    setSelection(axisId, value) {
      const knob = knobAxes().find((k) => k.id === axisId);
      if (knob) {
        if (!isValidSelection(knob, value)) return;
        if (value === axisDefault(knob)) delete knobValues[axisId];
        else knobValues = { ...knobValues, [axisId]: value };
        persistKnobs();
        applyKnobs();
        emit();
        return;
      }
      const axis = selects().find((a) => a.id === axisId);
      if (!axis || !isValidSelection(axis, value)) return;
      // The group's members leave the set and the pick joins it; the other
      // groups' picks ride along untouched.
      const members = new Set(axis.options.map((o) => o.id));
      const next = (intended ?? list?.active ?? []).filter((id) => !members.has(id));
      if (value !== OVERLAY_DEFAULT_OPTION) next.push(value);
      activate(next);
    },
    reset() {
      knobValues = {};
      persistKnobs();
      applyKnobs();
      activate([]);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
