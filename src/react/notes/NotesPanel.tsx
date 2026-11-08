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
import type { NoteView } from './useNoteView';

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
}

/** The feedback panel: its close control, the page filter, saved notes and the compose slot. */
export function NotesPanel({ id, open, route, view, editingId, resizeHandle, compose, onClose, onEdit, onRemove }: NotesPanelProps) {
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
}: Pick<NotesPanelProps, 'open' | 'route' | 'editingId' | 'onEdit' | 'onRemove'> & Pick<NoteView, 'notes' | 'selectedPages' | 'working'>) {
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
        />
      ))}
    </ul>
  );
});

const NOTE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];

/** Up, Down, Home and End move between notes; Left and Right between a note and its delete button. */
function moveNoteFocus(event: KeyboardEvent<HTMLUListElement>) {
  const target = event.target as HTMLElement;
  const row = target.closest('li');
  if (!row || !NOTE_KEYS.includes(event.key)) return;
  const rows = Array.from(event.currentTarget.children);
  const at = rows.indexOf(row);
  const next = { ArrowUp: rows[at - 1], ArrowDown: rows[at + 1], Home: rows[0], End: rows.at(-1) }[event.key] ?? row;
  const removing = event.key === 'ArrowRight' || (event.key !== 'ArrowLeft' && target.classList.contains('isotone-x'));
  const button = next.querySelector<HTMLElement>(removing ? '.isotone-x' : 'button');
  event.preventDefault();
  button?.focus();
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
}: {
  note: IsotoneNote;
  page: string | undefined;
  editing: boolean;
  working: boolean;
  /** The list's one Tab stop; arrow keys reach the other rows. */
  tabbable: boolean;
  onEdit: (note: IsotoneNote) => void;
  onRemove: (note: IsotoneNote) => void;
}) {
  const remove = removeAction(note);
  return (
    <li data-motion-key={note.id} className={`isotone-note${editing ? ' isotone-note-editing' : ''}`}>
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
          tabIndex={tabbable ? 0 : -1}
          aria-current={editing ? true : undefined}
          onClick={() => onEdit(note)}
        >
          {working && <WorkingDot />}
          <NoteSummary note={note} page={page} />
        </button>
      )}
      <button
        type="button"
        className="isotone-x isotone-icon"
        // An update note has no note button, so its delete button is the row's stop.
        tabIndex={tabbable && note.update ? 0 : -1}
        aria-label={remove.name}
        title={remove.action}
        onClick={(event) => {
          // From the keyboard, focus moves on to a neighbouring note rather than out of the list.
          const row = event.currentTarget.closest('li');
          if (event.detail === 0)
            (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>('.isotone-x')?.focus();
          onRemove(note);
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </li>
  );
});

/** The corner action, and an accessible name with enough of the note to tell rows apart. */
function removeAction(note: IsotoneNote): { action: string; name: string } {
  if (note.update) return { action: 'Cancel update request', name: 'Cancel update request' };
  const action = note.variantAction ? 'Cancel removal' : 'Delete note';
  const text = note.variantAction ? note.feedback.replace(/^\[[\w-]+\]\s*/, '') : note.feedback;
  return { action, name: `${action}: ${text.length > 48 ? `${text.slice(0, 47).trimEnd()}…` : text}` };
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
