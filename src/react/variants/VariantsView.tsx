import {
  type HTMLAttributes,
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { VariantReference } from '../../core/types';
import {
  axisDefault,
  axisSection,
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
import { keyboardInstant, MAX_ANIMATED_ITEMS, MOTION } from '../motion';
import { PanelClose } from '../notes/NotesPanel';
import { useLayoutMotion } from '../useLayoutMotion';
import { useRenderLimit } from '../useRenderLimit';
import { showOverflowTitle } from '../tooltips';

export function refreshSource(source: VariantsSource): void {
  const candidate = (source as { refresh?: unknown }).refresh;
  if (typeof candidate === 'function') void Promise.resolve(candidate.call(source)).catch(() => {});
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
}

export const VariantsView = memo(function VariantsView({
  source,
  active = true,
  onFeedback,
  onSaved,
  onManage,
  pendingActions = NO_PENDING_ACTIONS,
  emptyText = DEFAULT_EMPTY_TEXT,
}: VariantsViewProps) {
  const { selections, shown, sections, names, error: sourceError } = useVariantsSnapshot(source);
  useEffect(() => {
    if (active) refreshSource(source);
  }, [active, source]);
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
      source={source}
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
  const dirty = isDirty(shown, selections);
  // While the bar fades out, it keeps the count it had rather than reading "0 picks".
  const lastCount = useRef(0);
  if (dirty) lastCount.current = changedCount(shown, selections);
  const shownCount = lastCount.current;
  // The bar rises over the foot of the list: if it would cover the control just used, bring that control clear of it.
  const touched = useRef<Element | null>(null);
  const saving = Boolean(source.saveDefaults) && dirty;
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const control = touched.current?.closest('.isotone-axis');
    // Used once: a pick changed some other way later must not jump to an old control.
    touched.current = null;
    if (!saving || !body || !control?.isConnected || !body.contains(control)) return;
    const bar = body.parentElement?.querySelector<HTMLElement>(':scope > .isotone-panel-head')?.offsetHeight ?? 0;
    const view = body.getBoundingClientRect();
    const rect = control.getBoundingClientRect();
    // Only a control in view that the bar would cover; one scrolled away stays where the reviewer left it.
    if (rect.top >= view.bottom || rect.bottom <= view.top) return;
    const covered = rect.bottom - (view.bottom - bar);
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (covered > 0) body.scrollBy?.({ top: covered, behavior: still ? 'auto' : 'smooth' });
  }, [saving]);

  return (
    <div className="isotone-vars" data-saving={saving}>
      {source.saveDefaults && (
        // Always mounted and floating, so changing a pick never moves the selectors; it fades in once one differs.
        <div className="isotone-panel-head" data-shown={dirty}>
          <div
            className="isotone-head-actions"
            ref={(node) => {
              node?.toggleAttribute('inert', !dirty);
            }}
            aria-hidden={!dirty}
          >
            <DefaultsBar source={source} changed={shownCount} onSaved={onSaved} />
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
          touched.current = e.target as Element;
        }}
        onFocusCapture={(e) => {
          touched.current = e.target as Element;
        }}
      >
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
      </div>
      {colourAxis?.kind === 'color' && (
        <ColorPicker
          popRef={colourPop}
          value={value(colourAxis)}
          label={colourAxis.label}
          onChange={(hex) => source.setSelection(colourAxis.id, hex)}
          onClose={() => closeColour()}
          style={{ top: colourTop ?? 0, visibility: colourTop === null ? 'hidden' : undefined }}
        />
      )}
      {menu && menuAxis && (
        <AxisActionsDialog
          key={menu.session}
          source={source}
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
      <div className="isotone-section-body" id={`${id}-body`} hidden={collapsed}>
        {collapsed ? null : children}
      </div>
    </div>
  );
}

/** How many visible selectors differ from their defaults. */
function changedCount(axes: VariantAxis[], selections: VariantSelections): number {
  return axes.filter((a) => selections[a.id] !== undefined && selections[a.id] !== axisDefault(a)).length;
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
  const box = { left: node.offsetLeft, top: node.offsetTop, width: node.offsetWidth };
  const was = document.createElement('span');
  was.className = 'isotone-save-count isotone-save-was';
  was.setAttribute('aria-hidden', 'true');
  was.textContent = before;
  Object.assign(was.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px` });
  node.after(was);
  const timing = { duration: MOTION.swap, easing: 'ease' };
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
function DefaultsBar({ source, changed, onSaved }: { source: VariantsSource; changed: number; onSaved?: () => void }) {
  const [state, setState] = useState('');
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
        {line}
      </span>
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
