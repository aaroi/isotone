/**
 * iso-iterate — variants: the framework-free model.
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
 *   source files under `.iso-iterate/variants/<id>/…` that the Vite plugin
 *   swaps in for the real ones while a variant is active. The browser sees
 *   one select axis per group of alternatives, on the route they belong to
 *   ({@link overlayGroups}, {@link createOverlayVariantsSource}).
 *
 * Everything in this module is pure or DOM-free and runs in a `node` test.
 */

import type { IterationElement } from './index';

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
    return Number.isFinite(n) && n >= axis.min && n <= axis.max;
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
  const out: VariantSelections = {};
  for (const pair of raw.split(',')) {
    const at = pair.indexOf(':');
    if (at < 0) continue;
    const axisId = pair.slice(0, at);
    const value = pair.slice(at + 1);
    const axis = axes.find((a) => a.id === axisId);
    if (axis && isValidSelection(axis, value)) out[axisId] = value;
  }
  return out;
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
 * `showWhen` is recursive: a hidden parent hides its children. Depth-capped
 * so a cycle in a hand-written meta cannot hang the panel.
 */
export function isAxisVisible(
  axis: VariantAxis,
  axes: VariantAxis[],
  selections: VariantSelections,
  depth = 0,
): boolean {
  if (!axis.showWhen || depth > 8) return true;
  const parent = axes.find((a) => a.id === axis.showWhen?.axis);
  const value = selections[axis.showWhen.axis] ?? (parent ? axisDefault(parent) : undefined);
  if (axis.showWhen.equals !== undefined && value !== axis.showWhen.equals) return false;
  if (axis.showWhen.not !== undefined && value === axis.showWhen.not) return false;
  return parent ? isAxisVisible(parent, axes, selections, depth + 1) : true;
}

export function visibleAxes(axes: VariantAxis[], selections: VariantSelections): VariantAxis[] {
  return axes.filter((a) => isAxisVisible(a, axes, selections));
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
}): VariantsSource & {
  /** Replace the axes (route change); selections not valid for the new set
   *  are dropped. */
  setAxes(axes: VariantAxis[]): void;
  /** Replace the selections wholesale (URL hydration). */
  setSelections(selections: VariantSelections): void;
} {
  let axes = init.axes;
  let selections: VariantSelections = { ...defaultSelections(axes), ...(init.selections ?? {}) };
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
 * `variant.json` in `.iso-iterate/variants/<id>/`, with the files mirrored
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

/** `GET` body of the variants endpoint. */
export interface OverlayVariantsList {
  variants: OverlayVariantStatus[];
  /** The active variant ids, at most one per group; `[]` is the default. */
  active: string[];
}

/** The endpoint path the client calls. */
export const VARIANTS_ENDPOINT = '/api/iteration/variants';

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
  const seen = new Set<string>();
  for (const v of variants) {
    const members = v.group ? explicit.get(v.group) : inferred.get(find(loose.indexOf(v)));
    if (!members) continue;
    const id = v.group ?? members.map((m) => m.id).sort().join('+');
    if (seen.has(id)) continue;
    seen.add(id);
    groups.push({ id, label: groupLabel(id, members), members });
  }
  return groups;
}

function groupLabel(id: string, members: OverlayVariant[]): string {
  const named = members.find((m) => m.groupLabel);
  if (named?.groupLabel) return named.groupLabel;
  const [first, ...rest] = members;
  const shared = Object.keys(first?.files ?? {}).find((file) =>
    rest.every((m) => file in m.files),
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
export function overlayAxes(list: OverlayVariantsList, route: string): SelectVariantAxis[] {
  const axes: SelectVariantAxis[] = [];
  for (const group of overlayGroups(list.variants)) {
    const mine = group.members.filter((v) => !v.route || v.route === route);
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
 * The browser's own fetch when the Vite plugin captured it before any app
 * code ran, else whatever `fetch` is now (see `core/index.ts`).
 */
const request: typeof fetch = (input, init) => {
  const native = (globalThis as { __isoIterateFetch?: typeof fetch }).__isoIterateFetch;
  return (native ?? globalThis.fetch)(input, init);
};

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
}): VariantsSource & { refresh(): Promise<void>; readonly list: OverlayVariantsList | null } {
  let list: OverlayVariantsList | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const axes = (): SelectVariantAxis[] => (list ? overlayAxes(list, cfg.getRoute()) : []);
  async function activate(active: string[]) {
    const res = await request(`${cfg.endpoint}/active`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    if (!res.ok) throw new Error(`Activating variants failed (${res.status})`);
    if (list) list = { ...list, active };
    emit();
  }
  return {
    title: 'Variants',
    get list() {
      return list;
    },
    async refresh() {
      const res = await request(cfg.endpoint);
      if (!res.ok) throw new Error(`Loading variants failed (${res.status})`);
      list = (await res.json()) as OverlayVariantsList;
      emit();
    },
    getAxes: axes,
    getSelections() {
      const active = new Set(list?.active ?? []);
      return Object.fromEntries(
        axes().map((axis) => [
          axis.id,
          axis.options.find((o) => active.has(o.id))?.id ?? OVERLAY_DEFAULT_OPTION,
        ]),
      );
    },
    setSelection(axisId, value) {
      const axis = axes().find((a) => a.id === axisId);
      if (!axis || !isValidSelection(axis, value)) return;
      // The group's members leave the set and the pick joins it; the other
      // groups' picks ride along untouched.
      const members = new Set(axis.options.map((o) => o.id));
      const next = (list?.active ?? []).filter((id) => !members.has(id));
      if (value !== OVERLAY_DEFAULT_OPTION) next.push(value);
      void activate(next).catch(() => {});
    },
    reset() {
      void activate([]).catch(() => {});
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
