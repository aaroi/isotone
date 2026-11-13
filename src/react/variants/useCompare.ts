import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { IsotoneShortcut } from '../../core/types';
import { compareFor, type VariantSelections, type VariantsSource } from '../../core/variants';
import { isShortcutKey, matches } from '../dock/useDockEvents';

/**
 * The key under Escape: `Backquote` on ANSI keyboards, `IntlBackslash` (§) on
 * Mac ISO ones (Finnish, German, UK), where `Backquote` is beside left Shift.
 */
export const DEFAULT_COMPARE_SHORTCUT: IsotoneShortcut = { code: ['Backquote', 'IntlBackslash'] };

/** Whether the tooltip can say "the key under Esc": a bare press of one of those keys. */
export function isUnderEscape(shortcut: IsotoneShortcut | false): boolean {
  if (!shortcut || shortcut.mod || shortcut.alt || shortcut.shift) return false;
  return ([] as string[]).concat(shortcut.code).some((code) => code === 'Backquote' || code === 'IntlBackslash');
}

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
      if (!shortcut || !isShortcutKey(e, shortcut)) return;
      if (down) {
        // Repeats of the held key change nothing and type nothing.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.repeat || e.isComposing || !matches(e, shortcut) || editable(e)) return;
      if (!compare.start('key')) return;
      down = true;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const shortcut = latest.current;
      if (!down || !shortcut || !isShortcutKey(e, shortcut)) return;
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
