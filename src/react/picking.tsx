import { type Dispatch, type RefObject, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeIsotoneElement, elementAsNode, resolveElementSource } from '../core/element';
import type { IsotoneElement } from '../core/types';
import type { DockFocus } from './useDockFocus';
import type { Mode, UpdateMode } from './useDockMode';
import { useFloatingComposer } from './useFloatingComposer';

/**
 * Where the composer floats while writing about pinned elements: the point
 * that was clicked, kept relative to its element so it follows scrolling.
 * x and y are the last known viewport point, for when the element is gone.
 */
export interface Anchor {
  selector: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
  /** Pinned by touch: open beside the element, since a finger hides the point. */
  beside?: boolean;
}

/** What select mode needs from the panel, read when an event arrives. */
interface PickerContext {
  picking: boolean;
  rootRef: RefObject<HTMLElement | null>;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  targets: IsotoneElement[];
  setTargets: Dispatch<SetStateAction<IsotoneElement[]>>;
  anchored: boolean;
  touch: boolean;
  /** Pinned an element: the composer floats next to it. `slot` is the docked composer's height, measured before it leaves. */
  onPin: (anchor: Anchor, slot: number | null) => void;
  /** Typing, Enter or Escape ends selecting; Escape also drops the pins. */
  onFinish: (how: 'typing' | 'enter' | 'escape') => void;
}

const MAX_PINS = 50;

const isPanelElement = (node: EventTarget | null) => node instanceof Element && Boolean(node.closest('[data-isotone]'));

/**
 * Select mode: a crosshair over the page, where a click or Space pins the
 * element under it. Presses on the page are swallowed so a host menu does not
 * open or take focus from the pin; Shift passes everything through, so the
 * page can still open menus and tabs first.
 */
function usePicker(context: PickerContext) {
  const latest = useRef(context);
  latest.current = context;
  // The elements clicked, by selector. A re-render can shift a path onto a
  // different element, and the highlight has to stay on the one that was picked.
  const pinned = useRef(new Map<string, Element>());
  const locate = useCallback((selector: string): Element | null => {
    const element = pinned.current.get(selector);
    if (element?.isConnected) return element;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    const kept = new Set(context.targets.map((t) => t.selector));
    for (const selector of pinned.current.keys()) if (!kept.has(selector)) pinned.current.delete(selector);
  }, [context.targets]);

  const { picking } = context;
  useEffect(() => {
    if (!picking) return;
    const cursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    const elementAt = (e: MouseEvent) => {
      const el =
        e.detail === 0 && e.type === 'click'
          ? e.composedPath().find((node): node is Element => node instanceof Element)
          : document.elementFromPoint(e.clientX, e.clientY);
      return el && !el.closest('[data-isotone]') ? el : null;
    };
    const toggleTarget = (el: Element) => {
      const target = describeIsotoneElement(elementAsNode(el));
      pinned.current.set(target.selector, el);
      const { targets, setTargets } = latest.current;
      const added = !targets.some((t) => t.selector === target.selector);
      setTargets((prev) =>
        prev.some((t) => t.selector === target.selector)
          ? prev.filter((t) => t.selector !== target.selector)
          : prev.length < MAX_PINS
            ? [...prev, target]
            : prev,
      );
      // React 19 records the transformed line; its source map names the line in the file.
      if (added && target.source)
        void resolveElementSource(el).then((source) => {
          if (source && source !== target.source)
            latest.current.setTargets((prev) => prev.map((t) => (t.selector === target.selector ? { ...t, source } : t)));
        });
      return added ? target : null;
    };
    // A press on the page must not reach it: menu and popover triggers open on
    // pointerdown, and mousedown moves focus and starts text selection. A
    // touchstart is only stopped, since cancelling it would cancel the tap.
    const onPress = (e: Event) => {
      if ((e as MouseEvent).shiftKey || isPanelElement(e.target) || e.target === document.documentElement) return;
      if (e.type !== 'touchstart') e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onClick = (e: MouseEvent) => {
      // Shift passes the click through so the page can open menus and tabs first.
      if (e.shiftKey) return;
      const el = elementAt(e);
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const added = toggleTarget(el);
      // The composer comes to the element that was just pinned, ready for typing.
      if (!added) return;
      const r = el.getBoundingClientRect();
      const pointed = e.detail > 0 || e.clientX !== 0 || e.clientY !== 0;
      const x = pointed ? e.clientX : r.left;
      const y = pointed ? e.clientY : r.bottom;
      const { anchored, rootRef, touch, onPin } = latest.current;
      const slot = anchored
        ? null
        : (rootRef.current?.querySelector<HTMLElement>('.isotone-notes-panel .isotone-input')?.offsetHeight ?? 0);
      onPin({ selector: added.selector, dx: x - r.left, dy: y - r.top, x, y, beside: touch && pointed }, slot);
    };
    const onKey = (e: KeyboardEvent) => {
      const { fieldRef, anchored, onFinish } = latest.current;
      if (e.key === ' ') {
        const el = e.composedPath().find((node): node is Element => node instanceof Element);
        if (!el || el === document.body || el.closest('[data-isotone], input, textarea, select, [contenteditable]')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) toggleTarget(el);
        return;
      }
      // The composer is covered while selecting. Typing a character finishes
      // selecting and lands in the composer, unless the page has an input focused.
      const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing;
      if (typing) {
        const el = e.composedPath().find((node): node is Element => node instanceof Element);
        if (el && !el.closest('[data-isotone]') && el.closest('input, textarea, select, [contenteditable]')) return;
        onFinish('typing');
        fieldRef.current?.focus();
        return;
      }
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      // The floating composer is not covered, so Enter there sends what is written.
      const field = fieldRef.current;
      if (e.key === 'Enter' && anchored && field && !e.shiftKey && field.value.trim() && e.composedPath().includes(field)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Enter keeps what was pinned. Escape cancels the selection: the pins go,
      // what was written stays, and the composer returns to the dock.
      onFinish(e.key === 'Escape' ? 'escape' : 'enter');
    };
    const presses = ['pointerdown', 'mousedown', 'touchstart'];
    for (const type of presses) window.addEventListener(type, onPress, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.cursor = cursor;
      for (const type of presses) window.removeEventListener(type, onPress, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [picking]);

  return locate;
}

type Box = { top: number; left: number; width: number; height: number };

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

interface SelectModeOptions {
  mode: Mode;
  update: UpdateMode;
  focus: DockFocus;
  rootRef: RefObject<HTMLElement | null>;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  floatRef: RefObject<HTMLDivElement | null>;
  targets: IsotoneElement[];
  setTargets: Dispatch<SetStateAction<IsotoneElement[]>>;
  touch: boolean;
}

/**
 * Select mode in the dock: pins float the composer beside the element, the
 * composer's own controls start and end selecting, and focus follows.
 */
export function useSelectMode({ mode, update, focus, rootRef, fieldRef, floatRef, targets, setTargets, touch }: SelectModeOptions) {
  // The dock keeps the composer's height while it floats, so the panel stays put.
  const slotHeight = useRef(0);
  const locate = usePicker({
    picking: mode.picking,
    rootRef,
    fieldRef,
    targets,
    setTargets,
    anchored: mode.anchor !== null,
    touch,
    onPin: (pin, slot) => {
      if (slot !== null) slotHeight.current = slot;
      update({ anchor: pin, notesOpen: true });
      focus.composerWhilePicking();
    },
    onFinish: (how) => {
      if (how === 'escape') setTargets([]);
      update({ picking: false, notesOpen: true, ...(how === 'escape' ? { anchor: null } : {}) });
      if (how === 'typing') fieldRef.current?.focus();
      else focus.composer();
    },
  });
  useFloatingComposer(floatRef, rootRef, mode.anchor, locate);
  /** Stop selecting and write: the composer keeps what was pinned. */
  const done = useCallback(() => {
    update({ picking: false });
    focus.composer();
  }, [update, focus]);
  /** The composer's handlers for select mode. */
  const controls = useMemo(
    () => ({
      onFieldFocus: () => {
        if (!focus.pinning()) update({ picking: false });
      },
      onFieldPointerDown: () => update({ picking: false }),
      onTogglePicking: () => {
        focus.cancel();
        update((m) => ({ picking: !m.picking, pickingWithPanel: false }));
      },
      onDonePicking: done,
    }),
    [update, focus, done],
  );
  return { locate, slotHeight, done, controls };
}

/**
 * Outlines for the element under the pointer and the pinned ones. The hover
 * box is positioned directly, so moving the pointer re-renders nothing; pins
 * follow scrolling, resizing and their own layout changes.
 */
export function PickOverlay({
  picking,
  targets,
  locate,
}: {
  picking: boolean;
  targets: IsotoneElement[];
  locate: (selector: string) => Element | null;
}) {
  const hoverRef = useRef<HTMLDivElement>(null);
  const [pins, setPins] = useState<(Box & { selector: string })[]>([]);

  useEffect(() => {
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      setPins(
        targets.flatMap((t) => {
          const el = locate(t.selector);
          return el ? [{ ...boxOf(el), selector: t.selector }] : [];
        }),
      );
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(update);
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    for (const t of targets) {
      const el = locate(t.selector);
      if (el) observer?.observe(el);
    }
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [targets, locate]);

  // Only a hovering pointer previews; a finger has nothing to preview before it taps.
  useEffect(() => {
    const box = hoverRef.current;
    if (!picking || !box) return;
    let frame = 0;
    let point: { x: number; y: number } | null = null;
    const draw = () => {
      frame = 0;
      const el = point && document.elementFromPoint(point.x, point.y);
      if (!el || el.closest('[data-isotone]')) {
        box.hidden = true;
        return;
      }
      const r = boxOf(el);
      Object.assign(box.style, { top: `${r.top}px`, left: `${r.left}px`, width: `${r.width}px`, height: `${r.height}px` });
      box.hidden = false;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      // Shift hands the pointer to the page: no preview.
      point = e.shiftKey ? null : { x: e.clientX, y: e.clientY };
      frame ||= requestAnimationFrame(draw);
    };
    // Scrolling moves the page under a still pointer.
    const onScroll = () => {
      if (point) frame ||= requestAnimationFrame(draw);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      box.hidden = true;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [picking]);

  return (
    <>
      {pins.map((pin) => (
        <div
          key={pin.selector}
          data-isotone
          className="isotone-hover isotone-selected"
          style={{ top: pin.top, left: pin.left, width: pin.width, height: pin.height }}
        />
      ))}
      <div ref={hoverRef} data-isotone className="isotone-hover" hidden />
    </>
  );
}
