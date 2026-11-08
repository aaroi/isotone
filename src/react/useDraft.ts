import { useEffect, useRef } from 'react';
import { readBrowserStorage } from '../core/browser-storage';
import type { IsotoneElement, IsotoneNote, VariantReference } from '../core/types';

/**
 * The composer's text, outside React state: typing re-renders the composer
 * alone, and the panel reads the text only when it sends, edits or saves a draft.
 */
export interface DraftText {
  get(): string;
  set(value: string): void;
  subscribe(listener: () => void): () => void;
}

export function createDraftText(): DraftText {
  let value = '';
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** How long typing settles before the draft is written to storage. */
const DRAFT_SAVE_MS = 300;

interface Draft {
  targets: IsotoneElement[];
  variantTarget: VariantReference | null;
  /** A note being edited is not a draft: nothing is saved meanwhile. */
  editing: IsotoneNote | null;
}

function writeDraft(key: string, value: string, { editing, targets, variantTarget }: Draft): void {
  if (editing) return;
  try {
    if (!value && targets.length === 0 && !variantTarget) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ text: value, elements: targets, variant: variantTarget }));
  } catch {}
}

/**
 * The unsent feedback for one page, kept in `localStorage` under `key`. A new
 * key (another route) restores its draft through `text` and `restore`. Typing
 * is saved once it settles, references at once. A pending save is written
 * when the route changes, the panel unmounts or the page is hidden or
 * unloaded, so a reload (Vite's full reload after a variant switch, too)
 * keeps the last keystrokes.
 */
export function useDraft(
  key: string,
  text: DraftText,
  current: Draft,
  restore: (targets: IsotoneElement[], variantTarget: VariantReference | null) => void,
): void {
  const latest = useRef({ current, restore });
  latest.current = { current, restore };
  const restored = useRef('');
  const restoring = useRef(false);

  useEffect(() => {
    if (restored.current === key) return;
    restored.current = key;
    restoring.current = true;
    let draft: { text?: unknown; elements?: unknown; variant?: VariantReference } = {};
    try {
      const raw = readBrowserStorage(localStorage, key);
      try {
        draft = raw ? JSON.parse(raw) : {};
        if (!draft || typeof draft.text !== 'string') draft = { text: raw };
      } catch {
        draft = { text: raw };
      }
    } catch {}
    text.set(typeof draft.text === 'string' ? draft.text : '');
    latest.current.restore(Array.isArray(draft.elements) ? draft.elements : [], draft.variant ?? null);
  }, [key, text]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      if (restored.current === key) writeDraft(key, text.get(), latest.current.current);
    };
    const onHide = (event: Event) => {
      if (event.type === 'pagehide' || document.visibilityState === 'hidden') flush();
    };
    const off = text.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(flush, DRAFT_SAVE_MS);
    });
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      off();
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [key, text]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: references and edits save at once.
  useEffect(() => {
    // Restoration commits after this effect pass; never save the previous route's references over it.
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    if (restored.current === key) writeDraft(key, text.get(), current);
  }, [current.targets, current.variantTarget, current.editing, key]);
}
