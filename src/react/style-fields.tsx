/**
 * Inspector fields for the experimental style editor. Every field is a
 * recessed well (the Instrument field material); a changed value lights its
 * label and offers a reset. Number fields scrub: drag the label (or a bare
 * box-model cell) sideways, or use the arrow keys, with Shift for ten steps
 * and Alt for a tenth. An empty commit resets the property.
 */
import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { formatNumber, normalizeInput, nudgeValue, parseRgb, type StyleProperty } from '../core/style';
import { toHexColor } from '../core/style-source';
import { Icon, type IconName } from './icons';

export interface FieldProps {
  property: StyleProperty;
  /** The shared value; null when the selection is mixed. */
  value: string | null;
  changed: boolean;
  invalid?: boolean;
  /** Accessible name, e.g. "Padding top". */
  name: string;
  /** Short visible label. */
  label?: ReactNode;
  /** Set on every element in scope. `gesture` coalesces one drag or key run into one undo step. */
  /** False when the browser rejects the value; the field then keeps the text to fix. */
  onSet(value: string, gesture?: string): boolean | undefined;
  onReset(): void;
}

export interface NumberFieldProps extends FieldProps {
  /** Add `delta` to each element's own value; used while the field is Mixed. */
  onNudge(delta: number, gesture?: string): void;
  /** A box-model cell: no label or reset, the input itself scrubs. */
  bare?: boolean;
}

/** Multiplier for keyboard and scrub steps. */
function modifier(event: { shiftKey: boolean; altKey: boolean }): number {
  return event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
}

/** Strip `px` where a bare number can only mean pixels. */
function display(value: string, property: StyleProperty): string {
  if (property.kind !== 'length' || !/^-?[\d.]+px$/.test(value)) return value;
  // Layout often lands on fractions; a tenth of a pixel is precise enough to read and edit.
  const n = formatNumber(Math.round(Number.parseFloat(value) * 10) / 10);
  return property.unitless ? `${n}px` : n;
}

/**
 * Horizontal scrubbing on a handle. Two pixels per step. A press without
 * movement is a click, which focuses the input.
 */
function scrubber(
  property: StyleProperty,
  apply: (delta: number, gesture: string) => void,
  click: () => void,
) {
  return (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    // Already editing this input: leave text selection to the browser. Inside
    // a shadow root the document's active element is the host, so ask the root.
    const root = handle.getRootNode() as Document | ShadowRoot;
    if (root.activeElement === handle) return;
    event.preventDefault();
    const start = event.clientX;
    const gesture = `scrub:${property.name}:${event.timeStamp}`;
    let moved = false;
    let applied = 0;
    const step = property.step ?? 1;
    try { handle.setPointerCapture(event.pointerId); } catch {}
    const move = (e: PointerEvent) => {
      const dx = e.clientX - start;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) handle.dataset.scrubbing = 'true';
      moved = true;
      const steps = Math.trunc(dx / 2);
      if (steps === applied) return;
      apply((steps - applied) * step * modifier(e), gesture);
      applied = steps;
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      delete handle.dataset.scrubbing;
      if (!moved) click();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
}

/** A draft that exists only while the input has focus. */
function useDraft(value: string | null, format: (v: string) => string, invalid?: boolean) {
  const [draft, setDraft] = useState<string | null>(null);
  // Once the field is valid again (a later edit, a reset, undo), drop the rejected text.
  useEffect(() => { if (!invalid) setDraft((current) => (current !== null && current.trim() === '' ? current : null)); }, [invalid]);
  return {
    draft,
    shown: draft ?? (value === null ? '' : format(value)),
    // A rejected value stays as typed until it is fixed or reset.
    begin: () => setDraft((current) => current ?? (value === null ? '' : format(value))),
    set: setDraft,
    clear: () => setDraft(null),
    dirty: draft !== null && draft !== (value === null ? '' : format(value)),
  };
}

function ResetButton({ name, onReset }: { name: string; onReset(): void }) {
  return (
    <button type="button" className="isotone-field-reset" aria-label={`Reset ${name}`} onClick={onReset}>
      <Icon name="reset" size={11} />
    </button>
  );
}

export function NumberField({ property, value, changed, invalid, name, label, onSet, onNudge, onReset, bare }: NumberFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const format = (v: string) => display(v, property);
  const draft = useDraft(value, format, invalid);
  const commit = () => {
    if (draft.draft === null) return;
    const next = draft.draft.trim();
    if (!draft.dirty) { draft.clear(); return; }
    if (!next) { draft.clear(); onReset(); return; }
    if (onSet(normalizeInput(next, property)) !== false) draft.clear();
  };
  const nudge = (delta: number, gesture: string) => {
    if (value === null && !draft.dirty) {
      onNudge(delta, gesture);
      return;
    }
    const base = draft.draft?.trim() ? normalizeInput(draft.draft, property) : (value ?? '');
    const next = nudgeValue(base, delta, property);
    if (next === null) return;
    if (draft.draft !== null) draft.set(format(next));
    onSet(next, gesture);
  };
  const focusInput = () => {
    input.current?.focus();
    input.current?.select();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      nudge((event.key === 'ArrowUp' ? 1 : -1) * (property.step ?? 1) * modifier(event), `keys:${property.name}`);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      requestAnimationFrame(() => input.current?.select());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (draft.dirty) draft.set(value === null ? '' : format(value));
      else input.current?.blur();
    }
  };
  const scrub = scrubber(property, (delta, gesture) => nudge(delta, gesture), focusInput);
  const field = (
    <input
      ref={input}
      className="isotone-field-input"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      aria-label={value === null ? `${name}, mixed` : name}
      placeholder={value === null ? (bare ? '–' : 'Mixed') : undefined}
      value={draft.shown}
      data-dirty={draft.dirty || undefined}
      onFocus={() => { draft.begin(); }}
      onBlur={commit}
      onChange={(event) => draft.set(event.target.value)}
      onKeyDown={onKeyDown}
      onPointerDown={bare ? scrub : undefined}
    />
  );
  if (bare) {
    return <span className="isotone-box-cell" data-changed={changed || undefined} data-invalid={invalid || undefined}>{field}</span>;
  }
  return (
    <div className="isotone-field" data-changed={changed || undefined} data-invalid={invalid || undefined}>
      <span className="isotone-field-label isotone-scrub" aria-hidden="true" onPointerDown={scrub}>{label}</span>
      {field}
      {changed && <ResetButton name={name} onReset={onReset} />}
    </div>
  );
}

export function TextField({ property, value, changed, invalid, name, label, onSet, onReset }: FieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const draft = useDraft(value, (v) => v, invalid);
  const commit = () => {
    if (draft.draft === null) return;
    const next = draft.draft.trim();
    if (!draft.dirty) { draft.clear(); return; }
    if (!next) { draft.clear(); onReset(); return; }
    if (onSet(normalizeInput(next, property)) !== false) draft.clear();
  };
  return (
    <div className="isotone-field" data-changed={changed || undefined} data-invalid={invalid || undefined}>
      <span className="isotone-field-label" aria-hidden="true">{label}</span>
      <input
        ref={input}
        className="isotone-field-input"
        spellCheck={false}
        autoComplete="off"
        aria-label={value === null ? `${name}, mixed` : name}
        placeholder={value === null ? 'Mixed' : undefined}
        value={draft.shown}
        data-dirty={draft.dirty || undefined}
        onFocus={draft.begin}
        onBlur={commit}
        onChange={(event) => draft.set(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          else if (event.key === 'Escape') {
            event.preventDefault();
            if (draft.dirty) draft.set(value ?? '');
            else input.current?.blur();
          }
        }}
      />
      {changed && <ResetButton name={name} onReset={onReset} />}
    </div>
  );
}

/** Keep a colour's existing alpha when the native picker (which has none) sets its hue. */
function withAlpha(hex: string, previous: string | null): string {
  const alpha = previous ? parseRgb(previous)?.[3] : undefined;
  if (alpha === undefined || alpha >= 1 || alpha <= 0) return hex;
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0')}`;
}

export function ColorField({ property, value, changed, invalid, name, label, onSet, onReset }: FieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const draft = useDraft(value, (v) => v, invalid);
  const hex = (value && toHexColor(value)) || '#000000';
  const commit = () => {
    if (draft.draft === null) return;
    const next = draft.draft.trim();
    if (!draft.dirty) { draft.clear(); return; }
    if (!next) { draft.clear(); onReset(); return; }
    if (onSet(next) !== false) draft.clear();
  };
  return (
    <div className="isotone-field isotone-color-field" data-changed={changed || undefined} data-invalid={invalid || undefined}>
      <span className="isotone-field-label" aria-hidden="true">{label}</span>
      <label className="isotone-color-swatch" data-mixed={value === null || undefined} style={{ ['--iso-swatch-value' as string]: value ?? 'transparent' }}>
        <input
          type="color"
          value={hex}
          aria-label={`${name} picker`}
          onChange={(event) => onSet(withAlpha(event.target.value, value), `color:${property.name}`)}
        />
      </label>
      <input
        ref={input}
        className="isotone-field-input"
        spellCheck={false}
        autoComplete="off"
        aria-label={value === null ? `${name}, mixed` : name}
        placeholder={value === null ? 'Mixed' : undefined}
        value={draft.shown}
        data-dirty={draft.dirty || undefined}
        onFocus={draft.begin}
        onBlur={commit}
        onChange={(event) => draft.set(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); commit(); }
          else if (event.key === 'Escape') {
            event.preventDefault();
            if (draft.dirty) draft.set(value ?? '');
            else input.current?.blur();
          }
        }}
      />
      {changed && <ResetButton name={name} onReset={onReset} />}
    </div>
  );
}

const WEIGHT_NAMES: Record<string, string> = {
  100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium',
  600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black',
};

export function SelectField({ property, value, changed, name, label, onSet, onReset }: FieldProps) {
  const options = [...(property.options ?? [])];
  if (value !== null && value && !options.includes(value)) options.unshift(value);
  return (
    <label className="isotone-field isotone-select-field" data-changed={changed || undefined}>
      <span className="isotone-field-label">{label}</span>
      <select
        className="isotone-field-input"
        aria-label={value === null ? `${name}, mixed` : name}
        value={value ?? ''}
        onChange={(event) => onSet(event.target.value)}
      >
        {value === null && <option value="" disabled>Mixed</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {property.name === 'font-weight' && WEIGHT_NAMES[option] ? `${option} ${WEIGHT_NAMES[option]}` : option}
          </option>
        ))}
      </select>
      <span className="isotone-select-chevron" aria-hidden="true"><Icon name="chevron" size={12} /></span>
      {changed && <ResetButton name={name} onReset={onReset} />}
    </label>
  );
}

export interface SegmentOption {
  value: string;
  label: string;
  icon: IconName;
  /** Computed values that also select this option, e.g. `start` for left. */
  aliases?: string[];
}

export function SegmentField({ value, changed, name, options, onSet, onReset }: FieldProps & { options: SegmentOption[] }) {
  return (
    <div className="isotone-field-row">
      <fieldset className="isotone-segs isotone-style-segs" aria-label={value === null ? `${name}, mixed` : name}>
        {options.map((option) => {
          const pressed = value !== null && (value === option.value || Boolean(option.aliases?.includes(value)));
          return (
            <button
              key={option.value}
              type="button"
              className="isotone-seg"
              aria-pressed={pressed}
              aria-label={option.label}
              title={option.label}
              onClick={() => onSet(option.value)}
            >
              <Icon name={option.icon} size={14} />
            </button>
          );
        })}
      </fieldset>
      {changed && <ResetButton name={name} onReset={onReset} />}
    </div>
  );
}
