/** The overlay adapter: file variants and knobs served by the Vite plugin or `isotone serve`. */

import { readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from '../browser-storage';
import { request } from '../request';
import { matchRoute } from '../routes';
import type { IterationElement } from '../types';
import type { SelectVariantAxis, RangeVariantAxis, ColorVariantAxis, VariantAxis, VariantSelections } from './axes';
import { axisDefault, isValidSelection, formatRangeValue } from './helpers';
import type { VariantsSource } from './source';

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
  /** The panel section the group's selector sits in, like an axis `section`.
   *  Any member may carry it; a `groupLabel` prefix (`"Header > Logo"`) also works. */
  section?: string;
  createdAt: string;
  /**
   * Repo-relative source path → what the override was derived from. `base`
   * is the git blob id of the real file when the override was made (`null`
   * when the file was not hashable), so a later change to the real file can
   * be detected and three-way merged into the override.
   */
  /** `added`: a file the project does not have; the variant introduces it. */
  files: Record<string, { base: string | null; added?: true }>;
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
 * A knob: a range, colour or select axis the host declares in `.isotone/knobs.json`
 * next to its overlay variants. The panel renders it as a slider (or a colour
 * pick) on the routes it names, and the value reaches the page as a CSS
 * custom property on `<html>`, `--knob-<id>`, with the axis unit appended
 * (`--knob-fade-from: 40%`). The host reads it with a fallback that is the
 * committed default: `var(--knob-fade-from, 0%)`. "Make default" files
 * the moved knobs in the same `[set-defaults]` note as the variant picks, so
 * the agent writes the numbers into the source and the knob file.
 *
 * A select knob's value is its option id, which CSS cannot branch on through a
 * custom property, so it also lands as `data-knob-<id>` on `<html>`. Code that
 * draws for itself listens for {@link KNOBS_EVENT} on the document.
 */
export type KnobAxis = (RangeVariantAxis | ColorVariantAxis | SelectVariantAxis) & {
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

/** Fired on `<html>`, bubbling, when a knob's value changes. `detail` is
 *  `{ id, value }` with the same value the custom property holds, or `null`
 *  when the knob went back to its default. */
const KNOBS_EVENT = 'isotone:knob';

/** The property's value: a range carries its unit, a colour is its hex, a select is the option id. */
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
  root: {
    style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
    setAttribute?(name: string, value: string): void;
    removeAttribute?(name: string): void;
    getAttribute?(name: string): string | null;
    dispatchEvent?(event: Event): boolean;
  },
): void {
  for (const k of knobs) {
    const v = values[k.id];
    const cleared = v === undefined || v === axisDefault(k);
    const next = cleared ? null : knobCssValue(k, v);
    const previous = (root.style as { getPropertyValue?(name: string): string }).getPropertyValue?.(knobVar(k.id)) || null;
    if (next === null) root.style.removeProperty(knobVar(k.id));
    else root.style.setProperty(knobVar(k.id), next);
    if (k.kind !== 'range' && k.kind !== 'color') {
      if (next === null) root.removeAttribute?.(`data-knob-${k.id}`);
      else root.setAttribute?.(`data-knob-${k.id}`, next);
    }
    if (next !== previous && typeof CustomEvent !== 'undefined') {
      root.dispatchEvent?.(new CustomEvent(KNOBS_EVENT, { bubbles: true, detail: { id: k.id, value: next } }));
    }
  }
}

/** The knobs that sit off their default, with the value the panel showed. */
export function knobDelta(knobs: KnobAxis[], values: VariantSelections): { axis: KnobAxis; value: string; shown: string }[] {
  return knobs.flatMap((k) => {
    const v = values[k.id];
    if (v === undefined || v === axisDefault(k)) return [];
    const shown =
      k.kind === 'range' ? formatRangeValue(k, v) : k.kind === 'color' ? v : (k.options.find((option) => option.id === v)?.label ?? v);
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
    for (let up = parent[i] ?? i; up !== i; up = parent[i] ?? i) {
      // Path halving: point at the grandparent and continue from there.
      parent[i] = parent[up] ?? up;
      i = parent[i] ?? up;
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
    const id =
      v.group ??
      members
        .map((m) => m.id)
        .sort()
        .join('+');
    groups.push({ id, label: groupLabel(id, members), members });
  }
  return groups;
}

function groupLabel(id: string, members: OverlayVariant[]): string {
  const named = members.find((m) => m.groupLabel);
  if (named?.groupLabel) return named.groupLabel;
  const [first, ...rest] = members;
  const shared = Object.keys(first?.files ?? {}).find((file) => rest.every((m) => Object.hasOwn(m.files, file)));
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
 * Does a variant scoped to `pattern` belong on `route`? The shared route
 * grammar (`core/routes.ts`): no pattern means everywhere, an exact route
 * means that page, and `/items/*` the base and every page under it, so a
 * variant made on one detail page can be filed for all of them.
 */
export function variantAppliesTo(pattern: string | undefined, route: string): boolean {
  return matchRoute(pattern, route);
}

export function overlayAxes(list: OverlayVariantsList, route: string): SelectVariantAxis[] {
  const axes: SelectVariantAxis[] = [];
  for (const group of overlayGroups(list.variants)) {
    const mine = group.members.filter((v) => variantAppliesTo(v.route, route));
    if (mine.length === 0) continue;
    const section = group.members.find((m) => m.section !== undefined)?.section;
    axes.push({
      id: group.id,
      label: group.label,
      ...(section !== undefined ? { section } : {}),
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
 * The tab's live variant store, which the Vite plugin creates on the page
 * in live mode (`window.__isotoneLive`). Only the part the panel uses.
 */
export interface LiveVariantSelection {
  readonly active: string[];
  /** Switch the tab; true when the page has to reload to show it. */
  select(next: string[]): boolean;
  subscribe(listener: () => void): () => void;
  reload(): void;
}

function pageLiveStore(): LiveVariantSelection | null {
  if (typeof window === 'undefined') return null;
  const store = (window as { __isotoneLive?: LiveVariantSelection & { version?: number } }).__isotoneLive;
  return store && store.version === 1 ? store : null;
}

/**
 * A `VariantsSource` over the overlay endpoint. One select axis per group on
 * the route; choosing an option replaces that group's active member and
 * posts the whole active set. In live mode the tab's store switches the page
 * at once (or asks for a reload), and the post makes the pick the server's
 * default; otherwise the server answers the post by hot-swapping the files.
 * `refresh()` re-reads the listing; the panel calls it when it opens.
 */
export function createOverlayVariantsSource(cfg: {
  /** Absolute or same-origin URL of the variants endpoint. */
  endpoint: string;
  getRoute: () => string;
  /** Where knob values live between reloads; omit for none (tests). Default: `localStorage`. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /** The element knobs write their properties on. Default: `document.documentElement`. */
  knobRoot?: Parameters<typeof applyKnobValues>[2] | null;
  /** The tab's live store. Default: the one the Vite plugin put on the page, if any. */
  live?: LiveVariantSelection | null;
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
  let reloadAfterPost = false;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  const live = cfg.live === undefined ? pageLiveStore() : cfg.live;
  // The server's default can move the tab too (a CLI `variant use`).
  live?.subscribe(emit);
  const current = (): string[] => live?.active ?? intended ?? list?.active ?? [];
  const selects = (): SelectVariantAxis[] => (list ? overlayAxes(list, cfg.getRoute()) : []);
  const knobAxes = (): KnobAxis[] => knobsFor(list?.knobs, cfg.getRoute());
  const axes = (): VariantAxis[] => [...selects(), ...knobAxes()];

  // Knob values are review-time state, kept in the browser rather than on
  // the server: a slider is a look, not a file swap.
  const storage = (() => {
    if (cfg.storage !== undefined) return cfg.storage;
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  })();
  const knobRoot = cfg.knobRoot === undefined ? (typeof document === 'undefined' ? null : document.documentElement) : cfg.knobRoot;
  let knobValues: VariantSelections = (() => {
    const parse = (raw: string | null): VariantSelections => {
      try {
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.fromEntries(Object.entries(parsed).filter((entry) => typeof entry[1] === 'string'))
          : {};
      } catch {
        return {};
      }
    };
    try {
      return storage
        ? parse(
            readBrowserStorage(storage, KNOBS_STORAGE_KEY, (current, previous) =>
              JSON.stringify({ ...parse(previous), ...parse(current) }),
            ),
          )
        : {};
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
        if (!res.ok) {
          // The server knows which variants and which file are in the way.
          const reason = await res.json().then(
            (body: { error?: unknown }) => body?.error,
            () => null,
          );
          throw new Error(typeof reason === 'string' ? reason : `Activating variants failed (${res.status}). Try again.`);
        }
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
    // The tab already shows the pick in its URL; a server render reads the
    // set just posted, so the reload waits for it.
    if (reloadAfterPost && live) {
      reloadAfterPost = false;
      live.reload();
    }
  }
  function activate(active: string[]): void {
    if (live?.select(active)) reloadAfterPost = true;
    intended = active;
    revision++;
    error = null;
    emit();
    scheduleActivation();
  }
  function scheduleActivation(): void {
    if (activation) return;
    activation = Promise.resolve()
      .then(drainActivations)
      .finally(() => {
        activation = null;
        if (intended !== null) scheduleActivation();
      });
  }
  return {
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
        return (await res.json()) as OverlayVariantsList;
      });
      if (refreshId !== refreshRevision) return;
      // An older GET must not roll back a successful POST that finished while
      // the listing was loading. Definitions can still refresh independently.
      const previousKnobs = list?.knobs ?? [];
      list = list && (wasActivating || activation !== null || startedRevision !== revision) ? { ...next, active: list.active } : next;
      if (knobRoot) applyKnobValues(previousKnobs, {}, knobRoot);
      const valid = new Map((list.knobs ?? []).map((knob) => [knob.id, knob]));
      knobValues = Object.fromEntries(
        Object.entries(knobValues).filter(([id, value]) => {
          const knob = valid.get(id);
          return knob && isValidSelection(knob, value);
        }),
      );
      applyKnobs();
      emit();
    },
    getAxes: axes,
    getSelections() {
      const active = new Set(current());
      const picks = Object.fromEntries(
        selects().map((axis) => [axis.id, axis.options.find((o) => active.has(o.id))?.id ?? OVERLAY_DEFAULT_OPTION]),
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
      const next = current().filter((id) => !members.has(id));
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
