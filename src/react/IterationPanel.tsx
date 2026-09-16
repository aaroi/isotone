import { useEffect, useRef, useState } from 'react';

import {
  createIterationStore,
  describeIterationElement,
  elementAsNode,
  isRouteVisible,
  type IterationElement,
  type IterationNote,
  type IterationStoreConfig,
  type RouteGateOptions,
} from '../core/index';
import { type VariantsSource, visibleAxes } from '../core/variants';
import { ensurePanelStyles } from './styles';
import { refreshSource, useVariantsSource, VariantsView } from './VariantsView';

type PanelTab = 'variants' | 'notes';

function readTabPreference(key: string): PanelTab | null {
  try {
    const v = window.localStorage.getItem(key);
    return v === 'variants' || v === 'notes' ? v : null;
  } catch {
    return null;
  }
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Excludes the panel's own chrome from element picking. */
function elementAt(e: MouseEvent): Element | null {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  return el && !el.closest('[data-iso-iterate]') ? el : null;
}

/** Compact mono timestamp: time today, date otherwise. */
function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * sRGB (0-255) components of a computed backgroundColor, or null when the
 * browser can't parse it.
 *
 * A computed backgroundColor comes in any modern CSS color space — `#09090b`,
 * `rgba(...)`, `lab(...)`, `oklch(...)`, `hsl(...)` or `color(display-p3 ...)`.
 * Rather than hand-roll each grammar, hand the string back to the browser:
 * paint a 1×1 canvas with it and read the sRGB pixel. The round-trip validates
 * the value and pays for every color-space conversion, so the luminance test
 * sees the color as the screen renders it.
 */
function parseColor(c: string): { r: number; g: number; b: number; a: number } | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  } catch {
    return null;
  }
}

/**
 * Match the page under the panel: the top-most painted background at the
 * panel's corner decides the theme, so the control reads as part of a light
 * page and part of a dark one without any host configuration. An unpainted
 * stack means the browser's white canvas, hence light.
 */
function detectTheme(): 'dark' | 'light' {
  try {
    const x = Math.max(0, window.innerWidth - 44);
    const y = Math.max(0, window.innerHeight - 44);
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.closest('[data-iso-iterate]')) continue;
      const parsed = parseColor(getComputedStyle(el).backgroundColor);
      if (!parsed || parsed.a < 0.5) continue;
      const lum = (0.2126 * parsed.r + 0.7152 * parsed.g + 0.0722 * parsed.b) / 255;
      return lum > 0.55 ? 'light' : 'dark';
    }
  } catch {}
  return 'light';
}

export interface IterationPanelProps {
  /** The current route; the panel hides itself when `rule` excludes it. */
  route: string;
  /** Store wiring — endpoint (the Vite plugin's URL) + optional namespace. */
  store: IterationStoreConfig;
  /** Route visibility. When omitted you get the safe default (hidden on the
   *  auth/error pages). Pass an explicit list to allow-list your app's pages. */
  rule?: RouteGateOptions;
  /**
   * Host context attached to each NEW note as its opaque `payload` — the state
   * that gives a note its meaning (e.g. the variant knob settings it was
   * written against). Called at send time. Edits never re-attach it: the
   * snapshot belongs to the moment the note was written.
   */
  getPayload?: () => unknown;
  /**
   * Variants for the current page. With axes to show AND a notes endpoint the
   * panel grows a Variants / Notes tab bar; with only one of the two it is
   * just that content. A host with its own variant system hands over a
   * `VariantsSource`; the Vite plugin passes the overlay adapter.
   */
  variants?: VariantsSource;
  /** Which tab a tabbed panel opens on before the reviewer has picked one.
   *  Defaults to Notes; a host whose reviewers come for the controls (a
   *  preview site) passes `'variants'`. The reviewer's own choice, once
   *  made, wins. */
  defaultTab?: 'variants' | 'notes';
}

/**
 * The Iteration panel: INTERNAL feedback for the coding agent.
 *
 * The model is a chat with the agent. Notes list oldest→newest with the
 * composer pinned at the bottom, Enter sends (Shift+Enter for a newline), the
 * field clears instantly and keeps focus, and the new note appears right above
 * it — so writing five notes in a row is five sentences, no waiting, and
 * nothing under the cursor moves. A note optionally carries an element: the
 * crosshair in the composer starts the picker, and the pinned element rides
 * along as a removable chip. Unsent text survives close/reopen as a draft.
 */
export function IterationPanel({
  route,
  store: storeCfg,
  rule,
  getPayload,
  variants,
  defaultTab = 'notes',
}: IterationPanelProps) {
  const [store] = useState(() => createIterationStore(storeCfg));
  const nsKey = storeCfg.key ?? 'iso-iterate-feedback';
  const tabKey = `${nsKey}::tab`;
  const [tabPref, setTabPref] = useState<PanelTab | null>(() => readTabPreference(tabKey));
  // The overlay source only has axes after it has listed them, so the tab
  // bar has to follow the source, not just the initial render.
  useVariantsSource(variants);
  // Production hosts mount without a notes endpoint; then the panel is
  // variants only and the composer never renders.
  const notesAvailable = Boolean(storeCfg.endpoint);
  const variantsAvailable = variants
    ? visibleAxes(variants.getAxes(), variants.getSelections()).length > 0
    : false;
  const tabbed = notesAvailable && variantsAvailable;
  const tab: PanelTab = tabbed
    ? (tabPref ?? defaultTab)
    : variantsAvailable && !notesAvailable
      ? 'variants'
      : 'notes';
  const showNotes = tab === 'notes';
  function chooseTab(next: PanelTab) {
    setTabPref(next);
    try {
      window.localStorage.setItem(tabKey, next);
    } catch {}
  }
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<IterationElement | null>(null);
  const [hoverRect, setHoverRect] = useState<Rect | null>(null);
  const [text, setText] = useState('');
  /** The last save landed in localStorage, not on the dev server. */
  const [unsynced, setUnsynced] = useState(false);
  const [notes, setNotes] = useState<IterationNote[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const draftKey = `${nsKey}::draft::${route}`;

  const MAX_TEXTAREA_H = 148;
  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_H)}px`;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: autosize reads only the ref; text drives the re-run.
  useEffect(() => autosize(textareaRef.current), [text]);

  // A route the rule hides, or a panel with nothing to offer (no notes
  // endpoint and no axes on this page), renders nothing at all.
  const visible = isRouteVisible(route, rule) && (notesAvailable || variantsAvailable);
  const openCount = notes?.filter((n) => !n.done).length ?? 0;
  // Chat order: oldest at the top, newest right above the composer.
  const visibleNotes = (notes ?? [])
    .filter((n) => !n.done)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  /**
   * Send the composer. The field clears and keeps focus IMMEDIATELY — the
   * write happens behind an optimistic row, so the next note starts with the
   * next keystroke. The store falls back to localStorage when the endpoint is
   * down, so the catch path is a dev-server blip, not data loss.
   */
  function send() {
    const value = text.trim();
    if (value === '') return;
    const element = target;
    const editing = editingId;
    setText('');
    setTarget(null);
    setEditingId(null);
    try {
      window.localStorage.removeItem(draftKey);
    } catch {}
    textareaRef.current?.focus();

    if (editing) {
      setNotes((prev) =>
        prev?.map((n) => (n.id === editing ? { ...n, feedback: value, element } : n)) ??
        prev,
      );
      // Edits omit the payload on purpose: the stored snapshot stays.
      void store.saveNote(route, value, element, editing).catch(() => {});
      return;
    }

    const tempId = `pending-${Math.random().toString(36).slice(2)}`;
    const entry: IterationNote = {
      id: tempId,
      route,
      feedback: value,
      element,
      done: false,
      createdAt: new Date().toISOString(),
    };
    setNotes((prev) => (prev ? [...prev, entry] : [entry]));
    const viewport = { w: window.innerWidth, h: window.innerHeight };
    void store
      .saveNote(route, value, element, null, getPayload?.(), viewport)
      .then((id) => {
        setNotes((prev) =>
          prev?.map((n) => (n.id === tempId ? { ...n, id } : n)) ?? prev,
        );
        // A save that fell back to this browser's storage has not reached
        // the file the agent reads. Say so here, where the note was written.
        setUnsynced(store.lastSave === 'local');
      })
      .catch(() => {
        setNotes((prev) => prev?.filter((n) => n.id !== tempId) ?? prev);
      });
  }

  function beginEdit(note: IterationNote) {
    setText(note.feedback);
    setTarget(note.element);
    setEditingId(note.id);
    textareaRef.current?.focus();
  }

  function cancelEdit() {
    setText('');
    setTarget(null);
    setEditingId(null);
  }

  async function removeNote(id: string) {
    setNotes((prev) => prev?.filter((n) => n.id !== id) ?? prev);
    if (editingId === id) cancelEdit();
    try {
      await store.deleteNote(id);
    } catch {}
  }

  // Refresh the list on every open — the agent marks notes done between
  // opens, and the queue should drain visibly. Skipped while an optimistic
  // row is still in flight so a just-sent note cannot blink out. Also
  // restores the unsent draft.
  // The overlay source lists its variants from the dev server, so it is
  // re-read on every open. The view refreshes itself on mount, so this only
  // covers an open that lands on Notes (or on a source with no axes yet).
  // biome-ignore lint/correctness/useExhaustiveDependencies: an open-time action; the tab is read, not tracked.
  useEffect(() => {
    if (!open || !variants || tab === 'variants') return;
    refreshSource(variants);
  }, [open, variants]);

  // A source that learns its axes from the network starts empty, and a
  // panel with no notes endpoint has nothing else to show, so it never
  // renders the launcher that the open-time refresh above hangs off. Ask
  // once at mount so the launcher can appear at all.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a mount-time action; the axes are read, not tracked.
  useEffect(() => {
    if (!variants || variantsAvailable) return;
    refreshSource(variants);
  }, [variants]);

  // Also on a switch to the Notes tab: "Save as defaults" in the Variants
  // tab files a note, and the reviewer expects to see it the moment they
  // look, without closing and reopening the panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refetch is an open-time action; store is stable.
  useEffect(() => {
    if (!open || !notesAvailable || !showNotes) return;
    // Every route's notes, so feedback accumulates in one list whatever page
    // is open; each row says which page it belongs to.
    store
      .listNotes()
      .then((fresh) => {
        setNotes((prev) =>
          prev?.some((n) => n.id.startsWith('pending-')) ? prev : fresh,
        );
        // The endpoint answered, and the list call flushed any backlog.
        setUnsynced(false);
      })
      .catch(() => setNotes((prev) => prev ?? []));
    if (text === '') {
      try {
        const draft = window.localStorage.getItem(draftKey);
        if (draft) setText(draft);
      } catch {}
    }
  }, [open, route, showNotes]);

  // Unsent text survives close/reopen — the safety autosave used to provide,
  // without autosave's side effects (no phantom notes, no field-clearing).
  useEffect(() => {
    if (editingId) return; // an edit is not a draft
    try {
      if (text.trim() === '') window.localStorage.removeItem(draftKey);
      else window.localStorage.setItem(draftKey, text);
    } catch {}
  }, [text, editingId, draftKey]);

  // Keep the newest note in view: the list sticks to its bottom edge.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll position follows list growth.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [notes, open]);

  // Focus the composer whenever the panel is in front of the reviewer.
  useEffect(() => {
    if (open && !picking) textareaRef.current?.focus();
  }, [open, picking]);

  // Re-read the page under the panel on mount, route change and open — and
  // whenever html/body attributes change, which is where a host's own theme
  // switch lands (a class or data attribute flip).
  // biome-ignore lint/correctness/useExhaustiveDependencies: open/route are re-detection triggers, not read inside.
  useEffect(() => {
    if (!visible) return;
    setTheme(detectTheme());
    // Twice per mutation: right away for hosts that switch instantly, and
    // again after ~350ms because a host that transitions its background
    // (transition: background 200ms) still computes the OLD color at
    // mutation time — the immediate sample alone locks in the wrong theme.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const redetect = () => {
      setTheme(detectTheme());
      clearTimeout(settle);
      settle = setTimeout(() => setTheme(detectTheme()), 350);
    };
    const observer = new MutationObserver(redetect);
    observer.observe(document.documentElement, { attributes: true });
    if (document.body) observer.observe(document.body, { attributes: true });
    return () => {
      observer.disconnect();
      clearTimeout(settle);
    };
  }, [visible, open, route]);

  // Selector mode: highlight the hovered element, capture the click.
  useEffect(() => {
    if (!picking) return;
    document.body.style.cursor = 'crosshair';
    // One highlight update per frame: mousemove fires far more often than
    // the screen paints, and each update is an elementFromPoint + a render.
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = elementAt(e);
        if (!el) return setHoverRect(null);
        const r = el.getBoundingClientRect();
        setHoverRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    const onClick = (e: MouseEvent) => {
      const el = elementAt(e);
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setTarget(describeIterationElement(elementAsNode(el)));
      setPicking(false);
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPicking(false);
        setOpen(true);
      }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.cursor = '';
      cancelAnimationFrame(frame);
      setHoverRect(null);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [picking]);

  // Styles travel with the panel: a host embedding this component needs no CSS
  // import of ours, and a shadow-mounted one gets them inside its boundary
  // (where a stylesheet in document.head would never reach). Idempotent.
  useEffect(() => {
    if (!visible) return; // nothing rendered yet, so no root to style
    const root = rootRef.current?.getRootNode();
    if (root instanceof ShadowRoot || root instanceof Document) {
      ensurePanelStyles(root);
    }
  }, [visible]);

  // Escape backs out one layer (edit → panel); outside click closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingId) {
        setText('');
        setTarget(null);
        setEditingId(null);
      } else {
        setOpen(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      // composedPath, not `contains(e.target)`: a listener on window sees
      // events from inside a shadow root retargeted to the host, so `contains`
      // reports every click on our own panel as an outside click and the panel
      // closes under the cursor. The composed path still holds the real nodes.
      const root = rootRef.current;
      if (root && !e.composedPath().includes(root)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, editingId]);

  if (!visible) return null;

  return (
    <div ref={rootRef} data-iso-iterate data-theme={theme} className="iso-iter-root">
      {picking && (
        <span data-iso-iterate className="iso-iter-hint">
          click an element · esc cancels
        </span>
      )}

      {picking && hoverRect && (
        <div
          data-iso-iterate
          className="iso-iter-hover"
          style={{
            top: hoverRect.top,
            left: hoverRect.left,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      )}

      {open && !picking && (
        <div
          data-iso-iterate
          role="dialog"
          aria-label={showNotes ? 'Iteration notes' : 'Iteration variants'}
          className="iso-iter-panel"
        >
          {tabbed && (
            <div className="iso-iter-tabs" role="tablist">
              {(['variants', 'notes'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  data-iso-iterate
                  role="tab"
                  aria-selected={tab === t}
                  className={tab === t ? 'iso-iter-tab iso-iter-tab-on' : 'iso-iter-tab'}
                  onClick={() => chooseTab(t)}
                >
                  {t === 'variants' ? 'Variants' : 'Notes'}
                </button>
              ))}
            </div>
          )}

          {!showNotes && variants && <VariantsView source={variants} showTitle={!tabbed} />}

          {showNotes && visibleNotes.length > 0 && (
            <ul ref={listRef} className="iso-iter-list">
              {visibleNotes.map((note) => (
                <li
                  key={note.id}
                  className={[
                    'iso-iter-note',
                    note.done ? 'iso-iter-note-done' : '',
                    editingId === note.id ? 'iso-iter-note-editing' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    type="button"
                    data-iso-iterate
                    className="iso-iter-note-hit"
                    disabled={note.done}
                    title={note.feedback}
                    onClick={() => beginEdit(note)}
                  >
                    <div className="iso-iter-row">
                      <p>{note.feedback}</p>
                      <span className="iso-iter-when">
                        {note.done ? '✓ done' : timeLabel(note.createdAt)}
                      </span>
                    </div>
                    <div className="iso-iter-meta">
                      <span
                        className={
                          note.route === route ? 'iso-iter-route iso-iter-route-here' : 'iso-iter-route'
                        }
                        title={note.route === route ? 'This page' : `On ${note.route}`}
                      >
                        {note.route}
                      </span>
                      {note.element && (
                        <span className="iso-iter-el" title={note.element.selector}>
                          ↳ {note.element.tag}
                          {note.element.text ? ` · ${note.element.text}` : ''}
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    data-iso-iterate
                    aria-label="Delete note"
                    className="iso-iter-x"
                    onClick={() => void removeNote(note.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showNotes && (
            <div className="iso-iter-compose">
              {editingId && (
                <div className="iso-iter-editing">
                  <span>editing note</span>
                  <button type="button" data-iso-iterate onClick={cancelEdit}>
                    cancel
                  </button>
                </div>
              )}
              {unsynced && (
                <p className="iso-iter-notice" role="status">
                  Saved in this browser only — the dev server did not answer.
                  It syncs the next time the panel opens with the server up.
                </p>
              )}
              {target && (
                <div className="iso-iter-chip" title={target.selector}>
                  <span>
                    ↳ {target.tag}
                    {target.text ? ` · ${target.text}` : ''}
                  </span>
                  <button
                    type="button"
                    data-iso-iterate
                    aria-label="Remove pinned element"
                    onClick={() => setTarget(null)}
                  >
                    ×
                  </button>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => {
                  autosize(e.target);
                  setText(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  target ? 'Feedback on the pinned element…' : 'Feedback for the agent…'
                }
                rows={1}
                className="iso-iter-textarea"
              />
              <div className="iso-iter-toolbar">
                <button
                  type="button"
                  data-iso-iterate
                  title="Pin an element"
                  aria-label="Pin an element"
                  className={target ? 'iso-iter-pick iso-iter-pick-on' : 'iso-iter-pick'}
                  onClick={() => {
                    setOpen(false);
                    setPicking(true);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <title>Pin an element</title>
                    <circle cx="12" cy="12" r="7" />
                    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
                  </svg>
                </button>
                <button
                  type="button"
                  data-iso-iterate
                  aria-label={editingId ? 'Save edit' : 'Send note'}
                  title="Send — Enter"
                  disabled={text.trim() === ''}
                  className="iso-iter-send"
                  onClick={send}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <title>Send</title>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        data-iso-iterate
        onClick={() => {
          if (picking) {
            setPicking(false);
            setOpen(true);
          } else {
            setOpen((v) => !v);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          !notesAvailable
            ? 'Variants'
            : openCount > 0
              ? `Iteration — ${openCount} open notes`
              : 'Iteration'
        }
        className="iso-iter-fab"
      >
        {notesAvailable ? (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <title>Iteration</title>
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
          </svg>
        ) : (
          // A variants-only host has no composer behind this button, so the
          // pencil would promise something that is not there.
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <title>Variants</title>
            <path d="M4 6h9M19 6h1M4 12h3M11 12h9M4 18h11M19 18h1" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="9" cy="12" r="2" />
            <circle cx="17" cy="18" r="2" />
          </svg>
        )}
        {openCount > 0 && <span className="iso-iter-badge">{openCount}</span>}
      </button>
    </div>
  );
}
