import { type HTMLAttributes, memo, type ReactNode, type RefObject } from 'react';
import { normalizeRoute } from '../core/routes';
import type { IterationNote } from '../core/types';
import { Icon } from './icons';
import { dotPulse } from './motion';
import { NoteSummary } from './NoteSummary';
import { showOverflowTitle } from './tooltips';

interface NotesPanelProps {
  id: string;
  open: boolean;
  route: string;
  notes: IterationNote[];
  listRef: RefObject<HTMLUListElement | null>;
  /** Pages with open notes and how many, this page first. */
  pages: { counts: Map<string, number>; others: string[] };
  selectedPages: ReadonlySet<string>;
  /** Notes an agent is working on now. */
  working: ReadonlySet<string>;
  editingId: string | undefined;
  resizeHandle: HTMLAttributes<HTMLDivElement>;
  /** The composer, or the button that brings it back from the page. */
  compose: ReactNode;
  onClose: () => void;
  onTogglePage: (page: string) => void;
  onEdit: (note: IterationNote) => void;
  onRemove: (note: IterationNote) => void;
}

/** The feedback panel: its header, the page filter, saved notes and the compose slot. */
export function NotesPanel({
  id,
  open,
  route,
  notes,
  listRef,
  pages,
  selectedPages,
  working,
  editingId,
  resizeHandle,
  compose,
  onClose,
  onTogglePage,
  onEdit,
  onRemove,
}: NotesPanelProps) {
  return (
    <section
      id={id}
      role="dialog"
      aria-label="Iteration feedback"
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
              onClick={() => onTogglePage(page)}
            >
              <span onPointerOver={showOverflowTitle}>{page === route ? 'This page' : page}</span>
              <small>{pages.counts.get(page) ?? 0}</small>
            </button>
          ))}
        </fieldset>
      )}
      <ul ref={listRef} className="isotone-list">
        {notes.map((note) => (
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
      <div className="isotone-compose">{compose}</div>
    </section>
  );
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
  onEdit,
  onRemove,
}: {
  note: IterationNote;
  page: string | undefined;
  editing: boolean;
  working: boolean;
  onEdit: (note: IterationNote) => void;
  onRemove: (note: IterationNote) => void;
}) {
  const remove = note.variantAction ? 'Cancel removal' : note.update ? 'Cancel update request' : 'Delete note';
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
      <button type="button" className="isotone-x isotone-icon" aria-label={remove} title={remove} onClick={() => onRemove(note)}>
        <Icon name="close" size={12} />
      </button>
    </li>
  );
});

/** A quiet close control in the panel's top-left corner. */
export function PanelClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" className="isotone-panel-close" aria-label={label} title={label} onClick={onClose}>
      <Icon name="close" size={12} />
    </button>
  );
}
