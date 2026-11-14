/** Several variant sources as one: a host's own selectors beside Isotone's knobs, say. */

import type { VariantAxis, VariantSelections } from './axes';
import type { VariantsSource } from './source';

/**
 * One `VariantsSource` over several, so the panel lists every source's
 * selectors and each pick, preview and request still reaches the source that
 * owns the selector. Axes come in source order; when two sources share an axis
 * id, the earlier source keeps it and the later one's is left out.
 *
 * Optional parts exist when any source has them: `preview` (hold to compare)
 * shows each source's part through its own `preview`, `canPreview` asks the
 * owner (no `preview` there means no), `getError` is the first source's error,
 * `refresh` refreshes them all, and `saveDefaults` calls each source's own
 * with that source's picks, in order. `reset` resets every source, and
 * `getNotice` is the first source's notice. `linkIgnored` holds when any
 * source's does.
 */
export function combineVariantsSources(...sources: VariantsSource[]): VariantsSource {
  return combineSources(sources);
}

/** {@link combineVariantsSources}, with `dispose` for a mount that ends: it leaves every source's subscribers. */
export function combineSources(sources: VariantsSource[]): VariantsSource & { dispose(): void } {
  /** Each shown axis with the source that owns it, earliest first. */
  const owned = (): [VariantAxis, VariantsSource][] => {
    const seen = new Set<string>();
    const out: [VariantAxis, VariantsSource][] = [];
    for (const source of sources)
      for (const axis of source.getAxes()) {
        if (seen.has(axis.id)) continue;
        seen.add(axis.id);
        out.push([axis, source]);
      }
    return out;
  };
  const ownerOf = (axisId: string): VariantsSource | undefined => owned().find(([axis]) => axis.id === axisId)?.[1];
  /** `selections` split by owning source, keeping only ids some source owns. */
  const split = (selections: VariantSelections): Map<VariantsSource, VariantSelections> => {
    const parts = new Map<VariantsSource, VariantSelections>();
    for (const [axis, source] of owned()) {
      const value = selections[axis.id];
      if (value === undefined) continue;
      const part = parts.get(source) ?? {};
      part[axis.id] = value;
      parts.set(source, part);
    }
    return parts;
  };
  const some = (key: keyof VariantsSource) => sources.some((source) => typeof source[key] === 'function');
  // The sources a hold is showing, so letting go reaches only them.
  const previewed = new Set<VariantsSource>();

  // Every live subscription, so a mount that ends can leave the sources it does not own.
  const subscriptions = new Set<() => void>();
  const combined: VariantsSource & { refresh?: () => Promise<void>; dispose(): void } = {
    getAxes: () => owned().map(([axis]) => axis),
    getSelections() {
      const picks: VariantSelections = {};
      const read = new Map<VariantsSource, VariantSelections>();
      for (const [axis, source] of owned()) {
        const selections = read.get(source) ?? source.getSelections();
        read.set(source, selections);
        const value = selections[axis.id];
        if (value !== undefined) picks[axis.id] = value;
      }
      return picks;
    },
    setSelection(axisId, value) {
      ownerOf(axisId)?.setSelection(axisId, value);
    },
    reset() {
      for (const source of sources) source.reset();
    },
    subscribe(listener) {
      const offs = sources.map((source) => source.subscribe(listener));
      const off = () => {
        for (const one of offs) one();
        subscriptions.delete(off);
      };
      subscriptions.add(off);
      return off;
    },
    dispose() {
      for (const off of [...subscriptions]) off();
    },
  };
  if (some('getError')) combined.getError = () => sources.reduce<string | null>((error, s) => error ?? s.getError?.() ?? null, null);
  if (some('manage'))
    combined.manage = (action) => {
      const owner = ownerOf(action.axisId);
      if (!owner?.manage) throw new Error('This selector cannot be changed from the panel.');
      return owner.manage(action);
    };
  if (some('preview')) {
    combined.preview = (partial) => {
      if (partial === null) {
        for (const source of previewed) source.preview?.(null);
        previewed.clear();
        return undefined;
      }
      const shown: string[] = [];
      try {
        for (const [source, part] of split(partial)) {
          if (!source.preview) continue;
          previewed.add(source);
          const ids = source.preview(part);
          shown.push(...(Array.isArray(ids) ? ids : Object.keys(part)));
        }
      } catch (error) {
        // The hold never starts, so nothing may stay held: let go of what was shown.
        for (const source of previewed) {
          try {
            source.preview?.(null);
          } catch {
            // Its own state is what it stored.
          }
        }
        previewed.clear();
        throw error;
      }
      return shown;
    };
    combined.canPreview = (axisId) => {
      const owner = ownerOf(axisId);
      return owner?.preview ? (owner.canPreview?.(axisId) ?? true) : false;
    };
  }
  if (some('saveDefaults'))
    combined.saveDefaults = async (selections) => {
      const parts = split(selections);
      // A source with nothing on this page has nothing to save.
      for (const [source, part] of parts) await source.saveDefaults?.(part);
    };
  if (some('getNotice')) combined.getNotice = () => sources.reduce<string | null>((notice, s) => notice ?? s.getNotice?.() ?? null, null);
  if (some('linkIgnored')) combined.linkIgnored = () => sources.some((s) => s.linkIgnored?.() ?? false);
  if (sources.some((source) => typeof (source as { refresh?: unknown }).refresh === 'function'))
    combined.refresh = async () => {
      await Promise.all(sources.map((source) => (source as { refresh?: () => unknown }).refresh?.()));
    };
  return combined;
}
