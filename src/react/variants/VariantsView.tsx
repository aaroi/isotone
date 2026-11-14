import {
  type HTMLAttributes,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { VariantReference } from '../../core/types';
import {
  axisDefault,
  axisSection,
  changedAxes,
  compareAxes,
  compareFor,
  isDirty,
  type VariantAction,
  type VariantAxis,
  type VariantSection,
  type VariantSelections,
  type VariantsSource,
  sectionAxes,
  visibleAxes,
} from '../../core/variants';
import { AxisActionsDialog } from './AxisActionsDialog';
import { AxisControl, type OpenMenu } from './AxisControl';
import { ColorPicker } from './ColorPicker';
import { Icon } from '../icons';
import { keyboardInstant, MAX_ANIMATED_ITEMS, MOTION, stillMotion } from '../motion';
import { PanelClose } from '../notes/NotesPanel';
import { useLayoutMotion } from '../useLayoutMotion';
import { useRenderLimit } from '../useRenderLimit';
import { showOverflowTitle } from '../tooltips';
import { useCompareHeld } from './useCompare';

/** Re-read a source that can (the overlay one); settles, never rejects, once it has. */
export function refreshSource(source: VariantsSource): Promise<void> {
  const candidate = (source as { refresh?: unknown }).refresh;
  return typeof candidate === 'function' ? Promise.resolve(candidate.call(source)).then(noop, noop) : Promise.resolve();
}

const noop = () => {};

function readNotice(source: VariantsSource): string | null {
  return source.getNotice?.() ?? null;
}

/**
 * The panel sits on the pill, so it keeps its bottom edge whatever opens above it. When it has to give up
 * room, as Feedback opens or grows over a long list, it gives it from its top edge and the list scrolls by
 * as much, so every control in view stays where it was; given room back, it scrolls back. Room its scroll
 * cannot absorb, as when Feedback closes over a list at its top, waits until the pointer leaves the dock.
 * A change of its own (a section folding, a notice, a resize the reviewer drags, an open dialog) is left
 * alone.
 */
function useSteadyBody(bodyRef: RefObject<HTMLDivElement | null>, active: boolean, besideFeedback: boolean) {
  const seen = useRef({ height: 0, scroll: 0 });
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const panel = body?.closest<HTMLElement>('.isotone-panel');
    const root = body?.closest<HTMLElement>('.isotone-root');
    if (!active || !body || !panel || !root || typeof ResizeObserver === 'undefined') return;
    // Read after the browser's own layout, in the observer, so opening never forces one.
    let last: { height: number; content: number; foot: number } | null = null;
    const scrolled = () => {
      seen.current.scroll = body.scrollTop;
    };
    const observer = new ResizeObserver(() => {
      const now = {
        height: body.clientHeight,
        content: body.scrollHeight,
        // Layout offsets, so a panel still moving into place reads where it will rest.
        foot: root.offsetHeight - panel.offsetTop - panel.offsetHeight,
      };
      const before = last;
      last = now;
      if (before && now.content === before.content && now.foot === before.foot && root.dataset.resizing !== 'true')
        if (!body.hasAttribute('inert') && !panel.querySelector('.isotone-colour')) body.scrollTop += before.height - now.height;
      seen.current = { height: panel.offsetHeight, scroll: body.scrollTop };
    });
    observer.observe(body);
    body.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      observer.disconnect();
      body.removeEventListener('scroll', scrolled);
    };
  }, [bodyRef, active]);
  const wasBeside = useRef(besideFeedback);
  useLayoutEffect(() => {
    const panel = bodyRef.current?.closest<HTMLElement>('.isotone-panel');
    const root = panel?.closest<HTMLElement>('.isotone-root');
    const closed = wasBeside.current && !besideFeedback;
    wasBeside.current = besideFeedback;
    const { height, scroll } = seen.current;
    // Only a pointer resting on the dock is kept from moving; a close from the keyboard lets the list grow.
    if (!closed || !active || !panel || !root || !height || !root.matches(':hover')) return;
    panel.style.setProperty('--iso-variants-hold', `${height + scroll}px`);
    // A resize handle taken up by pointer or key lets go too, so the reviewer's own size applies.
    const handle = ['pointerdown', 'keydown', 'focusin'];
    const release = (event?: Event) => {
      if (event && event.type !== 'pointerleave' && !(event.target as Element).closest?.('.isotone-resize')) return;
      panel.style.removeProperty('--iso-variants-hold');
      root.removeEventListener('pointerleave', release);
      for (const type of handle) root.removeEventListener(type, release, true);
    };
    root.addEventListener('pointerleave', release);
    for (const type of handle) root.addEventListener(type, release, true);
    return () => release();
  }, [bodyRef, active, besideFeedback]);
}

/**
 * A reload, such as a variant switch on a host that reloads, comes back to the same place in the list,
 * so the selector being compared is still under the pointer. The place is kept from the list's foot, which
 * sits on the pill and so does not move, whatever height Feedback above it comes back with, and held
 * while the dock settles (the list arriving in chunks, Feedback loading its notes) until the reviewer
 * scrolls or presses in the list. Only a panel open as it mounts, which is one a reload restored, does so.
 */
function useKeptScroll(bodyRef: RefObject<HTMLDivElement | null>, active: boolean, key: string | undefined) {
  const atMount = useRef(active);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!active) atMount.current = false;
    if (!key || !active || !body) return;
    const save = () => {
      try {
        sessionStorage.setItem(key, String(Math.round(body.scrollTop + body.clientHeight)));
      } catch {
        /* Blocked storage only costs the position. */
      }
    };
    window.addEventListener('pagehide', save);
    let want = 0;
    try {
      if (atMount.current) want = Number(sessionStorage.getItem(key)) || 0;
    } catch {
      /* The list starts at the top. */
    }
    const hold = () => {
      if (want > body.clientHeight) body.scrollTop = want - body.clientHeight;
    };
    const observer = want && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(hold) : undefined;
    observer?.observe(body);
    for (const child of want ? body.children : []) observer?.observe(child);
    hold();
    const presses = ['wheel', 'pointerdown', 'keydown', 'touchstart'];
    let holding = Boolean(observer);
    const release = () => {
      holding = false;
      observer?.disconnect();
      for (const type of presses) body.removeEventListener(type, release);
    };
    for (const type of presses) body.addEventListener(type, release, { passive: true });
    return () => {
      // A remount in the same document comes back to where the list is now, not where the last unload left
      // it; while the place is still held, that is the place being held.
      if (!holding && body.clientHeight) save();
      release();
      window.removeEventListener('pagehide', save);
    };
  }, [bodyRef, active, key]);
}

/** What the panel draws from a source: read once per change and shared by every view of it. */
export interface VariantsSnapshot {
  selections: Readonly<VariantSelections>;
  /** The axes on show: conditional ones only while their condition holds. */
  shown: VariantAxis[];
  sections: VariantSection[];
  /** Each shown axis's name, without and with its section. */
  names: Map<string, VariantSection['axes'][number]>;
  error: string | null;
}

interface SnapshotStore {
  subscribe(listener: () => void): () => void;
  read(): VariantsSnapshot;
}

function takeSnapshot(source: VariantsSource): VariantsSnapshot {
  const selections = { ...source.getSelections() };
  const shown = visibleAxes(source.getAxes(), selections);
  const sections = sectionAxes(shown);
  return {
    selections,
    shown,
    sections,
    names: new Map(sections.flatMap((section) => section.axes).map((entry) => [entry.axis.id, entry])),
    error: source.getError?.() ?? null,
  };
}

const stores = new WeakMap<VariantsSource, SnapshotStore>();
const EMPTY: VariantsSnapshot = { selections: {}, shown: [], sections: [], names: new Map(), error: null };
const NO_SOURCE: SnapshotStore = { subscribe: () => () => {}, read: () => EMPTY };

/**
 * One subscription per source, however many views read it, made the first
 * time the source is read and kept as long as the source lives, so a snapshot
 * is never stale between a render and its subscription.
 */
function storeFor(source: VariantsSource | undefined): SnapshotStore {
  if (!source) return NO_SOURCE;
  let store = stores.get(source);
  if (store) return store;
  const listeners = new Set<() => void>();
  let snapshot: VariantsSnapshot | null = null;
  source.subscribe(() => {
    snapshot = null;
    for (const listener of listeners) listener();
  });
  store = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read: () => (snapshot ??= takeSnapshot(source)),
  };
  stores.set(source, store);
  return store;
}

/** The source's current snapshot; a new one after each change. */
export function useVariantsSnapshot(source: VariantsSource | undefined): VariantsSnapshot {
  const store = storeFor(source);
  return useSyncExternalStore(store.subscribe, store.read, store.read);
}

/** Selectors in the commit that opens the panel: more than a tall panel shows at once. */
const FIRST_AXES = 16;

const NO_PENDING_ACTIONS: VariantAction[] = [];

const DEFAULT_EMPTY_TEXT = 'No variants on this page yet. Ask your agent to create variants of any design and they will appear here.';

interface VariantsViewProps {
  source: VariantsSource;
  active?: boolean;
  onFeedback?: (reference: VariantReference) => void;
  onSaved?: () => void;
  onManage?: (action: VariantAction, reference: VariantReference) => Promise<void>;
  pendingActions?: VariantAction[];
  /** What the list says when this page has no selectors. */
  emptyText?: string;
  /** Whether the key under Escape also holds Compare, for its tooltip. */
  compareKey?: boolean;
  /** Where the list keeps its scroll position across a reload of the tab (`sessionStorage`). */
  scrollKey?: string;
  /** Feedback is open above: room it gives back is taken only as the list can absorb it. */
  besideFeedback?: boolean;
}

export const VariantsView = memo(function VariantsView({
  source,
  active = true,
  onFeedback,
  onSaved,
  onManage,
  pendingActions = NO_PENDING_ACTIONS,
  emptyText = DEFAULT_EMPTY_TEXT,
  compareKey = false,
  scrollKey,
  besideFeedback = false,
}: VariantsViewProps) {
  const { selections: stored, shown, sections, names, error: sourceError } = useVariantsSnapshot(source);
  // Settled by each opening's own refresh and kept until the panel closes: a notice coming or going
  // while the reviewer picks (or when Feedback opening refreshes the source) would move the selectors.
  const [notice, setNotice] = useState<string | null>(() => readNotice(source));
  useEffect(() => {
    if (!active) return;
    let open = true;
    setNotice(readNotice(source));
    void refreshSource(source).then(() => {
      if (open) setNotice(readNotice(source));
    });
    return () => {
      open = false;
    };
  }, [active, source]);
  // While the reviewer holds Compare the controls show what the page shows, and take no picks.
  const held = useCompareHeld(source);
  const selections = useMemo(() => (held ? { ...stored, ...held } : stored), [stored, held]);
  const holding = useRef(false);
  holding.current = held !== null;
  const guarded = useMemo<VariantsSource>(
    () =>
      Object.create(source, {
        setSelection: {
          value: (axisId: string, value: string) => {
            if (!holding.current) source.setSelection(axisId, value);
          },
        },
      }),
    [source],
  );
  // A closed panel renders no selectors. The body stays one more render after
  // closing, so the dock's exit snapshot still shows them.
  const lingering = useDeferredValue(active);
  const value = (axis: VariantAxis) => selections[axis.id] ?? axisDefault(axis);
  // Collapsed sections, by case-insensitive name; kept while the panel closes.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const expandedCount = sections.reduce(
    (n, section) => n + (section.name !== null && collapsed.has(section.key) ? 0 : section.axes.length),
    0,
  );
  let left = useRenderLimit(active || lingering, expandedCount, FIRST_AXES);
  let stopped = false;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // A long list arrives in chunks and is past the size that animates anyway.
  useLayoutMotion(bodyRef, shown, active && shown.length <= MAX_ANIMATED_ITEMS);
  useSteadyBody(bodyRef, active, besideFeedback);
  useKeptScroll(bodyRef, active, scrollKey);

  // The action dialog: which selector, which option, and each opening's own session.
  const [menu, setMenu] = useState<{ axisId: string; optionId: string | null; session: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menuAxis = menu ? shown.find((axis) => axis.id === menu.axisId) : undefined;
  const menuScopeExists =
    !menu?.optionId ||
    (menuAxis !== undefined &&
      menuAxis.kind !== 'range' &&
      (menuAxis.kind === 'color' ? menuAxis.swatches : menuAxis.options).some((o) => o.id === menu.optionId));
  const menuShown = menuOpen && menuAxis !== undefined && menuScopeExists;
  const openMenu = useCallback<OpenMenu>((axis, opener, optionId = null) => {
    trigger.current = opener;
    setMenu((previous) => ({ axisId: axis.id, optionId, session: (previous?.session ?? 0) + 1 }));
    setMenuOpen(true);
  }, []);
  // Composing feedback moves focus to the composer instead of the selector.
  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    if (!restoreFocus) return;
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else bodyRef.current?.parentElement?.querySelector<HTMLButtonElement>('button')?.focus();
    });
  }, []);

  // The custom colour popover, below its swatch when it fits and above otherwise.
  const [colourOpen, setColourOpen] = useState<string | null>(null);
  const colourPop = useRef<HTMLFieldSetElement>(null);
  const colourTrigger = useRef<HTMLButtonElement | null>(null);
  const [colourTop, setColourTop] = useState<number | null>(null);
  const closeColour = useCallback((refocus = true) => {
    setColourOpen(null);
    setColourTop(null);
    if (refocus) requestAnimationFrame(() => colourTrigger.current?.focus());
  }, []);
  const toggleColour = useCallback((axis: VariantAxis, button: HTMLButtonElement) => {
    colourTrigger.current = button;
    setColourOpen((open) => (open === axis.id ? null : axis.id));
    setColourTop(null);
  }, []);
  // Like the action dialog, the custom colour closes on a press anywhere else;
  // its own button toggles it.
  useEffect(() => {
    if (!colourOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (colourPop.current && !path.includes(colourPop.current) && !(colourTrigger.current && path.includes(colourTrigger.current)))
        closeColour(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [colourOpen, closeColour]);
  // It follows the button while the selectors scroll, and a short panel grows to hold it.
  useLayoutEffect(() => {
    const pop = colourPop.current;
    const button = colourTrigger.current;
    const parent = pop?.offsetParent as HTMLElement | null;
    if (!colourOpen || !pop || !button || !parent) return;
    parent.style.setProperty('--iso-menu-need', `${pop.offsetHeight + 12}px`);
    const place = () => {
      const box = parent.getBoundingClientRect();
      const anchor = button.getBoundingClientRect();
      const height = pop.offsetHeight;
      const below = anchor.bottom - box.top + 6;
      const above = anchor.top - box.top - height - 6;
      const top = below + height <= parent.clientHeight - 6 || above < 6 ? below : above;
      setColourTop(Math.max(6, Math.min(top, parent.clientHeight - height - 6)));
    };
    place();
    const body = bodyRef.current;
    body?.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    return () => {
      body?.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      parent.style.removeProperty('--iso-menu-need');
    };
  }, [colourOpen]);

  const renderAxis = ({ axis, label, fullLabel }: { axis: VariantAxis; label: string; fullLabel: string }) => (
    <AxisControl
      key={axis.id}
      source={guarded}
      axis={axis}
      label={label}
      fullLabel={fullLabel}
      value={value(axis)}
      menuFor={menuShown && menu?.axisId === axis.id ? menu.optionId : undefined}
      colourOpen={colourOpen === axis.id}
      onOpenMenu={openMenu}
      onColour={toggleColour}
    />
  );
  const colourAxis = shown.find((a) => a.id === colourOpen);
  const dirty = isDirty(shown, stored);
  // While the bar fades out, it keeps the count it had rather than reading "0 picks".
  const lastCount = useRef(0);
  if (dirty) lastCount.current = changedAxes(shown, stored).length;
  const comparable = compareAxes(source, shown, stored);
  const shortName = (axis: VariantAxis) => names.get(axis.id)?.label ?? axis.label;
  // A changed selector that is not part of the hold keeps showing its pick, and the bar names it.
  const except = held
    ? changedAxes(shown, stored)
        .filter((axis) => !(axis.id in held))
        .map(shortName)
    : [];
  const firstSkip = comparable.skipped[0];
  const compareTitle = [
    `Hold to show the defaults${compareKey ? ' · or hold the key under Esc' : ''}`,
    firstSkip &&
      `${shortName(firstSkip.axis)} ${firstSkip.reason ?? 'cannot switch instantly'}, so it keeps its pick${
        comparable.skipped.length > 1 ? `, as do ${comparable.skipped.length - 1} more` : ''
      }.`,
  ]
    .filter(Boolean)
    .join('. ');
  const shownCount = lastCount.current;
  const saving = Boolean(source.saveDefaults) && dirty;
  // Where and when the last press in the list landed, and whether the pointer has since moved away from it.
  const pressed = useRef<{ x: number; y: number; time: number; target: Element; moved: boolean } | null>(null);
  useEffect(() => {
    const moved = (e: PointerEvent) => {
      const at = pressed.current;
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > 8) at.moved = true;
    };
    window.addEventListener('pointermove', moved, { passive: true });
    return () => window.removeEventListener('pointermove', moved);
  }, []);
  // The bar floats in room the list keeps for it, so in a list at rest it covers only what has already faded.
  // A pick on a control partly under it, in a list that scrolls, brings that control just clear of the bar.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const bar = body?.parentElement?.querySelector<HTMLElement>(':scope > .isotone-panel-head');
    const control = pressed.current?.target.closest('.isotone-axis');
    if (!saving || !body || !bar || !control?.isConnected || !body.contains(control)) return;
    const view = body.getBoundingClientRect();
    const rect = control.getBoundingClientRect();
    if (rect.top >= view.bottom || rect.bottom <= view.top) return;
    const covered = rect.bottom - (bar.parentElement as HTMLElement).getBoundingClientRect().bottom + bar.offsetHeight;
    if (covered > 0) body.scrollBy?.({ top: covered, behavior: stillMotion(body) ? 'auto' : 'smooth' });
  }, [saving]);
  // A press on the bar soon after a press in the list, or where that press landed with the pointer not moved
  // away, was meant for the list: a second click on a pick the bar has just risen under files nothing.
  const unmoved = (e: { timeStamp: number; preventDefault(): void; stopPropagation(): void }) => {
    const at = pressed.current;
    if (!at || (at.moved && e.timeStamp - at.time > 500)) return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="isotone-vars" data-bar={Boolean(source.saveDefaults)} data-saving={saving} data-comparing={held !== null}>
      {source.saveDefaults && (
        // Always mounted, floating in room the list keeps for it, so a pick never moves the selectors; it fades in once one differs.
        <div className="isotone-panel-head" data-shown={dirty} onPointerDownCapture={unmoved} onClickCapture={unmoved}>
          <div
            className="isotone-head-actions"
            ref={(node) => {
              node?.toggleAttribute('inert', !dirty);
            }}
            aria-hidden={!dirty}
          >
            <DefaultsBar
              source={source}
              changed={shownCount}
              onSaved={onSaved}
              compareTitle={active && comparable.ids.length > 0 ? compareTitle : null}
              comparing={held !== null}
              except={except}
            />
          </div>
        </div>
      )}
      <div
        className="isotone-vars-body"
        ref={(node) => {
          bodyRef.current = node;
          node?.toggleAttribute('inert', menuShown);
        }}
        onPointerDownCapture={(e) => {
          pressed.current = { x: e.clientX, y: e.clientY, time: e.timeStamp, target: e.target as Element, moved: false };
        }}
        // While held, presses do nothing here; scrolling, Tab and Escape (the dock's) still work.
        onKeyDownCapture={(e) => {
          if (!holding.current || e.key === 'Tab' || e.key === 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onClickCapture={(e) => {
          if (!holding.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenuCapture={(e) => {
          if (!holding.current) return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {notice && (
          <p className="isotone-vars-notice" role="status">
            {notice}
          </p>
        )}
        {sourceError && (
          <p className="isotone-danger" role="alert">
            {sourceError}
          </p>
        )}
        {shown.length === 0 && <p className="isotone-empty">{emptyText}</p>}
        {sections.map((section) => {
          // A folded section costs nothing; the list stops at the first selector past the limit.
          const folded = section.name !== null && collapsed.has(section.key);
          if (stopped || (!folded && left === 0)) {
            stopped = true;
            return null;
          }
          const axes = folded ? [] : section.axes.slice(0, left);
          left -= axes.length;
          stopped = !folded && axes.length < section.axes.length;
          return section.name === null ? (
            axes.map(renderAxis)
          ) : (
            <SectionBlock
              key={`section:${section.key}`}
              name={section.name}
              sectionKey={section.key}
              count={section.axes.length}
              collapsed={folded}
              onToggle={() =>
                setCollapsed((previous) => {
                  const next = new Set(previous);
                  if (!next.delete(section.key)) next.add(section.key);
                  return next;
                })
              }
            >
              {axes.map(renderAxis)}
            </SectionBlock>
          );
        })}
        {source.saveDefaults && <div className="isotone-vars-tail" aria-hidden="true" />}
        <ScrollEdge side="top" />
        <ScrollEdge side="bottom" />
      </div>
      {colourAxis?.kind === 'color' && (
        <ColorPicker
          popRef={colourPop}
          value={value(colourAxis)}
          label={colourAxis.label}
          onChange={(hex) => guarded.setSelection(colourAxis.id, hex)}
          onClose={() => closeColour()}
          style={{ top: colourTop ?? 0, visibility: colourTop === null ? 'hidden' : undefined }}
        />
      )}
      {menu && menuAxis && (
        <AxisActionsDialog
          key={menu.session}
          source={guarded}
          axis={menuAxis}
          name={names.get(menuAxis.id) ?? axisSection(menuAxis)}
          value={value(menuAxis)}
          optionId={menu.optionId}
          open={menuShown}
          opener={trigger}
          pendingActions={pendingActions}
          onFeedback={onFeedback}
          onManage={onManage}
          onClose={closeMenu}
        />
      )}
    </div>
  );
});

/** The variants panel in the dock: its close control, resize handle and selectors. */
export function VariantsPanel({
  id,
  resizeHandle,
  onClose,
  ...view
}: VariantsViewProps & { id: string; active: boolean; resizeHandle: HTMLAttributes<HTMLDivElement>; onClose: () => void }) {
  return (
    <section
      id={id}
      role="dialog"
      aria-label="Variants"
      className="isotone-panel isotone-variants-panel"
      data-open={view.active}
      aria-hidden={!view.active}
      ref={(node) => {
        node?.toggleAttribute('inert', !view.active);
      }}
    >
      <PanelClose label="Close variants" onClose={onClose} />
      {view.active && <div {...resizeHandle} />}
      <VariantsView {...view} />
    </section>
  );
}

/**
 * A section of selectors: a sticky header that names the part of the page and
 * can fold the section away, then its selectors. The header stays at the top of
 * the scroll area while its own selectors pass beneath it, and the next
 * section's header pushes it out.
 */
function SectionBlock({
  name,
  sectionKey,
  count,
  collapsed,
  onToggle,
  children,
}: {
  name: string;
  sectionKey: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const wasCollapsed = useRef(collapsed);
  // Opening a section eases its selectors in from under the header, rather than popping them in.
  useLayoutEffect(() => {
    const opening = wasCollapsed.current && !collapsed;
    wasCollapsed.current = collapsed;
    const node = body.current;
    if (!opening || !node || typeof node.animate !== 'function' || stillMotion(node)) return;
    node.animate(
      [
        { opacity: 0, transform: 'translateY(-6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: MOTION.enter, easing: MOTION.easeOut },
    );
  }, [collapsed]);
  return (
    // The heading carries the structure (heading navigation, a disclosure button);
    // a region or group per section would only add landmarks to a long list.
    <div className="isotone-section" data-collapsed={collapsed}>
      <h3 className="isotone-section-head" data-motion-key={`section:${sectionKey}`}>
        <button
          type="button"
          className="isotone-section-toggle"
          aria-label={`${name}, ${count} ${count === 1 ? 'selector' : 'selectors'}`}
          aria-expanded={!collapsed}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <Icon name="chevron" size={12} />
          <span onPointerOver={showOverflowTitle}>{name}</span>
          <small>{count}</small>
        </button>
      </h3>
      <div ref={body} className="isotone-section-body" id={`${id}-body`} hidden={collapsed}>
        {collapsed ? null : children}
      </div>
    </div>
  );
}

/**
 * Crossfade a line of text that has just changed: the old words fade out over
 * the new ones as a copy outside the live region, so the change is announced
 * once, and both blur a little through the middle so they read as one line
 * changing. The copy takes no room, so the bar keeps its size.
 */
function crossfade(node: HTMLElement | null, before: string) {
  if (!node || typeof node.animate !== 'function' || keyboardInstant(node)) return;
  const row = node.parentElement;
  if (!row) return;
  for (const old of row.querySelectorAll('.isotone-save-was')) old.remove();
  const at = node.getBoundingClientRect();
  const origin = (node.offsetParent ?? row).getBoundingClientRect();
  const box = { left: at.left - origin.left, top: at.top - origin.top, width: at.width };
  const was = document.createElement('span');
  was.className = 'isotone-save-count isotone-save-was';
  was.setAttribute('aria-hidden', 'true');
  was.textContent = before;
  Object.assign(was.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px` });
  node.after(was);
  const timing = { duration: MOTION.swap, easing: MOTION.easeOut };
  const out = was.animate(
    [
      { opacity: 1, filter: 'blur(0)' },
      { opacity: 0.5, filter: 'blur(2px)', offset: 0.5 },
      { opacity: 0, filter: 'blur(2px)' },
    ],
    timing,
  );
  node.animate(
    [
      { opacity: 0, filter: 'blur(2px)' },
      { opacity: 0.5, filter: 'blur(2px)', offset: 0.5 },
      { opacity: 1, filter: 'blur(0)' },
    ],
    timing,
  );
  out.onfinish = () => was.remove();
}

/**
 * The page's changed picks and the request to make them the defaults. The
 * other alternatives stay; removing one is its own request.
 */
function DefaultsBar({
  source,
  changed,
  onSaved,
  compareTitle,
  comparing,
  except,
}: {
  source: VariantsSource;
  changed: number;
  onSaved?: () => void;
  /** Compare's tooltip, or null when nothing changed can be compared. */
  compareTitle: string | null;
  comparing: boolean;
  /** Changed selectors the hold leaves on their pick. */
  except: string[];
}) {
  const [state, setState] = useState('');
  // A quick click looks like nothing happened; say how it works.
  const [tapped, setTapped] = useState(false);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(tapTimer.current), []);
  const onTap = useCallback(() => {
    setTapped(true);
    clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => setTapped(false), 1500);
  }, []);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function run() {
    if (busy) return;
    setBusy(true);
    setState('');
    const selections: VariantSelections = { ...source.getSelections() };
    try {
      await source.saveDefaults?.(selections);
      setState('Default request saved');
      onSaved?.();
    } catch {
      setState('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(''), 3000);
  }
  const picks = `${changed} ${changed === 1 ? 'pick' : 'picks'}`;
  const line = state || `${picks} changed`;
  const status = useRef<HTMLSpanElement>(null);
  const shown = useRef(line);
  // The saved message comes and goes as a crossfade; a count that changes with a pick swaps at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the message's arrival and departure crossfade.
  useLayoutEffect(() => {
    if (shown.current !== line) crossfade(status.current, shown.current);
  }, [state]);
  useLayoutEffect(() => {
    shown.current = line;
  });
  return (
    <div className="isotone-save-row" aria-busy={busy}>
      <span ref={status} className="isotone-save-count" role="status">
        {state ||
          (comparing ? (
            except.length > 0 ? (
              <>
                <span className="isotone-wide">Showing defaults, except</span>
                <span className="isotone-narrow">Defaults, except</span>
                <span className="isotone-save-name">{except[0]}</span>
                {except.length > 1 && (
                  <>
                    <span className="isotone-wide">and {except.length - 1} more</span>
                    <span className="isotone-narrow">+{except.length - 1}</span>
                  </>
                )}
              </>
            ) : (
              'Showing defaults'
            )
          ) : tapped ? (
            'Hold to compare'
          ) : (
            `${picks} changed`
          ))}
      </span>
      {compareTitle && <CompareButton source={source} title={compareTitle} comparing={comparing} onTap={onTap} />}
      <button
        type="button"
        className="isotone-save"
        disabled={busy}
        title={`Ask the agent to make ${changed === 1 ? 'this pick' : 'these picks'} the default. Every option stays available.`}
        onClick={() => void run()}
      >
        Make default
      </button>
    </div>
  );
}

/** A press released sooner than this was a click, not a hold. */
const TAP_MS = 250;

/** Keys on the focused button that hold, as a press would. */
const HOLD_KEYS = new Set([' ', 'Enter']);

/**
 * Hold to show the defaults; let go to show the picks again. A pointer hold is
 * captured, so it ends wherever the press ends, and also ends if capture is
 * lost, the pointer leaves the window, or the button goes away (the panel
 * closes). Space or Enter held on the button does the same. It never animates:
 * a flick is for seeing the difference.
 */
function CompareButton({
  source,
  title,
  comparing,
  onTap,
}: {
  source: VariantsSource;
  title: string;
  comparing: boolean;
  onTap: () => void;
}) {
  const compare = compareFor(source);
  const pointer = useRef<number | null>(null);
  const since = useRef(0);
  const tap = useRef(onTap);
  tap.current = onTap;
  const release = useCallback(() => {
    const quick = pointer.current !== null && performance.now() - since.current < TAP_MS;
    pointer.current = null;
    compare.end('pointer');
    if (quick) tap.current();
  }, [compare]);
  // Whatever happens to the press (released elsewhere, the window left, the button unmounted), the hold ends.
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === pointer.current) release();
    };
    const onOut = (e: PointerEvent) => {
      if (pointer.current !== null && e.relatedTarget === null && e.pointerType === 'mouse') release();
    };
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    document.addEventListener('pointerout', onOut, true);
    return () => {
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('pointerout', onOut, true);
      release();
      compare.end('button-key');
    };
  }, [compare, release]);
  return (
    <button
      type="button"
      className="isotone-compare"
      aria-pressed={comparing}
      title={title}
      onPointerDown={(e) => {
        // A hold ended elsewhere (blur, a hidden tab) leaves no claim on the next press.
        if (e.button !== 0 || !compare.start('pointer')) return;
        pointer.current = e.pointerId;
        since.current = performance.now();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // No capture (an old engine): the window listeners still end the hold.
        }
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (!HOLD_KEYS.has(e.key)) return;
        e.preventDefault();
        if (!e.repeat) compare.start('button-key');
      }}
      onKeyUp={(e) => {
        if (!HOLD_KEYS.has(e.key)) return;
        e.preventDefault();
        compare.end('button-key');
      }}
      onBlur={() => compare.end('button-key')}
    >
      Compare
    </button>
  );
}

/** Blur layers for one edge of the selectors' scroller, each a step blurrier than the last, so
 *  content dissolves gradually where it leaves view (styles/edges.ts). */
function ScrollEdge({ side }: { side: 'top' | 'bottom' }) {
  return (
    <div className={`isotone-edge isotone-edge-${side}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}
