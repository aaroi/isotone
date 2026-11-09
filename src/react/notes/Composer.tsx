import { memo, type RefObject, useLayoutEffect, useSyncExternalStore } from 'react';
import { HINTS } from './hints';
import { Icon } from '../icons';
import { fadeIn } from '../motion';
import { showOverflowTitle } from '../tooltips';
import { useDictation } from './useDictation';
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
  /** The dictation experiment is on. */
  dictation?: boolean;
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
  draft: { text: draft, editing, answering, variantTarget, targets, notice },
  fieldRef,
  active,
  picking,
  pickingWithPanel,
  floating,
  touch,
  shortcutLabel,
  dictation = false,
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
  // Only while the panel is open: a closed composer never holds the microphone.
  const voice = useDictation(draft, dictation && active);
  const stopVoice = voice.stop;
  const said = voice.problem || notice;
  const changes = adjust?.count ?? 0;
  const hasContext = Boolean(editing || answering || variantTarget || targets.length || said || changes);
  // A sent note takes the microphone with it; clearing the field by hand does not.
  const send = () => {
    stopVoice();
    onSend();
  };
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
  const hints = touch ? 'touch' : 'pointer';
  // "Not quite" on a closed note edits it, and sending reopens it.
  const reopening = editing?.done === true;
  const action = answering ? 'Send answer' : reopening ? 'Reopen note' : editing ? 'Save edit' : 'Send note';
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
      {/* The agent's question, in full, while the reviewer answers it or edits the note to. */}
      {(answering ?? editing)?.reply?.text && !(answering ?? editing)?.reply?.answered && (
        <p className="isotone-editing-reply">
          <span>Agent asks</span> {(answering ?? editing)?.reply?.text}
        </p>
      )}
      {/* What the agent said it changed, in full, while the reviewer says what is still off. */}
      {reopening && editing.resolution?.summary && (
        <p className="isotone-editing-reply">
          <span>Agent</span> {editing.resolution.summary}
        </p>
      )}
      <div className="isotone-context" aria-live="polite">
        {(editing || answering) && (
          <span className="isotone-chip">
            {answering ? 'Answering agent' : reopening ? 'Reopening note' : 'Editing note'}
            <button
              type="button"
              aria-label={answering ? 'Cancel answer' : 'Cancel edit'}
              title={answering ? 'Cancel answer' : 'Cancel edit'}
              onClick={onCancelEdit}
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
          <span key={target.selector} className="isotone-chip">
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
        {said && <p className="isotone-notice">{said}</p>}
      </div>
      <div className="isotone-entry">
        <textarea
          ref={fieldRef}
          value={text}
          aria-label={answering ? 'Your answer to the agent' : 'Feedback for the agent'}
          onChange={(e) => draft.set(e.target.value)}
          onFocus={onFieldFocus}
          onPointerDown={onFieldPointerDown}
          onScroll={(event) => {
            event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={
            voice.listening
              ? 'Listening…'
              : answering
                ? 'Your answer…'
                : reopening
                  ? 'What is still off?'
                  : changes
                    ? 'Add a note, or just send…'
                    : targets.length || variantTarget
                      ? 'Feedback on your selection…'
                      : 'What would you change?'
          }
          rows={1}
          className="isotone-textarea"
        />
        <div className="isotone-toolbar">
          {/* An answer goes without pins or style changes, so neither is offered while writing one. */}
          {!answering && (
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
          )}
          {adjust && !answering && (
            <button
              type="button"
              title="Adjust styles · experimental"
              aria-label="Adjust styles"
              aria-pressed={adjust.open}
              className="isotone-pick isotone-mic isotone-adjust-toggle isotone-icon"
              onMouseDown={(e) => e.preventDefault()}
              onClick={adjust.onToggle}
            >
              <Icon name="adjust" size={14} />
            </button>
          )}
          {/* Beside a pin the hint needs the room, unless the microphone is on and needs its off switch. */}
          {voice.supported && (voice.listening || !(floating && picking)) && (
            <button
              type="button"
              title={voice.listening ? 'Stop dictating' : 'Dictate · experimental'}
              aria-label="Dictate"
              aria-pressed={voice.listening}
              className="isotone-pick isotone-mic isotone-icon"
              onMouseDown={(e) => e.preventDefault()}
              onClick={voice.toggle}
            >
              <Icon name="mic" size={14} />
            </button>
          )}
          {floating && picking && (
            <span ref={fadeIn} className="isotone-float-hint">
              {HINTS.floating[hints]}
            </span>
          )}
          <button
            type="button"
            aria-label={action}
            // Style changes go with a note, never with an answer.
            disabled={!text.trim() && (!changes || Boolean(answering))}
            className="isotone-send"
            title={`${action} (Enter)`}
            onClick={send}
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
