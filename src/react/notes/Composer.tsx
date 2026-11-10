import { memo, type RefObject, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { HINTS } from './hints';
import { Icon } from '../icons';
import { fadeIn, settleIn } from '../motion';
import { showOverflowTitle } from '../tooltips';
import type { ComposerDraft } from './useNoteActions';

interface ComposerProps {
  /** The text, what it refers to, and the note being edited. */
  draft: ComposerDraft;
  fieldRef: RefObject<HTMLTextAreaElement | null>;
  /** Whether the feedback panel is open; a closed one does not measure its field. */
  active: boolean;
  picking: boolean;
  /** Selecting started together with the panel: the cover shows at once. */
  pickingWithPanel: boolean;
  floating: boolean;
  touch: boolean;
  shortcutLabel: string;
  /** The style editor, when its experiment is on and something is pinned. */
  adjust?: { open: boolean; count: number; onToggle: () => void; onReset: () => void };
  onSend: () => void;
  onCancelEdit: () => void;
  onClearVariant: () => void;
  onUnpin: (selector: string) => void;
  onFieldFocus: () => void;
  onFieldPointerDown: () => void;
  onTogglePicking: () => void;
  onDonePicking: () => void;
}

/** One composer, in the dock or floating beside the element being written about. */
export const Composer = memo(function Composer({
  draft: { text: draft, editing, variantTarget, targets, notice },
  fieldRef,
  active,
  picking,
  pickingWithPanel,
  floating,
  touch,
  shortcutLabel,
  adjust,
  onSend,
  onCancelEdit,
  onClearVariant,
  onUnpin,
  onFieldFocus,
  onFieldPointerDown,
  onTogglePicking,
  onDonePicking,
}: ComposerProps) {
  const text = useSyncExternalStore(draft.subscribe, draft.get, draft.get);
  const changes = adjust?.count ?? 0;
  const hasContext = Boolean(editing || variantTarget || targets.length || notice || changes);
  // Context changes the scroll-through inset; measure again when that changes
  // or a route restores the composer after its DOM was removed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasContext changes the CSS inset used by scrollHeight.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field || !active) return;
    // An empty field needs no layout read, so opening the panel does not force one.
    const resize = () => {
      if (!field.value) {
        field.style.height = '22px';
        field.dataset.scrolled = 'false';
        return;
      }
      field.style.height = '0px';
      field.style.height = `${Math.max(22, field.scrollHeight)}px`;
      field.dataset.scrolled = String(field.scrollTop > 0);
    };
    resize();
    if (typeof ResizeObserver === 'undefined') return;
    let width: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width;
      if (width !== undefined && next !== width) resize();
      width = next;
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [text, active, hasContext, fieldRef]);
  const chips = useRef<HTMLDivElement>(null);
  const references = [editing ? 'editing' : '', variantTarget ? 'variant' : '', ...targets.map((t) => `pin:${t.selector}`)]
    .filter(Boolean)
    .join('\n');
  // A reference added while the composer shows settles in; those it mounts with (a restored draft, an
  // opening panel, a move between the dock and the floating composer) are simply there.
  const settled = useRef<{ references: Set<string>; active: boolean } | null>(null);
  useLayoutEffect(() => {
    const keys = new Set(references.split('\n'));
    const before = settled.current;
    settled.current = { references: keys, active };
    if (!before?.active || !active || !chips.current) return;
    for (const chip of chips.current.querySelectorAll<HTMLElement>(':scope > [data-reference]'))
      if (!before.references.has(chip.dataset.reference ?? '')) settleIn(chip, 0.96);
  }, [references, active]);
  const hints = touch ? 'touch' : 'pointer';
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: This extends the native textarea's pointer area; keyboard users focus the textarea directly.
    <fieldset
      className="isotone-input"
      aria-label="Feedback composer"
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0) return;
        const target = event.target as Element;
        if (target.closest('button, textarea, input, select, a, [contenteditable="true"]')) return;
        fieldRef.current?.focus({ preventScroll: true });
      }}
    >
      {/* The agent's question, in full, while the reviewer edits the note to answer it. */}
      {editing?.reply?.text && !editing.reply.answered && (
        <p className="isotone-editing-reply">
          <span>Agent asks</span> {editing.reply.text}
        </p>
      )}
      <div ref={chips} className="isotone-context" aria-live="polite">
        {editing && (
          <span className="isotone-chip" data-reference="editing">
            Editing note
            <button type="button" aria-label="Cancel edit" title="Cancel edit" onClick={onCancelEdit}>
              <Icon name="close" size={12} />
            </button>
          </span>
        )}
        {variantTarget && (
          <span className="isotone-chip" data-reference="variant">
            <Icon name="sliders" size={12} />
            <span onPointerOver={showOverflowTitle}>
              {variantTarget.label}
              {variantTarget.optionLabel ? ` / ${variantTarget.optionLabel}` : ''}
            </span>
            {!editing?.variantAction && (
              <button type="button" aria-label="Remove variant reference" title="Remove reference" onClick={onClearVariant}>
                <Icon name="close" size={12} />
              </button>
            )}
          </span>
        )}
        {targets.map((target, index) => (
          <span key={target.selector} className="isotone-chip" data-reference={`pin:${target.selector}`}>
            <span onPointerOver={showOverflowTitle}>{target.text || target.tag}</span>
            <button
              type="button"
              aria-label={`Remove pinned element ${index + 1}`}
              title="Unpin element"
              onClick={() => onUnpin(target.selector)}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
        {changes > 0 && (
          <span className="isotone-chip">
            <Icon name="adjust" size={12} />
            <span>
              {changes} style change{changes === 1 ? '' : 's'}
            </span>
            <button type="button" aria-label="Remove style changes" title="Remove style changes" onClick={() => adjust?.onReset()}>
              <Icon name="close" size={12} />
            </button>
          </span>
        )}
        {/* The context strip is already a polite live region; a nested status would announce twice. */}
        {notice && <p className="isotone-notice">{notice}</p>}
      </div>
      <div className="isotone-entry">
        <textarea
          ref={fieldRef}
          value={text}
          aria-label="Feedback for the agent"
          onChange={(e) => draft.set(e.target.value)}
          onFocus={onFieldFocus}
          onPointerDown={onFieldPointerDown}
          onScroll={(event) => {
            event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            changes
              ? 'Add a note, or just send…'
              : targets.length || variantTarget
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
            onClick={onTogglePicking}
          >
            <Icon name="pin" size={14} />
          </button>
          {adjust && (
            <button
              type="button"
              title="Adjust styles · experimental"
              aria-label="Adjust styles"
              aria-pressed={adjust.open}
              className="isotone-pick isotone-adjust-toggle isotone-icon"
              onMouseDown={(e) => e.preventDefault()}
              onClick={adjust.onToggle}
            >
              <Icon name="adjust" size={14} />
            </button>
          )}
          {floating && picking && (
            <span ref={fadeIn} className="isotone-float-hint">
              {HINTS.floating[hints]}
            </span>
          )}
          <button
            type="button"
            aria-label={editing ? 'Save edit' : 'Send note'}
            disabled={!text.trim() && !changes}
            className="isotone-send"
            title={editing ? 'Save edit (Enter)' : 'Send note (Enter)'}
            onClick={onSend}
          >
            <Icon name="send" size={14} />
          </button>
        </div>
        {picking && !floating && (
          <div ref={fadeIn} className="isotone-picking" data-still={pickingWithPanel}>
            <Icon name="pin" size={14} />
            <p>
              <span>{targets.length ? `${targets.length} selected` : HINTS.picking[hints].title}</span>
              {/* Touch has no Shift: Done leaves select mode with the pins kept, and the crosshair resumes it. */}
              <small>{HINTS.picking[hints].pause}</small>
            </p>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onDonePicking}>
              Done{!touch && <kbd>↵</kbd>}
            </button>
          </div>
        )}
      </div>
    </fieldset>
  );
});
