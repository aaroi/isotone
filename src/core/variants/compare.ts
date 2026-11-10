/**
 * Hold to compare: while the reviewer holds a control, the page shows every
 * selector it can switch instantly at its default; letting go shows the picks
 * again. Nothing is stored: the source's `preview` applies selections without
 * persisting them, and the stored selections never change.
 */

import type { VariantAxis, VariantSelections } from './axes';
import { axisDefault, visibleAxes } from './helpers';
import type { VariantsSource } from './source';

/** The shown axes whose pick differs from the default. */
export function changedAxes(shown: VariantAxis[], selections: Readonly<VariantSelections>): VariantAxis[] {
  return shown.filter((axis) => {
    const value = selections[axis.id];
    return value !== undefined && value !== axisDefault(axis);
  });
}

/**
 * What a hold would flick: the changed axes that switch instantly, and the
 * changed ones that cannot, each with the source's reason when it gave one.
 */
export function compareAxes(
  source: VariantsSource,
  shown: VariantAxis[],
  selections: Readonly<VariantSelections>,
): { ids: string[]; skipped: { axis: VariantAxis; reason: string | null }[] } {
  const changed = changedAxes(shown, selections);
  if (!source.preview) return { ids: [], skipped: [] };
  const ids: string[] = [];
  const skipped: { axis: VariantAxis; reason: string | null }[] = [];
  for (const axis of changed) {
    const can = source.canPreview?.(axis.id) ?? true;
    if (can === true) ids.push(axis.id);
    else skipped.push({ axis, reason: typeof can === 'string' && can ? can : null });
  }
  return { ids, skipped };
}

/** One hold at a time, owned by whatever started it (the button, its keys, the shortcut). */
export interface VariantsCompare {
  /** The defaults on show during a hold, by axis id; null otherwise. */
  readonly held: Readonly<VariantSelections> | null;
  /** Show the defaults for `holder`. False when a hold is on or nothing can be compared. */
  start(holder: string): boolean;
  /** Show the picks again. With a holder, only that holder's hold ends. */
  end(holder?: string): void;
  subscribe(listener: () => void): () => void;
}

const compares = new WeakMap<VariantsSource, VariantsCompare>();

/** The compare for `source`, shared by every control that can hold it. */
export function compareFor(source: VariantsSource): VariantsCompare {
  const existing = compares.get(source);
  if (existing) return existing;
  let held: VariantSelections | null = null;
  let owner: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const compare: VariantsCompare = {
    get held() {
      return held;
    },
    start(holder) {
      if (held || !source.preview) return false;
      const selections = source.getSelections();
      const axes = visibleAxes(source.getAxes(), selections);
      const { ids } = compareAxes(source, axes, selections);
      if (ids.length === 0) return false;
      const defaults: VariantSelections = {};
      for (const axis of axes) if (ids.includes(axis.id)) defaults[axis.id] = axisDefault(axis);
      let shownIds: string[] | undefined;
      try {
        shownIds = source.preview(defaults);
      } catch {
        return false;
      }
      // Only what the page really shows reads as the default in the panel.
      if (Array.isArray(shownIds)) {
        for (const id of Object.keys(defaults)) if (!shownIds.includes(id)) delete defaults[id];
        if (Object.keys(defaults).length === 0) {
          try {
            source.preview(null);
          } catch {
            // Nothing was shown.
          }
          return false;
        }
      }
      held = defaults;
      owner = holder;
      emit();
      return true;
    },
    end(holder) {
      if (!held || (holder !== undefined && holder !== owner)) return;
      held = null;
      owner = null;
      try {
        source.preview?.(null);
      } catch {
        // The hold is over either way; the host's own state is what it stored.
      }
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  compares.set(source, compare);
  return compare;
}
