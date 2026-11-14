import { useCallback, useEffect, useReducer, useRef } from 'react';
import { readBrowserStorage } from '../../core/browser-storage';
import type { Anchor } from './picking';
import type { Surface } from './useDockFocus';
import { isCompactViewport } from './viewport';

/** Which surfaces are open, and what the composer is doing. */
export interface Mode {
  notesOpen: boolean;
  variantsOpen: boolean;
  /** The pill shows its tools. */
  expanded: boolean;
  /** Select mode: the page's elements are pinned by clicking. */
  picking: boolean;
  /** Selecting started with the panel: its cover shows at once, so the field never shows through while the panel fades in. */
  pickingWithPanel: boolean;
  /** Set once an element is pinned: the composer leaves the dock and floats next to it. */
  anchor: Anchor | null;
}
type ModeUpdate = Partial<Mode> | ((mode: Mode) => Partial<Mode>);
export type UpdateMode = (change: ModeUpdate) => void;

export const CLOSED: Mode = {
  notesOpen: false,
  variantsOpen: false,
  expanded: false,
  picking: false,
  pickingWithPanel: false,
  anchor: null,
};

/** Apply an update, then the rules that hold between the surfaces. */
function reduceMode(mode: Mode, { update, compact }: { update: ModeUpdate; compact: boolean }): Mode {
  const next = { ...mode, ...(typeof update === 'function' ? update(mode) : update) };
  // A small screen has room for one panel: the one just opened stays.
  if (compact && next.notesOpen && next.variantsOpen) {
    if (mode.variantsOpen) next.variantsOpen = false;
    else Object.assign(next, { notesOpen: false, picking: false });
  }
  // Turning to Variants ends selecting, so the next click on the page acts on the page. Pins stay.
  if (next.variantsOpen && !mode.variantsOpen) next.picking = false;
  // The composer floats only while the feedback panel is open.
  if (!next.notesOpen) next.anchor = null;
  return (Object.keys(next) as (keyof Mode)[]).every((key) => next[key] === mode[key]) ? mode : next;
}

/** The dock's mode and a stable `update` that applies a change with the rules between surfaces. */
export function useDockMode(initial: () => Partial<Mode> = () => ({})): [Mode, UpdateMode] {
  const [mode, dispatch] = useReducer(reduceMode, undefined, () => ({ ...CLOSED, ...initial() }));
  const update = useCallback<UpdateMode>((change) => dispatch({ update: change, compact: isCompactViewport() }), []);
  return [mode, update];
}

/**
 * What a tab remembers: the panels it had open on which page, the tool opened last, and the link it
 * opened Variants with, whose unapplied `?v=` the reviewer has then read about. `doc` names the document
 * that wrote it.
 */
interface Remembered {
  notes?: boolean;
  variants?: boolean;
  last?: Surface;
  route?: string;
  doc?: number;
  link?: string;
}

function recall(key: string): Remembered {
  try {
    const value: unknown = JSON.parse(readBrowserStorage(sessionStorage, key) ?? 'null');
    return typeof value === 'object' && value !== null ? (value as Remembered) : {};
  } catch {
    return {};
  }
}

/** This document, as opposed to an earlier one in the same tab. */
const thisDocument = () => (typeof performance === 'undefined' ? 0 : performance.timeOrigin);
const reloaded = () =>
  typeof performance !== 'undefined' &&
  (performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';

/**
 * The panels open before this page was reloaded, or before the panel remounted in the same document,
 * among those it can show. A new visit, even to the same page, starts folded. A small screen reopens only
 * the one used last. Select mode and a floating composer are never restored: selecting is something the
 * reviewer starts.
 */
export function restoredMode(key: string, route: string, available: Record<Surface, boolean>): Partial<Mode> {
  const saved = recall(key);
  if (saved.route !== route || (saved.doc !== thisDocument() && !reloaded())) return {};
  const open = { notesOpen: saved.notes === true && available.notes, variantsOpen: saved.variants === true && available.variants };
  if (open.notesOpen && open.variantsOpen && isCompactViewport()) {
    if (saved.last === 'notes') open.variantsOpen = false;
    else open.notesOpen = false;
  }
  return open;
}

/**
 * Keep which panels are open in this tab (`sessionStorage`), so a reload, such as a variant switch that
 * reloads the page, comes back to the same tools. Holds the tool opened last, which the launcher reopens,
 * and the link Variants was last opened with.
 */
export function useDockMemory(key: string, route: string, { notesOpen, variantsOpen }: Pick<Mode, 'notesOpen' | 'variantsOpen'>) {
  const record = useRef<Remembered | null>(null);
  record.current ??= recall(key);
  const was = useRef<Pick<Mode, 'notesOpen' | 'variantsOpen'> | null>(null);
  useEffect(() => {
    const saved = record.current as Remembered;
    const before = was.current;
    was.current = { notesOpen, variantsOpen };
    // At mount the panels are the ones restored, which leaves the tool used last as it was.
    if (!before && !notesOpen && !variantsOpen) return;
    if (before && notesOpen && !before.notesOpen) saved.last = 'notes';
    if (before && variantsOpen && !before.variantsOpen) saved.last = 'variants';
    if (variantsOpen) saved.link = location.search;
    Object.assign(saved, { notes: notesOpen, variants: variantsOpen, route, doc: thisDocument() });
    try {
      sessionStorage.setItem(key, JSON.stringify(saved));
    } catch {
      /* Private mode or blocked storage: the dock just starts folded after a reload. */
    }
  }, [key, route, notesOpen, variantsOpen]);
  return record as { readonly current: Remembered };
}
