import { type FocusEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { IsotoneShortcut } from '../../core/types';
import { prefersTouch } from './viewport';

/**
 * Events that stay inside the dock. They stop at the shadow root in the bubble
 * phase, so a host's bubble-phase shortcuts, outside-press handlers and
 * scroll hijackers never see them. Host listeners in the capture phase on
 * `window` or `document` run before the dock's and still see everything;
 * docs/design.md lists what that leaves.
 */
const FENCED_EVENTS =
  'pointerdown mousedown touchstart click contextmenu keydown keyup keypress beforeinput input focusin focusout wheel'.split(' ');

export const DEFAULT_SHORTCUT: IsotoneShortcut = { code: 'Period', mod: true, shift: true };

/** The shortcut as the panel's hints spell it. */
export function shortcutText(shortcut: IsotoneShortcut | false): string {
  if (!shortcut) return '';
  const code = ([] as string[]).concat(shortcut.code)[0] ?? '';
  const key = code === 'Period' ? '.' : code.replace(/^Key/, '');
  return [shortcut.mod && '⌘/Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', key].filter(Boolean).join('+');
}

interface DockEventsOptions {
  rootRef: RefObject<HTMLElement | null>;
  /** Start without motion until the first key or pointer, as panels a reload restored are simply there. */
  still?: boolean;
  visible: boolean;
  shortcut: IsotoneShortcut | false;
  /** The shortcut was pressed, anywhere on the page. */
  onShortcut: () => void;
  /** Escape was pressed in the dock, or with nothing focused. */
  onEscape: () => void;
  /** The pointer left the dock, or the dock was hidden. */
  onLeave: () => void;
}

/** The key each character is typed with on a US layout, shifted or not, and § on a Mac ISO one. */
const KEY_CODES: Record<string, string> = Object.fromEntries(
  Object.entries({
    Period: '.>',
    Comma: ',<',
    Slash: '/?',
    Semicolon: ';:',
    Quote: `'"`,
    BracketLeft: '[{',
    BracketRight: ']}',
    Backslash: '\\|',
    Backquote: '`~',
    Minus: '-_',
    Equal: '=+',
    IntlBackslash: '§±',
    Space: ' ',
  }).flatMap(([code, keys]) => [...keys].map((key) => [key, code])),
);

/**
 * The event's physical key. A real keyboard always sets `code`; an event an
 * automation tool dispatches often carries only `key` (`'.'`, `code: ''`), so
 * the key is read as a US layout would type it. Named keys (`Escape`, `F2`)
 * share their code's name.
 */
function codeOf({ code, key = '' }: Pick<KeyboardEvent, 'code' | 'key'>): string {
  if (code) return code;
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  const shifted = '!@#$%^&*()'.indexOf(key);
  if (shifted >= 0) return `Digit${(shifted + 1) % 10}`;
  return KEY_CODES[key] ?? key;
}

/** Whether the event's key is one of the shortcut's keys. */
export const isShortcutKey = (e: Pick<KeyboardEvent, 'code' | 'key'>, shortcut: IsotoneShortcut) =>
  ([] as string[]).concat(shortcut.code).includes(codeOf(e));

/** The shortcut's key with exactly its modifiers. */
export const matches = (e: KeyboardEvent, shortcut: IsotoneShortcut) =>
  isShortcutKey(e, shortcut) &&
  Boolean(e.metaKey || e.ctrlKey) === Boolean(shortcut.mod) &&
  e.shiftKey === Boolean(shortcut.shift) &&
  e.altKey === Boolean(shortcut.alt);

/**
 * The dock's page-level events: hover and rail focus (which unfold the rail),
 * the input modality (keyboard actions skip motion; hints follow the last
 * pointer), the global shortcut, Escape, and the fence that keeps the dock's
 * own events from the host.
 */
export function useDockEvents({ rootRef, visible, shortcut, onShortcut, onEscape, onLeave, still = false }: DockEventsOptions) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [instant, setInstant] = useState(still);
  // Hints follow the last pointer used, so a hybrid device gets the right words.
  const [touch, setTouch] = useState(prefersTouch);
  const latest = useRef({ shortcut, onShortcut, onEscape, onLeave });
  latest.current = { shortcut, onShortcut, onEscape, onLeave };

  // Native enter/leave survive transitions from a host React tree into our shadow root.
  useEffect(() => {
    if (!visible) {
      setHovered(false);
      setFocused(false);
      latest.current.onLeave();
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const enter = (event: PointerEvent) => {
      if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && event.buttons === 0) {
        root.setAttribute('data-instant', 'false');
        setInstant(false);
        setHovered(true);
      }
    };
    const leave = () => {
      setHovered(false);
      latest.current.onLeave();
    };
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
    };
  }, [visible, rootRef]);

  // The shortcut and the input modality listen in capture, so they work while typing (browser- and
  // OS-reserved chords never reach a page). Escape belongs to the dock.
  useEffect(() => {
    const root = rootRef.current;
    if (!visible || !root) return;
    const onKey = (e: KeyboardEvent) => {
      root.setAttribute('data-instant', 'true');
      setInstant(true);
      const { shortcut } = latest.current;
      if (!shortcut || e.repeat || e.isComposing || !matches(e, shortcut)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      latest.current.onShortcut();
    };
    const onPointer = (e: PointerEvent) => {
      root.setAttribute('data-instant', 'false');
      setInstant(false);
      if (e.pointerType) setTouch(e.pointerType === 'touch');
    };
    // An Escape pressed in a host input or dialog is the host's; one in the dock, or with nothing focused, is ours.
    const onEscapeKey = (event: Event) => {
      const e = event as KeyboardEvent;
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const { target } = e;
      const unfocused = !(target instanceof Element) || target === document.body || target === document.documentElement;
      if (unfocused || e.composedPath().includes(root)) latest.current.onEscape();
    };
    const shadow = root.getRootNode();
    const stop = (e: Event) => e.stopPropagation();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onEscapeKey);
    if (shadow instanceof ShadowRoot) {
      // React listens on the shadow root or below it, and registered first, so its handlers still run, and so
      // do the capture listeners above. Releases still reach the page, so a host drag ending over the dock ends.
      shadow.addEventListener('keydown', onEscapeKey);
      for (const type of FENCED_EVENTS) shadow.addEventListener(type, stop);
    }
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onEscapeKey);
      if (shadow instanceof ShadowRoot) {
        shadow.removeEventListener('keydown', onEscapeKey);
        for (const type of FENCED_EVENTS) shadow.removeEventListener(type, stop);
      }
    };
  }, [visible, rootRef]);

  /** Focus anywhere in the rail keeps it unfolded for the keyboard. */
  const railFocus = useMemo(
    () => ({
      onFocus: () => setFocused(true),
      onBlur: (e: FocusEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      },
    }),
    [],
  );
  return { hovered, setHovered, focused, instant, touch, railFocus };
}
