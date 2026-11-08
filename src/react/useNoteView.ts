import { useCallback, useMemo, useRef, useState } from 'react';
import { normalizeRoute } from '../core/routes';
import type { IterationNote } from '../core/types';

/** How long "an agent is working on this" is believed without a sign of life. */
const WORKING_FRESH_MS = 20 * 60 * 1000;

/** The notes the feedback panel lists, and the page filter above them. */
export interface NoteView {
  /** Pages with open notes and how many, this page first. */
  pages: { counts: Map<string, number>; others: string[] };
  selectedPages: ReadonlySet<string>;
  /** Open notes on the selected pages, oldest first. */
  notes: IterationNote[];
  /** Notes an agent is working on now. */
  working: ReadonlySet<string>;
  togglePage: (page: string) => void;
}

/**
 * What the panel derives from the notes list. `clock` (a coarse minute) ages
 * out an agent's claim: a crashed or abandoned run should not pulse forever.
 */
export function useNoteView(all: IterationNote[], route: string, clock: number) {
  // Which pages' notes the list shows. Unset means this page only.
  const [scope, setScope] = useState<string[] | null>(null);
  const open = useMemo(() => all.filter((n) => !n.done), [all]);
  // Pages that have open notes, this one first, so the row of page chips reads the same on every page.
  const pages = useMemo(() => {
    const counts = new Map<string, number>();
    // The update note belongs to the project, not a page: it shows everywhere.
    for (const n of open) {
      const page = normalizeRoute(n.route);
      if (!n.update) counts.set(page, (counts.get(page) ?? 0) + 1);
    }
    const others = [...counts.keys()].filter((r) => r !== route).sort();
    return { counts, others };
  }, [open, route]);
  const selectedPages = useMemo(() => {
    const chosen = (scope ?? [route]).filter((r) => r === route || pages.counts.has(r));
    return new Set(chosen.length ? chosen : [route]);
  }, [scope, route, pages]);
  const notes = useMemo(
    () => open.filter((n) => n.update || selectedPages.has(normalizeRoute(n.route))).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [open, selectedPages],
  );
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
    () => ({ pages, selectedPages, notes, working, togglePage }),
    [pages, selectedPages, notes, working, togglePage],
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
