/** The overlay adapter: file variants and knobs served by the Vite plugin or `isotone serve`. */

import { readBrowserStorage } from '../browser-storage';
import { request } from '../request';
import { matchRoute } from '../routes';
import type { IsotoneElement } from '../types';
import type { SelectVariantAxis, RangeVariantAxis, ColorVariantAxis, VariantAxis, VariantSelections } from './axes';
import { axisDefault, isValidSelection, formatRangeValue } from './helpers';
import { splitSectionLabel } from './sections';
import type { VariantNotice, VariantsSource } from './source';

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
  element?: IsotoneElement | null;
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
   * is the git blob id of the real file when the override was made (outside
   * a repository its bytes sit in the variant's `.isotone-base/`; `null` for
   * an added file, or a copy made outside one by Isotone 1.5.0 and earlier),
   * so a later change to the real file can be detected and three-way merged
   * into the override.
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
  /** Copies still holding conflict markers from `variant sync`. */
  conflicts?: string[];
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
 *  when the knob went back to its default or the page left its route. */
const KNOBS_EVENT = 'isotone:knob';

/** The property's value: a range carries its unit, a colour is its hex, a select is the option id. */
export function knobCssValue(axis: KnobAxis, value: string): string {
  return axis.kind === 'range' ? `${value}${axis.unit ?? ''}` : value;
}

/** The knobs that belong on `route`; every knob without one. */
export function knobsFor(knobs: KnobAxis[] | undefined, route?: string): KnobAxis[] {
  if (route === undefined) return knobs ?? [];
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
export const VARIANTS_ENDPOINT = '/api/isotone/variants';

/** Where the browser keeps knob values between reloads. */
export const KNOBS_STORAGE_KEY = 'isotone:knobs';

/** The option id that means "no variant, the real files". */
export const OVERLAY_DEFAULT_OPTION = 'default';

/** The shape an explicit `group` has to take: an id, like a variant's. */
export const OVERLAY_GROUP_ID: RegExp = /^[a-z0-9][a-z0-9-]{0,63}$/;

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

export function overlayAxes(list: OverlayVariantsList, route?: string): SelectVariantAxis[] {
  const axes: SelectVariantAxis[] = [];
  for (const group of overlayGroups(list.variants)) {
    // No route, as in `variant list` without one: every group with every member.
    const mine = route === undefined ? group.members : group.members.filter((v) => variantAppliesTo(v.route, route));
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

/**
 * The listing's knobs on `route` (every one without a route), less any whose id
 * a file-variant group has on any route. A knob and a group with one id would
 * share a selection, a `?v=` entry and a note reference, so the group keeps it;
 * `variant list` names the knob that is left out.
 */
export function overlayKnobs(list: Pick<OverlayVariantsList, 'variants' | 'knobs'>, route?: string): KnobAxis[] {
  const groups = new Set(overlayGroups(list.variants).map((group) => group.id));
  return knobsFor(list.knobs, route).filter((knob) => !groups.has(knob.id));
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
  if (v.conflicts?.length) parts.push(`conflicts: ${v.conflicts.join(', ')}`);
  return parts.join('\n');
}

/**
 * The tab's live variant store, which the Vite plugin creates on the page
 * in live mode (`window.__isotoneLive`). Only the part the panel uses.
 */
export interface LiveVariantSelection {
  readonly active: string[];
  /** Switch the tab and keep it there, `groups` (those the reviewer set) at
   *  Default included; true when the page has to reload to show it. */
  select(next: string[], groups?: string[]): boolean;
  subscribe(listener: () => void): () => void;
  reload(): void;
  /** Whether switching to `next` reloads the page. */
  needsReload?(next: string[]): boolean;
  /** Show `next` in this tab for a moment, outside the URL and the server; `null` ends it.
   *  False, changing nothing, when `next` would need a reload. */
  preview?(next: string[] | null): boolean;
}

/**
 * What the panel says when the page's `?v=` names picks it does not show. Only
 * live mode (React on Vite 6 or later) keeps picks per tab and reads `?v=`;
 * everywhere else every tab shows `.isotone/active.json`, so a link made in
 * live mode, or by hand, would otherwise be ignored without a word. Pairs that
 * name no group here are left alone: they may be the host's own.
 */
export function unappliedLinkNotice(list: OverlayVariantsList, active: string[], search: string): VariantNotice | null {
  const raw = new URLSearchParams(search).get('v');
  if (!raw) return null;
  const groups = new Map(overlayGroups(list.variants).map((group) => [group.id, group]));
  const shown = new Set(active);
  const asked: string[] = [];
  for (const pair of raw.split(',')) {
    const at = pair.indexOf(':');
    const group = at < 0 ? undefined : groups.get(pair.slice(0, at));
    if (!group) continue;
    const want = pair.slice(at + 1);
    const member = group.members.find((m) => m.id === want);
    if (!member && want !== OVERLAY_DEFAULT_OPTION) continue;
    const current = group.members.find((m) => shown.has(m.id))?.id ?? OVERLAY_DEFAULT_OPTION;
    if (current === want) continue;
    const section = group.members.find((m) => m.section !== undefined)?.section;
    asked.push(`${splitSectionLabel(group.label, section).fullLabel}: ${member ? member.label || member.id : 'Default'}`);
  }
  if (asked.length === 0) return null;
  // Stays true while the panel keeps it, even once the reviewer has picked what the link asked for.
  return {
    text: 'Link picks aren’t applied here',
    detail: `This link asks for ${asked.join('; ')}. Here every tab shows the same picks, so a link can’t choose them: pick ${asked.length > 1 ? 'them' : 'it'} below instead. Per-tab links need live switching (React on Vite 6+).`,
  };
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
  /** The page's query string, for a `?v=` the source does not apply. Default: `location.search`. */
  getSearch?: () => string;
  /**
   * Axis ids another source in the same panel already shows, such as a host's
   * own selectors. A knob with one of them is left out, as one sharing a file
   * group's id is: never shown, never on the page, and named in the notice.
   */
  takenIds?: () => Iterable<string>;
}): VariantsSource & {
  refresh(): Promise<void>;
  /** For the reviewer: the page's `?v=` names picks the page does not show; else null. */
  getNotice(): VariantNotice | null;
  readonly list: OverlayVariantsList | null;
  /** The knobs on the current route and their values, for the save note. */
  readonly knobs: { axes: KnobAxis[]; values: VariantSelections };
  /** Call after a client-side navigation: puts the new route's knobs on the page,
   *  takes the others off and notifies. Does nothing while the route is the same. */
  routeChanged(): void;
  /** Call when the ids `takenIds` gives may have changed (a host source loaded
   *  its axes): puts back or takes off the knobs they leave out. */
  takenChanged(): void;
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
  // The server's default can move the tab too (a CLI `variant use`). A preview changes no selection, so
  // re-reading every selector for it would only delay the flick.
  let previewingLive = false;
  live?.subscribe(() => {
    if (!previewingLive) emit();
  });
  const previewLive = (next: string[] | null): boolean => {
    previewingLive = true;
    try {
      return live?.preview?.(next) === true;
    } finally {
      previewingLive = false;
    }
  };
  const current = (): string[] => live?.active ?? intended ?? list?.active ?? [];
  const selects = (): SelectVariantAxis[] => (list ? overlayAxes(list, cfg.getRoute()) : []);
  /** The knobs on `route` (every route without one) that no other source's selector has taken. */
  const ownKnobs = (route?: string): KnobAxis[] => {
    if (!list) return [];
    const taken = new Set(cfg.takenIds?.() ?? []);
    return overlayKnobs(list, route).filter((knob) => !taken.has(knob.id));
  };
  const knobAxes = (): KnobAxis[] => ownKnobs(cfg.getRoute());
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
      return storage ? parse(readBrowserStorage(storage, KNOBS_STORAGE_KEY)) : {};
    } catch {
      return {};
    }
  })();
  const persistKnobs = () => {
    try {
      if (!storage) return;
      if (Object.keys(knobValues).length === 0) storage.removeItem(KNOBS_STORAGE_KEY);
      else storage.setItem(KNOBS_STORAGE_KEY, JSON.stringify(knobValues));
    } catch {
      // Storage full or blocked: the values still apply for this page view.
    }
  };
  // A hold to compare shows these over the stored values, and stores nothing.
  let previewing: VariantSelections | null = null;
  // The route whose knobs are on the page; `routeChanged` compares against it.
  let knobsRoute: string | null = null;
  // A knob is on the page only on its own routes, like its slider. Elsewhere its
  // property and attribute come off, and the stored value waits for its route.
  const applyKnobs = () => {
    knobsRoute = cfg.getRoute();
    if (!knobRoot) return;
    const knobs = list ? overlayKnobs(list) : [];
    const here = new Set(ownKnobs(knobsRoute).map((k) => k.id));
    const shown = previewing ? { ...knobValues, ...previewing } : knobValues;
    applyKnobValues(knobs, Object.fromEntries(Object.entries(shown).filter(([id]) => here.has(id))), knobRoot);
  };
  /** The active set with the given groups' members taken out: those groups at Default. */
  const withoutGroups = (axisIds: string[]): string[] => {
    const members = new Set(selects().flatMap((axis) => (axisIds.includes(axis.id) ? axis.options.map((o) => o.id) : [])));
    return current().filter((id) => !members.has(id));
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
  /** `groups`: the selectors the reviewer set, which the tab keeps even at Default. */
  function activate(active: string[], groups: string[]): void {
    if (live?.select(active, groups)) reloadAfterPost = true;
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
  const search = cfg.getSearch ?? (() => (typeof location === 'undefined' ? '' : location.search));
  return {
    getError: () => error,
    // A live tab follows its own `?v=`, so only a source without one can leave a link unapplied.
    // Read as the picks are now; the view keeps what it showed until the panel closes.
    getNotice: () => {
      if (!list) return null;
      const taken = new Set(cfg.takenIds?.() ?? []);
      const clashes = overlayKnobs(list, cfg.getRoute()).filter((knob) => taken.has(knob.id));
      const clash: VariantNotice | null = clashes.length
        ? {
            text: clashes.length > 1 ? `${clashes.length} knobs are left out` : 'A knob is left out',
            detail: `Left out of .isotone/knobs.json: ${clashes.map((knob) => knob.id).join(', ')}, since one of the app’s own selectors has ${clashes.length > 1 ? 'each' : 'this'} id, so the panel shows only that selector. Give ${clashes.length > 1 ? 'each knob its' : 'the knob its'} own id.`,
          }
        : null;
      const link = live ? null : unappliedLinkNotice(list, current(), search());
      const notices = [link, clash].filter((notice): notice is VariantNotice => notice !== null);
      // Both at once read as one line, and one explanation after the other.
      return notices.length ? { text: notices.map((n) => n.text).join(' · '), detail: notices.map((n) => n.detail).join('\n\n') } : null;
    },
    get list() {
      return list;
    },
    get knobs() {
      return { axes: knobAxes(), values: { ...knobValues } };
    },
    takenChanged() {
      // The panel re-reads axes from the source that changed; only <html> needs this.
      if (list) applyKnobs();
    },
    routeChanged() {
      // Before the first listing nothing is on the page; `refresh` applies it.
      if (!list || cfg.getRoute() === knobsRoute) return;
      applyKnobs();
      emit();
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
      // A stored value for a knob a group now hides is dropped too, so it cannot style the page unseen.
      const valid = new Map(overlayKnobs(list).map((knob) => [knob.id, knob]));
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
    // Knobs are properties on the page, so they switch at once. A file variant does only in live mode,
    // in this tab, when no export fixed at load differs; otherwise it is a server round trip or a reload.
    canPreview(axisId) {
      if (knobAxes().some((k) => k.id === axisId)) return true;
      if (!selects().some((a) => a.id === axisId)) return false;
      if (!live?.preview || !live.needsReload) return 'switches through the dev server';
      return live.needsReload(withoutGroups([axisId])) ? 'switches by reloading the page' : true;
    },
    preview(partial) {
      const knobIds = new Set(knobAxes().map((k) => k.id));
      previewing = partial && Object.fromEntries(Object.entries(partial).filter(([id]) => knobIds.has(id)));
      applyKnobs();
      const groups = partial ? Object.keys(partial).filter((id) => !knobIds.has(id)) : [];
      // A set the tab cannot show in place (together they would reload) stays on the picks, and says so.
      const shown = groups.length > 0 && previewLive(withoutGroups(groups));
      if (partial === null) previewLive(null);
      return partial ? Object.keys(previewing ?? {}).concat(shown ? groups : []) : undefined;
    },
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
      activate(next, [axis.id]);
    },
    reset() {
      knobValues = {};
      persistKnobs();
      applyKnobs();
      activate(
        [],
        selects().map((axis) => axis.id),
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
