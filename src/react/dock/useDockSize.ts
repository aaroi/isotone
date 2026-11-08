import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { readBrowserStorage } from '../../core/browser-storage';

type Panel = 'variants' | 'notes';
type Handle = 'width' | Panel;
/** Panel heights are max-heights in px; the width is the dock's. */
type DockSize = { width?: number; variants?: number; notes?: number };
type Open = Record<Panel, boolean>;
interface Extent {
  now: number;
  min: number;
  max: number;
}
interface Measured {
  height: number;
  content: number;
  min: number;
}
interface Frame {
  room: number;
  gap: number;
  panels: Partial<Record<Panel, Measured>>;
}

const MIN_WIDTH = 280;
/** The least of a panel's scrolling body worth showing, on top of its own header and composer. */
const MIN_BODY: Record<Panel, number> = { variants: 112, notes: 72 };
const INSET = 32;
const STEP = 16;
const DEFAULT_WIDTH = 340;
const PANELS: Panel[] = ['variants', 'notes'];
const LABEL: Record<Handle, string> = { width: 'Resize panel width', variants: 'Resize variants height', notes: 'Resize feedback height' };

const maxWidth = () => window.innerWidth - INSET;
const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max));
const px = (value: string, fallback = 0) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};

function load(key: string): DockSize {
  try {
    const parsed: unknown = JSON.parse(readBrowserStorage(localStorage, key) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null) return {};
    const valid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
    const record = parsed as Record<string, unknown>;
    // The first release stored one dock-wide `height`; it has no per-panel meaning and is dropped on the next save.
    return Object.fromEntries((['width', ...PANELS] as const).filter((name) => valid(record[name])).map((name) => [name, record[name]]));
  } catch {
    return {};
  }
}

function save(key: string, size: DockSize) {
  try {
    localStorage.setItem(key, JSON.stringify(size));
  } catch {
    /* Quota or access restrictions only cost persistence. */
  }
}

/** What each open panel is now, and how tall it would be with nothing scrolling. */
function measure(root: HTMLElement, open: Open): Frame {
  const style = getComputedStyle(root);
  const panels: Frame['panels'] = {};
  for (const name of PANELS) {
    const element = open[name] ? root.querySelector<HTMLElement>(`.isotone-${name}-panel`) : null;
    if (!element) continue;
    const height = Math.round(element.getBoundingClientRect().height);
    let hidden = 0;
    let body = 0;
    for (const scroller of element.querySelectorAll<HTMLElement>('.isotone-vars-body, .isotone-list')) {
      hidden += Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      body += scroller.clientHeight;
    }
    const content = height + Math.ceil(hidden);
    // Below the fixed parts plus a little body, the panel's own content would spill out of its border.
    panels[name] = { height, content, min: Math.min(content, height - body + MIN_BODY[name]) };
  }
  // The root's max-height is the 1.2.0 view height minus its margin; its bottom padding is the rail.
  return {
    room: px(style.maxHeight, window.innerHeight - INSET) - px(style.paddingBottom),
    gap: panels.variants && panels.notes ? px(style.rowGap) : 0,
    panels,
  };
}

/**
 * The range a panel's top edge can take. Past its content a panel cannot grow, so the range ends there.
 * With both panels open the edge of the lower one is the split: it can grow until the upper one is at its minimum.
 */
function extent(panel: Panel, frame: Frame): Extent {
  const own = frame.panels[panel] as Measured;
  const other = frame.panels[panel === 'variants' ? 'notes' : 'variants'];
  const reserved = other ? (panel === 'notes' ? other.min : other.height) + frame.gap : 0;
  const max = Math.max(own.min, Math.min(own.content, frame.room - reserved));
  return { now: clamp(own.height, own.min, max), min: own.min, max };
}

/** The heights to store for a panel edge dragged to `target`; a split also gives its height to the upper panel. */
function resize(panel: Panel, target: number, frame: Frame): DockSize {
  const { min, max } = extent(panel, frame);
  const next = clamp(target, min, max);
  const above = frame.panels.variants;
  if (panel !== 'notes' || !above) return { [panel]: next };
  const grown = next - (frame.panels.notes as Measured).height;
  return { notes: next, variants: clamp(above.height - grown, above.min, above.content) };
}

/** The reviewer's dock size: CSS variables for the root and props for its three handles. */
export function useDockSize(rootRef: RefObject<HTMLElement | null>, key: string, open: Open) {
  const [size, setSize] = useState<DockSize>({});
  const [extents, setExtents] = useState<Partial<Record<Panel, Extent>>>({});
  const latest = useRef(size);
  const drag = useRef<{ handle: Handle; origin: number; frame: Frame } | null>(null);
  const split = open.variants && open.notes;

  const apply = useCallback(
    (next: DockSize, persist: boolean) => {
      latest.current = next;
      setSize(next);
      if (persist) save(key, next);
    },
    [key],
  );
  const reset = (handle: Handle) => {
    const next = { ...latest.current };
    for (const name of handle === 'notes' && split ? PANELS : [handle]) delete next[name];
    apply(next, true);
  };
  const stop = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    rootRef.current?.removeAttribute('data-resizing');
    save(key, latest.current);
  }, [key, rootRef]);

  useEffect(() => {
    apply(load(key), false);
  }, [key, apply]);
  // A handle that unmounts or changes role mid-drag never sees pointerup.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a panel opening or closing changes every handle's role.
  useEffect(() => stop, [open.variants, open.notes, stop]);
  // The handles announce what a panel can reach. That changes when a panel opens or closes, a size is
  // set, or the dock resizes; content changes are picked up when a handle is about to be used.
  const latestOpen = useRef(open);
  latestOpen.current = open;
  const refresh = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const frame = measure(root, latestOpen.current);
    const next = Object.fromEntries(PANELS.filter((name) => frame.panels[name]).map((name) => [name, extent(name, frame)]));
    setExtents((previous) => (JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
  }, [rootRef]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the changes that move a handle's range.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || (!open.variants && !open.notes)) {
      setExtents((previous) => (Object.keys(previous).length ? {} : previous));
      return;
    }
    // The observer's first report comes after the browser's own layout; measuring here would force that
    // layout synchronously, which is most of what opening a long Variants list costs.
    if (typeof ResizeObserver === 'undefined') return refresh();
    const observer = new ResizeObserver(refresh);
    for (const panel of root.querySelectorAll('.isotone-panel')) observer.observe(panel);
    return () => observer.disconnect();
  }, [open.variants, open.notes, size, refresh, rootRef]);

  const vars: Record<string, string> = {};
  if (size.width) vars['--iso-width'] = `min(${size.width}px, calc(100vw - ${INSET}px))`;
  for (const name of PANELS) if (size[name]) vars[`--iso-${name}-height`] = `${size[name]}px`;
  const root = {
    style: vars as CSSProperties,
    'data-sized-notes': size.notes !== undefined,
  };

  const handle = (name: Handle) => {
    const horizontal = name !== 'width';
    const range: Extent = horizontal
      ? (extents[name] ?? { now: 0, min: 0, max: 0 })
      : { now: size.width ?? Math.min(DEFAULT_WIDTH, maxWidth()), min: MIN_WIDTH, max: maxWidth() };
    const edit = (target: number, frame: Frame | null, persist: boolean) => {
      apply(
        { ...latest.current, ...(horizontal ? resize(name, target, frame as Frame) : { width: clamp(target, MIN_WIDTH, maxWidth()) }) },
        persist,
      );
    };
    return {
      className:
        name === 'width'
          ? 'isotone-resize isotone-resize-w'
          : `isotone-resize isotone-resize-h${name === 'notes' && split ? ' isotone-resize-split' : ''}`,
      role: 'separator' as const,
      'aria-orientation': horizontal ? ('horizontal' as const) : ('vertical' as const),
      'aria-label': name === 'notes' && split ? 'Resize variants and feedback split' : LABEL[name],
      'aria-valuenow': range.now,
      'aria-valuemin': range.min,
      'aria-valuemax': range.max,
      tabIndex: 0,
      onFocus: refresh,
      onPointerEnter: refresh,
      onPointerDown(event: PointerEvent<HTMLElement>) {
        const dock = rootRef.current;
        if (!dock || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const frame = measure(dock, open);
        // The size is `origin` minus the pointer, so it needs no per-move delta.
        const origin = horizontal ? (frame.panels[name] as Measured).height + event.clientY : dock.getBoundingClientRect().right;
        drag.current = { handle: name, frame, origin };
        // Sizes and panel positions must track the pointer, not animate toward it.
        dock.setAttribute('data-resizing', 'true');
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const current = drag.current;
        if (!current || current.handle !== name) return;
        // Moving a top edge up grows the panel below it; moving the left edge left grows the dock.
        edit(current.origin - (horizontal ? event.clientY : event.clientX), current.frame, false);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (event.key === 'Home') {
          event.preventDefault();
          reset(name);
          return;
        }
        const grow = horizontal ? 'ArrowUp' : 'ArrowLeft';
        const shrink = horizontal ? 'ArrowDown' : 'ArrowRight';
        if (event.key !== grow && event.key !== shrink) return;
        event.preventDefault();
        const frame = horizontal && rootRef.current ? measure(rootRef.current, open) : null;
        const now = horizontal && frame ? extent(name, frame).now : range.now;
        edit(now + STEP * (event.shiftKey ? 4 : 1) * (event.key === grow ? 1 : -1), frame, true);
      },
      onDoubleClick() {
        reset(name);
      },
    };
  };

  return { root, handle };
}
