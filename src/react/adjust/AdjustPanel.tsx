import { type KeyboardEvent, memo, type PointerEvent, useRef, useState } from 'react';
import { Icon } from '../icons';
import { ColorPicker, normalizeHex } from '../variants/ColorPicker';
import { ADJUST_GROUPS, type AdjustField, fieldCss, fieldNumber } from './fields';
import type { Adjust, FieldState } from './useAdjust';

/** Pixels of pointer travel per step while scrubbing a label: slow enough to land on a value. */
const SCRUB_PX = 3;

/**
 * A number in a well. Type a value, step it with the arrow keys (Shift ×10,
 * Alt ×0.1), or drag its label sideways; every change shows on the page at once.
 */
function NumberField({ state, onSet, onReset }: { state: FieldState; onSet: Adjust['set']; onReset: Adjust['reset'] }) {
  const { field, value, changed } = state;
  const current = value === null ? null : fieldNumber(field, value);
  // What is being typed; null shows the value the element has.
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const scrub = useRef<{ x: number; from: number } | null>(null);
  const step = field.step ?? 1;

  const apply = (n: number) => {
    setInvalid(!onSet(field.property, fieldCss(field, n)));
  };
  const nudge = (event: KeyboardEvent<HTMLInputElement>) => {
    const direction = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0;
    if (direction) {
      event.preventDefault();
      const size = step * (event.shiftKey ? 10 : event.altKey && field.kind === 'px' ? 0.1 : 1);
      setDraft(null);
      apply((current ?? 0) + direction * size);
    } else if (event.key === 'Enter') {
      event.currentTarget.blur();
    } else if (event.key === 'Escape' && draft !== null) {
      // The field's own Escape: put back what the element has, and keep the panel open.
      event.stopPropagation();
      setDraft(null);
      setInvalid(false);
    }
  };
  const onScrubStart = (event: PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrub.current = { x: event.clientX, from: current ?? 0 };
    setDraft(null);
  };
  const onScrub = (event: PointerEvent<HTMLSpanElement>) => {
    const start = scrub.current;
    if (!start) return;
    apply(start.from + Math.round((event.clientX - start.x) / SCRUB_PX) * step * (event.shiftKey ? 10 : 1));
  };
  const endScrub = () => {
    scrub.current = null;
  };

  return (
    <div className="isotone-num" data-changed={changed || undefined} data-invalid={invalid || undefined}>
      {/* The label is the scrub handle; the input beside it carries the name for assistive technology. */}
      <span
        className="isotone-num-label"
        aria-hidden="true"
        title="Drag to change"
        onPointerDown={onScrubStart}
        onPointerMove={onScrub}
        onPointerUp={endScrub}
        onPointerCancel={endScrub}
        onLostPointerCapture={endScrub}
      >
        {field.label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={field.label}
        aria-invalid={invalid || undefined}
        value={draft ?? (current === null ? '' : String(current))}
        // Several elements that differ, or sides that do; else a value that is no number (`normal`, `auto`).
        placeholder={value === null || /\s/.test(value.trim()) ? 'Mixed' : 'Auto'}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const n = Number.parseFloat(text);
          if (Number.isFinite(n)) apply(n);
          else setInvalid(text.trim() !== '');
        }}
        onBlur={() => {
          setDraft(null);
          setInvalid(false);
        }}
        onKeyDown={nudge}
      />
      {changed && (
        <ResetButton
          field={field}
          onReset={(property) => {
            // Whatever was half typed goes with the change.
            setDraft(null);
            setInvalid(false);
            onReset(property);
          }}
        />
      )}
    </div>
  );
}

function ResetButton({ field, onReset }: { field: AdjustField; onReset: Adjust['reset'] }) {
  return (
    <button
      type="button"
      className="isotone-num-reset"
      aria-label={`Reset ${field.label}`}
      title="Reset"
      onClick={() => onReset(field.property)}
    >
      <Icon name="reset" size={11} />
    </button>
  );
}

/** A colour in a well: the swatch and its value, opening the panel's own picker beneath its group. */
function ColorField({
  state,
  open,
  onToggle,
  onReset,
}: {
  state: FieldState;
  open: boolean;
  onToggle: () => void;
  onReset: Adjust['reset'];
}) {
  const { field, value, changed } = state;
  return (
    <div className="isotone-num isotone-num-colour" data-changed={changed || undefined}>
      <button type="button" className="isotone-num-swatch" aria-label={field.label} aria-expanded={open} onClick={onToggle}>
        <span className="isotone-num-label">{field.label}</span>
        <i style={{ background: value ?? 'transparent' }} data-empty={value === null || value === 'transparent' || undefined} />
        <span className="isotone-num-value">
          {value === null ? 'Mixed' : value === 'transparent' ? 'None' : value.startsWith('#') ? value.toUpperCase() : value}
        </span>
      </button>
      {changed && <ResetButton field={field} onReset={onReset} />}
    </div>
  );
}

/**
 * The style editor: compact rows of the properties a reviewer nudges, above
 * the composer. Changes show on the page as they are made and travel with the
 * note as exact values; the page's own source stays the agent's to change.
 */
export const AdjustPanel = memo(function AdjustPanel({ adjust }: { adjust: Adjust }) {
  // The colour field whose picker is open, by property.
  const [picking, setPicking] = useState<string | null>(null);
  return (
    <section className="isotone-adjust" aria-label="Style editor">
      <header className="isotone-adjust-head">
        <strong>Adjust</strong>
        <small>Experimental</small>
        {adjust.count > 0 && (
          <button type="button" className="isotone-adjust-reset" onClick={() => adjust.reset()}>
            Reset all
          </button>
        )}
        <button
          type="button"
          className="isotone-icon isotone-adjust-close"
          aria-label="Close style editor"
          title="Close"
          onClick={adjust.close}
        >
          <Icon name="close" size={12} />
        </button>
      </header>
      {ADJUST_GROUPS.map((group) => {
        const fields = adjust.fields.filter((state) => state.field.group === group);
        if (!fields.length) return null;
        const colour = fields.find((state) => state.field.property === picking);
        return (
          <fieldset key={group} className="isotone-adjust-group" aria-label={group}>
            <span aria-hidden="true">{group}</span>
            <div className="isotone-adjust-fields">
              {fields.map((state) =>
                state.field.kind === 'color' ? (
                  <ColorField
                    key={state.field.property}
                    state={state}
                    open={picking === state.field.property}
                    onToggle={() => setPicking((was) => (was === state.field.property ? null : state.field.property))}
                    onReset={adjust.reset}
                  />
                ) : (
                  <NumberField key={state.field.property} state={state} onSet={adjust.set} onReset={adjust.reset} />
                ),
              )}
            </div>
            {colour && (
              <ColorPicker
                value={normalizeHex(colour.value ?? '') ?? '#808080'}
                label={colour.field.label}
                onChange={(hex) => adjust.set(colour.field.property, hex)}
                onClose={() => setPicking(null)}
                style={{ position: 'static', gridColumn: '1 / -1' }}
              />
            )}
          </fieldset>
        );
      })}
    </section>
  );
});
