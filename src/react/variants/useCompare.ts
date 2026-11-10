import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { IsotoneShortcut } from '../../core/types';
import { compareFor, type VariantSelections, type VariantsSource } from '../../core/variants';

export const DEFAULT_COMPARE_SHORTCUT: IsotoneShortcut = { code: 'Backquote' };

const NO_HOLD = { subscribe: () => () => {}, held: null };

/** The defaults on show while the reviewer holds Compare, else null. */
export function useCompareHeld(source: VariantsSource | undefined): Readonly<VariantSelections> | null {
  const compare = source ? compareFor(source) : NO_HOLD;
  return useSyncExternalStore(
    compare.subscribe,
    () => compare.held,
    () => compare.held,
  );
}

const TEXT_FREE_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/** Typing somewhere: a text field, a select or editable content, in the page or in the panel. */
function editable(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !TEXT_FREE_INPUTS.has(target.type);
}

const exact = (e: KeyboardEvent, shortcut: IsotoneShortcut) =>
  e.code === shortcut.code &&
  Boolean(e.metaKey || e.ctrlKey) === Boolean(shortcut.mod) &&
  e.shiftKey === Boolean(shortcut.shift) &&
  e.altKey === Boolean(shortcut.alt);

/**
 * The page-wide hold: while the compare key is down, with the panel open or
 * closed, the page shows the defaults. Ignored while typing, with other
 * modifiers and on repeat; the key is swallowed only while it acts. Losing
 * the window or the tab, or the dock going away, ends any hold.
 */
export function useCompareKey(source: VariantsSource | undefined, shortcut: IsotoneShortcut | false, enabled: boolean): void {
  const latest = useRef(shortcut);
  latest.current = shortcut;
  useEffect(() => {
    if (!source || !enabled) return;
    const compare = compareFor(source);
    let down = false;
    const onKeyDown = (e: KeyboardEvent) => {
      const shortcut = latest.current;
      if (!shortcut || e.code !== shortcut.code) return;
      if (down) {
        // Repeats of the held key change nothing and type nothing.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.repeat || e.isComposing || !exact(e, shortcut) || editable(e)) return;
      if (!compare.start('key')) return;
      down = true;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!down || e.code !== (latest.current || null)?.code) return;
      down = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      compare.end('key');
    };
    const endAll = () => {
      down = false;
      compare.end();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') endAll();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', endAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', endAll);
      document.removeEventListener('visibilitychange', onVisibility);
      endAll();
    };
  }, [source, enabled]);
}
