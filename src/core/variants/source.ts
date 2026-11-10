/** The source contract: what the panel reads variants from, and the host-owned source. */

import type { VariantAxis, VariantSelections, VariantAction } from './axes';
import { keptValue, axisDefault, isValidSelection, defaultSelections } from './helpers';

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
   * When present, the panel shows "Make default" and calls this with the
   * current selections. A host that promotes by editing source (one that
   * files a `[set-defaults]` note for the agent) implements it; a host
   * whose variants are whole alternatives (the overlay adapter) leaves it
   * out and promotes from the CLI instead.
   */
  saveDefaults?: (selections: VariantSelections) => Promise<void> | void;
  /** Optional durable host mutation. Reject to leave the UI unchanged. */
  manage?: (action: VariantAction) => Promise<void> | void;
  /**
   * Optional, for hold to compare: show `selections` (some axes, by id) in
   * the page for a moment on top of the stored ones, and `null` to show the
   * stored ones again. A preview stores nothing, notifies no subscriber and
   * leaves `getSelections` as it was. Without it the panel offers no compare.
   */
  preview?: (selections: VariantSelections | null) => void;
  /** Optional: whether `preview` can show this axis instantly, in the page.
   *  Absent, every axis can. */
  canPreview?: (axisId: string) => boolean;
}

/**
 * A `VariantsSource` over plain state, for hosts that just want to hand the
 * panel an axes array and be told when a selection changes. Handles
 * subscriptions, validation and defaults. `onChange` fires after every
 * selection or reset with the full selections, and while the reviewer holds
 * Compare, with the defaults and then the picks again (`{ preview: true }`
 * on the first).
 */
export function createVariantsSource(init: {
  axes: VariantAxis[];
  selections?: VariantSelections;
  /** `preview` is true while the reviewer holds Compare: apply the selections, but keep them out of the URL and storage. */
  onChange?: (selections: VariantSelections, change?: { preview: boolean }) => void;
  saveDefaults?: VariantsSource['saveDefaults'];
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
          const swatch = axis.swatches.find((s) => s.id === action.optionId);
          if (!swatch || swatch.value.toLowerCase() === axis.defaultColor.toLowerCase())
            throw new Error('Keep the default colour, or remove the whole selector.');
          const swatches = axis.swatches.filter((s) => s.id !== action.optionId);
          if (picks[axis.id]?.toLowerCase() === swatch.value.toLowerCase()) picks[axis.id] = axis.defaultColor;
          next = next.map((a) => (a.id === axis.id ? { ...axis, swatches } : a));
        } else {
          if (action.optionId === axis.defaultOption) throw new Error('Keep the default option, or remove the whole selector.');
          if (!axis.options.some((o) => o.id === action.optionId)) throw new Error('This option is no longer available.');
          const options = axis.options.filter((o) => o.id !== action.optionId);
          if (picks[axis.id] === action.optionId) picks[axis.id] = axis.defaultOption;
          next = next.map((a) => (a.id === axis.id ? { ...axis, options } : a));
          if (options.length === 1) next = next.filter((a) => a.id !== axis.id);
        }
      } else {
        if (action.action === 'keep-option') picks[axis.id] = keptValue(axis, action.optionId);
        else if (action.action === 'keep-default') picks[axis.id] = axisDefault(axis);
        else delete picks[axis.id];
        next = next.filter((a) => a.id !== axis.id);
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
    preview(partial) {
      const shown = { ...selections };
      for (const axis of axes) {
        const value = partial?.[axis.id];
        if (value !== undefined && isValidSelection(axis, value)) shown[axis.id] = value;
      }
      init.onChange?.(shown, { preview: partial !== null });
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
