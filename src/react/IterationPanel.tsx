import { FEEDBACK_STORAGE_KEY } from '../core/browser-storage';
import { createNoteId } from '../core/id';
import { MAX_FEEDBACK_LENGTH } from '../core/limits';
import type { IterationStoreConfig } from '../core/notes-client';
import { isRouteVisible, normalizeRoute, type RouteGateOptions } from '../core/routes';
import type { IterationElement, IterationNote, IterationShortcut, IterationTheme, VariantReference } from '../core/types';
import type { VariantAction, VariantsSource } from '../core/variants';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Composer, createDraftText } from './Composer';
import { Icon } from './icons';
import { fadeInContent, ringPulse } from './motion';
import { NotesPanel, PanelClose } from './NotesPanel';
import { type Anchor, PickOverlay, usePicker } from './picking';
import { ensurePanelStyles } from './styles';
import { detectTheme, observeTheme } from './theme';
import { UpdateNotice } from './UpdateNotice';
import { useDockMotion } from './useDockMotion';
import { useDockSize } from './useDockSize';
import { useDraft } from './useDraft';
import { useFloatingComposer } from './useFloatingComposer';
import { useLayoutMotion } from './useLayoutMotion';
import { useNotes } from './useNotes';
import { refreshSource, useVariantsSnapshot, VariantsView } from './VariantsView';
import { isCompactViewport, prefersTouch, useKeyboardInset } from './viewport';

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
  /** What the Variants list says on a page without selectors. */
  variantsEmptyText?: string;
  /** Initial surface. Kept for compatibility; surfaces can now open together. */
  defaultTab?: 'variants' | 'notes';
  /** Default: Cmd/Ctrl+Shift+Period. false disables the shortcut. */
  shortcut?: IterationShortcut | false;
}

/** How long "an agent is working on this" is believed without a sign of life. */
const WORKING_FRESH_MS = 20 * 60 * 1000;

const DEFAULT_SHORTCUT: IterationShortcut = { code: 'Period', mod: true, shift: true };

/** Events that stay inside the dock, so host shortcuts, focus traps, outside-press handlers and scroll hijackers ignore it. */
const FENCED_EVENTS =
  'pointerdown mousedown touchstart click contextmenu keydown keyup keypress beforeinput input focusin focusout wheel'.split(' ');

/** Which surfaces are open, and what the composer is doing. */
interface Mode {
  notesOpen: boolean;
  variantsOpen: boolean;
  /** The pill shows its tools. */
  expanded: boolean;
  /** Select mode: the page's elements are pinned by clicking. */
  picking: boolean;
  /** Selecting started with the panel: its cover shows at once, so the field never shows through while the panel fades in. */
  pickingWithPanel: boolean;
  /** Set once an element is pinned: the composer leaves the dock and floats next to it. */
  anchor: Anchor | null;
}
type ModeUpdate = Partial<Mode> | ((mode: Mode) => Partial<Mode>);

const CLOSED: Mode = { notesOpen: false, variantsOpen: false, expanded: false, picking: false, pickingWithPanel: false, anchor: null };

/** Apply an update, then the rules that hold between the surfaces. */
function reduceMode(mode: Mode, { update, compact }: { update: ModeUpdate; compact: boolean }): Mode {
  const next = { ...mode, ...(typeof update === 'function' ? update(mode) : update) };
  // A small screen has room for one panel: the one just opened stays.
  if (compact && next.notesOpen && next.variantsOpen) {
    if (mode.variantsOpen) next.variantsOpen = false;
    else Object.assign(next, { notesOpen: false, picking: false });
  }
  // The composer floats only while the feedback panel is open.
  if (!next.notesOpen) next.anchor = null;
  return (Object.keys(next) as (keyof Mode)[]).every((key) => next[key] === mode[key]) ? mode : next;
}

function shortcutText(shortcut: IterationShortcut | false): string {
  if (!shortcut) return '';
  return [
    shortcut.mod ? '⌘/Ctrl' : '',
    shortcut.alt ? 'Alt' : '',
    shortcut.shift ? 'Shift' : '',
    shortcut.code === 'Period' ? '.' : shortcut.code.replace(/^Key/, ''),
  ]
    .filter(Boolean)
    .join('+');
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function IterationPanel({
  route: pageRoute,
  theme: themePreference = 'auto',
  updateEndpoint,
  store: storeCfg,
  rule,
  getPayload,
  variants,
  variantsEmptyText,
  defaultTab = 'notes',
  shortcut = DEFAULT_SHORTCUT,
}: IterationPanelProps) {
  // One page, however the URL spells it: `/about/` and `/about?tab=2` are `/about`, as for the CLI.
  const route = normalizeRoute(pageRoute);
  const nsKey = storeCfg.key ?? FEEDBACK_STORAGE_KEY;
  const [mode, dispatch] = useReducer(reduceMode, CLOSED);
  const update = useCallback((change: ModeUpdate) => dispatch({ update: change, compact: isCompactViewport() }), []);
  const { notesOpen, variantsOpen, expanded, picking, pickingWithPanel, anchor } = mode;
  const floating = anchor !== null;
  const open = notesOpen || variantsOpen;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [instant, setInstant] = useState(false);
  // Hints follow the last pointer used, so a hybrid device gets the right words.
  const [touch, setTouch] = useState(prefersTouch);
  const [theme, setTheme] = useState(() => detectTheme(themePreference));
  const [targets, setTargets] = useState<IterationElement[]>([]);
  const [variantTarget, setVariantTarget] = useState<VariantReference | null>(null);
  const [editing, setEditing] = useState<IterationNote | null>(null);
  const [notice, setNotice] = useState('');
  // Which pages' notes the list shows. Unset means this page only.
  const [scope, setScope] = useState<string[] | null>(null);
  const [text] = useState(createDraftText);

  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  // The dock keeps the composer's height while it floats, so the panel stays put.
  const slotHeight = useRef(0);
  const focusFrame = useRef(0);
  // Focusing the composer after a pin must not leave select mode.
  const keepPicking = useRef(false);
  const id = useId();

  const notesAvailable = Boolean(storeCfg.endpoint);
  const variantsAvailable = useVariantsSnapshot(variants).shown.length > 0;
  const visible = isRouteVisible(route, rule) && (notesAvailable || variantsAvailable || variantsOpen);
  const { store, notes, setNotes, clock, load: loadNotes, write } = useNotes(storeCfg, visible);
  useLayoutMotion(listRef, notes, notesOpen);
  useDockMotion(rootRef, visible);
  useKeyboardInset(rootRef, visible);
  const dockSize = useDockSize(rootRef, `${nsKey}::dock`, { variants: variantsOpen, notes: notesOpen });
  const railOpen = expanded || hovered || (focused && instant) || open || picking;
  const draftKey = `${nsKey}::draft::${route}`;
  const shortcutLabel = shortcutText(shortcut);

  const openNotes = useMemo(() => notes.filter((n) => !n.done), [notes]);
  // Pages that have open notes, this one first, so the row of page chips reads
  // the same on every page.
  const pages = useMemo(() => {
    const counts = new Map<string, number>();
    // The update note belongs to the project, not a page: it shows everywhere.
    for (const n of openNotes) {
      const page = normalizeRoute(n.route);
      if (!n.update) counts.set(page, (counts.get(page) ?? 0) + 1);
    }
    const others = [...counts.keys()].filter((r) => r !== route).sort();
    return { counts, others };
  }, [openNotes, route]);
  const selectedPages = useMemo(() => {
    const chosen = (scope ?? [route]).filter((r) => r === route || pages.counts.has(r));
    return new Set(chosen.length ? chosen : [route]);
  }, [scope, route, pages]);
  const updateRequested = useMemo(() => openNotes.some((n) => n.update), [openNotes]);
  const visibleNotes = useMemo(
    () =>
      openNotes
        .filter((n) => n.update || selectedPages.has(normalizeRoute(n.route)))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [openNotes, selectedPages],
  );
  // An agent's claim goes stale: a crashed or abandoned run should not pulse forever.
  const working = useMemo(
    () => new Set(visibleNotes.filter((n) => n.workingAt && clock - Date.parse(n.workingAt) < WORKING_FRESH_MS).map((n) => n.id)),
    [visibleNotes, clock],
  );
  const pendingActions = useMemo(
    () => notes.flatMap((n) => (!n.done && normalizeRoute(n.route) === route && n.variantAction ? [n.variantAction] : [])),
    [notes, route],
  );

  // Handlers read the current render through `latest`, so they stay stable and
  // memoized children (the composer, note rows, selectors) skip unrelated renders.
  const current = {
    mode,
    route,
    targets,
    variantTarget,
    editing,
    selectedPages,
    getPayload,
    notesAvailable,
    variantsAvailable,
    defaultTab,
    shortcut,
  };
  const latest = useRef(current);
  latest.current = current;

  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  const focusComposer = useCallback(() => {
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => fieldRef.current?.focus());
  }, []);
  const focusWhilePicking = useCallback(() => {
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      keepPicking.current = true;
      fieldRef.current?.focus({ preventScroll: true });
      keepPicking.current = false;
    });
  }, []);
  /** Whether keyboard focus is in the dock, so closing it should put focus somewhere sensible. */
  const focusInDock = useCallback(() => {
    const root = rootRef.current;
    const active = (root?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
    return Boolean(root && active && root.contains(active));
  }, []);
  /** Remember the host control to return to on close. The dock itself (seen from outside as the shadow host) is
   *  not one: focus would land on a div that cannot take it, then on the body. Closing falls back to the launcher. */
  const rememberFocus = useCallback(() => {
    const active = document.activeElement;
    const root = rootRef.current;
    const ours = !root || active === (root.getRootNode() as ShadowRoot).host || (active !== null && root.contains(active));
    previousFocus.current = active instanceof HTMLElement && active !== document.body && !ours ? active : null;
  }, []);
  /** After the next commit, focus the launcher: a rail button (this panel's, if given) while the rail shows, else the pill. */
  const focusLauncher = useCallback(
    (panel?: 'notes' | 'variants') => {
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        const selector = panel ? `.isotone-rail-button[aria-controls="${id}-${panel}"]` : '.isotone-rail-button';
        const button = rootRef.current?.querySelector<HTMLButtonElement>(selector);
        (button && !button.closest('[inert]') ? button : fabRef.current)?.focus();
      });
    },
    [id],
  );
  const closeAll = useCallback(() => {
    const inDock = focusInDock();
    cancelAnimationFrame(focusFrame.current);
    update(CLOSED);
    setHovered(false);
    if (!inDock) return;
    if (previousFocus.current?.isConnected) previousFocus.current.focus();
    else focusLauncher();
  }, [update, focusInDock, focusLauncher]);
  /** Close one panel. Focus inside it goes to its rail button, or the launcher once the rail folds away. */
  const closePanel = useCallback(
    (panel: 'notes' | 'variants') => {
      const inDock = focusInDock();
      update(panel === 'notes' ? { notesOpen: false, picking: false, expanded: false } : { variantsOpen: false, expanded: false });
      if (inDock) focusLauncher(panel);
    },
    [update, focusInDock, focusLauncher],
  );
  const closeNotes = useCallback(() => closePanel('notes'), [closePanel]);
  const closeVariants = useCallback(() => closePanel('variants'), [closePanel]);
  /** The pointer and the shortcut start selecting; Enter or Space on a focused button goes to the field. */
  const startFeedback = useCallback(
    (select: boolean) => {
      update((m) => ({ notesOpen: true, ...(select ? { picking: true, pickingWithPanel: !m.notesOpen } : {}) }));
      if (select) cancelAnimationFrame(focusFrame.current);
      else focusComposer();
    },
    [update, focusComposer],
  );
  const cancelEdit = useCallback(() => {
    setEditing(null);
    text.set('');
    setTargets([]);
    setVariantTarget(null);
  }, [text]);
  /** Put the composer back in the dock, keeping what was written and pinned. */
  const dockComposer = useCallback(() => {
    update({ anchor: null, picking: false });
    focusComposer();
  }, [update, focusComposer]);
  const feedback = useCallback(
    (reference: VariantReference) => {
      setVariantTarget(reference);
      update({ anchor: null, notesOpen: true, expanded: true });
      focusComposer();
    },
    [update, focusComposer],
  );
  const queueRemoval = useCallback(
    async (action: VariantAction, reference: VariantReference) => {
      const description =
        action.action === 'remove-option'
          ? `Remove “${reference.optionLabel}” from ${reference.label}.`
          : action.action === 'keep-option'
            ? `Keep only “${reference.optionLabel}” for ${reference.label}; make it the default and remove the selector and the other options.`
            : action.action === 'keep-default'
              ? `Keep only the default for ${reference.label}; remove its selector and alternatives.`
              : `Remove ${reference.label}, its selector and all alternatives.`;
      const note = `[${action.action}] ${description}`;
      const context = { variant: reference, variantAction: action };
      const { route, getPayload } = latest.current;
      await write(async () => {
        const savedId = await store.saveNote(route, note, null, null, getPayload?.(), { w: innerWidth, h: innerHeight }, context);
        setNotes((prev) => [
          ...prev,
          { id: savedId, route, feedback: note, element: null, done: false, createdAt: new Date().toISOString(), ...context },
        ]);
        update({ notesOpen: true });
      });
    },
    [store, write, setNotes, update],
  );
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
    const tempId = previous?.id ?? `pending-${createNoteId()}`;
    const entry: IterationNote = {
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
        setNotes((prev) => prev.map((n) => (n.id === tempId ? { ...n, id: savedId } : n)));
      } catch {
        setNotes((prev) => (previous ? prev.map((n) => (n.id === tempId ? previous : n)) : prev.filter((n) => n.id !== tempId)));
        text.set(value);
        setTargets(context.elements);
        setVariantTarget(context.variant);
        setEditing(previous);
        setNotice('Could not save. Your feedback is still here.');
      }
    });
  }, [text, store, write, setNotes, cancelEdit, update, focusComposer]);
  const beginEdit = useCallback(
    (note: IterationNote) => {
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
    (note: IterationNote) => {
      void write(async () => {
        setNotes((prev) => prev.filter((n) => n.id !== note.id));
        if (latest.current.editing?.id === note.id) cancelEdit();
        try {
          await store.deleteNote(note.id);
        } catch {
          setNotes((prev) => [...prev, note]);
          setNotice('Could not delete the note. Try again.');
        }
      });
    },
    [write, setNotes, cancelEdit, store],
  );
  const togglePage = useCallback(
    (page: string) => {
      const next = new Set(latest.current.selectedPages);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      setScope(next.size ? [...next] : [route]);
    },
    [route],
  );

  // Select mode and the floating composer.
  const locate = usePicker({
    picking,
    rootRef,
    fieldRef,
    targets,
    setTargets,
    anchored: floating,
    touch,
    onPin: (pin, slot) => {
      if (slot !== null) slotHeight.current = slot;
      update({ anchor: pin, notesOpen: true });
      focusWhilePicking();
    },
    onFinish: (how) => {
      if (how === 'escape') setTargets([]);
      update({ picking: false, notesOpen: true, ...(how === 'escape' ? { anchor: null } : {}) });
      if (how === 'typing') fieldRef.current?.focus();
      else focusComposer();
    },
  });
  useFloatingComposer(floatRef, rootRef, anchor, locate);

  // Composer callbacks.
  const onFieldFocus = useCallback(() => {
    if (!keepPicking.current) update({ picking: false });
  }, [update]);
  const stopPicking = useCallback(() => update({ picking: false }), [update]);
  const togglePicking = useCallback(() => {
    cancelAnimationFrame(focusFrame.current);
    update((m) => ({ picking: !m.picking, pickingWithPanel: false }));
  }, [update]);
  const donePicking = useCallback(() => {
    update({ picking: false });
    focusComposer();
  }, [update, focusComposer]);
  const unpin = useCallback((selector: string) => setTargets((prev) => prev.filter((t) => t.selector !== selector)), []);
  const clearVariant = useCallback(() => setVariantTarget(null), []);

  // Native enter/leave survive transitions from a host React tree into our shadow root.
  useEffect(() => {
    if (!visible) {
      setHovered(false);
      setFocused(false);
      update({ expanded: false });
      return;
    }
    const root = rootRef.current;
    if (!root) return;
    const enter = (event: PointerEvent) => {
      if ((event.pointerType === 'mouse' || event.pointerType === 'pen') && event.buttons === 0) {
        root.setAttribute('data-instant', 'false');
        setInstant(false);
        setHovered(true);
      }
    };
    const leave = () => {
      setHovered(false);
      update({ expanded: false });
    };
    root.addEventListener('pointerenter', enter);
    root.addEventListener('pointerleave', leave);
    return () => {
      root.removeEventListener('pointerenter', enter);
      root.removeEventListener('pointerleave', leave);
    };
  }, [visible, update]);
  useEffect(() => {
    if (!railOpen || !instant) return;
    const active = (rootRef.current?.getRootNode() as Document | ShadowRoot)?.activeElement;
    if (active === fabRef.current) rootRef.current?.querySelector<HTMLButtonElement>('.isotone-rail-button')?.focus();
  }, [railOpen, instant]);

  // The global shortcut and the input modality listen in capture, so they work while typing (browser- and
  // OS-reserved chords never reach a page). Escape belongs to the dock. The fence keeps the dock's events from the host.
  useEffect(() => {
    const root = rootRef.current;
    if (!visible || !root) return;
    const onKey = (e: KeyboardEvent) => {
      root.setAttribute('data-instant', 'true');
      setInstant(true);
      const { shortcut, mode, notesAvailable } = latest.current;
      const { picking, notesOpen, variantsOpen } = mode;
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
      if (!notesAvailable) update((m) => ({ variantsOpen: !m.variantsOpen }));
      else if (picking) {
        update({ picking: false });
        focusComposer();
      } else {
        if (!notesOpen && !variantsOpen) rememberFocus();
        update({ expanded: true });
        startFeedback(true);
      }
    };
    const onPointer = (e: PointerEvent) => {
      root.setAttribute('data-instant', 'false');
      setInstant(false);
      if (e.pointerType) setTouch(e.pointerType === 'touch');
    };
    // An Escape pressed in a host input or dialog is the host's; one in the dock, or with nothing focused, is ours.
    const onEscape = (event: Event) => {
      const e = event as KeyboardEvent;
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const { mode, editing } = latest.current;
      if (!(mode.notesOpen || mode.variantsOpen) || mode.picking) return;
      const { target } = e;
      const unfocused = !(target instanceof Element) || target === document.body || target === document.documentElement;
      if (!unfocused && !e.composedPath().includes(root)) return;
      if (mode.anchor) dockComposer();
      else if (editing) cancelEdit();
      else closeAll();
    };
    const shadow = root.getRootNode();
    const stop = (e: Event) => e.stopPropagation();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onEscape);
    if (shadow instanceof ShadowRoot) {
      // React listens on the shadow root or below it, and registered first, so its handlers still run, and so
      // do the capture listeners above. Releases still reach the page, so a host drag ending over the dock ends.
      shadow.addEventListener('keydown', onEscape);
      for (const type of FENCED_EVENTS) shadow.addEventListener(type, stop);
    }
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onEscape);
      if (shadow instanceof ShadowRoot) {
        shadow.removeEventListener('keydown', onEscape);
        for (const type of FENCED_EVENTS) shadow.removeEventListener(type, stop);
      }
    };
  }, [visible, update, focusComposer, startFeedback, dockComposer, cancelEdit, closeAll, rememberFocus]);

  // Opening a surface or changing route loads at once; the poll in useNotes keeps it current.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open-time refresh.
  useEffect(() => {
    loadNotes();
  }, [notesOpen, variantsOpen, route, loadNotes]);
  useEffect(() => {
    if (variants && notesOpen && !variantsOpen) refreshSource(variants);
  }, [notesOpen, variantsOpen, variants]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a network-backed source starts empty.
  useEffect(() => {
    if (variants && !variantsAvailable) refreshSource(variants);
  }, [variants]);

  useDraft(draftKey, text, { targets, variantTarget, editing }, (restoredTargets, restoredVariant) => {
    update({ anchor: null });
    setEditing(null);
    setTargets(restoredTargets);
    setVariantTarget(restoredVariant);
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll follows new notes.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [notes, notesOpen]);
  // The observer follows the page from here on; opening a panel or changing route does not rebuild it.
  useLayoutEffect(() => {
    if (!visible) return;
    const root = rootRef.current?.getRootNode();
    if (root instanceof ShadowRoot || root instanceof Document) ensurePanelStyles(root);
    return observeTheme(setTheme, themePreference);
  }, [visible, themePreference]);

  if (!visible) return null;
  const composer = (
    <Composer
      text={text}
      fieldRef={fieldRef}
      active={notesOpen}
      editing={editing}
      variantTarget={variantTarget}
      targets={targets}
      notice={notice}
      picking={picking}
      pickingWithPanel={pickingWithPanel}
      floating={floating}
      touch={touch}
      shortcutLabel={shortcutLabel}
      onSend={send}
      onCancelEdit={cancelEdit}
      onClearVariant={clearVariant}
      onUnpin={unpin}
      onFieldFocus={onFieldFocus}
      onFieldPointerDown={stopPicking}
      onTogglePicking={togglePicking}
      onDonePicking={donePicking}
    />
  );
  // The dock names the element the floating composer sits next to.
  const anchored = targets.find((t) => t.selector === anchor?.selector) ?? targets[0];
  const awayLabel = anchored
    ? `Next to ${anchored.text || anchored.tag}${targets.length > 1 ? ` and ${targets.length - 1} more` : ''}`
    : 'Next to where you clicked';
  const count = visibleNotes.length;
  const tools = Number(Boolean(variants)) + Number(notesAvailable);
  return (
    <div
      ref={rootRef}
      data-isotone
      data-theme={theme}
      data-expanded={railOpen}
      data-tools={tools}
      data-instant={instant}
      data-notes-open={notesOpen}
      data-selecting={picking || floating}
      data-working={working.size > 0}
      data-open={open}
      className="isotone-root"
      {...dockSize.root}
    >
      {open && <div {...dockSize.handle('width')} />}
      <div className="isotone-rail-track" aria-hidden="true" />
      {(picking || floating) && <PickOverlay picking={picking} targets={targets} locate={locate} />}
      {floating && notesOpen && (
        <div ref={floatRef} className="isotone-float" role="dialog" aria-label="Feedback on the selection">
          {composer}
        </div>
      )}
      <div className="isotone-notices">
        <UpdateNotice
          endpoint={updateEndpoint}
          active={open}
          route={route}
          requested={updateRequested}
          onRequested={notesAvailable ? loadNotes : undefined}
        />
      </div>
      <fieldset
        aria-label="Isotone tools"
        onKeyDown={(event) => {
          if (!(event.target as HTMLElement).classList.contains('isotone-rail-button')) return;
          if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.isotone-rail-button'));
          const at = buttons.indexOf(event.target as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (at + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
          buttons[next]?.focus();
        }}
        className="isotone-rail"
        data-expanded={railOpen}
        data-tools={tools}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
        }}
      >
        <div
          className="isotone-rail-tools"
          aria-hidden={!railOpen}
          ref={(node) => {
            node?.toggleAttribute('inert', !railOpen);
          }}
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
                if (variantsOpen) closeVariants();
                else update({ variantsOpen: true, expanded: false });
              }}
            >
              <Icon name="sliders" />
              <span className="isotone-tool-label">Variants</span>
            </button>
          )}
          {variants && (
            <section
              id={`${id}-variants`}
              role="dialog"
              aria-label="Iteration variants"
              className="isotone-panel isotone-variants-panel"
              data-open={variantsOpen}
              aria-hidden={!variantsOpen}
              ref={(node) => {
                node?.toggleAttribute('inert', !variantsOpen);
              }}
            >
              <PanelClose label="Close variants" onClose={closeVariants} />
              {variantsOpen && <div {...dockSize.handle('variants')} />}
              <VariantsView
                source={variants}
                active={variantsOpen}
                onFeedback={notesAvailable ? feedback : undefined}
                onSaved={loadNotes}
                onManage={notesAvailable ? queueRemoval : undefined}
                pendingActions={pendingActions}
                emptyText={variantsEmptyText}
              />
            </section>
          )}
          {notesAvailable && (
            <NotesPanel
              id={`${id}-notes`}
              open={notesOpen}
              route={route}
              notes={visibleNotes}
              listRef={listRef}
              pages={pages}
              selectedPages={selectedPages}
              working={working}
              editingId={editing?.id}
              resizeHandle={dockSize.handle('notes')}
              onClose={closeNotes}
              onTogglePage={togglePage}
              onEdit={beginEdit}
              onRemove={removeNote}
              compose={
                floating ? (
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
                ) : (
                  composer
                )
              }
            />
          )}
          {notesAvailable && (
            <button
              type="button"
              className="isotone-rail-button"
              aria-label={count ? `Feedback, ${plural(count, 'note')}` : 'Feedback'}
              title="Feedback"
              aria-controls={`${id}-notes`}
              aria-expanded={notesOpen}
              onClick={(event) => {
                if (notesOpen) closeNotes();
                else {
                  update({ expanded: false });
                  startFeedback(event.detail > 0);
                }
              }}
            >
              <Icon name="message" />
              <span className="isotone-tool-label">
                Feedback <span className="isotone-count">{count || ''}</span>
              </span>
            </button>
          )}
        </div>
        <button
          type="button"
          ref={fabRef}
          className="isotone-fab"
          aria-hidden={railOpen}
          tabIndex={railOpen ? -1 : 0}
          aria-label={[
            notesAvailable ? 'Isotone' : 'Variants',
            count ? plural(count, 'note') : '',
            working.size ? `${working.size} in progress` : '',
          ]
            .filter(Boolean)
            .join(', ')}
          title={`Isotone${working.size ? ` · ${working.size} in progress` : ''}${shortcutLabel ? ` · ${shortcutLabel}` : ''}`}
          aria-expanded={railOpen}
          onClick={(event) => {
            if (open) closeAll();
            else if (expanded) update({ expanded: false });
            else {
              rememberFocus();
              update({ expanded: true });
              const { defaultTab, notesAvailable, variantsAvailable } = latest.current;
              if ((defaultTab === 'variants' || !notesAvailable) && variantsAvailable) update({ variantsOpen: true });
              else startFeedback(event.detail > 0);
            }
          }}
        >
          {working.size > 0 && <span className="isotone-ring" ref={ringPulse} />}
          <Icon name="iterate" />
          {count > 0 && (
            <span className="isotone-badge" aria-hidden="true">
              {count}
            </span>
          )}
        </button>
      </fieldset>
    </div>
  );
}
