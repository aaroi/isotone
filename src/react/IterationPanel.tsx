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
import { BlastNotice } from './BlastNotice';
import { MOTION } from './motion';
import { HINTS } from './hints';
import { isCompactViewport, prefersTouch, useKeyboardInset, visibleBand } from './viewport';

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
  /** Local adapter endpoint for the Blast session indicator. */
  blastEndpoint?: string;
  route: string;
  store: IterationStoreConfig;
  rule?: RouteGateOptions;
  getPayload?: () => unknown;
  variants?: VariantsSource;
  /** What the Variants list says on a page without selectors. */
  variantsEmptyText?: string;
  /** Initial surface. Kept for compatibility; surfaces can now open together. */
  defaultTab?: 'variants' | 'notes';
  /** Default: Cmd/Ctrl+Shift+Period. false disables the shortcut. */
  shortcut?: IterationShortcut | false;
}
const PULSE_MS = 2000;

/**
 * Where the composer floats while writing about pinned elements: the point
 * that was clicked, kept relative to its element so it follows scrolling.
 * x and y are the last known viewport point, for when the element is gone.
 */
interface Anchor {
  selector: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
  /** Pinned by touch: open beside the element, since a finger hides the point. */
  beside?: boolean;
}
/** Space between the clicked point and the floating composer, and its viewport margin. */
const FLOAT_GAP = 12;
const FLOAT_MARGIN = 8;

/**
 * Pulse a node on the document's own clock. Every pulse starts at the timeline's
 * origin, so the launcher ring and every note dot beat together whenever they
 * appear, instead of each starting from its own mount time.
 */
function syncPulse(spread: number) {
  return (node: HTMLElement | null) => {
    if (!node || typeof node.animate !== 'function') return;
    if (node.closest('[data-instant="true"]') ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    const tint = 'color-mix(in srgb, var(--iso-focus) 55%, transparent)';
    const pulse = node.animate([
      { boxShadow: `0 0 0 0 ${tint}`, offset: 0 },
      { boxShadow: `0 0 0 ${spread}px transparent`, offset: 0.7 },
      { boxShadow: `0 0 0 ${spread}px transparent`, offset: 1 },
    ], { duration: PULSE_MS, iterations: Infinity, easing: 'ease-out' });
    pulse.startTime = 0;
  };
}
/** Keyboard use and reduced motion make the panel immediate. */
function stillMotion(node: Element) {
  return Boolean(node.closest('[data-instant="true"]')) ||
    (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
/**
 * Fade an element in once, when it mounts. A CSS animation would replay
 * whenever the panel switches between keyboard and pointer use, since that
 * toggles animations off and on again; an animation started here cannot.
 * `data-still` on the element skips it.
 */
function fadeIn(node: HTMLElement | null) {
  if (!node || typeof node.animate !== 'function' || node.dataset.still === 'true' || stillMotion(node)) return;
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}
/** The same, for a control whose surface stays put while its content arrives. */
function fadeInContent(node: HTMLElement | null) {
  if (!node || stillMotion(node)) return;
  for (const child of node.children)
    if (typeof child.animate === 'function')
      child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}
const dotPulse = syncPulse(6);
const ringPulse = syncPulse(8);

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

/** How long "an agent is working on this" is believed without a sign of life. */
const WORKING_FRESH_MS = 20 * 60 * 1000;

const DEFAULT_SHORTCUT: IterationShortcut = {
  code: 'Period',
  mod: true,
  shift: true,
};

export function IterationPanel({
  route,
  theme: themePreference = 'auto',
  updateEndpoint,
  blastEndpoint,
  store: storeCfg,
  rule,
  getPayload,
  variants,
  variantsEmptyText,
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
  // Selecting that starts with the panel shows its cover at once, so the field
  // underneath never shows through while the panel fades in.
  const [pickingWithPanel, setPickingWithPanel] = useState(false);
  const [targets, setTargets] = useState<IterationElement[]>([]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  // Set once an element is pinned: the composer leaves the dock and floats next to it.
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const floating = anchor !== null;
  const floatRef = useRef<HTMLDivElement>(null);
  // The dock keeps the composer's height while it floats, so the panel stays put.
  const slotHeight = useRef(0);
  // Where the floating composer last was, so moving to a new pin glides there.
  const lastFloat = useRef<{ left: number; top: number } | null>(null);
  const floatNode = useRef<HTMLDivElement | null>(null);
  const [variantTarget, setVariantTarget] = useState<VariantReference | null>(
    null,
  );
  const [hoverRect, setHoverRect] = useState<Rect | null>(null);
  const [rects, setRects] = useState<(Rect & { selector: string })[]>([]);
  // The elements clicked, by selector. A re-render can shift a path onto a
  // different element, and the highlight has to stay on the one that was picked.
  const pinnedElements = useRef(new Map<string, Element>());
  const locate = useCallback((selector: string): Element | null => {
    const pinned = pinnedElements.current.get(selector);
    if (pinned?.isConnected) return pinned;
    try { return document.querySelector(selector); } catch { return null; }
  }, []);
  const [text, setText] = useState('');
  const [notes, setNotes] = useState<IterationNote[]>([]);
  // Which pages' notes the list shows. Unset means this page only.
  const [scope, setScope] = useState<string[] | null>(null);
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const pollRev = useRef<string | null>(null);
  const noteRevision = useRef(0);
  const pendingWrites = useRef(0);
  const noteRequest = useRef(0);
  const [editing, setEditing] = useState<IterationNote | null>(null);
  const [notice, setNotice] = useState('');
  const [theme, setTheme] = useState(() => detectTheme(themePreference));
  const [instant, setInstant] = useState(false);
  // Hints follow the last pointer used, so a hybrid device gets the right words.
  const [touch, setTouch] = useState(prefersTouch);
  const touchRef = useRef(touch);
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
  }, [text, notesOpen, visible, hasContext, floating]);
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
  useKeyboardInset(rootRef, visible);
  // A small screen has room for one panel: the one just opened stays.
  const wasOpen = useRef({ notes: notesOpen, variants: variantsOpen });
  useLayoutEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = { notes: notesOpen, variants: variantsOpen };
    if (!notesOpen || !variantsOpen || !isCompactViewport()) return;
    if (was.variants) setVariantsOpen(false);
    else {
      setNotesOpen(false);
      setPicking(false);
    }
  }, [notesOpen, variantsOpen]);
  const open = notesOpen || variantsOpen;
  const railOpen = expanded || hovered || (focused && instant) || open || picking;
  useEffect(() => {
    if (!railOpen || !instant) return;
    const active = (rootRef.current?.getRootNode() as Document | ShadowRoot)?.activeElement;
    if (active === fabRef.current) rootRef.current?.querySelector<HTMLButtonElement>('.isotone-rail-button')?.focus();
  }, [railOpen, instant]);
  const draftKey = `${nsKey}::draft::${route}`;
  const openNotes = useMemo(() => notes.filter((n) => !n.done), [notes]);
  // Pages that have open notes, this one first, so the row of page chips reads
  // the same on every page.
  const pages = useMemo(() => {
    const counts = new Map<string, number>();
    // The update note belongs to the project, not a page: it shows everywhere.
    for (const n of openNotes) if (!n.update) counts.set(n.route, (counts.get(n.route) ?? 0) + 1);
    const others = [...counts.keys()].filter((r) => r !== route).sort();
    return { counts, others };
  }, [openNotes, route]);
  const selectedPages = useMemo(() => {
    const chosen = (scope ?? [route]).filter((r) => r === route || pages.counts.has(r));
    return new Set(chosen.length ? chosen : [route]);
  }, [scope, route, pages]);
  const updateRequested = useMemo(() => openNotes.some((n) => n.update), [openNotes]);
  const visibleNotes = useMemo(() => openNotes
    .filter((n) => n.update || selectedPages.has(n.route))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [openNotes, selectedPages]);
  // An agent's claim goes stale: a crashed or abandoned run should not pulse forever.
  const working = useMemo(() => new Set(visibleNotes
    .filter((n) => n.workingAt && clock - Date.parse(n.workingAt) < WORKING_FRESH_MS)
    .map((n) => n.id)), [visibleNotes, clock]);
  // Every note in progress, on any page: a Blast agent works across routes.
  const allWorking = useMemo(() => openNotes
    .filter((n) => n.workingAt && clock - Date.parse(n.workingAt) < WORKING_FRESH_MS).length, [openNotes, clock]);
  // One notice dialog at a time beside the pill.
  const [openNotice, setOpenNotice] = useState<'update' | 'blast' | null>(null);
  function togglePage(page: string) {
    const next = new Set(selectedPages);
    if (next.has(page)) next.delete(page); else next.add(page);
    setScope(next.size ? [...next] : [route]);
  }
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
      .pollNotes(null)
      .then((result) => ({ rev: result.rev, notes: result.notes ?? [] }))
      // Server away: show what this browser kept, if anything.
      .catch(() => store.pendingNotes().then((fresh) => ({ rev: null, notes: fresh })))
      .then(({ rev, notes: fresh }) => {
        // An old refresh must not restore deleted notes or undo optimistic edits.
        if (request !== noteRequest.current || revision !== noteRevision.current || pendingWrites.current) return;
        pollRev.current = rev;
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
      textareaRef.current?.focus({ preventScroll: true });
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
    setAnchor(null);
    setExpanded(false);
    setHovered(false);
    (previousFocus.current?.isConnected
      ? previousFocus.current
      : fabRef.current
    )?.focus();
  }
  /** The pointer and the shortcut start selecting; Enter or Space on a focused button goes to the field. */
  function startFeedback(select: boolean) {
    setNotesOpen(true);
    if (select) {
      cancelAnimationFrame(focusFrame.current);
      setPickingWithPanel(!notesOpen);
      setPicking(true);
    } else focusComposer();
  }
  function openInitial(select: boolean) {
    previousFocus.current = document.activeElement as HTMLElement | null;
    setExpanded(true);
    if ((defaultTab === 'variants' || !notesAvailable) && variantsAvailable)
      setVariantsOpen(true);
    else startFeedback(select);
  }
  /** Put the composer back in the dock, keeping what was written and pinned. */
  function dockComposer() {
    setAnchor(null);
    setPicking(false);
    focusComposer();
  }
  function feedback(reference: VariantReference) {
    setAnchor(null);
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
    setPicking(false);
    setAnchor(null);
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
    setAnchor(null);
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

  // Opening a surface or changing route loads at once; the poll below keeps it current.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-time refresh; store is stable.
  useEffect(() => {
    loadNotes();
  }, [notesOpen, variantsOpen, route]);
  // Keep the list current while the page is in front: an agent closing a note
  // shows up here without a reload. Only the notes request is repeated, so
  // nothing on the page, the composer or an edit in progress is touched. An
  // idle poll costs the server one stat; a hidden tab does not poll at all;
  // an unreachable server is retried less and less often.
  useEffect(() => {
    if (!notesAvailable || !visible) return;
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
      const request = noteRequest.current;
      const revision = noteRevision.current;
      try {
        const result = await store.pollNotes(pollRev.current);
        failures = 0;
        // A local save, delete or reload while the request was out wins over it.
        if (stopped || request !== noteRequest.current || revision !== noteRevision.current || pendingWrites.current) return;
        pollRev.current = result.rev;
        const fresh = result.notes;
        if (fresh) setNotes((prev) => (sameNotes(prev, fresh) ? prev : fresh));
        // Coarse on purpose: the value only ages out stale claims, and an
        // unchanged minute lets React skip the render.
        setClock(Math.floor(Date.now() / 60_000) * 60_000);
      } catch {
        failures = Math.min(failures + 1, 8);
      } finally {
        running = false;
        schedule();
      }
    };
    const wake = () => {
      if (document.hidden) { clearTimeout(timer); return; }
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
  }, [notesAvailable, visible, store]);
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
    setAnchor(null);
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
      if (!notesAvailable) setVariantsOpen((v) => !v);
      else if (picking) {
        setPicking(false);
        focusComposer();
      } else {
        if (!open)
          previousFocus.current = document.activeElement as HTMLElement;
        setExpanded(true);
        startFeedback(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      rootRef.current?.setAttribute('data-instant', 'false');
      setInstant(false);
      if (e.pointerType) {
        touchRef.current = e.pointerType === 'touch';
        setTouch(touchRef.current);
      }
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
      if (anchor) dockComposer();
      else if (editing) cancelEdit();
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
    // Only a hovering pointer previews; a finger has nothing to preview before it taps.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      cancelAnimationFrame(frame);
      const deferred = e.shiftKey;
      frame = requestAnimationFrame(() => {
        const el = deferred ? null : elementAt(e);
        setHoverRect(el ? el.getBoundingClientRect() : null);
      });
    };
    const toggleTarget = (el: Element) => {
      const target = describeIterationElement(elementAsNode(el));
      pinnedElements.current.set(target.selector, el);
      const added = !targetsRef.current.some((t) => t.selector === target.selector);
      setTargets((prev) =>
        prev.some((t) => t.selector === target.selector)
          ? prev.filter((t) => t.selector !== target.selector)
          : prev.length < 50
            ? [...prev, target]
            : prev,
      );
      return added ? target : null;
    };
    const onClick = (e: MouseEvent) => {
      // Shift passes the click through so the page can open menus and tabs first.
      if (e.shiftKey) return;
      const el = elementAt(e);
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const added = toggleTarget(el);
      // The composer comes to the element that was just pinned, ready for typing.
      if (added) {
        const r = el.getBoundingClientRect();
        const pointed = e.detail > 0 || e.clientX !== 0 || e.clientY !== 0;
        const x = pointed ? e.clientX : r.left;
        const y = pointed ? e.clientY : r.bottom;
        if (!anchorRef.current)
          slotHeight.current = rootRef.current?.querySelector<HTMLElement>('.isotone-notes-panel .isotone-input')?.offsetHeight ?? 0;
        setAnchor({ selector: added.selector, dx: x - r.left, dy: y - r.top, x, y, beside: touchRef.current && pointed });
        setNotesOpen(true);
        focusWhilePicking();
      }
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
      // The composer is covered while selecting. Typing a character finishes
      // selecting and lands in the composer, unless the page has an input focused.
      const typing = e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && !e.isComposing;
      if (typing) {
        const el = e.composedPath().find((node): node is Element => node instanceof Element);
        if (el && !el.closest('[data-isotone]') && el.closest('input, textarea, select, [contenteditable]')) return;
        setPicking(false);
        setNotesOpen(true);
        textareaRef.current?.focus();
        return;
      }
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      // The floating composer is not covered, so Enter there sends what is written.
      const field = textareaRef.current;
      if (
        e.key === 'Enter' && anchorRef.current && field && !e.shiftKey &&
        field.value.trim() && e.composedPath().includes(field)
      )
        return;
      e.preventDefault();
      e.stopImmediatePropagation();
      // Enter keeps what was pinned. Escape cancels the selection: the pins go,
      // what was written stays, and the composer returns to the dock.
      if (e.key === 'Escape') {
        setTargets([]);
        setAnchor(null);
      }
      setPicking(false);
      setNotesOpen(true);
      focusComposer();
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.cursor = cursor;
      cancelAnimationFrame(frame);
      setHoverRect(null);
      window.removeEventListener('pointermove', onMove, true);
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
    // Presses and clicks only. Releases (pointerup, mouseup, touchend) still
    // reach the page, so a host drag that ends over the dock still ends.
    const types = ['pointerdown', 'mousedown', 'touchstart', 'click'];
    for (const type of types) shadow.addEventListener(type, stop);
    return () => { for (const type of types) shadow.removeEventListener(type, stop); };
  }, []);
  useEffect(() => {
    if (!notesOpen) setAnchor(null);
  }, [notesOpen]);
  // Place the floating composer beside its anchor, inside the viewport. It opens
  // below the point when it fits and above otherwise, and keeps that side while
  // it grows, so typing never makes it jump.
  useLayoutEffect(() => {
    const float = floatRef.current;
    if (!anchor || !float) {
      lastFloat.current = null;
      return;
    }
    floatNode.current = float;
    const from = lastFloat.current;
    let frame: number | undefined;
    let side: 'below' | 'above' | null = null;
    const place = () => {
      frame = undefined;
      let { x, y } = anchor;
      const el = locate(anchor.selector);
      const r = el?.getBoundingClientRect();
      if (r) {
        x = r.left + anchor.dx;
        y = r.top + anchor.dy;
      }
      const vw = document.documentElement.clientWidth || innerWidth;
      const vh = innerHeight;
      // Above an on-screen keyboard, when one is open.
      const band = visibleBand();
      const minY = band.top + FLOAT_MARGIN;
      const maxY = band.bottom - FLOAT_MARGIN;
      const w = float.offsetWidth;
      const h = float.offsetHeight;
      const fits = (below: number, above: number) =>
        [below + FLOAT_GAP + h <= maxY, above - FLOAT_GAP - h >= minY] as const;
      // A touch pin opens under or over the whole element, centred on the tap,
      // unless the element is too tall for either; a pointer pin opens at the point.
      let belowY = y;
      let aboveY = y;
      let left = x + FLOAT_GAP;
      if (anchor.beside && r && fits(r.bottom, r.top).some(Boolean)) {
        belowY = r.bottom;
        aboveY = r.top;
        left = x - w / 2;
      } else if (left + w > vw - FLOAT_MARGIN) left = x - FLOAT_GAP - w;
      left = Math.max(FLOAT_MARGIN, Math.min(left, vw - w - FLOAT_MARGIN));
      const [fitsBelow, fitsAbove] = fits(belowY, aboveY);
      if (side === null || (side === 'below' ? !fitsBelow && fitsAbove : !fitsAbove && fitsBelow))
        side = fitsBelow || !fitsAbove ? 'below' : 'above';
      float.style.left = `${left}px`;
      let top: number;
      if (side === 'below') {
        top = Math.max(minY, Math.min(belowY + FLOAT_GAP, maxY - h));
        float.style.top = `${top}px`;
        float.style.bottom = 'auto';
      } else {
        const bottom = Math.max(vh - maxY, Math.min(vh - aboveY + FLOAT_GAP, vh - h - minY));
        float.style.bottom = `${bottom}px`;
        float.style.top = 'auto';
        top = vh - bottom - h;
      }
      float.style.transformOrigin = `${x - left}px ${y - top}px`;
      lastFloat.current = { left, top };
    };
    const schedule = () => { frame ??= requestAnimationFrame(place); };
    place();
    // The composer grows out of the clicked point once, when it opens. A later
    // pin moves it, and it glides there rather than jumping.
    const to = lastFloat.current;
    const still = stillMotion(float) || typeof float.animate !== 'function';
    let glide: Animation | undefined;
    if (still) {
      // Immediate: no movement.
    } else if (!from)
      glide = float.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: MOTION.enter, easing: MOTION.easeOut });
    else if (to && (from.left !== to.left || from.top !== to.top))
      glide = float.animate(
        [{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0 0' }],
        { duration: MOTION.enter, easing: MOTION.easeOut },
      );
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined;
    observer?.observe(float);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    // An on-screen keyboard opening or closing changes the visible area.
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      glide?.cancel();
      observer?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [anchor, locate]);
  // Leaving the page, the floating composer fades where it was instead of
  // vanishing in one frame. Keyboard actions and reduced motion stay immediate.
  useLayoutEffect(() => {
    const last = floatNode.current;
    const root = rootRef.current;
    if (floating || !last || !root) return;
    floatNode.current = null;
    if (typeof last.animate !== 'function' || stillMotion(root)) return;
    const ghost = last.cloneNode(true) as HTMLElement;
    const field = last.querySelector('textarea');
    const copy = ghost.querySelector('textarea');
    if (field && copy) copy.value = field.value;
    ghost.classList.add('isotone-exit');
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.removeAttribute('role');
    root.appendChild(ghost);
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], {
      duration: MOTION.exit, easing: MOTION.easeOut, fill: 'forwards',
    });
    fade.onfinish = () => ghost.remove();
    return () => { fade.cancel(); ghost.remove(); };
  }, [floating]);
  useEffect(() => {
    const kept = new Set(targets.map((t) => t.selector));
    for (const selector of pinnedElements.current.keys()) if (!kept.has(selector)) pinnedElements.current.delete(selector);
  }, [targets]);
  // Pinned elements stay outlined while their note is written next to them.
  useEffect(() => {
    if (!picking && !floating) {
      setRects([]);
      return;
    }
    let frame: number | undefined;
    const update = () => {
      frame = undefined;
      setRects(
        targets.flatMap((t) => {
          const el = locate(t.selector);
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
  }, [targets, picking, floating, locate]);

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
          <PanelClose label="Close variants" onClose={() => { setVariantsOpen(false); setExpanded(false); }} />
          <VariantsView
            source={variants}
            active={variantsOpen}
            onClose={() => { setVariantsOpen(false); setExpanded(false); }}
            onFeedback={notesAvailable ? feedback : undefined}
            onSaved={loadNotes}
            onManage={notesAvailable ? queueRemoval : undefined}
            pendingActions={pendingActions}
            emptyText={variantsEmptyText}
          />
        </section>
      );
  // The dock names the element the floating composer sits next to.
  const anchored = targets.find((t) => t.selector === anchor?.selector) ?? targets[0];
  const awayLabel = anchored
    ? `Next to ${anchored.text || anchored.tag}${targets.length > 1 ? ` and ${targets.length - 1} more` : ''}`
    : 'Next to where you clicked';
  // One composer, in the dock or floating beside the element being written about.
  const composer = (
    // biome-ignore lint/a11y/useKeyWithClickEvents: This extends the native textarea's pointer area; keyboard users focus the textarea directly.
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
    {/* The agent's question, in full, while the reviewer edits the note to answer it. */}
    {editing?.reply?.text && !editing.reply.answered && <p className="isotone-editing-reply"><span>Agent asks</span> {editing.reply.text}</p>}
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
    <div className="isotone-entry">
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
        title={`Select elements${shortcutLabel ? ` · ${shortcutLabel}` : ''}`}
        aria-label="Select elements"
        aria-pressed={picking}
        className="isotone-pick isotone-icon"
        // Keep focus where it is, so a focused composer stays focused.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          cancelAnimationFrame(focusFrame.current);
          setPickingWithPanel(false);
          setPicking((v) => !v);
        }}
      >
        <Icon name="pin" size={14} />
      </button>
      {floating && picking && (
        <span ref={fadeIn} className="isotone-float-hint">
          {HINTS.floating[touch ? 'touch' : 'pointer']}
        </span>
      )}
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
    {picking && !floating && (
      <div ref={fadeIn} className="isotone-picking" data-still={pickingWithPanel}>
        <Icon name="pin" size={14} />
        <p>
          <span>{targets.length ? `${targets.length} selected` : HINTS.picking[touch ? 'touch' : 'pointer'].title}</span>
          {/* Touch has no Shift: Done leaves select mode with the pins kept, and the crosshair resumes it. */}
          <small>{HINTS.picking[touch ? 'touch' : 'pointer'].pause}</small>
        </p>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setPicking(false);
            focusComposer();
          }}
        >
          Done{!touch && <kbd>↵</kbd>}
        </button>
      </div>
    )}
    </div>
    </fieldset>
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
          <PanelClose
            label="Close feedback"
            onClose={() => {
              setNotesOpen(false);
              setExpanded(false);
              setPicking(false);
            }}
          />
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
          <ul ref={listRef} className="isotone-list">
            {visibleNotes.map((note) => (
              <li
                key={note.id}
                data-motion-key={note.id}
                className={`isotone-note${editing?.id === note.id ? ' isotone-note-editing' : ''}`}
              >
                {note.update ? (
                  // Isotone writes an update note's text from its request, so
                  // there is nothing to edit; its corner action cancels it.
                  <div className="isotone-note-hit" data-static="">
                    {working.has(note.id) && <span className="isotone-working" ref={dotPulse} role="img" aria-label="An agent is working on this" title="An agent is working on this" />}
                    <NoteSummary note={note} />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="isotone-note-hit"
                    aria-current={editing?.id === note.id ? true : undefined}
                    onClick={() => beginEdit(note)}
                  >
                    {working.has(note.id) && <span className="isotone-working" ref={dotPulse} role="img" aria-label="An agent is working on this" title="An agent is working on this" />}
                    <NoteSummary note={note} page={note.route !== route ? note.route : undefined} />
                  </button>
                )}
                <button
                  type="button"
                  className="isotone-x isotone-icon"
                  aria-label={note.variantAction ? 'Cancel removal' : note.update ? 'Cancel update request' : 'Delete note'}
                  title={note.variantAction ? 'Cancel removal' : note.update ? 'Cancel update request' : 'Delete note'}
                  onClick={() => void removeNote(note)}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="isotone-compose">
            {floating ? (
              <button
                type="button"
                ref={fadeInContent}
                className="isotone-away"
                title="Write here instead"
                style={{ minHeight: slotHeight.current || undefined }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={dockComposer}
              >
                <Icon name="pin" size={14} />
                <span className="isotone-away-text">
                  <span>Writing on the page</span>
                  <small>{awayLabel}</small>
                </span>
                <span className="isotone-away-action">Move here</span>
              </button>
            ) : composer}
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
      data-selecting={picking || floating}
      data-working={working.size > 0}
      data-open={open}
      className="isotone-root"
    >
      <div className="isotone-rail-track" aria-hidden="true" />
      {(picking || floating) &&
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
      {floating && notesOpen && (
        <div
          ref={floatRef}
          className="isotone-float"
          role="dialog"
          aria-label="Feedback on the selection"
        >
          {composer}
        </div>
      )}
      <div className="isotone-notices">
        {/* Right to left from the pill: the live session first, then the update. */}
        {notesAvailable && <BlastNotice endpoint={blastEndpoint} active={open} working={allWorking}
          open={openNotice === 'blast'} onOpenChange={(next) => setOpenNotice((current) => next ? 'blast' : current === 'blast' ? null : current)} />}
        <UpdateNotice endpoint={updateEndpoint} active={open} route={route}
          requested={updateRequested} onRequested={notesAvailable ? loadNotes : undefined}
          open={openNotice === 'update'} onOpenChange={(next) => setOpenNotice((current) => next ? 'update' : current === 'update' ? null : current)} />
      </div>
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
              onClick={(event) => {
                setExpanded(false);
                if (notesOpen) {
                  setNotesOpen(false);
                  setPicking(false);
                } else startFeedback(event.detail > 0);
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
          title={`Isotone${working.size ? ` · ${working.size} in progress` : ''}${shortcutLabel ? ` · ${shortcutLabel}` : ''}`}
          aria-expanded={railOpen}
          onClick={(event) => {
            if (open) closeAll();
            else if (expanded) setExpanded(false);
            else openInitial(event.detail > 0);
          }}
        >
          {working.size > 0 && <span className="isotone-ring" ref={ringPulse} />}
          <Icon name="iterate" />
          {visibleNotes.length > 0 && (
            <span className="isotone-badge">{visibleNotes.length}</span>
          )}
        </button>
      </fieldset>
    </div>
  );
}

/** A quiet close control in the panel's top-left corner. */
function PanelClose({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <button type="button" className="isotone-panel-close" aria-label={label} title={label} onClick={onClose}>
      <Icon name="close" size={12} />
    </button>
  );
}
