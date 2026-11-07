import { showOverflowTitle } from './tooltips';
import { type ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VariantReference } from '../core/index';
import {
  axisDefault,
  axisSection,
  formatRangeValue,
  isDirty,
  type VariantAction,
  type VariantAxis,
  type VariantSection,
  type VariantSelections,
  type VariantsSource,
  sectionAxes,
  visibleAxes,
} from '../core/variants';
import { Icon } from './icons';
import { MOTION } from './motion';
import { useLayoutMotion } from './useLayoutMotion';

export function refreshSource(source: VariantsSource): void {
  const candidate = (source as { refresh?: unknown }).refresh;
  if (typeof candidate === 'function')
    void Promise.resolve(candidate.call(source)).catch(() => {});
}

export function useVariantsSource(source: VariantsSource | undefined) {
  const [revision, setRevision] = useState(0);
  useEffect(() => source?.subscribe(() => setRevision(n => n + 1)), [source]);
  return revision;
}

const NO_PENDING_ACTIONS: VariantAction[] = [];

const DEFAULT_EMPTY_TEXT = 'No variants on this page yet. Ask your agent to create variants of any design and they will appear here.';

export function VariantsView({
  source,
  showTitle = true,
  active = true,
  onFeedback,
  onClose,
  onSaved,
  onManage,
  pendingActions = NO_PENDING_ACTIONS,
  emptyText = DEFAULT_EMPTY_TEXT,
}: {
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
}) {
  const revision = useVariantsSource(source);
  useEffect(() => {
    if (active) refreshSource(source);
  }, [active, source]);
  // The source notifies through its revision; typing in the composer does not
  // need another selector graph walk or another layout measurement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision represents external source updates.
  const { selections, shown, sections, names, sourceError } = useMemo(() => {
    const selections = source.getSelections();
    const shown = visibleAxes(source.getAxes(), selections);
    const sections = sectionAxes(shown);
    return {
      selections,
      shown,
      sections,
      names: new Map(sections.flatMap(section => section.axes).map(entry => [entry.axis.id, entry])),
      sourceError: source.getError?.(),
    };
  }, [source, revision]);
  // Collapsed sections, by case-insensitive name; kept while the panel closes.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [menuId, setMenuId] = useState<string | null>(null);
  const menu = shown.find(axis => axis.id === menuId) ?? null;
  const nameOf = (axis: VariantAxis) => names.get(axis.id) ?? axisSection(axis);
  const menuName = menu ? nameOf(menu) : null;
  // Set when the dialog was opened from one option instead of the selector label.
  const [menuOption, setMenuOption] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ optionId: string; retry: boolean } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutMotion(bodyRef, shown, active);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const value = (axis: VariantAxis) => selections[axis.id] ?? axisDefault(axis);
  const menuOptions =
    menu?.kind === 'color'
      ? menu.swatches.map((s) => ({
          ...s,
          isDefault: s.value.toLowerCase() === menu.defaultColor.toLowerCase(),
        }))
      : menu && menu.kind !== 'range'
        ? menu.options.map((o) => ({
            ...o,
            isDefault: o.id === menu.defaultOption,
          }))
        : [];
  const scoped = menuOption ? menuOptions.find(o => o.id === menuOption) : undefined;
  // Composing feedback moves focus to the composer instead of the selector.
  const closeMenu = (restoreFocus = true) => {
    setMenuOpen(false);
    setError('');
    pendingFocus.current = null;
    if (!restoreFocus) return;
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else
        bodyRef.current?.parentElement
          ?.querySelector<HTMLButtonElement>('button')
          ?.focus();
    });
  };
  // A removal request keeps the dialog open. Its trash button is disabled while
  // the request saves and stays disabled once it is pending, so focus moves on
  // to the next option that can still be removed, then back up the list, then
  // to Reset to default. A failed request returns focus to the same button.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the request settles and the pending state has rendered.
  useEffect(() => {
    const target = pendingFocus.current;
    const dialog = menuRef.current;
    if (busy || !target || !dialog || !menuOpen) return;
    pendingFocus.current = null;
    const rows = Array.from(dialog.querySelectorAll<HTMLElement>('.isotone-option-row'));
    const at = rows.findIndex(row => row.dataset.optionId === target.optionId);
    const removable = (row: HTMLElement | undefined) =>
      row?.querySelector<HTMLButtonElement>('button[data-remove]:not(:disabled)') ?? null;
    const next = target.retry
      ? removable(rows[at])
      : [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0)).reverse()].map(removable).find(Boolean);
    (next ?? dialog.querySelector<HTMLButtonElement>('[data-reset]'))?.focus();
  }, [busy, pendingActions, menuOpen]);

  useEffect(() => {
    if (!menu || (menuOption && !scoped)) setMenuOpen(false);
  }, [menu, menuOption, scoped]);

  // The panel grows only when the dialog's own content cannot fit in it, and the
  // dialog sits directly above the clicked heading or option when there is room.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog's content changes with the selected selector and its options.
  useLayoutEffect(() => {
    const root = bodyRef.current?.parentElement;
    const dialog = menuRef.current;
    const scroll = dialog?.querySelector<HTMLElement>('.isotone-menu-scroll');
    if (!root) return;
    const clear = () => {
      root.style.removeProperty('--iso-menu-need');
      root.style.removeProperty('--iso-menu-top');
    };
    if (!menuOpen || !dialog || !scroll) { clear(); return; }
    const place = () => {
      const natural = dialog.offsetHeight + scroll.scrollHeight - scroll.clientHeight;
      root.style.setProperty('--iso-menu-need', `${natural + 12}px`);
      const opener = trigger.current?.isConnected ? trigger.current : null;
      const anchor = (opener?.closest<HTMLElement>('.isotone-opt') ?? opener)?.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const above = anchor ? anchor.top - rootRect.top - natural - 6 : 6;
      const below = anchor ? anchor.bottom - rootRect.top + 6 : 6;
      // Opens below when it cannot fit above, so it never covers the option or heading that opened it.
      const top = above >= 6 ? above : below + natural <= root.clientHeight - 6 ? below : 6;
      root.style.setProperty('--iso-menu-top', `${top}px`);
    };
    place();
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(scroll);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
      clear();
    };
  }, [menuOpen, menu, menuOptions.length, error]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: closeMenu only touches state setters and refs, so the listener follows menuOpen alone.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const dialog = menuRef.current;
      if (dialog && !e.composedPath().includes(dialog)) closeMenu();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen)
      menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [menuOpen]);

  function feedback(axis: VariantAxis, optionId?: string) {
    const option =
      axis.kind === 'range'
        ? undefined
        : (axis.kind === 'color' ? axis.swatches : axis.options).find(
            (o) => o.id === optionId,
          );
    closeMenu(false);
    onFeedback?.({
      axisId: axis.id,
      label: nameOf(axis).fullLabel,
      value: value(axis),
      ...(option ? { optionId: option.id, optionLabel: option.label } : {}),
    });
  }
  const requested = (action: VariantAction) => pendingActions.some(pending =>
    pending.axisId === action.axisId && pending.action === action.action && pending.optionId === action.optionId);
  function openMenu(axis: VariantAxis, opener: HTMLButtonElement | null, optionId: string | null = null) {
    trigger.current = opener;
    setMenuId(axis.id);
    setMenuOption(optionId);
    setError('');
    setMenuOpen(true);
  }
  // Removing one option from the selector's dialog keeps it open, so several can
  // be requested in a row. Everything else closes it: Keep default only, Keep only
  // this and Remove selector decide the selector, and the option-scoped dialog has
  // no list to move focus along, so it closes and returns focus to its chevron.
  async function manage(action: VariantAction) {
    if (!menu || busy || !onManage || requested(action)) return;
    const option = action.action === 'remove-option' && !scoped ? action.optionId : undefined;
    setBusy(true);
    setError('');
    try {
      const chosen = menuOptions.find(o => o.id === action.optionId);
      await onManage(action, {
        axisId: menu.id, label: menuName?.fullLabel ?? menu.label, value: value(menu),
        ...(chosen ? { optionId: chosen.id, optionLabel: chosen.label } : {}),
      });
      if (option !== undefined) pendingFocus.current = { optionId: option, retry: false };
      else closeMenu();
    } catch (e) {
      if (option !== undefined) pendingFocus.current = { optionId: option, retry: true };
      setError(
        e instanceof Error ? e.message : 'Could not update this selector.',
      );
    } finally {
      setBusy(false);
    }
  }

  function renderAxis({ axis, label, fullLabel }: VariantSection['axes'][number]) {
    const thumbnails = axis.kind !== 'range' && axis.kind !== 'color' && axis.options.length > 0 && axis.options.every(option => option.image);
    return (
      <div
        className="isotone-axis"
        key={axis.id}
        data-motion-key={axis.id}
      >
        <div className="isotone-axis-head">
          <button
            type="button"
            className="isotone-axis-label"
            aria-label={`${fullLabel} actions`}
            aria-haspopup="dialog"
            aria-expanded={menuOpen && menu?.id === axis.id}
            onClick={(e) => openMenu(axis, e.currentTarget)}
          >
            <span onPointerOver={showOverflowTitle}>{label}</span>
            <Icon name="chevron" size={12} />
          </button>
          {(axis.kind === 'range' || axis.kind === 'color') && (
            <span className="isotone-axis-value">
              {axis.kind === 'range'
                ? formatRangeValue(axis, value(axis))
                : value(axis).toUpperCase()}
            </span>
          )}
        </div>
        {axis.kind === 'range' ? (
          <input
            type="range"
            className="isotone-range"
            aria-label={fullLabel}
            aria-valuetext={formatRangeValue(axis, value(axis))}
            min={axis.min}
            max={axis.max}
            step={axis.step}
            value={Number(value(axis))}
            onChange={(e) => source.setSelection(axis.id, e.target.value)}
          />
        ) : axis.kind === 'color' ? (
          <fieldset className="isotone-swatches" aria-label={fullLabel}>
            {axis.swatches.map((sw) => (
              <OptionFrame key={sw.id} className="isotone-opt-swatch" axis={axis} id={sw.id} label={sw.label} onOpen={openMenu}>
                <button
                  type="button"
                  title={sw.label}
                  aria-label={sw.label}
                  aria-pressed={
                    value(axis).toLowerCase() === sw.value.toLowerCase()
                  }
                  className="isotone-swatch"
                  style={{ backgroundColor: sw.value }}
                  onClick={() => source.setSelection(axis.id, sw.value)}
                />
              </OptionFrame>
            ))}
            <label className="isotone-picker" title="Custom colour">
              <input
                type="color"
                aria-label={`${fullLabel}: custom colour`}
                value={value(axis)}
                onChange={(e) =>
                  source.setSelection(axis.id, e.target.value)
                }
              />
            </label>
          </fieldset>
        ) : (
          <fieldset
            aria-label={fullLabel}
            className={
              thumbnails
                ? 'isotone-grid'
                : 'isotone-segs'
            }
          >
            {axis.options.map((o) => (
              <OptionFrame key={o.id} className={thumbnails ? 'isotone-opt-thumb' : 'isotone-opt-seg'} axis={axis} id={o.id} label={o.label} onOpen={openMenu}>
                <button
                  type="button"
                  aria-label={o.label}
                  aria-pressed={value(axis) === o.id}
                  className={`${thumbnails ? 'isotone-thumb' : 'isotone-seg'}${value(axis) === o.id ? ' isotone-seg-on' : ''}`}
                  onClick={() => source.setSelection(axis.id, o.id)}
                >
                  {thumbnails && (
                    <img src={o.image} alt="" />
                  )}
                  <span onPointerOver={showOverflowTitle}>{o.label}</span>
                </button>
              </OptionFrame>
            ))}
          </fieldset>
        )}

      </div>
      );
  }

  return (
    <div className="isotone-vars">
      <div className="isotone-panel-head">
        {showTitle && <h2>{source.title ?? 'Variants'}</h2>}
        <div className="isotone-head-actions">
          {source.saveDefaults && isDirty(shown, selections) && (
            <SaveDefaults source={source} onSaved={onSaved} />
          )}
          {onClose && (
            <button
              type="button"
              className="isotone-icon"
              aria-label="Close variants"
              title="Close variants"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      </div>
      <div className="isotone-vars-body" ref={node => { bodyRef.current = node; node?.toggleAttribute('inert', menuOpen); }}>
        {sourceError && <p className="isotone-danger" role="alert">{sourceError}</p>}
        {shown.length === 0 && (
          <p className="isotone-empty">{emptyText}</p>
        )}
        {sections.map(section => section.name === null
          ? section.axes.map(renderAxis)
          : <SectionBlock
              key={`section:${section.key}`}
              name={section.name}
              sectionKey={section.key}
              count={section.axes.length}
              collapsed={collapsed.has(section.key)}
              onToggle={() => setCollapsed(previous => {
                const next = new Set(previous);
                if (!next.delete(section.key)) next.add(section.key);
                return next;
              })}
            >
              {section.axes.map(renderAxis)}
            </SectionBlock>)}
      </div>
      {menu && (
        <div
          className="isotone-axis-menu"
          ref={node => { menuRef.current = node; node?.toggleAttribute('inert', !menuOpen); }}
          role="dialog"
          aria-label={scoped ? `${scoped.label} option actions` : `${menuName?.fullLabel ?? menu.label} actions`}
          aria-hidden={!menuOpen}
          data-open={menuOpen}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              closeMenu();
            }
          }}
        >
          <div className="isotone-menu-title">
            {scoped ? (
              <span className="isotone-menu-heading">
                <strong>{scoped.label}</strong>
                <small>{menuName?.label ?? menu.label}</small>
              </span>
            ) : (
              <strong>{menuName?.label ?? menu.label}</strong>
            )}
            <button
              type="button"
              className="isotone-icon"
              aria-label="Close selector actions"
              title="Close selector actions"
              onClick={() => closeMenu()}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="isotone-menu-scroll">
            {scoped ? (
              <>
                {onFeedback && (
                  <button type="button" className="isotone-menu-action" onClick={() => feedback(menu, scoped.id)}>
                    <Icon name="message" />
                    Feedback on this option
                  </button>
                )}
                {onManage && (
                  <>
                    <button
                      type="button"
                      className="isotone-menu-action"
                      disabled={busy || requested({ axisId: menu.id, action: 'keep-option', optionId: scoped.id })}
                      onClick={() => void manage({ axisId: menu.id, action: 'keep-option', optionId: scoped.id })}
                    >
                      <Icon name="check" />
                      {requested({ axisId: menu.id, action: 'keep-option', optionId: scoped.id }) ? 'Keep request saved' : 'Keep only this'}
                    </button>
                    <button
                      type="button"
                      className="isotone-menu-action isotone-danger"
                      disabled={scoped.isDefault || busy || requested({ axisId: menu.id, action: 'remove-option', optionId: scoped.id })}
                      onClick={() => void manage({ axisId: menu.id, action: 'remove-option', optionId: scoped.id })}
                    >
                      <Icon name="trash" />
                      {requested({ axisId: menu.id, action: 'remove-option', optionId: scoped.id }) ? 'Removal request saved' : 'Remove this option'}
                    </button>
                  </>
                )}
              </>
            ) : (<>
            {onFeedback && (
              <button
                type="button"
                className="isotone-menu-action"
                onClick={() => feedback(menu)}
              >
                <Icon name="message" />
                Feedback on this selector
              </button>
            )}
            {menu.kind !== 'range' && (
              <div className="isotone-menu-options">
                {menuOptions.map((option) => {
                  const pending = requested({ axisId: menu.id, action: 'remove-option', optionId: option.id });
                  return (
                  <div className="isotone-option-row" key={option.id} data-option-id={option.id} data-requested={pending || undefined}>
                    {/* Only the label truncates; its tags sit beside it and always show in full. */}
                    <span className="isotone-option-name">
                      <span className="isotone-option-label">{option.label}</span>
                      {(option.isDefault || pending) && (
                        <span className="isotone-option-tags">
                          {option.isDefault && <small>Default</small>}
                          {pending && <small>Removal requested</small>}
                        </span>
                      )}
                    </span>
                    {onFeedback && (
                      <button
                        type="button"
                        className="isotone-icon"
                        aria-label={`Feedback on ${option.label}`}
                        title="Give feedback"
                        onClick={() => feedback(menu, option.id)}
                      >
                        <Icon name="message" />
                      </button>
                    )}
                    {onManage && (
                      <button
                        type="button"
                        className="isotone-icon"
                        aria-label={`Keep only ${option.label}`}
                        title="Keep only this"
                        disabled={busy || requested({ axisId: menu.id, action: 'keep-option', optionId: option.id })}
                        onClick={() => void manage({ axisId: menu.id, action: 'keep-option', optionId: option.id })}
                      >
                        <Icon name="check" />
                      </button>
                    )}
                    {onManage && (
                      <button
                        type="button"
                        className="isotone-icon"
                        data-remove=""
                        aria-label={`Remove ${option.label}`}
                        disabled={option.isDefault || busy || pending}
                        title={
                          option.isDefault
                            ? 'Default option'
                            : pending
                              ? 'Removal requested'
                              : 'Request option removal'
                        }
                        onClick={() =>
                          void manage({
                            axisId: menu.id,
                            action: 'remove-option',
                            optionId: option.id,
                          })
                        }
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className="isotone-menu-action"
              data-reset=""
              onClick={() => {
                source.setSelection(menu.id, axisDefault(menu));
                closeMenu();
              }}
            >
              <Icon name="reset" />
              Reset to default
            </button>
            {onManage && (
              <>
                <button
                  type="button"
                  className="isotone-menu-action"
                  disabled={busy || requested({ axisId: menu.id, action: 'keep-default' })}
                  onClick={() =>
                    void manage({ axisId: menu.id, action: 'keep-default' })
                  }
                >
                  <Icon name="check" />
                  {requested({ axisId: menu.id, action: 'keep-default' }) ? 'Default-only request saved' : 'Keep default only'}
                </button>
                <button
                  type="button"
                  className="isotone-menu-action isotone-danger"
                  disabled={busy || requested({ axisId: menu.id, action: 'remove-axis' })}
                  onClick={() =>
                    void manage({ axisId: menu.id, action: 'remove-axis' })
                  }
                >
                  <Icon name="trash" />
                  {requested({ axisId: menu.id, action: 'remove-axis' }) ? 'Removal request saved' : 'Remove selector & options'}
                </button>
              </>
            )}
            </>)}
          </div>
          {error && (
            <div className="isotone-menu-footer">
              <p className="isotone-danger" role="alert">{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Positions an option's actions button beside its own button: a button cannot nest in a button. */
function OptionFrame({ axis, id, label, className, onOpen, children }: {
  axis: VariantAxis;
  id: string;
  label: string;
  className: string;
  onOpen: (axis: VariantAxis, opener: HTMLButtonElement | null, optionId: string) => void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right click is a pointer shortcut; the actions button is the accessible entry point.
    <div
      className={`isotone-opt ${className}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpen(axis, e.currentTarget.querySelector('button'), id);
      }}
    >
      {children}
      <button
        type="button"
        className={`isotone-icon isotone-opt-more${className === 'isotone-opt-swatch' ? ' isotone-x' : ''}`}
        aria-label={`Actions for ${label}`}
        aria-haspopup="dialog"
        onClick={(e) => onOpen(axis, e.currentTarget, id)}
      >
        <Icon name="chevron" size={12} />
      </button>
    </div>
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

function SaveDefaults({
  source,
  onSaved,
}: {
  source: VariantsSource;
  onSaved?: () => void;
}) {
  const [state, setState] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function save() {
    if (state === 'Saving…') return;
    setState('Saving…');
    const selections: VariantSelections = { ...source.getSelections() };
    try {
      await source.saveDefaults?.(selections);
      setState('Saved for the agent');
      onSaved?.();
    } catch {
      setState('Could not save. Try again.');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(''), 3000);
  }
  // The button itself carries the result for a few seconds: its label crossfades
  // and its width eases between the two label widths.
  const label = state && state !== 'Saving…' ? state : 'Save as defaults';
  const button = useRef<HTMLButtonElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const width = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a label change needs a measurement.
  useLayoutEffect(() => {
    const node = button.current;
    if (!node) return;
    node.style.width = '';
    const next = node.offsetWidth;
    const previous = width.current;
    width.current = next;
    const instant = node.closest('[data-instant="true"]') ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!previous || instant || typeof node.animate !== 'function') return;
    text.current?.animate(
      [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: MOTION.enter, easing: MOTION.easeOut },
    );
    if (Math.abs(previous - next) < 0.5) return;
    node.animate(
      [{ width: `${previous}px` }, { width: `${next}px` }],
      { duration: MOTION.reflow, easing: MOTION.easeOut },
    );
  }, [label]);
  return (
    <div className="isotone-save-row">
      <button
        ref={button}
        type="button"
        className="isotone-save"
        disabled={state === 'Saving…'}
        aria-busy={state === 'Saving…'}
        onClick={() => void save()}
      >
        <span className="isotone-save-label" ref={text}>{label}</span>
      </button>
      <span className="isotone-save-state" role="status">{state}</span>
    </div>
  );
}
