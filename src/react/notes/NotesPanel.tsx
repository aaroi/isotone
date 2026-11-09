import {
  type HTMLAttributes,
  type KeyboardEvent,
  memo,
  useCallback,
  type ReactNode,
  type RefObject,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { normalizeRoute } from '../../core/routes';
import type { IsotoneElement, IsotoneNote } from '../../core/types';
import { Icon } from '../icons';
import { dotPulse, fadeInContent, MAX_ANIMATED_ITEMS } from '../motion';
import { NoteSummary } from './NoteSummary';
import type { Anchor } from '../dock/picking';
import { showOverflowTitle } from '../tooltips';
import { useLayoutMotion } from '../useLayoutMotion';
import { useRenderLimit } from '../useRenderLimit';
import { isUnsent } from './useNoteActions';
import { awaitsAnswer, type NoteView } from './useNoteView';

interface NotesPanelProps {
  id: string;
  open: boolean;
  route: string;
  view: NoteView;
  editingId: string | undefined;
  resizeHandle: HTMLAttributes<HTMLDivElement>;
  /** The composer, or the button that brings it back from the page. */
  compose: ReactNode;
  onClose: () => void;
  onEdit: (note: IsotoneNote) => void;
  onRemove: (note: IsotoneNote) => void;
  /** "Looks good" on a closed note. */
  onCheck: (note: IsotoneNote) => void;
  /** One of the answers the agent offered, pressed. */
  onAnswer: (note: IsotoneNote, answer: string) => void;
  /** "Answer…": write the answer in the composer. */
  onBeginAnswer: (note: IsotoneNote) => void;
  /** Show a note's pinned element on the page. */
  onLocate: (note: IsotoneNote) => void;
}

/** The feedback panel: its close control, the page filter, saved notes and the compose slot. */
export function NotesPanel({
  id,
  open,
  route,
  view,
  editingId,
  resizeHandle,
  compose,
  onClose,
  onEdit,
  onRemove,
  onCheck,
  onAnswer,
  onBeginAnswer,
  onLocate,
}: NotesPanelProps) {
  const { pages, selectedPages, notes, working, togglePage } = view;
  return (
    <section
      id={id}
      role="dialog"
      aria-label="Feedback"
      className="isotone-panel isotone-notes-panel"
      data-open={open}
      aria-hidden={!open}
      ref={(node) => {
        node?.toggleAttribute('inert', !open);
      }}
    >
      <PanelClose label="Close feedback" onClose={onClose} />
      {open && <div {...resizeHandle} />}
      {pages.counts.size > 1 && (
        <fieldset className="isotone-pages" aria-label="Pages">
          {[route, ...pages.others].map((page) => (
            <button
              key={page}
              type="button"
              className="isotone-page"
              aria-pressed={selectedPages.has(page)}
              title={page === route ? `This page · ${page}` : page}
              onClick={() => togglePage(page)}
            >
              <span onPointerOver={showOverflowTitle}>{page === route ? 'This page' : page}</span>
              <small>{pages.counts.get(page) ?? 0}</small>
            </button>
          ))}
        </fieldset>
      )}
      <NoteList
        open={open}
        notes={notes}
        selectedPages={selectedPages}
        route={route}
        editingId={editingId}
        working={working}
        onEdit={onEdit}
        onRemove={onRemove}
        onCheck={onCheck}
        onAnswer={onAnswer}
        onBeginAnswer={onBeginAnswer}
        onLocate={onLocate}
      />
      <div className="isotone-compose">{compose}</div>
    </section>
  );
}

/**
 * The saved notes, scrolled to the newest. Memoized apart from the panel,
 * which the composer and the dock re-render with props that change every time.
 */
const NoteList = memo(function NoteList({
  open,
  notes,
  selectedPages,
  route,
  editingId,
  working,
  onEdit,
  onRemove,
  onCheck,
  onAnswer,
  onBeginAnswer,
  onLocate,
}: Pick<NotesPanelProps, 'open' | 'route' | 'editingId' | 'onEdit' | 'onRemove' | 'onCheck' | 'onAnswer' | 'onBeginAnswer' | 'onLocate'> &
  Pick<NoteView, 'notes' | 'selectedPages' | 'working'>) {
  const listRef = useRef<HTMLUListElement>(null);
  // A closed panel renders no notes; the rows stay one more render after closing, for the dock's exit snapshot.
  // Opening renders the newest notes first and older ones above them in chunks, as the Variants list does.
  const lingering = useDeferredValue(open);
  const count = useRenderLimit(open || lingering, notes.length, MAX_ANIMATED_ITEMS);
  const shown = count < notes.length ? notes.slice(notes.length - count) : notes;
  // How far the reader is from the newest note; 0 keeps the list on it. Older notes arriving above, the panel
  // resizing, the list reappearing after select mode on a phone, a delete or an agent's progress all keep that
  // distance. Only opening, another page filter, or a note this reviewer just sent goes back to the newest.
  const fromEnd = useRef(0);
  const keepPlace = useCallback(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight - list.clientHeight - fromEnd.current;
  }, []);
  // A fresh set comes with every change to the notes; the pages it names are what matter.
  const filter = [...selectedPages].join('\n');
  const newest = notes.at(-1);
  const sent = newest && isUnsent(newest) ? newest.id : undefined;
  useLayoutMotion(listRef, notes, open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the changes that go back to the newest note.
  useEffect(() => {
    fromEnd.current = 0;
    keepPlace();
  }, [open, filter, sent, keepPlace]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each chunk adds rows above the reader, and any other change keeps their place.
  useLayoutEffect(keepPlace, [count, notes, keepPlace]);
  // One Tab stop for the whole list: the row last focused, else the newest.
  const [focused, setFocused] = useState<string>();
  const stop = focused && shown.some((note) => note.id === focused) ? focused : shown.at(-1)?.id;
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(keepPlace);
    observer.observe(list);
    return () => observer.disconnect();
  }, [keepPlace]);
  return (
    <ul
      ref={listRef}
      className="isotone-list"
      aria-label="Notes"
      onFocus={(e) => setFocused((e.target as HTMLElement).closest('li')?.dataset.motionKey)}
      onKeyDown={moveNoteFocus}
      onScroll={(e) => {
        const list = e.currentTarget;
        // A hidden list reads as all zeros; it keeps the place it had.
        if (list.clientHeight) fromEnd.current = list.scrollHeight - list.clientHeight - list.scrollTop;
      }}
    >
      {shown.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          page={normalizeRoute(note.route) !== route ? note.route : undefined}
          editing={editingId === note.id}
          working={working.has(note.id)}
          tabbable={note.id === stop}
          onEdit={onEdit}
          onRemove={onRemove}
          onCheck={onCheck}
          onAnswer={onAnswer}
          onBeginAnswer={onBeginAnswer}
          onLocate={onLocate}
        />
      ))}
    </ul>
  );
});

const NOTE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];

/** A row's controls, left to right: the note, then its actions. Each names its kind in `data-kind`. */
const controlsOf = (row: Element | null | undefined) => Array.from(row?.querySelectorAll<HTMLElement>('button[data-kind]') ?? []);

/** In `row`, the control of the same kind as `like`, else the row's own button: never an action of another kind. */
function sameKind(row: Element | null | undefined, like: HTMLElement): HTMLElement | undefined {
  const controls = controlsOf(row);
  return controls.find((control) => control.dataset.kind === like.dataset.kind) ?? controls[0];
}

/**
 * Up, Down, Home and End move between notes, to the same kind of control or
 * else the note itself; Left and Right between a note and its actions.
 */
function moveNoteFocus(event: KeyboardEvent<HTMLUListElement>) {
  const target = event.target as HTMLElement;
  const row = target.closest('li');
  if (!row || !NOTE_KEYS.includes(event.key)) return;
  const rows = Array.from(event.currentTarget.children);
  const at = rows.indexOf(row);
  event.preventDefault();
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const controls = controlsOf(row);
    const column = Math.max(0, controls.indexOf(target)) + (event.key === 'ArrowLeft' ? -1 : 1);
    controls[Math.min(Math.max(0, column), controls.length - 1)]?.focus();
    return;
  }
  const next = { ArrowUp: rows[at - 1], ArrowDown: rows[at + 1], Home: rows[0], End: rows.at(-1) }[event.key] ?? row;
  sameKind(next, target)?.focus();
}

/** After an action from the keyboard, focus moves on to a neighbouring note rather than out of the list. */
function focusNeighbour(button: HTMLElement) {
  const row = button.closest('li');
  sameKind(row?.nextElementSibling ?? row?.previousElementSibling, button)?.focus();
}

const WorkingDot = () => (
  <span
    className="isotone-working"
    ref={dotPulse}
    role="img"
    aria-label="An agent is working on this"
    title="An agent is working on this"
  />
);

/** One saved note. Memoized: a poll or an edit elsewhere leaves unchanged rows alone. */
const NoteRow = memo(function NoteRow({
  note,
  page,
  editing,
  working,
  tabbable,
  onEdit,
  onRemove,
  onCheck,
  onAnswer,
  onBeginAnswer,
  onLocate,
}: {
  note: IsotoneNote;
  page: string | undefined;
  editing: boolean;
  working: boolean;
  /** The list's one Tab stop; arrow keys reach the other rows. */
  tabbable: boolean;
  onEdit: (note: IsotoneNote) => void;
  onRemove: (note: IsotoneNote) => void;
  onCheck: (note: IsotoneNote) => void;
  onAnswer: (note: IsotoneNote, answer: string) => void;
  onBeginAnswer: (note: IsotoneNote) => void;
  onLocate: (note: IsotoneNote) => void;
}) {
  if (note.done)
    return <CheckRow note={note} page={page} editing={editing} tabbable={tabbable} onEdit={onEdit} onCheck={onCheck} onLocate={onLocate} />;
  const remove = removeAction(note);
  // The agent's question stacks the row like a closed note's: the question, then the answers, or the one given.
  const asked = awaitsAnswer(note);
  const answer = !asked && note.reply?.answered ? note.reply.answer?.text : undefined;
  const stacked = asked || answer !== undefined;
  return (
    <li
      data-motion-key={note.id}
      className={`isotone-note${stacked ? ' isotone-note-asked' : ''}${editing ? ' isotone-note-editing' : ''}`}
    >
      {note.update ? (
        // Isotone writes an update note's text from its request, so
        // there is nothing to edit; its corner action cancels it.
        <div className="isotone-note-hit" data-static="">
          {working && <WorkingDot />}
          <NoteSummary note={note} />
        </div>
      ) : (
        <button
          type="button"
          className="isotone-note-hit"
          data-kind="note"
          tabIndex={tabbable ? 0 : -1}
          aria-current={editing ? true : undefined}
          onClick={() => onEdit(note)}
        >
          {working && <WorkingDot />}
          <NoteSummary note={note} page={page} />
        </button>
      )}
      {asked && <AnswerActions note={note} onAnswer={onAnswer} onBeginAnswer={onBeginAnswer} />}
      {answer !== undefined && (
        <p className="isotone-reply isotone-answered" onPointerOver={showOverflowTitle}>
          <span>You answered</span> {answer}
        </p>
      )}
      <button
        type="button"
        className="isotone-x isotone-icon"
        data-kind="delete"
        // An update note has no note button, so its delete button is the row's stop.
        tabIndex={tabbable && note.update ? 0 : -1}
        aria-label={remove.name}
        title={remove.action}
        onClick={(event) => {
          if (event.detail === 0) focusNeighbour(event.currentTarget);
          onRemove(note);
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </li>
  );
});

/**
 * Under the agent's question, always shown: the answers it offered, one press
 * each, then Answer… to write one's own in the composer.
 */
function AnswerActions({
  note,
  onAnswer,
  onBeginAnswer,
}: {
  note: IsotoneNote;
  onAnswer: (note: IsotoneNote, answer: string) => void;
  onBeginAnswer: (note: IsotoneNote) => void;
}) {
  const text = shortText(note.feedback);
  const choices = note.reply?.choices ?? [];
  return (
    <div className="isotone-check-actions isotone-answer-actions">
      {choices.map((choice) => (
        <button
          key={choice}
          type="button"
          className="isotone-secondary"
          data-kind="choice"
          tabIndex={-1}
          aria-label={`${choice}: answer for ${text}`}
          onClick={(event) => {
            // The answers give way to the one chosen; the keyboard stays on the row.
            if (event.detail === 0) event.currentTarget.closest('li')?.querySelector<HTMLElement>('[data-kind="note"]')?.focus();
            onAnswer(note, choice);
          }}
        >
          <span onPointerOver={showOverflowTitle}>{choice}</span>
        </button>
      ))}
      <button
        type="button"
        className="isotone-quiet"
        data-kind="answer"
        tabIndex={-1}
        aria-label={`Answer the agent: ${text}`}
        onClick={() => onBeginAnswer(note)}
      >
        {choices.length ? 'Answer…' : 'Answer'}
      </button>
    </div>
  );
}

/**
 * A note the agent closed, waiting for the reviewer: the agent's summary under
 * the note, and two corner actions. The row itself shows the element again.
 */
function CheckRow({
  note,
  page,
  editing,
  tabbable,
  onEdit,
  onCheck,
  onLocate,
}: {
  note: IsotoneNote;
  page: string | undefined;
  editing: boolean;
  tabbable: boolean;
  onEdit: (note: IsotoneNote) => void;
  onCheck: (note: IsotoneNote) => void;
  onLocate: (note: IsotoneNote) => void;
}) {
  const text = shortText(note.feedback);
  return (
    <li data-motion-key={note.id} className={`isotone-note isotone-note-done${editing ? ' isotone-note-editing' : ''}`}>
      <button
        type="button"
        className="isotone-note-hit"
        data-kind="note"
        tabIndex={tabbable ? 0 : -1}
        aria-current={editing ? true : undefined}
        onClick={() => onLocate(note)}
      >
        <span className="isotone-checked" role="img" aria-label="Closed by the agent">
          <Icon name="check" size={9} />
        </span>
        <NoteSummary note={note} page={page} />
      </button>
      {/* Always shown, never on hover only: these two are what the row asks of the reviewer. */}
      <div className="isotone-check-actions">
        <button
          type="button"
          className="isotone-quiet"
          data-kind="not-quite"
          tabIndex={-1}
          aria-label={`Not quite: ${text}`}
          onClick={() => onEdit(note)}
        >
          Not quite
        </button>
        <button
          type="button"
          className="isotone-secondary"
          data-kind="looks-good"
          tabIndex={-1}
          aria-label={`Looks good: ${text}`}
          onClick={(event) => {
            if (event.detail === 0) focusNeighbour(event.currentTarget);
            onCheck(note);
          }}
        >
          Looks good
        </button>
      </div>
    </li>
  );
}

/** Enough of a note to tell rows apart in an accessible name. */
const shortText = (text: string) => (text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text);

/** The corner action, and an accessible name with enough of the note to tell rows apart. */
function removeAction(note: IsotoneNote): { action: string; name: string } {
  if (note.update) return { action: 'Cancel update request', name: 'Cancel update request' };
  const action = note.variantAction ? 'Cancel removal' : 'Delete note';
  const text = note.variantAction ? note.feedback.replace(/^\[[\w-]+\]\s*/, '') : note.feedback;
  return { action, name: `${action}: ${shortText(text)}` };
}

/** Stands in for the composer while it floats on the page, naming where; a click brings it back. */
export function AwayButton({
  targets,
  anchor,
  slot,
  onReturn,
}: {
  targets: IsotoneElement[];
  /** Where the composer floats: beside the pinned element it names. */
  anchor: Anchor | null;
  /** The docked composer's height, kept so the panel does not jump. */
  slot: RefObject<number>;
  onReturn: () => void;
}) {
  const anchored = targets.find((t) => t.selector === anchor?.selector) ?? targets[0];
  const more = targets.length > 1 ? ` and ${targets.length - 1} more` : '';
  return (
    <button
      type="button"
      ref={fadeInContent}
      className="isotone-away"
      title="Write here instead"
      style={{ minHeight: slot.current || undefined }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onReturn}
    >
      <Icon name="pin" size={14} />
      <span className="isotone-away-text">
        <span>Writing on the page</span>
        <small>{anchored ? `Next to ${anchored.text || anchored.tag}${more}` : 'Next to where you clicked'}</small>
      </span>
      <span className="isotone-away-action">Move here</span>
    </button>
  );
}

/** A quiet close control in the panel's top-left corner. */
export function PanelClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" className="isotone-panel-close" aria-label={label} title={label} onClick={onClose}>
      <Icon name="close" size={12} />
    </button>
  );
}
