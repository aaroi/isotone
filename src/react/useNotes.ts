import { useCallback, useEffect, useRef, useState } from 'react';
import { createIterationStore, type IterationStoreConfig } from '../core/notes-client';
import type { IterationNote } from '../core/types';

/** How often an open page asks whether the notes changed. */
const POLL_MS = 2500;
/** The slowest retry while the server cannot be reached. */
const POLL_MAX_MS = 30_000;

/** Whether a poll changed anything the panel draws, without a deep diff. */
function sameNotes(a: IterationNote[], b: IterationNote[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((note) => [note.id, note]));
  return b.every((note) => {
    const old = byId.get(note.id);
    return old !== undefined && JSON.stringify(old) === JSON.stringify(note);
  });
}

const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

/**
 * The notes list and its server: loads on demand, polls while visible, and
 * guards optimistic writes so an older response never restores a deleted note
 * or undoes an edit. `write` wraps one optimistic change and its request.
 */
export function useNotes(config: IterationStoreConfig, visible: boolean) {
  const [store] = useState(() => createIterationStore(config));
  const available = Boolean(config.endpoint);
  const [notes, setNotes] = useState<IterationNote[]>([]);
  // Coarse on purpose: the value only ages out stale claims, and an unchanged minute lets React skip the render.
  const [clock, setClock] = useState(minute);
  const pollRev = useRef<string | null>(null);
  const revision = useRef(0);
  const pending = useRef(0);
  const request = useRef(0);

  const load = useCallback(() => {
    if (!available) return;
    const asked = ++request.current;
    const at = revision.current;
    void store
      .pollNotes(null)
      .then((result) => ({ rev: result.rev, notes: result.notes ?? [] }))
      // Server away: show what this browser kept, if anything.
      .catch(() => store.pendingNotes().then((fresh) => ({ rev: null, notes: fresh })))
      .then(({ rev, notes: fresh }) => {
        // An old refresh must not restore deleted notes or undo optimistic edits.
        if (asked !== request.current || at !== revision.current || pending.current) return;
        pollRev.current = rev;
        setNotes(fresh);
      })
      .catch(() => {});
  }, [available, store]);

  /** Run one optimistic change; polls and loads that started before it are ignored. */
  const write = useCallback(async <T>(run: () => Promise<T>): Promise<T> => {
    revision.current++;
    pending.current++;
    try {
      return await run();
    } finally {
      revision.current++;
      pending.current--;
    }
  }, []);

  // Keep the list current while the page is in front: an agent closing a note
  // shows up here without a reload. Only the notes request is repeated, so
  // nothing on the page, the composer or an edit in progress is touched. An
  // idle poll costs the server one stat; a hidden tab does not poll at all;
  // an unreachable server is retried less and less often.
  useEffect(() => {
    if (!available || !visible) return;
    let stopped = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (stopped || document.hidden) return;
      timer = setTimeout(() => void tick(), Math.min(POLL_MS * 2 ** failures, POLL_MAX_MS));
    };
    const tick = async () => {
      if (stopped || running || document.hidden) return;
      running = true;
      const asked = request.current;
      const at = revision.current;
      try {
        const result = await store.pollNotes(pollRev.current);
        failures = 0;
        // A local save, delete or reload while the request was out wins over it.
        if (stopped || asked !== request.current || at !== revision.current || pending.current) return;
        pollRev.current = result.rev;
        const fresh = result.notes;
        if (fresh) setNotes((prev) => (sameNotes(prev, fresh) ? prev : fresh));
        setClock(minute());
      } catch {
        failures = Math.min(failures + 1, 8);
      } finally {
        running = false;
        schedule();
      }
    };
    const wake = () => {
      if (document.hidden) {
        clearTimeout(timer);
        return;
      }
      failures = 0;
      void tick();
    };
    schedule();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [available, visible, store]);

  return { store, available, notes, setNotes, clock, load, write };
}
