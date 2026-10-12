import { showOverflowTitle } from './tooltips';
import { FEEDBACK_STORAGE_KEY, readBrowserStorage, removeBrowserStorage, writeBrowserStorage } from '../core/browser-storage';
import { MAX_FEEDBACK_LENGTH } from '../core/limits';
import { createNoteId } from '../core/id';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createIterationStore,
  describeIterationElement,
  elementAsNode,
  isRouteVisible,
  type IterationElement,
  type IterationNote,
  type IterationStoreConfig,
  type RouteGateOptions,
  type VariantReference,
} from '../core/index';
import { type VariantAction, type VariantsSource, visibleAxes } from '../core/variants';
import { ensurePanelStyles } from './styles';
import { refreshSource, useVariantsSource, VariantsView } from './VariantsView';
import { detectTheme, observeTheme, type IterationTheme } from './theme';
import { NoteSummary } from './NoteSummary';
import { Icon } from './icons';
import { useLayoutMotion } from './useLayoutMotion';
import { useDockMotion } from './useDockMotion';
import { UpdateNotice } from './UpdateNotice';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface IterationShortcut {
  /** Physical key code, stable across keyboard layouts. Default: Period. */
  code: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}
export interface IterationPanelProps {
  /** Auto follows the page at the dock. System follows the OS preference. */
  theme?: IterationTheme;
  /** Local adapter endpoint for an optional, nonblocking update notice. */
  updateEndpoint?: string;
  route: string;
  store: IterationStoreConfig;
  rule?: RouteGateOptions;
  getPayload?: () => unknown;
  variants?: VariantsSource;
  /** Initial surface. Kept for compatibility; surfaces can now open together. */
  defaultTab?: 'variants' | 'notes';
  /** Default: Cmd/Ctrl+Shift+Period. false disables the shortcut. */
  shortcut?: IterationShortcut | false;
}
const DEFAULT_SHORTCUT: IterationShortcut = {
  code: 'Period',
  mod: true,
  shift: true,
};

export function IterationPanel({
  route,
  theme: themePreference = 'auto',
  updateEndpoint,
  store: storeCfg,
  rule,
  getPayload,
  variants,
  defaultTab = 'notes',
  shortcut = DEFAULT_SHORTCUT,
}: IterationPanelProps) {
  const [store] = useState(() => createIterationStore(storeCfg));
  const nsKey = storeCfg.key ?? FEEDBACK_STORAGE_KEY;
  const [notesOpen, setNotesOpen] = useState(false);
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [picking, setPicking] = useState(false);
  const [targets, setTargets] = useState<IterationElement[]>([]);
  const [variantTarget, setVariantTarget] = useState<VariantReference | null>(
    null,
  );
  const [hoverRect, setHoverRect] = useState<Rect | null>(null);
  const [rects, setRects] = useState<(Rect & { selector: string })[]>([]);
  const [text, setText] = useState('');
  const [notes, setNotes] = useState<IterationNote[]>([]);
  const noteRevision = useRef(0);
  const pendingWrites = useRef(0);
  const noteRequest = useRef(0);
  const [editing, setEditing] = useState<IterationNote | null>(null);
  const [notice, setNotice] = useState('');
  const [theme, setTheme] = useState(() => detectTheme(themePreference));
  const [instant, setInstant] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutMotion(listRef, notes, notesOpen);
  const fabRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const draftRestored = useRef('');
  const restoringDraft = useRef(false);
  const id = useId();
  const notesAvailable = Boolean(storeCfg.endpoint);
  useVariantsSource(variants);
  const variantsAvailable = Boolean(
    variants &&
      visibleAxes(variants.getAxes(), variants.getSelections()).length,
  );
  const visible =
    isRouteVisible(route, rule) &&
    (notesAvailable || variantsAvailable || variantsOpen);
  const hasContext = Boolean(editing || variantTarget || targets.length || notice);
  // Context changes the scroll-through inset; measure again when that changes
  // or a route restores the composer after its DOM was removed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasContext changes the CSS inset used by scrollHeight.
  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field || !notesOpen || !visible) return;
    const resize = () => {
      field.style.height = '0px';
      field.style.height = `${text ? Math.max(22, field.scrollHeight) : 22}px`;
      field.dataset.scrolled = String(field.scrollTop > 0);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth !== width) { width = field.clientWidth; resize(); }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [text, notesOpen, visible, hasContext]);
  useEffect(() => {
    if (!visible) {
      setHovered(false);
      setFocused(false);
      setExpanded(false);
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    // Native enter/leave survive transitions from a host React tree into our shadow root.
    const enter = (event: PointerEvent) => {
      if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && event.buttons === 0) {
        root.setAttribute('data-instant', 'false');
        setInstant(false);
        setHovered(true);
      }
    };
    const leave = () => { setHovered(false); setExpanded(false); };
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
    };
  }, [visible]);
  useDockMotion(rootRef, visible);
  const open = notesOpen || variantsOpen;
  const railOpen = expanded || hovered || (focused && instant) || open || picking;
  useEffect(() => {
    if (!railOpen || !instant) return;
    const active = (rootRef.current?.getRootNode() as Document | ShadowRoot)?.activeElement;
    if (active === fabRef.current) rootRef.current?.querySelector<HTMLButtonElement>('.isotone-rail-button')?.focus();
  }, [railOpen, instant]);
  const draftKey = `${nsKey}::draft::${route}`;
  const visibleNotes = useMemo(() => notes
    .filter((n) => !n.done)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [notes]);
  const pendingActions = useMemo(() => notes.flatMap(n =>
    !n.done && n.route === route && n.variantAction ? [n.variantAction] : []), [notes, route]);
  const shortcutLabel = shortcut
    ? [
        shortcut.mod ? '⌘/Ctrl' : '',
        shortcut.alt ? 'Alt' : '',
        shortcut.shift ? 'Shift' : '',
        shortcut.code === 'Period' ? '.' : shortcut.code.replace(/^Key/, ''),
      ]
        .filter(Boolean)
        .join('+')
    : '';

  function loadNotes() {
    if (!notesAvailable) return;
    const request = ++noteRequest.current;
    const revision = noteRevision.current;
    void store
      .listNotes()
      .then((fresh) => {
        // An old refresh must not restore deleted notes or undo optimistic edits.
        if (request !== noteRequest.current || revision !== noteRevision.current || pendingWrites.current) return;
        setNotes(fresh);
      })
      .catch(() => {});
  }
  function beginNoteWrite() {
    noteRevision.current++;
    pendingWrites.current++;
    return () => {
      noteRevision.current++;
      pendingWrites.current--;
    };
  }
  // Focus the composer after a pin without leaving select mode.
  const keepPicking = useRef(false);
  const focusWhilePicking = useCallback(() => {
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      keepPicking.current = true;
      textareaRef.current?.focus();
      keepPicking.current = false;
    });
  }, []);
  const focusComposer = useCallback(() => {
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() =>
      textareaRef.current?.focus(),
    );
  }, []);
  function closeAll() {
    cancelAnimationFrame(focusFrame.current);
    setNotesOpen(false);
    setVariantsOpen(false);
    setPicking(false);
    setExpanded(false);
    setHovered(false);
    (previousFocus.current?.isConnected
      ? previousFocus.current
      : fabRef.current
    )?.focus();
  }
  function openInitial() {
    previousFocus.current = document.activeElement as HTMLElement | null;
    setExpanded(true);
    if ((defaultTab === 'variants' || !notesAvailable) && variantsAvailable)
      setVariantsOpen(true);
    else {
      setNotesOpen(true);
      focusComposer();
    }
  }
  function feedback(reference: VariantReference) {
    setVariantTarget(reference);
    setNotesOpen(true);
    setExpanded(true);
    focusComposer();
  }
  async function queueRemoval(action: VariantAction, reference: VariantReference) {
    const description = action.action === 'remove-option'
      ? `Remove “${reference.optionLabel}” from ${reference.label}.`
      : action.action === 'keep-default'
        ? `Keep only the default for ${reference.label}; remove its selector and alternatives.`
        : `Remove ${reference.label}, its selector and all alternatives.`;
    const feedback = `[${action.action}] ${description}`;
    const context = { variant: reference, variantAction: action };
    const finish = beginNoteWrite();
    try {
      const savedId = await store.saveNote(route, feedback, null, null, getPayload?.(),
        { w: innerWidth, h: innerHeight }, context);
      setNotes(prev => [...prev, { id: savedId, route, feedback, element: null,
        done: false, createdAt: new Date().toISOString(), ...context }]);
      setNotesOpen(true);
    } finally {
      finish();
    }
  }
  function cancelEdit() {
    setEditing(null);
    setText('');
    setTargets([]);
    setVariantTarget(null);
  }

  async function send() {
    const value = text.trim();
    if (!value) return;
    if (value.length > MAX_FEEDBACK_LENGTH) {
      setNotice(`Feedback must be at most ${MAX_FEEDBACK_LENGTH} characters.`);
      return;
    }
    const context = { elements: targets, variant: variantTarget, ...(editing?.variantAction ? { variantAction: editing.variantAction } : {}) };
    const noteRoute = editing?.route ?? route;
    const element = targets[0] ?? null;
    const tempId = editing?.id ?? `pending-${createNoteId()}`;
    const entry: IterationNote = {
      ...(editing ?? {}),
      id: tempId,
      route: noteRoute,
      feedback: value,
      element,
      ...context,
      done: false,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    const payload = editing ? undefined : getPayload?.();
    const previous = editing;
    const finish = beginNoteWrite();
    setNotes((prev) =>
      previous
        ? prev.map((n) => (n.id === tempId ? entry : n))
        : [...prev, entry],
    );
    cancelEdit();
    setNotice('');
    focusComposer();
    try {
      const savedId = await store.saveNote(
        noteRoute,
        value,
        element,
        previous?.id ?? null,
        payload,
        { w: innerWidth, h: innerHeight },
        context,
      );
      setNotes((prev) =>
        prev.map((n) => (n.id === tempId ? { ...n, id: savedId } : n)),
      );
    } catch {
      setNotes((prev) =>
        previous
          ? prev.map((n) => (n.id === tempId ? previous : n))
          : prev.filter((n) => n.id !== tempId),
      );
      setText(value);
      setTargets(context.elements);
      setVariantTarget(context.variant);
      setEditing(previous);
      setNotice('Could not save. Your feedback is still here.');
    } finally {
      finish();
    }
  }
  function beginEdit(note: IterationNote) {
    setEditing(note);
    setText(note.feedback);
    setTargets(note.elements ?? (note.element ? [note.element] : []));
    setVariantTarget(note.variant ?? null);
    focusComposer();
  }
  async function removeNote(note: IterationNote) {
    const finish = beginNoteWrite();
    setNotes((prev) => prev.filter((n) => n.id !== note.id));
    if (editing?.id === note.id) cancelEdit();
    try {
      await store.deleteNote(note.id);
    } catch {
      setNotes((prev) => [...prev, note]);
      setNotice('Could not delete the note. Try again.');
    } finally {
      finish();
    }
  }

  // Reopen/revisit fetches fresh state without a background polling loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-time refresh; store is stable.
  useEffect(() => {
    loadNotes();
  }, [notesOpen, variantsOpen, route]);
  useEffect(() => {
    if (variants && notesOpen && !variantsOpen) refreshSource(variants);
  }, [notesOpen, variantsOpen, variants]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a network-backed source starts empty.
  useEffect(() => {
    if (variants && !variantsAvailable) refreshSource(variants);
  }, [variants]);
  useEffect(() => {
    if (draftRestored.current === draftKey) return;
    draftRestored.current = draftKey;
    restoringDraft.current = true;
    setEditing(null);
    setText('');
    setTargets([]);
    setVariantTarget(null);
    try {
      const raw = readBrowserStorage(localStorage, draftKey);
      if (!raw) return;
      try {
        const draft = JSON.parse(raw);
        if (draft && typeof draft.text === 'string') {
          setText(draft.text);
          setTargets(Array.isArray(draft.elements) ? draft.elements : []);
          setVariantTarget(draft.variant ?? null);
        } else setText(raw);
      } catch {
        setText(raw);
      }
    } catch {}
  }, [draftKey]);
  useEffect(() => {
    // Restoration commits after this effect pass; never save the previous route's draft over it.
    if (restoringDraft.current) { restoringDraft.current = false; return; }
    if (editing || draftRestored.current !== draftKey) return;
    try {
      if (!text && targets.length === 0 && !variantTarget)
        removeBrowserStorage(localStorage, draftKey);
      else
        writeBrowserStorage(localStorage,
          draftKey,
          JSON.stringify({ text, elements: targets, variant: variantTarget }),
        );
    } catch {}
  }, [text, targets, variantTarget, editing, draftKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll follows new notes.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [notes, notesOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sample the surrounding page when opened.
  useLayoutEffect(() => {
    if (!visible) return;
    const root = rootRef.current?.getRootNode();
    if (root instanceof ShadowRoot || root instanceof Document)
      ensurePanelStyles(root);
    return observeTheme(setTheme, themePreference);
  }, [visible, open, route, themePreference]);

  // Capture phase still works while typing. Browser/OS-reserved chords never reach a page.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      rootRef.current?.setAttribute('data-instant', 'true');
      setInstant(true);
      if (!shortcut || e.repeat || e.isComposing) return;
      if (
        e.code !== shortcut.code ||
        Boolean(e.metaKey || e.ctrlKey) !== Boolean(shortcut.mod) ||
        e.shiftKey !== Boolean(shortcut.shift) ||
        e.altKey !== Boolean(shortcut.alt)
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (
        notesOpen &&
        textareaRef.current ===
          (rootRef.current?.getRootNode() as Document | ShadowRoot)
            ?.activeElement
      )
        closeAll();
      else if (notesAvailable) {
        if (!open)
          previousFocus.current = document.activeElement as HTMLElement;
        setNotesOpen(true);
        setExpanded(true);
        setPicking(false);
        focusComposer();
      } else setVariantsOpen((v) => !v);
    };
    const onPointer = () => {
      rootRef.current?.setAttribute('data-instant', 'false');
      setInstant(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  });

  useEffect(() => {
    if (!open || picking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (editing) cancelEdit();
      else closeAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!picking) return;
    const cursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';
    let frame = 0;
    const elementAt = (e: MouseEvent) => {
      const el = e.detail === 0 && e.type === 'click'
        ? e.composedPath().find((node): node is Element => node instanceof Element)
        : document.elementFromPoint(e.clientX, e.clientY);
      return el && !el.closest('[data-isotone]') ? el : null;
    };
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(frame);
      const deferred = e.shiftKey;
      frame = requestAnimationFrame(() => {
        const el = deferred ? null : elementAt(e);
        setHoverRect(el ? el.getBoundingClientRect() : null);
      });
    };
    const toggleTarget = (el: Element) => {
      const target = describeIterationElement(elementAsNode(el));
      setTargets((prev) =>
        prev.some((t) => t.selector === target.selector)
          ? prev.filter((t) => t.selector !== target.selector)
          : prev.length < 50
            ? [...prev, target]
            : prev,
      );
    };
    const onClick = (e: MouseEvent) => {
      // Shift passes the click through so the page can open menus and tabs first.
      if (e.shiftKey) return;
      const el = elementAt(e);
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleTarget(el);
      focusWhilePicking();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        const el = e.composedPath().find((node): node is Element => node instanceof Element);
        if (!el || el === document.body || el.closest('[data-isotone], input, textarea, select, [contenteditable]')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) toggleTarget(el);
        return;
      }
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      // Enter in the composer sends; picking finishes only from the page.
      if (
        e.composedPath().includes(textareaRef.current as EventTarget) &&
        e.key === 'Enter'
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPicking(false);
      setNotesOpen(true);
      focusComposer();
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.cursor = cursor;
      cancelAnimationFrame(frame);
      setHoverRect(null);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [picking, focusComposer, focusWhilePicking]);
  // Pointer events inside the dock stay inside it, so a host dropdown that closes
  // on an outside press is not dismissed by using the dock. React listens on the
  // shadow root too, and it registered first, so its handlers still run.
  useEffect(() => {
    const shadow = rootRef.current?.getRootNode();
    if (!(shadow instanceof ShadowRoot)) return;
    const stop = (e: Event) => e.stopPropagation();
    const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'];
    for (const type of types) shadow.addEventListener(type, stop);
    return () => { for (const type of types) shadow.removeEventListener(type, stop); };
  }, []);
  useEffect(() => {
    if (!picking) {
      setRects([]);
      return;
    }
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      setRects(
        targets.flatMap((t) => {
          try {
            const el = document.querySelector(t.selector);
            if (!el) return [];
            const r = el.getBoundingClientRect();
            return [
              {
                top: r.top,
                left: r.left,
                width: r.width,
                height: r.height,
                selector: t.selector,
              },
            ];
          } catch {
            return [];
          }
        }),
      );
    };
    const schedule = () => { frame ??= requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [targets, picking]);

  const variantsPanel = variants && (
        <section
          id={`${id}-variants`}
          role="dialog"
          aria-label="Iteration variants"
          className="isotone-panel isotone-variants-panel"
          data-open={variantsOpen}
          aria-hidden={!variantsOpen}
          ref={node => { node?.toggleAttribute('inert', !variantsOpen); }}
        >
          <VariantsView
            source={variants}
            active={variantsOpen}
            onClose={() => { setVariantsOpen(false); setExpanded(false); }}
            onFeedback={notesAvailable ? feedback : undefined}
            onSaved={loadNotes}
            onManage={notesAvailable ? queueRemoval : undefined}
            pendingActions={pendingActions}
          />
        </section>
      );
  const notesPanel = notesAvailable && (
        <section
          id={`${id}-notes`}
          role="dialog"
          aria-label="Iteration feedback"
          className="isotone-panel isotone-notes-panel"
          data-open={notesOpen}
          aria-hidden={!notesOpen}
          ref={node => { node?.toggleAttribute('inert', !notesOpen); }}
        >
          <div className="isotone-panel-head">
            <h2>
              Feedback{' '}
              <span className="isotone-count">
                {visibleNotes.length || ''}
              </span>
            </h2>
            <button
              type="button"
              className="isotone-icon"
              aria-label="Close feedback"
                title="Close feedback"
              onClick={() => {
                setNotesOpen(false);
                setExpanded(false);
                setPicking(false);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
          <ul ref={listRef} className="isotone-list">
            {visibleNotes.map((note) => (
              <li
                key={note.id}
                data-motion-key={note.id}
                className={`isotone-note${editing?.id === note.id ? ' isotone-note-editing' : ''}`}
              >
                <button
                  type="button"
                  className="isotone-note-hit"
                  aria-current={editing?.id === note.id ? true : undefined}
                  onClick={() => beginEdit(note)}
                >
                  <NoteSummary note={note} />
                </button>
                <button
                  type="button"
                  className="isotone-x isotone-icon"
                  aria-label={note.variantAction ? 'Cancel removal' : 'Delete note'}
                  title={note.variantAction ? 'Cancel removal' : 'Delete note'}
                  onClick={() => void removeNote(note)}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="isotone-compose">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: This extends the native textarea's pointer area; keyboard users focus the textarea directly. */}
            <fieldset
              className="isotone-input"
              aria-label="Feedback composer"
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0) return;
                const target = event.target as Element;
                if (target.closest('button, textarea, input, select, a, [contenteditable="true"]')) return;
                textareaRef.current?.focus({ preventScroll: true });
              }}
            >
            <div className="isotone-context" aria-live="polite">
              {editing && (
                <span className="isotone-chip">
                  Editing note
                  <button
                    type="button"
                    aria-label="Cancel edit"
                    title="Cancel edit"
                    onClick={cancelEdit}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              )}
              {variantTarget && (
                <span className="isotone-chip">
                  <Icon name="sliders" size={12} />
                  <span onPointerOver={showOverflowTitle}>
                    {variantTarget.label}
                    {variantTarget.optionLabel
                      ? ` / ${variantTarget.optionLabel}`
                      : ''}
                  </span>
                  {!editing?.variantAction && <button
                    type="button"
                    aria-label="Remove variant reference"
                    title="Remove reference"
                    onClick={() => setVariantTarget(null)}
                  >
                    <Icon name="close" size={12} />
                  </button>}
                </span>
              )}
              {targets.map((target, index) => (
                <span
                  key={target.selector}
                  className="isotone-chip"
                >
                  <span onPointerOver={showOverflowTitle}>{target.text || target.tag}</span>
                  <button
                    type="button"
                    aria-label={`Remove pinned element ${index + 1}`}
                    title="Unpin element"
                    onClick={() =>
                      setTargets((prev) =>
                        prev.filter((t) => t.selector !== target.selector),
                      )
                    }
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
              {notice && (
                <p role="status" className="isotone-notice">
                  {notice}
                </p>
              )}
            </div>
            <textarea
              ref={textareaRef}
              value={text}
              aria-label="Feedback for the agent"
              onChange={(e) => setText(e.target.value)}
              onFocus={() => { if (!keepPicking.current) setPicking(false); }}
              onPointerDown={() => setPicking(false)}
              onScroll={event => {
                event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 0);
              }}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={
                targets.length || variantTarget
                  ? 'Feedback on your selection…'
                  : 'What would you change?'
              }
              rows={1}
              className="isotone-textarea"
            />
            <div className="isotone-toolbar">
              <button
                type="button"
                title="Select elements"
                aria-label="Select elements"
                aria-pressed={picking}
                className="isotone-pick isotone-icon"
                // Keep focus where it is, so a focused composer stays focused.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  cancelAnimationFrame(focusFrame.current);
                  setPicking((v) => !v);
                }}
              >
                <Icon name="pin" size={14} />
              </button>
              <button
                type="button"
                aria-label={editing ? 'Save edit' : 'Send note'}
                disabled={!text.trim()}
                className="isotone-send"
                title={editing ? 'Save edit (Enter)' : 'Send note (Enter)'}
                onClick={() => void send()}
              >
                <Icon name="send" size={14} />
              </button>
            </div>
            </fieldset>
          </div>
        </section>
      );
  if (!visible) return null;
  return (
    <div
      ref={rootRef}
      data-isotone
      data-theme={theme}
      data-expanded={railOpen}
      data-tools={Number(Boolean(variants)) + Number(notesAvailable)}
      data-instant={instant}
      data-notes-open={notesOpen}
      data-open={open}
      className="isotone-root"
    >
      <div className="isotone-rail-track" aria-hidden="true" />
      {picking && (
        <div className="isotone-hint" data-isotone>
          <span>{targets.length} selected · click to add or remove · hold ⇧ to use the page</span>
          <button
            type="button"
            onClick={() => {
              setPicking(false);
              focusComposer();
            }}
          >
            Done <kbd>↵</kbd>
          </button>
        </div>
      )}
      {picking &&
        [
          ...rects,
          ...(hoverRect
            ? [
                {
                  top: hoverRect.top,
                  left: hoverRect.left,
                  width: hoverRect.width,
                  height: hoverRect.height,
                  selector: '__hover',
                },
              ]
            : []),
        ].map((rect, i) => (
          <div
            key={rect.selector}
            data-isotone
            className={`isotone-hover${i < rects.length ? ' isotone-selected' : ''}`}
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
            }}
          />
        ))}
      <UpdateNotice endpoint={updateEndpoint} active={open} />
      <fieldset
        aria-label="Isotone tools"
        onKeyDown={event => {
          if (!(event.target as HTMLElement).classList.contains('isotone-rail-button')) return;
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.isotone-rail-button'));
          const at = buttons.indexOf(event.target as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (at + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}
        className="isotone-rail"
        data-expanded={railOpen}
        data-tools={Number(Boolean(variants)) + Number(notesAvailable)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
        }}
      >
        <div
          className="isotone-rail-tools"
          aria-hidden={!railOpen}
          ref={node => { node?.toggleAttribute('inert', !railOpen); }}
        >
          {variants && (
            <button
              type="button"
              className="isotone-rail-button"
              aria-label="Variants"
              title="Variants"
              aria-controls={`${id}-variants`}
              aria-expanded={variantsOpen}
              onClick={() => {
                setVariantsOpen((v) => !v);
                setExpanded(false);
              }}
            >
              <Icon name="sliders" /><span className="isotone-tool-label">Variants</span>
            </button>
          )}
          {variantsPanel}
          {notesPanel}
          {notesAvailable && (
            <button
              type="button"
              className="isotone-rail-button"
              aria-label="Feedback"
              title="Feedback"
              aria-controls={`${id}-notes`}
              aria-expanded={notesOpen}
              onClick={() => {
                setNotesOpen((v) => !v);
                setExpanded(false);
                if (!notesOpen) focusComposer();
              }}
            >
              <Icon name="message" /><span className="isotone-tool-label">Feedback <span className="isotone-count">{visibleNotes.length || ""}</span></span>
            </button>
          )}
        </div>
        <button
          type="button"
          ref={fabRef}
          className="isotone-fab"
          aria-hidden={railOpen}
          tabIndex={railOpen ? -1 : 0}
          aria-label={notesAvailable ? 'Isotone' : 'Variants'}
          title={`Isotone${shortcutLabel ? ` · ${shortcutLabel}` : ''}`}
          aria-expanded={railOpen}
          onClick={() => {
            if (open) closeAll();
            else if (expanded) setExpanded(false);
            else openInitial();
          }}
        >
          <Icon name="iterate" />
          {visibleNotes.length > 0 && (
            <span className="isotone-badge">{visibleNotes.length}</span>
          )}
        </button>
      </fieldset>
    </div>
  );
}
