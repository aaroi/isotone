import {
  type HTMLAttributes,
  memo,
  useCallback,
  type ReactNode,
  type RefObject,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { normalizeRoute } from '../core/routes';
import type { IsotoneElement, IsotoneNote } from '../core/types';
import { Icon } from './icons';
import { dotPulse, fadeInContent, MAX_ANIMATED_ITEMS } from './motion';
import { NoteSummary } from './NoteSummary';
import type { Anchor } from './picking';
import { showOverflowTitle } from './tooltips';
import { useLayoutMotion } from './useLayoutMotion';
import { useRenderLimit } from './useRenderLimit';
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
      <NoteList open={open} notes={notes} route={route} editingId={editingId} working={working} onEdit={onEdit} onRemove={onRemove} />
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
  route,
  editingId,
  working,
  onEdit,
  onRemove,
}: Pick<NotesPanelProps, 'open' | 'route' | 'editingId' | 'onEdit' | 'onRemove'> & Pick<NoteView, 'notes' | 'working'>) {
  const listRef = useRef<HTMLUListElement>(null);
  // A closed panel renders no notes; the rows stay one more render after closing, for the dock's exit snapshot.
  // Opening renders the newest notes first and older ones above them in chunks, as the Variants list does.
  const lingering = useDeferredValue(open);
  const count = useRenderLimit(open || lingering, notes.length, MAX_ANIMATED_ITEMS);
  const shown = count < notes.length ? notes.slice(notes.length - count) : notes;
  // How far the reader is from the newest note; 0 keeps the list on it. Older notes arriving above, the panel
  // resizing, or the list reappearing after select mode on a phone all keep that distance.
  const fromEnd = useRef(0);
  const keepPlace = useCallback(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight - list.clientHeight - fromEnd.current;
  }, []);
  useLayoutMotion(listRef, notes, open);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new note or opening the panel goes to the newest.
  useEffect(() => {
    fromEnd.current = 0;
    keepPlace();
  }, [notes, open, keepPlace]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each chunk adds rows above the reader.
  useLayoutEffect(keepPlace, [count, keepPlace]);
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
          onEdit={onEdit}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
});

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
  onEdit,
  onRemove,
}: {
  note: IsotoneNote;
  page: string | undefined;
  editing: boolean;
  working: boolean;
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
        <button type="button" className="isotone-note-hit" aria-current={editing ? true : undefined} onClick={() => onEdit(note)}>
          {working && <WorkingDot />}
          <NoteSummary note={note} page={page} />
        </button>
      )}
      <button
        type="button"
        className="isotone-x isotone-icon"
        aria-label={remove.name}
        title={remove.action}
        onClick={() => onRemove(note)}
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
