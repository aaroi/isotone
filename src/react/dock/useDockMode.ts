import { useCallback, useReducer } from 'react';
import type { Anchor } from './picking';
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
  // The composer floats only while the feedback panel is open.
  if (!next.notesOpen) next.anchor = null;
  return (Object.keys(next) as (keyof Mode)[]).every((key) => next[key] === mode[key]) ? mode : next;
}

/** The dock's mode and a stable `update` that applies a change with the rules between surfaces. */
export function useDockMode(): [Mode, UpdateMode] {
  const [mode, dispatch] = useReducer(reduceMode, CLOSED);
  const update = useCallback<UpdateMode>((change) => dispatch({ update: change, compact: isCompactViewport() }), []);
  return [mode, update];
}
