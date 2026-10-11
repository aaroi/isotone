import { showOverflowTitle } from './tooltips';
import { useEffect, useMemo, useRef, useState } from 'react';
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
    <div className="iso-iter-vars">
      <div className="iso-iter-panel-head">
        {showTitle && <h2>{source.title ?? 'Variants'}</h2>}
        <div className="iso-iter-head-actions">
          {source.saveDefaults && isDirty(shown, selections) && (
            <SaveDefaults source={source} onSaved={onSaved} />
          )}
          {onClose && (
            <button
              type="button"
              className="iso-iter-icon"
              aria-label="Close variants"
              title="Close variants"
              onClick={onClose}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      </div>
      <div className="iso-iter-vars-body" ref={node => { bodyRef.current = node; node?.toggleAttribute('inert', menuOpen); }}>
        {sourceError && <p className="iso-iter-danger" role="alert">{sourceError}</p>}
        {shown.length === 0 && (
          <p className="iso-iter-empty">No variant selectors on this page.</p>
        )}
        {shown.map((axis) => {
          const thumbnails = axis.kind !== 'range' && axis.kind !== 'color' && axis.options.length > 0 && axis.options.every(option => option.image);
          return (
          <div
            className="iso-iter-axis"
            key={axis.id}
            data-motion-key={axis.id}
          >
            <div className="iso-iter-axis-head">
              <button
                type="button"
                className="iso-iter-axis-label"
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
                <span className="iso-iter-axis-value">
                  {axis.kind === 'range'
                    ? formatRangeValue(axis, value(axis))
                    : value(axis).toUpperCase()}
                </span>
              )}
            </div>
            {axis.kind === 'range' ? (
              <input
                type="range"
                className="iso-iter-range"
                aria-label={axis.label}
                aria-valuetext={formatRangeValue(axis, value(axis))}
                min={axis.min}
                max={axis.max}
                step={axis.step}
                value={Number(value(axis))}
                onChange={(e) => source.setSelection(axis.id, e.target.value)}
              />
            ) : axis.kind === 'color' ? (
              <fieldset className="iso-iter-swatches" aria-label={axis.label}>
                {axis.swatches.map((sw) => (
                  <button
                    key={sw.id}
                    type="button"
                    title={sw.label}
                    aria-label={sw.label}
                    aria-pressed={
                      value(axis).toLowerCase() === sw.value.toLowerCase()
                    }
                    className="iso-iter-swatch"
                    style={{ backgroundColor: sw.value }}
                    onClick={() => source.setSelection(axis.id, sw.value)}
                  />
                ))}
                <label className="iso-iter-picker" title="Custom colour">
                  <input
                    type="color"
                    aria-label={`${axis.label}: custom colour`}
                    value={value(axis)}
                    onChange={(e) =>
                      source.setSelection(axis.id, e.target.value)
                    }
                  />
                </label>
              </fieldset>
            ) : (
              <fieldset
                aria-label={axis.label}
                className={
                  thumbnails
                    ? 'iso-iter-grid'
                    : 'iso-iter-segs'
                }
              >
                {axis.options.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-label={o.label}
                    aria-pressed={value(axis) === o.id}
                    className={`${thumbnails ? 'iso-iter-thumb' : 'iso-iter-seg'}${value(axis) === o.id ? ' iso-iter-seg-on' : ''}`}
                    onClick={() => source.setSelection(axis.id, o.id)}
                  >
                    {thumbnails && (
                      <img src={o.image} alt="" />
                    )}
                    <span onPointerOver={showOverflowTitle}>{o.label}</span>
                  </button>
                ))}
              </fieldset>
            )}

          </div>
          );
        })}
      </div>
      {menu && (
        <div
          className="iso-iter-axis-menu"
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
          <div className="iso-iter-menu-title">
            <strong>{menu.label}</strong>
            <button
              type="button"
              className="iso-iter-icon"
              aria-label="Close selector actions"
              title="Close selector actions"
              onClick={closeMenu}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="iso-iter-menu-scroll">
            {onFeedback && (
              <button
                type="button"
                className="iso-iter-menu-action"
                onClick={() => feedback(menu)}
              >
                <Icon name="message" />
                Feedback on this selector
              </button>
            )}
            {menu.kind !== 'range' && (
              <div className="iso-iter-menu-options">
                {menuOptions.map((option) => (
                  <div className="iso-iter-option-row" key={option.id}>
                    <span>
                      {option.label}
                      {option.isDefault && <small>Default</small>}
                    </span>
                    {onFeedback && (
                      <button
                        type="button"
                        className="iso-iter-icon"
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
                        className="iso-iter-icon"
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
              className="iso-iter-menu-action"
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
                  className="iso-iter-menu-action"
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
                  className="iso-iter-menu-action iso-iter-danger"
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
            <div className="iso-iter-menu-footer">
              <p className="iso-iter-danger" role="alert">{error}</p>
            </div>
          )}
        </div>
      )}
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
    timer.current = setTimeout(() => setState(''), 2500);
  }
  return (
    <div className="iso-iter-save-row">
      <button
        type="button"
        className="iso-iter-save"
        disabled={state === 'Saving…'}
        onClick={() => void save()}
      >
        Save as defaults
      </button>
      <span className="iso-iter-save-state" role="status">
        {state}
      </span>
    </div>
  );
}
