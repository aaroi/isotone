import { type Dispatch, type SetStateAction, useCallback, useMemo, useRef, useState } from 'react';
import { createNoteId } from '../../core/id';
import { MAX_FEEDBACK_LENGTH } from '../../core/limits';
import type { IsotoneElement, IsotoneNote, VariantReference } from '../../core/types';
import type { VariantAction } from '../../core/variants';
import type { UpdateMode } from '../dock/useDockMode';
import { createDraftText, type DraftText, useDraft } from './useDraft';
import type { useNotes } from './useNotes';

type Notes = ReturnType<typeof useNotes>;

interface NoteActionsOptions {
  route: string;
  /** Where this page's unsent draft is kept. */
  draftKey: string;
  store: Notes['store'];
  write: Notes['write'];
  setNotes: Dispatch<SetStateAction<IsotoneNote[]>>;
  getPayload?: () => unknown;
  update: UpdateMode;
  focusComposer: () => void;
}

/** What the composer shows, besides its text: one object that changes only when one of these does. */
export interface ComposerDraft {
  text: DraftText;
  editing: IsotoneNote | null;
  variantTarget: VariantReference | null;
  targets: IsotoneElement[];
  notice: string;
}

function removalText(action: VariantAction, reference: VariantReference): string {
  if (action.action === 'remove-option') return `Remove “${reference.optionLabel}” from ${reference.label}.`;
  if (action.action === 'keep-option')
    return `Keep only “${reference.optionLabel}” for ${reference.label}; make it the default and remove the selector and the other options.`;
  if (action.action === 'keep-default') return `Keep only the default for ${reference.label}; remove its selector and alternatives.`;
  return `Remove ${reference.label}, its selector and all alternatives.`;
}

/** A note this reviewer just sent, shown before the server has saved it. */
export const isUnsent = (note: IsotoneNote) => note.id.startsWith(UNSENT);
const UNSENT = 'pending-';

/**
 * The note being written and the requests that save, edit and remove notes.
 * Saves are optimistic: the list shows a note at once under a temporary id and
 * puts things back if the server refuses. Editing or deleting a note whose
 * save is still in flight waits for its real id.
 */
export function useNoteActions({ route, draftKey, store, write, setNotes, getPayload, update, focusComposer }: NoteActionsOptions) {
  const [text] = useState(createDraftText);
  const [targets, setTargets] = useState<IsotoneElement[]>([]);
  const [variantTarget, setVariantTarget] = useState<VariantReference | null>(null);
  const [editing, setEditing] = useState<IsotoneNote | null>(null);
  const [notice, setNotice] = useState('');
  // Handlers read the current render here, so they stay stable and memoized children skip unrelated renders.
  const latest = useRef({ route, getPayload, targets, variantTarget, editing });
  latest.current = { route, getPayload, targets, variantTarget, editing };
  /** Saves in flight, by the temporary id of their optimistic note. */
  const saving = useRef(new Map<string, Promise<string>>());

  const cancelEdit = useCallback(() => {
    setEditing(null);
    text.set('');
    setTargets([]);
    setVariantTarget(null);
  }, [text]);

  const send = useCallback(() => {
    const value = text.get().trim();
    if (!value) return;
    if (value.length > MAX_FEEDBACK_LENGTH) {
      setNotice(`Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
      return;
    }
    const { editing: previous, targets, variantTarget, route, getPayload } = latest.current;
    const context = {
      elements: targets,
      variant: variantTarget,
      ...(previous?.variantAction ? { variantAction: previous.variantAction } : {}),
    };
    const noteRoute = previous?.route ?? route;
    const element = targets[0] ?? null;
    const tempId = previous?.id ?? `${UNSENT}${createNoteId()}`;
    const entry: IsotoneNote = {
      ...(previous ?? {}),
      id: tempId,
      route: noteRoute,
      feedback: value,
      element,
      ...context,
      done: false,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
    };
    const payload = previous ? undefined : getPayload?.();
    void write(async () => {
      setNotes((prev) => (previous ? prev.map((n) => (n.id === tempId ? entry : n)) : [...prev, entry]));
      cancelEdit();
      setNotice('');
      update({ picking: false, anchor: null });
      focusComposer();
      const viewport = { w: innerWidth, h: innerHeight };
      const saved = (previous ? (saving.current.get(previous.id) ?? Promise.resolve(previous.id)) : Promise.resolve(null)).then((id) =>
        store.saveNote(noteRoute, value, element, id, payload, viewport, context),
      );
      if (!previous) saving.current.set(tempId, saved);
      try {
        const id = await saved;
        setNotes((prev) => prev.map((n) => (n.id === tempId ? { ...n, id } : n)));
        // An edit begun meanwhile holds the temporary id; it now edits the saved note.
        if (!previous) setEditing((current) => (current?.id === tempId ? { ...current, id } : current));
      } catch {
        setNotes((prev) => (previous ? prev.map((n) => (n.id === tempId ? previous : n)) : prev.filter((n) => n.id !== tempId)));
        text.set(value);
        setTargets(context.elements);
        setVariantTarget(context.variant);
        setEditing(previous);
        setNotice('Could not save. Your feedback is still here.');
      } finally {
        // Kept a moment past the save, for an edit or delete that read the temporary id meanwhile.
        if (!previous) setTimeout(() => saving.current.delete(tempId), 0);
      }
    });
  }, [text, store, write, setNotes, cancelEdit, update, focusComposer]);

  const beginEdit = useCallback(
    (note: IsotoneNote) => {
      update({ anchor: null });
      setEditing(note);
      text.set(note.feedback);
      setTargets(note.elements ?? (note.element ? [note.element] : []));
      setVariantTarget(note.variant ?? null);
      focusComposer();
    },
    [update, text, focusComposer],
  );

  const removeNote = useCallback(
    (note: IsotoneNote) => {
      void write(async () => {
        setNotes((prev) => prev.filter((n) => n.id !== note.id));
        if (latest.current.editing?.id === note.id) cancelEdit();
        let id: string;
        try {
          id = await (saving.current.get(note.id) ?? note.id);
        } catch {
          return; // Its save failed, so the server never had it.
        }
        try {
          await store.deleteNote(id);
        } catch {
          setNotes((prev) => [...prev, { ...note, id }]);
          setNotice('Could not delete the note. Try again.');
        }
      });
    },
    [write, setNotes, cancelEdit, store],
  );

  /** Ask the agent to remove a selector or some of its options; the request is a note. */
  const queueRemoval = useCallback(
    async (action: VariantAction, reference: VariantReference) => {
      const note = `[${action.action}] ${removalText(action, reference)}`;
      const context = { variant: reference, variantAction: action };
      const { route, getPayload } = latest.current;
      await write(async () => {
        const id = await store.saveNote(route, note, null, null, getPayload?.(), { w: innerWidth, h: innerHeight }, context);
        setNotes((prev) => [
          ...prev,
          { id, route, feedback: note, element: null, done: false, createdAt: new Date().toISOString(), ...context },
        ]);
        update({ notesOpen: true });
      });
    },
    [store, write, setNotes, update],
  );

  /** Write about a selector or option: the composer opens in the dock with it referenced. */
  const referVariant = useCallback(
    (reference: VariantReference) => {
      setVariantTarget(reference);
      update({ anchor: null, notesOpen: true, expanded: true });
      focusComposer();
    },
    [update, focusComposer],
  );
  const unpin = useCallback((selector: string) => setTargets((prev) => prev.filter((t) => t.selector !== selector)), []);
  const clearVariant = useCallback(() => setVariantTarget(null), []);

  useDraft(draftKey, text, { targets, variantTarget, editing }, (restoredTargets, restoredVariant) => {
    update({ anchor: null });
    setEditing(null);
    setTargets(restoredTargets);
    setVariantTarget(restoredVariant);
  });

  const draft = useMemo<ComposerDraft>(
    () => ({ text, editing, variantTarget, targets, notice }),
    [text, editing, variantTarget, targets, notice],
  );
  /** The composer's handlers for writing. */
  const composer = useMemo(
    () => ({ onSend: send, onCancelEdit: cancelEdit, onClearVariant: clearVariant, onUnpin: unpin }),
    [send, cancelEdit, clearVariant, unpin],
  );
  return { draft, composer, setTargets, cancelEdit, beginEdit, removeNote, queueRemoval, referVariant };
}
