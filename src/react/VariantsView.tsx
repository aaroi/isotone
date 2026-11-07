import {
  memo,
  type ReactNode,
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
import type { VariantReference } from '../core/types';
import {
  axisDefault,
  axisSection,
  isDirty,
  type VariantAction,
  type VariantAxis,
  type VariantSelections,
  type VariantsSource,
  sectionAxes,
  visibleAxes,
} from '../core/variants';
import { AxisActionsDialog } from './AxisActionsDialog';
import { AxisControl, type OpenMenu } from './AxisControl';
import { ColorPicker } from './ColorPicker';
import { Icon } from './icons';
import { useLayoutMotion } from './useLayoutMotion';
import { showOverflowTitle } from './tooltips';

export function refreshSource(source: VariantsSource): void {
  const candidate = (source as { refresh?: unknown }).refresh;
  if (typeof candidate === 'function') void Promise.resolve(candidate.call(source)).catch(() => {});
}

/** How many times each source has notified; the snapshot that selectors are derived from. */
const versions = new WeakMap<VariantsSource, number>();
const noSource = () => () => {};

/** Re-render when the source changes. Returns its change count, to key derived values on. */
export function useVariantsVersion(source: VariantsSource | undefined): number {
  const subscribe = useCallback(
    (notify: () => void) =>
      source
        ? source.subscribe(() => {
            versions.set(source, (versions.get(source) ?? 0) + 1);
            notify();
          })
        : noSource(),
    [source],
  );
  const read = () => (source ? (versions.get(source) ?? 0) : 0);
  return useSyncExternalStore(subscribe, read, read);
}

const NO_PENDING_ACTIONS: VariantAction[] = [];

const DEFAULT_EMPTY_TEXT = 'No variants on this page yet. Ask your agent to create variants of any design and they will appear here.';

interface VariantsViewProps {
  source: VariantsSource;
  showTitle?: boolean;
  active?: boolean;
  onFeedback?: (reference: VariantReference) => void;
  onClose?: () => void;
  onSaved?: () => void;
  onManage?: (action: VariantAction, reference: VariantReference) => Promise<void>;
  pendingActions?: VariantAction[];
  /** What the list says when this page has no selectors. */
  emptyText?: string;
}

export const VariantsView = memo(function VariantsView({
  source,
  showTitle = true,
  active = true,
  onFeedback,
  onClose,
  onSaved,
  onManage,
  pendingActions = NO_PENDING_ACTIONS,
  emptyText = DEFAULT_EMPTY_TEXT,
}: VariantsViewProps) {
  const version = useVariantsVersion(source);
  useEffect(() => {
    if (active) refreshSource(source);
  }, [active, source]);
  // A closed panel renders no selectors. The body stays one more render after
  // closing, so the dock's exit snapshot still shows them.
  const lingering = useDeferredValue(active);
  const bodyShown = active || lingering;
  // biome-ignore lint/correctness/useExhaustiveDependencies: version represents external source updates.
  const { selections, shown, sections, names, sourceError } = useMemo(() => {
    const selections = source.getSelections();
    const shown = visibleAxes(source.getAxes(), selections);
    const sections = sectionAxes(shown);
    return {
      selections,
      shown,
      sections,
      names: new Map(sections.flatMap((section) => section.axes).map((entry) => [entry.axis.id, entry])),
      sourceError: source.getError?.(),
    };
  }, [source, version]);
  const value = (axis: VariantAxis) => selections[axis.id] ?? axisDefault(axis);
  // Collapsed sections, by case-insensitive name; kept while the panel closes.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useLayoutMotion(bodyRef, shown, active);

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

  return (
    <div className="isotone-vars">
      <div className="isotone-panel-head">
        {showTitle && <h2>{source.title ?? 'Variants'}</h2>}
        <div className="isotone-head-actions">
          {source.saveDefaults && isDirty(shown, selections) && (
            <DefaultsBar source={source} changed={changedCount(shown, selections)} onSaved={onSaved} />
          )}
          {onClose && (
            <button type="button" className="isotone-icon" aria-label="Close variants" title="Close variants" onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </div>
      </div>
      <div
        className="isotone-vars-body"
        ref={(node) => {
          bodyRef.current = node;
          node?.toggleAttribute('inert', menuShown);
        }}
      >
        {sourceError && (
          <p className="isotone-danger" role="alert">
            {sourceError}
          </p>
        )}
        {shown.length === 0 && <p className="isotone-empty">{emptyText}</p>}
        {bodyShown &&
          sections.map((section) =>
            section.name === null ? (
              section.axes.map(renderAxis)
            ) : (
              <SectionBlock
                key={`section:${section.key}`}
                name={section.name}
                sectionKey={section.key}
                count={section.axes.length}
                collapsed={collapsed.has(section.key)}
                onToggle={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (!next.delete(section.key)) next.add(section.key);
                    return next;
                  })
                }
              >
                {section.axes.map(renderAxis)}
              </SectionBlock>
            ),
          )}
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
  return (
    <div className="isotone-save-row" aria-busy={busy}>
      <span className="isotone-save-count" role="status">
        {state || `${picks} changed`}
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
