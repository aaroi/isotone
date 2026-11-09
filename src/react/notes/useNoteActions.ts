import { type Dispatch, type SetStateAction, useCallback, useMemo, useRef, useState } from 'react';
import { createNoteId } from '../../core/id';
import { MAX_FEEDBACK_LENGTH, MAX_REPLY_LENGTH } from '../../core/limits';
import { withAnswer } from '../../core/notes-client';
import type { StyleEdit } from '../../core/style-edits';
import type { IsotoneElement, IsotoneNote, NoteDiagnostics, VariantReference } from '../../core/types';
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
  /** The page's recent errors and failed requests, for a new note. */
  getDiagnostics?: () => NoteDiagnostics | undefined;
  /** What the style editor holds for the pinned elements; sent with the note, which may then have no text of its own. */
  getStyleEdits?: () => StyleEdit[];
  /** Hand edits back to the style editor: a saved note's when it is edited, or those of a note that could not be saved. */
  restoreStyleEdits?: (edits: readonly StyleEdit[]) => void;
  update: UpdateMode;
  focusComposer: () => void;
}

/** What the composer shows, besides its text: one object that changes only when one of these does. */
export interface ComposerDraft {
  text: DraftText;
  editing: IsotoneNote | null;
  /** The note whose question the reviewer is answering; its own text stays as it is. */
  answering: IsotoneNote | null;
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

/** The text of a note sent with style changes and no words. */
const STYLE_ONLY_NOTE = 'Apply these style changes.';

/** A note this reviewer just sent, shown before the server has saved it. */
export const isUnsent = (note: IsotoneNote) => note.id.startsWith(UNSENT);
const UNSENT = 'pending-';

/**
 * The note being written and the requests that save, edit and remove notes.
 * Saves are optimistic: the list shows a note at once under a temporary id and
 * puts things back if the server refuses. Editing or deleting a note whose
 * save is still in flight waits for its real id.
 */
export function useNoteActions({
  route,
  draftKey,
  store,
  write,
  setNotes,
  getPayload,
  getDiagnostics,
  getStyleEdits,
  restoreStyleEdits,
  update,
  focusComposer,
}: NoteActionsOptions) {
  const [text] = useState(createDraftText);
  const [targets, setTargets] = useState<IsotoneElement[]>([]);
  const [variantTarget, setVariantTarget] = useState<VariantReference | null>(null);
  const [editing, setEditing] = useState<IsotoneNote | null>(null);
  const [answering, setAnswering] = useState<IsotoneNote | null>(null);
  const [notice, setNotice] = useState('');
  // Handlers read the current render here, so they stay stable and memoized children skip unrelated renders.
  const latest = useRef({
    route,
    getPayload,
    getDiagnostics,
    getStyleEdits,
    restoreStyleEdits,
    targets,
    variantTarget,
    editing,
    answering,
  });
  latest.current = { route, getPayload, getDiagnostics, getStyleEdits, restoreStyleEdits, targets, variantTarget, editing, answering };
  /** Saves in flight, by the temporary id of their optimistic note. */
  const saving = useRef(new Map<string, Promise<string>>());

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setAnswering(null);
    text.set('');
    setTargets([]);
    setVariantTarget(null);
  }, [text]);

  /**
   * The reviewer's answer to the agent's question, from a choice or the
   * composer. Shown at once; if the server refuses, the question comes back,
   * and an answer written in the composer goes back into it.
   */
  const answerNote = useCallback(
    (note: IsotoneNote, value: string, written = false) => {
      setNotice('');
      void write(async () => {
        setNotes((prev) => prev.map((n) => (n.id === note.id ? withAnswer(note, value) : n)));
        try {
          await store.answerNote(note, value);
        } catch {
          setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
          if (written && !latest.current.editing && !latest.current.answering && !text.get()) {
            setAnswering(note);
            text.set(value);
          }
          setNotice('Could not send your answer. Try again.');
        }
      });
    },
    [write, setNotes, store, text],
  );

  const send = useCallback(() => {
    const { answering } = latest.current;
    if (answering) {
      const answer = text.get().trim();
      if (!answer) return;
      if (answer.length > MAX_REPLY_LENGTH) {
        setNotice(`An answer can be at most ${MAX_REPLY_LENGTH} characters.`);
        return;
      }
      cancelEdit();
      focusComposer();
      answerNote(answering, answer, true);
      return;
    }
    const styleEdits = latest.current.getStyleEdits?.() ?? [];
    // Style changes speak for themselves; words are optional beside them.
    const written = text.get().trim();
    const value = written || (styleEdits.length ? STYLE_ONLY_NOTE : '');
    if (!value) return;
    if (value.length > MAX_FEEDBACK_LENGTH) {
      setNotice(`Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
      return;
    }
    const { editing: previous, targets, variantTarget, route, getPayload, getDiagnostics } = latest.current;
    const diagnostics = previous ? undefined : getDiagnostics?.();
    const context = {
      elements: targets,
      variant: variantTarget,
      ...(previous?.variantAction ? { variantAction: previous.variantAction } : {}),
      ...(diagnostics ? { diagnostics } : {}),
      // An edited note's changes are the editor's as it stands now, an emptied list included.
      ...(styleEdits.length || (previous?.styleEdits && !previous.done) ? { styleEdits } : {}),
    };
    const noteRoute = previous?.route ?? route;
    const element = targets[0] ?? null;
    const tempId = previous?.id ?? `${UNSENT}${createNoteId()}`;
    // Sending a closed note ("Not quite") reopens it, even unchanged.
    const reopen = previous?.done === true;
    const { resolution: _said, checkedAt: _checked, doneAt: _closed, reply, ...kept } = previous ?? ({} as Partial<IsotoneNote>);
    const entry: IsotoneNote = {
      ...kept,
      // Changing the text answers the agent's question too; the next poll says so.
      ...(reply && value === previous?.feedback ? { reply } : {}),
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
        store.saveNote(noteRoute, value, element, id, payload, viewport, context, reopen),
      );
      if (!previous) saving.current.set(tempId, saved);
      try {
        const id = await saved;
        setNotes((prev) => prev.map((n) => (n.id === tempId ? { ...n, id } : n)));
        // An edit begun meanwhile holds the temporary id; it now edits the saved note.
        if (!previous) setEditing((current) => (current?.id === tempId ? { ...current, id } : current));
      } catch {
        setNotes((prev) => (previous ? prev.map((n) => (n.id === tempId ? previous : n)) : prev.filter((n) => n.id !== tempId)));
        text.set(written);
        setTargets(context.elements);
        latest.current.restoreStyleEdits?.(styleEdits);
        setVariantTarget(context.variant);
        setEditing(previous);
        setNotice('Could not save. Your feedback is still here.');
      } finally {
        // Kept a moment past the save, for an edit or delete that read the temporary id meanwhile.
        if (!previous) setTimeout(() => saving.current.delete(tempId), 0);
      }
    });
  }, [text, store, write, setNotes, cancelEdit, update, focusComposer, answerNote]);

  const beginEdit = useCallback(
    (note: IsotoneNote) => {
      setNotice('');
      update({ anchor: null });
      setAnswering(null);
      setEditing(note);
      text.set(note.feedback);
      setTargets(note.elements ?? (note.element ? [note.element] : []));
      setVariantTarget(note.variant ?? null);
      // An open note's style changes come back to the editor and the page, to change or remove like the text.
      // A closed one's stay on the note: the page now shows what the agent made of them, which is what is being judged.
      if (!note.done) latest.current.restoreStyleEdits?.(note.styleEdits ?? []);
      focusComposer();
    },
    [update, text, focusComposer],
  );

  /** "Answer…": the composer takes the reviewer's answer in their own words. The note and the draft's pins stay out of it. */
  const beginAnswer = useCallback(
    (note: IsotoneNote) => {
      setNotice('');
      update({ anchor: null, picking: false });
      setEditing(null);
      setAnswering(note);
      text.set('');
      setTargets([]);
      setVariantTarget(null);
      focusComposer();
    },
    [update, text, focusComposer],
  );

  const removeNote = useCallback(
    (note: IsotoneNote) => {
      setNotice('');
      void write(async () => {
        setNotes((prev) => prev.filter((n) => n.id !== note.id));
        if (latest.current.editing?.id === note.id || latest.current.answering?.id === note.id) cancelEdit();
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

  /** "Looks good" on a closed note: it leaves the list, and comes back if the server refuses. */
  const checkNote = useCallback(
    (note: IsotoneNote) => {
      setNotice('');
      void write(async () => {
        setNotes((prev) => prev.filter((n) => n.id !== note.id));
        try {
          await store.checkNote(note);
        } catch {
          setNotes((prev) => (prev.some((n) => n.id === note.id) ? prev : [...prev, note]));
          setNotice('Could not mark the note as checked. Try again.');
        }
      });
    },
    [write, setNotes, store],
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

  // An answer is not a draft either: nothing is saved while one is written.
  useDraft(draftKey, text, { targets, variantTarget, editing: editing ?? answering }, (restoredTargets, restoredVariant) => {
    update({ anchor: null });
    setEditing(null);
    setAnswering(null);
    setTargets(restoredTargets);
    setVariantTarget(restoredVariant);
  });

  const draft = useMemo<ComposerDraft>(
    () => ({ text, editing, answering, variantTarget, targets, notice }),
    [text, editing, answering, variantTarget, targets, notice],
  );
  /** The composer's handlers for writing. */
  const composer = useMemo(
    () => ({ onSend: send, onCancelEdit: cancelEdit, onClearVariant: clearVariant, onUnpin: unpin }),
    [send, cancelEdit, clearVariant, unpin],
  );
  /** A line in the composer's notice, such as why a note's element cannot be shown; the next action clears it. */
  const say = useCallback((line: string) => setNotice(line), []);
  return {
    draft,
    composer,
    setTargets,
    cancelEdit,
    beginEdit,
    beginAnswer,
    answerNote,
    removeNote,
    checkNote,
    queueRemoval,
    referVariant,
    say,
  };
}
