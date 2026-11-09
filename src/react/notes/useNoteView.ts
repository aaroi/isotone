import { useCallback, useMemo, useRef, useState } from 'react';
import { awaitsCheck } from '../../core/resolution';
import { normalizeRoute } from '../../core/routes';
import type { IsotoneNote } from '../../core/types';

/** How long "an agent is working on this" is believed without a sign of life. */
const WORKING_FRESH_MS = 20 * 60 * 1000;

/** When a note last changed hands: closed by the agent, else written by the reviewer. */
const handedOver = (note: IsotoneNote): string => (note.done && note.doneAt ? note.doneAt : note.createdAt);

/** The notes the feedback panel lists, and the page filter above them. */
export interface NoteView {
  /** Pages with notes listed and how many, this page first. */
  pages: { counts: Map<string, number>; others: string[] };
  selectedPages: ReadonlySet<string>;
  /** The notes on the selected pages, open and closed ones to check, by when each last changed hands. */
  notes: IsotoneNote[];
  /** How many of those are open: the launcher's count. */
  open: number;
  /** Closed notes on every page that the reviewer has yet to check. */
  toCheck: number;
  /** Notes an agent is working on now. */
  working: ReadonlySet<string>;
  togglePage: (page: string) => void;
}

/**
 * What the panel derives from the notes list. `clock` (a coarse minute) ages
 * out an agent's claim: a crashed or abandoned run should not pulse forever.
 */
export function useNoteView(all: IsotoneNote[], route: string, clock: number) {
  // Which pages' notes the list shows. Unset means this page only.
  const [scope, setScope] = useState<string[] | null>(null);
  const open = useMemo(() => all.filter((n) => !n.done), [all]);
  // The minute clock also ages out a closed note's wait for its check.
  const listed = useMemo(() => all.filter((n) => !n.done || awaitsCheck(n, clock)), [all, clock]);
  // Pages that have notes to list, this one first, so the row of page chips reads the same on every page.
  const pages = useMemo(() => {
    const counts = new Map<string, number>();
    // The update note belongs to the project, not a page: it shows everywhere.
    for (const n of listed) {
      const page = normalizeRoute(n.route);
      if (!n.update) counts.set(page, (counts.get(page) ?? 0) + 1);
    }
    const others = [...counts.keys()].filter((r) => r !== route).sort();
    return { counts, others };
  }, [listed, route]);
  const selectedPages = useMemo(() => {
    const chosen = (scope ?? [route]).filter((r) => r === route || pages.counts.has(r));
    return new Set(chosen.length ? chosen : [route]);
  }, [scope, route, pages]);
  // By when each last changed hands: written, or closed by the agent. A note the agent has just closed
  // arrives at the foot of the list, beside the composer, where the reviewer is looking.
  const notes = useMemo(
    () =>
      listed
        .filter((n) => n.update || selectedPages.has(normalizeRoute(n.route)))
        .sort((a, b) => handedOver(a).localeCompare(handedOver(b)) || a.createdAt.localeCompare(b.createdAt)),
    [listed, selectedPages],
  );
  const shownOpen = useMemo(() => notes.filter((n) => !n.done).length, [notes]);
  const toCheck = listed.length - open.length;
  const working = useMemo(
    () => new Set(notes.filter((n) => n.workingAt && clock - Date.parse(n.workingAt) < WORKING_FRESH_MS).map((n) => n.id)),
    [notes, clock],
  );
  const selected = useRef(selectedPages);
  selected.current = selectedPages;
  const togglePage = useCallback(
    (page: string) => {
      const next = new Set(selected.current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      setScope(next.size ? [...next] : [route]);
    },
    [route],
  );
  const view = useMemo<NoteView>(
    () => ({ pages, selectedPages, notes, open: shownOpen, toCheck, working, togglePage }),
    [pages, selectedPages, notes, shownOpen, toCheck, working, togglePage],
  );
  return {
    view,
    /** The reviewer asked for an Isotone update and it is still open. */
    updateRequested: useMemo(() => open.some((n) => n.update), [open]),
    /** Removal requests this page is waiting on, so their options show as pending. */
    pendingActions: useMemo(
      () => open.flatMap((n) => (normalizeRoute(n.route) === route && n.variantAction ? [n.variantAction] : [])),
      [open, route],
    ),
  };
}
