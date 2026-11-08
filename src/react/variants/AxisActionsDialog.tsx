import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { VariantReference } from '../../core/types';
import { axisDefault, type SectionedLabel, type VariantAction, type VariantAxis, type VariantsSource } from '../../core/variants';
import { Icon } from '../icons';
import { MOTION } from '../motion';

interface AxisActionsDialogProps {
  source: VariantsSource;
  axis: VariantAxis;
  name: SectionedLabel;
  value: string;
  /** Set when the dialog was opened from one option instead of the selector label. */
  optionId: string | null;
  open: boolean;
  /** The heading or option that opened the dialog: placement and focus return go there. */
  opener: RefObject<HTMLButtonElement | null>;
  pendingActions: VariantAction[];
  onFeedback?: (reference: VariantReference) => void;
  onManage?: (action: VariantAction, reference: VariantReference) => Promise<void>;
  /** Close, returning focus to the opener unless `restoreFocus` is false. */
  onClose: (restoreFocus?: boolean) => void;
}

/**
 * Keeping one option: the default keeps its own action, so an agent need not
 * change the source default.
 */
function keepAction(axisId: string, option: { id: string; isDefault: boolean }): VariantAction {
  return option.isDefault ? { axisId, action: 'keep-default' } : { axisId, action: 'keep-option', optionId: option.id };
}

type DialogOption = { id: string; label: string; isDefault: boolean };

/** What the action forms share: whether a request is saving, and how to make or check one. */
interface ActionsProps {
  axisId: string;
  busy: boolean;
  requested: (action: VariantAction) => boolean;
  manage: (action: VariantAction) => void;
  feedback?: (optionId?: string) => void;
}

const removeOption = (axisId: string, optionId: string): VariantAction => ({ axisId, action: 'remove-option', optionId });

/** A selector's (or one option's) feedback, reset, keep and removal actions. */
export function AxisActionsDialog({
  source,
  axis,
  name,
  value,
  optionId,
  open,
  opener,
  pendingActions,
  onFeedback,
  onManage,
  onClose,
}: AxisActionsDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ optionId: string; retry: boolean } | null>(null);
  const options: DialogOption[] =
    axis.kind === 'color'
      ? axis.swatches.map((s) => ({ ...s, isDefault: s.value.toLowerCase() === axis.defaultColor.toLowerCase() }))
      : axis.kind !== 'range'
        ? axis.options.map((o) => ({ ...o, isDefault: o.id === axis.defaultOption }))
        : [];
  const scoped = optionId ? options.find((o) => o.id === optionId) : undefined;
  const close = (restoreFocus = true) => {
    pendingFocus.current = null;
    onClose(restoreFocus);
  };
  const requested = (action: VariantAction) =>
    pendingActions.some((p) => p.axisId === action.axisId && p.action === action.action && p.optionId === action.optionId);

  useRemovalFocus(menuRef, pendingFocus, busy, pendingActions, open);
  useMenuPlacement(menuRef, opener, open, [axis, options.length, error]);
  useDismiss(menuRef, open, close);

  function feedback(choice?: string) {
    const option = axis.kind === 'range' ? undefined : (axis.kind === 'color' ? axis.swatches : axis.options).find((o) => o.id === choice);
    close(false);
    onFeedback?.({
      axisId: axis.id,
      label: name.fullLabel,
      value,
      ...(option ? { optionId: option.id, optionLabel: option.label } : {}),
    });
  }
  // Removing one option from the selector's dialog keeps it open, so several can
  // be requested in a row. Everything else closes it: Keep default only, Keep only
  // this and Remove selector decide the selector, and the option-scoped dialog has
  // no list to move focus along, so it closes and returns focus to what opened it.
  async function manage(action: VariantAction) {
    if (busy || !onManage || requested(action)) return;
    const option = action.action === 'remove-option' && !scoped ? action.optionId : undefined;
    setBusy(true);
    setError('');
    try {
      const chosen = options.find((o) => o.id === action.optionId);
      await onManage(action, {
        axisId: axis.id,
        label: name.fullLabel,
        value,
        ...(chosen ? { optionId: chosen.id, optionLabel: chosen.label } : {}),
      });
      if (option !== undefined) pendingFocus.current = { optionId: option, retry: false };
      else close();
    } catch (e) {
      if (option !== undefined) pendingFocus.current = { optionId: option, retry: true };
      setError(e instanceof Error ? e.message : 'Could not update this selector.');
    } finally {
      setBusy(false);
    }
  }

  const actions: ActionsProps = {
    axisId: axis.id,
    busy,
    requested,
    manage: (action) => void manage(action),
    ...(onFeedback ? { feedback } : {}),
  };
  const canManage = Boolean(onManage);
  return (
    <div
      className="isotone-axis-menu"
      ref={(node) => {
        menuRef.current = node;
        node?.toggleAttribute('inert', !open);
      }}
      role="dialog"
      aria-label={scoped ? `${scoped.label} option actions` : `${name.fullLabel} actions`}
      aria-hidden={!open}
      data-open={open}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <div className="isotone-menu-title">
        {scoped ? (
          <span className="isotone-menu-heading">
            <strong>{scoped.label}</strong>
            <span>{name.label}</span>
          </span>
        ) : (
          <strong>{name.label}</strong>
        )}
        <button
          type="button"
          className="isotone-icon"
          aria-label="Close selector actions"
          title="Close selector actions"
          onClick={() => close()}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="isotone-menu-scroll">
        {scoped ? (
          <OptionActions {...actions} option={scoped} canManage={canManage} />
        ) : (
          <SelectorActions
            {...actions}
            options={axis.kind !== 'range' ? options : null}
            canManage={canManage}
            onReset={() => {
              source.setSelection(axis.id, axisDefault(axis));
              close();
            }}
          />
        )}
      </div>
      {error && (
        <div className="isotone-menu-footer">
          <p className="isotone-danger" role="alert">
            {error}
          </p>
        </div>
      )}
    </div>
  );
}

/** The dialog opened from one option: feedback on it, keep only it, or remove it. */
function OptionActions({
  axisId,
  busy,
  requested,
  manage,
  feedback,
  option,
  canManage,
}: ActionsProps & { option: DialogOption; canManage: boolean }) {
  const keep = keepAction(axisId, option);
  const remove = removeOption(axisId, option.id);
  return (
    <>
      {feedback && (
        <button type="button" className="isotone-menu-action" onClick={() => feedback(option.id)}>
          <Icon name="message" />
          Feedback on this option
        </button>
      )}
      {canManage && (
        <>
          <button type="button" className="isotone-menu-action" disabled={busy || requested(keep)} onClick={() => manage(keep)}>
            <Icon name="check" />
            {requested(keep) ? 'Keep request saved' : 'Keep only this'}
          </button>
          <button
            type="button"
            className="isotone-menu-action isotone-danger"
            disabled={option.isDefault || busy || requested(remove)}
            onClick={() => manage(remove)}
          >
            <Icon name="trash" />
            {requested(remove) ? 'Removal request saved' : 'Remove this option'}
          </button>
        </>
      )}
    </>
  );
}

/** The dialog opened from the selector: per-option rows, then the selector-wide actions. */
function SelectorActions({
  options,
  canManage,
  onReset,
  ...actions
}: ActionsProps & { options: DialogOption[] | null; canManage: boolean; onReset: () => void }) {
  const { axisId, busy, requested, manage, feedback } = actions;
  const keepDefault: VariantAction = { axisId, action: 'keep-default' };
  const removeAxis: VariantAction = { axisId, action: 'remove-axis' };
  return (
    <>
      {feedback && (
        <button type="button" className="isotone-menu-action" onClick={() => feedback()}>
          <Icon name="message" />
          Feedback on this selector
        </button>
      )}
      {options && (
        <div className="isotone-menu-options">
          {options.map((option) => (
            <OptionRow key={option.id} {...actions} option={option} canManage={canManage} />
          ))}
        </div>
      )}
      <button type="button" className="isotone-menu-action" data-reset="" onClick={onReset}>
        <Icon name="reset" />
        Reset to default
      </button>
      {canManage && (
        <>
          <button
            type="button"
            className="isotone-menu-action"
            disabled={busy || requested(keepDefault)}
            onClick={() => manage(keepDefault)}
          >
            <Icon name="check" />
            {requested(keepDefault) ? 'Default-only request saved' : 'Keep default only'}
          </button>
          <button
            type="button"
            className="isotone-menu-action isotone-danger"
            disabled={busy || requested(removeAxis)}
            onClick={() => manage(removeAxis)}
          >
            <Icon name="trash" />
            {requested(removeAxis) ? 'Removal request saved' : 'Remove selector & options'}
          </button>
        </>
      )}
    </>
  );
}

/** One option in the selector's dialog, with its feedback, keep and removal buttons. */
function OptionRow({
  axisId,
  busy,
  requested,
  manage,
  feedback,
  option,
  canManage,
}: ActionsProps & { option: DialogOption; canManage: boolean }) {
  const remove = removeOption(axisId, option.id);
  const pending = requested(remove);
  const keep = keepAction(axisId, option);
  const kept = requested(keep);
  return (
    <div className="isotone-option-row" data-option-id={option.id} data-requested={pending || undefined}>
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
      {feedback && (
        <button
          type="button"
          className="isotone-icon"
          aria-label={`Feedback on ${option.label}`}
          title="Give feedback"
          onClick={() => feedback(option.id)}
        >
          <Icon name="message" />
        </button>
      )}
      {canManage && (
        <button
          type="button"
          className="isotone-icon"
          aria-label={`Keep only ${option.label}`}
          disabled={busy || kept}
          title={kept ? 'Keep request saved' : 'Keep only this, as the default'}
          onClick={() => manage(keep)}
        >
          <Icon name="check" />
        </button>
      )}
      {canManage && (
        <button
          type="button"
          className="isotone-icon"
          data-remove=""
          aria-label={`Remove ${option.label}`}
          disabled={option.isDefault || busy || pending}
          title={option.isDefault ? 'Default option' : pending ? 'Removal requested' : 'Request option removal'}
          onClick={() => manage(remove)}
        >
          <Icon name="trash" />
        </button>
      )}
    </div>
  );
}

/**
 * A removal request keeps the dialog open. Its trash button is disabled while
 * the request saves and stays disabled once it is pending, so focus moves on
 * to the next option that can still be removed, then back up the list, then
 * to Reset to default. A failed request returns focus to the same button.
 */
function useRemovalFocus(
  menuRef: RefObject<HTMLDivElement | null>,
  pendingFocus: RefObject<{ optionId: string; retry: boolean } | null>,
  busy: boolean,
  pendingActions: VariantAction[],
  open: boolean,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after the request settles and the pending state has rendered.
  useEffect(() => {
    const target = pendingFocus.current;
    const dialog = menuRef.current;
    if (busy || !target || !dialog || !open) return;
    pendingFocus.current = null;
    const rows = Array.from(dialog.querySelectorAll<HTMLElement>('.isotone-option-row'));
    const at = rows.findIndex((row) => row.dataset.optionId === target.optionId);
    const removable = (row: HTMLElement | undefined) => row?.querySelector<HTMLButtonElement>('button[data-remove]:not(:disabled)') ?? null;
    const next = target.retry
      ? removable(rows[at])
      : [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0)).reverse()].map(removable).find(Boolean);
    (next ?? dialog.querySelector<HTMLButtonElement>('[data-reset]'))?.focus();
  }, [busy, pendingActions, open]);
}

/**
 * The panel grows only when the dialog's own content cannot fit in it, and the
 * dialog sits directly above the clicked heading or option when there is room.
 * `content` lists what changes the dialog's size.
 */
function useMenuPlacement(
  menuRef: RefObject<HTMLDivElement | null>,
  opener: RefObject<HTMLButtonElement | null>,
  open: boolean,
  content: unknown[],
) {
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog's content changes with the selected selector and its options.
  useLayoutEffect(() => {
    const dialog = menuRef.current;
    const root = dialog?.parentElement;
    const scroll = dialog?.querySelector<HTMLElement>('.isotone-menu-scroll');
    if (!root) return;
    clearTimeout(release.current);
    const clear = () => {
      root.style.removeProperty('--iso-menu-need');
      root.style.removeProperty('--iso-menu-top');
    };
    // A closing dialog keeps its place and the room it took until its fade has
    // finished; dropping them at once moved it to the panel's top mid-fade.
    if (!open) {
      release.current = setTimeout(clear, MOTION.exit + 20);
      return;
    }
    if (!dialog || !scroll) {
      clear();
      return;
    }
    const place = () => {
      const natural = dialog.offsetHeight + scroll.scrollHeight - scroll.clientHeight;
      root.style.setProperty('--iso-menu-need', `${natural + 12}px`);
      const from = opener.current?.isConnected ? opener.current : null;
      const anchor = (from?.closest<HTMLElement>('.isotone-opt') ?? from)?.getBoundingClientRect();
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
    };
  }, [open, ...content]);
  // Unmounting drops the dialog's place and room at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on mount and unmount.
  useEffect(() => {
    const root = menuRef.current?.parentElement;
    return () => {
      clearTimeout(release.current);
      root?.style.removeProperty('--iso-menu-need');
      root?.style.removeProperty('--iso-menu-top');
    };
  }, []);
}

/** An open dialog takes focus, and a press outside it closes it. */
function useDismiss(menuRef: RefObject<HTMLDivElement | null>, open: boolean, close: () => void) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: close only reaches refs and the parent's stable close.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onPointerDown = (e: PointerEvent) => {
      const dialog = menuRef.current;
      if (dialog && !e.composedPath().includes(dialog)) close();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);
}
