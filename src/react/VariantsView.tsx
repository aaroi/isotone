import { showOverflowTitle } from './tooltips';
import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VariantReference } from '../core/index';
import {
  axisDefault,
  formatRangeValue,
  isDirty,
  type VariantAction,
  type VariantAxis,
  type VariantSelections,
  type VariantsSource,
  visibleAxes,
} from '../core/variants';
import { ColorPicker } from './ColorPicker';
import { Icon } from './icons';
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

export function VariantsView({
  source,
  showTitle = true,
  active = true,
  onFeedback,
  onClose,
  onSaved,
  onManage,
  pendingActions = NO_PENDING_ACTIONS,
}: {
  source: VariantsSource;
  showTitle?: boolean;
  active?: boolean;
  onFeedback?: (reference: VariantReference) => void;
  onClose?: () => void;
  onSaved?: () => void;
  onManage?: (action: VariantAction, reference: VariantReference) => Promise<void>;
  pendingActions?: VariantAction[];
}) {
  const revision = useVariantsSource(source);
  useEffect(() => {
    if (active) refreshSource(source);
  }, [active, source]);
  // The source notifies through its revision; typing in the composer does not
  // need another selector graph walk or another layout measurement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision represents external source updates.
  const { selections, shown, sourceError } = useMemo(() => {
    const selections = source.getSelections();
    return {
      selections,
      shown: visibleAxes(source.getAxes(), selections),
      sourceError: source.getError?.(),
    };
  }, [source, revision]);
  const [menuId, setMenuId] = useState<string | null>(null);
  const menu = shown.find(axis => axis.id === menuId) ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [colourOpen, setColourOpen] = useState<string | null>(null);
  const colourPop = useRef<HTMLFieldSetElement>(null);
  const colourTrigger = useRef<HTMLButtonElement | null>(null);
  const [colourTop, setColourTop] = useState<number | null>(null);
  const closeColour = (refocus = true) => {
    setColourOpen(null);
    setColourTop(null);
    if (refocus) requestAnimationFrame(() => colourTrigger.current?.focus());
  };
  // Like the action dialog, the custom colour closes on a press anywhere else;
  // its own button toggles it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closeColour only touches state and refs.
  useEffect(() => {
    if (!colourOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (colourPop.current && !path.includes(colourPop.current) && !(colourTrigger.current && path.includes(colourTrigger.current))) closeColour(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [colourOpen]);
  // Below its button when it fits in the panel, otherwise above it, and it
  // follows the button while the selectors scroll.
  useLayoutEffect(() => {
    const pop = colourPop.current;
    const button = colourTrigger.current;
    const parent = pop?.offsetParent as HTMLElement | null;
    if (!colourOpen || !pop || !button || !parent) return;
    // A short panel grows to hold the popover, as it does for the action dialog.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
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
  const closeMenu = () => {
    setMenuOpen(false);
    setError('');
    requestAnimationFrame(() => {
      if (trigger.current?.isConnected) trigger.current.focus();
      else
        bodyRef.current?.parentElement
          ?.querySelector<HTMLButtonElement>('button')
          ?.focus();
    });
  };

  useEffect(() => {
    if (!menu) setMenuOpen(false);
  }, [menu]);

  // The panel grows only when the dialog's own content cannot fit in it, and the
  // dialog sits directly above the clicked heading when there is room.
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
      const heading = trigger.current?.isConnected ? trigger.current.getBoundingClientRect().top : 0;
      const top = heading - root.getBoundingClientRect().top - natural - 6;
      root.style.setProperty('--iso-menu-top', `${Number.isFinite(top) && top >= 6 ? top : 6}px`);
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
    closeMenu();
    onFeedback?.({
      axisId: axis.id,
      label: axis.label,
      value: value(axis),
      ...(option ? { optionId: option.id, optionLabel: option.label } : {}),
    });
  }
  const requested = (action: VariantAction) => pendingActions.some(pending =>
    pending.axisId === action.axisId && pending.action === action.action && pending.optionId === action.optionId);
  async function manage(action: VariantAction) {
    if (!menu || busy || !onManage || requested(action)) return;
    setBusy(true);
    setError('');
    try {
      const option = menuOptions.find(o => o.id === action.optionId);
      await onManage(action, {
        axisId: menu.id, label: menu.label, value: value(menu),
        ...(option ? { optionId: option.id, optionLabel: option.label } : {}),
      });

      closeMenu();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not update this selector.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="isotone-vars">
      <div className="isotone-panel-head">
        {showTitle && <h2>{source.title ?? 'Variants'}</h2>}
        <div className="isotone-head-actions">
          {source.saveDefaults && isDirty(shown, selections) && (
            <DefaultsBar source={source} changed={changedCount(shown, selections)} onSaved={onSaved} />
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
          <p className="isotone-empty">No variants on this page yet. Ask your agent to create variants of any design and they will appear here.</p>
        )}
        {shown.map((axis) => {
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
                aria-label={`${axis.label} actions`}
                aria-haspopup="dialog"
                aria-expanded={menuOpen && menu?.id === axis.id}
                onClick={(e) => {
                  trigger.current = e.currentTarget;
                  setMenuId(axis.id);
                  setError('');
                  setMenuOpen(true);
                }}
              >
                <span onPointerOver={showOverflowTitle}>{axis.label}</span>
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
              <div
                className="isotone-range-wrap"
                style={{ '--iso-default-at': String((axis.defaultValue - axis.min) / ((axis.max - axis.min) || 1)) } as CSSProperties}
              >
              <input
                type="range"
                className="isotone-range"
                aria-label={axis.label}
                aria-valuetext={formatRangeValue(axis, value(axis))}
                min={axis.min}
                max={axis.max}
                step={axis.step}
                value={Number(value(axis))}
                onChange={(e) => source.setSelection(axis.id, e.target.value)}
              />
              {Number(value(axis)) !== axis.defaultValue && <i className="isotone-range-tick" aria-hidden="true" />}
              </div>
            ) : axis.kind === 'color' ? (
              <fieldset className="isotone-swatches" aria-label={axis.label}>
                {axis.swatches.map((sw) => (
                  <button
                    key={sw.id}
                    type="button"
                    title={sw.value.toLowerCase() === axis.defaultColor.toLowerCase() ? `${sw.label} (default)` : sw.label}
                    aria-label={sw.label}
                    aria-pressed={
                      value(axis).toLowerCase() === sw.value.toLowerCase()
                    }
                    className={`isotone-swatch${sw.value.toLowerCase() === axis.defaultColor.toLowerCase() ? ' isotone-is-default' : ''}`}
                    style={{ backgroundColor: sw.value }}
                    onClick={() => source.setSelection(axis.id, sw.value)}
                  />
                ))}
                <button
                  type="button"
                  className="isotone-picker"
                  title="Custom colour"
                  aria-label={`${axis.label}: custom colour`}
                  aria-expanded={colourOpen === axis.id}
                  data-custom={!axis.swatches.some((sw) => sw.value.toLowerCase() === value(axis).toLowerCase())}
                  style={{ '--iso-custom': value(axis) } as CSSProperties}
                  onClick={(e) => {
                    colourTrigger.current = e.currentTarget;
                    if (colourOpen === axis.id) closeColour();
                    else setColourOpen(axis.id);
                  }}
                />
              </fieldset>

            ) : (
              <fieldset
                aria-label={axis.label}
                className={
                  thumbnails
                    ? 'isotone-grid'
                    : 'isotone-segs'
                }
              >
                {axis.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-label={o.label}
                    aria-pressed={value(axis) === o.id}
                    className={`${thumbnails ? 'isotone-thumb' : 'isotone-seg'}${value(axis) === o.id ? ' isotone-seg-on' : ''}${o.id === axis.defaultOption ? ' isotone-is-default' : ''}`}
                    onClick={() => source.setSelection(axis.id, o.id)}
                  >
                    {thumbnails && (
                      <img src={o.image} alt="" />
                    )}
                    <span onPointerOver={showOverflowTitle}>{o.label}</span>
                    {o.id === axis.defaultOption && <i className="isotone-default-dot" title="Default" aria-hidden="true" />}
                  </button>
                ))}
              </fieldset>
            )}

          </div>
          );
        })}
      </div>
      {(() => {
        const axis = shown.find((a) => a.id === colourOpen);
        if (axis?.kind !== 'color') return null;
        return (
          <ColorPicker
            popRef={colourPop}
            value={value(axis)}
            label={axis.label}
            onChange={(hex) => source.setSelection(axis.id, hex)}
            onClose={() => closeColour()}
            style={{ top: colourTop ?? 0, visibility: colourTop === null ? 'hidden' : undefined }}
          />
        );
      })()}
      {menu && (
        <div
          className="isotone-axis-menu"
          ref={node => { menuRef.current = node; node?.toggleAttribute('inert', !menuOpen); }}
          role="dialog"
          aria-label={`${menu.label} actions`}
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
            <strong>{menu.label}</strong>
            <button
              type="button"
              className="isotone-icon"
              aria-label="Close selector actions"
              title="Close selector actions"
              onClick={closeMenu}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="isotone-menu-scroll">
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
                {menuOptions.map((option) => (
                  <div className="isotone-option-row" key={option.id}>
                    <span>
                      {option.label}
                      {option.isDefault && <small>Default</small>}
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
                    {onManage && (() => {
                      // The default keeps its own action, so an agent need not change the source default.
                      const keep: VariantAction = option.isDefault
                        ? { axisId: menu.id, action: 'keep-default' }
                        : { axisId: menu.id, action: 'keep-option', optionId: option.id };
                      const saved = requested(keep);
                      return (
                        <button
                          type="button"
                          className="isotone-icon"
                          aria-label={`Keep only ${option.label}`}
                          disabled={busy || saved}
                          title={saved ? 'Keep request saved' : 'Keep only this, as the default'}
                          onClick={() => void manage(keep)}
                        >
                          <Icon name="check" />
                        </button>
                      );
                    })()}
                    {onManage && (
                      <button
                        type="button"
                        className="isotone-icon"
                        aria-label={`Remove ${option.label}`}
                        disabled={option.isDefault || busy || requested({ axisId: menu.id, action: 'remove-option', optionId: option.id })}
                        title={
                          option.isDefault
                            ? 'Default option'
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
                ))}
              </div>
            )}
            <button
              type="button"
              className="isotone-menu-action"
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
                {menu.kind === 'range' && <button
                  type="button"
                  className="isotone-menu-action"
                  disabled={busy || requested({ axisId: menu.id, action: 'keep-default' })}
                  onClick={() =>
                    void manage({ axisId: menu.id, action: 'keep-default' })
                  }
                >
                  <Icon name="check" />
                  {requested({ axisId: menu.id, action: 'keep-default' }) ? 'Default-only request saved' : 'Keep default only'}
                </button>}
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

/** How many visible selectors differ from their defaults. */
function changedCount(axes: VariantAxis[], selections: VariantSelections): number {
  return axes.filter((a) => selections[a.id] !== undefined && selections[a.id] !== axisDefault(a)).length;
}

/**
 * The page's changed picks and the request to make them the defaults. The
 * other alternatives stay; removing one is its own request.
 */
function DefaultsBar({
  source,
  changed,
  onSaved,
}: {
  source: VariantsSource;
  changed: number;
  onSaved?: () => void;
}) {
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
      <span className="isotone-save-count" role="status">{state || `${picks} changed`}</span>
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
