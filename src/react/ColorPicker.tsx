import { type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref, useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/* ── Colour maths ─────────────────────────────────────────────────────── */

export interface Hsv { h: number; s: number; v: number }

/** `#rgb` or `#rrggbb` to lower-case `#rrggbb`, or null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${raw.split('').map((c) => c + c).join('')}`;
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  return null;
}

export function hexToHsv(hex: string): Hsv {
  const full = normalizeHex(hex) ?? '#000000';
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/* ── Picker ───────────────────────────────────────────────────────────── */

interface EyeDropperLike { open(): Promise<{ sRGBHex: string }> }

/**
 * The custom colour control, drawn in the panel's own materials instead of
 * the browser's native popup. It floats like the selector action dialog:
 * a saturation and brightness field, a hue track and a hex field. Changes
 * apply as they happen, like picking a swatch.
 */
export function ColorPicker({
  value,
  label,
  onChange,
  onClose,
  popRef,
  style,
}: {
  value: string;
  label: string;
  onChange: (hex: string) => void;
  onClose: () => void;
  popRef?: Ref<HTMLFieldSetElement>;
  style?: CSSProperties;
}) {
  // Hue and saturation survive greys and black, where the hex alone loses them.
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [draft, setDraft] = useState(value.toUpperCase());
  const last = useRef(normalizeHex(value));
  const field = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = normalizeHex(value);
    if (next && next !== last.current) {
      last.current = next;
      setHsv(hexToHsv(next));
      setDraft(next.toUpperCase());
    }
  }, [value]);

  useEffect(() => { handle.current?.focus({ preventScroll: true }); }, []);

  const apply = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    last.current = hex;
    setDraft(hex.toUpperCase());
    onChange(hex);
  };

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = field.current?.getBoundingClientRect();
    if (!box?.width || !box.height) return;
    apply({ h: hsv.h, s: clamp((e.clientX - box.left) / box.width), v: clamp(1 - (e.clientY - box.top) / box.height) });
  };

  const onFieldKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step],
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    apply({ h: hsv.h, s: clamp(hsv.s + move[0]), v: clamp(hsv.v + move[1]) });
  };

  const commitDraft = () => {
    const hex = normalizeHex(draft);
    if (!hex) { setDraft((last.current ?? value).toUpperCase()); return; }
    if (hex !== last.current) apply(hexToHsv(hex));
    else setDraft(hex.toUpperCase());
  };

  const dropper = typeof window !== 'undefined'
    ? (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper
    : undefined;

  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const percent = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <fieldset
      ref={popRef}
      className="isotone-colour"
      style={style}
      aria-label={`${label}: custom colour`}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        ref={field}
        className="isotone-colour-field"
        style={{ backgroundColor: hue }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          handle.current?.focus({ preventScroll: true });
          fromPointer(e);
        }}
        onPointerMove={(e) => { if (e.buttons & 1) fromPointer(e); }}
      >
        <div
          ref={handle}
          className="isotone-colour-handle"
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuetext={`Saturation ${percent(hsv.s)}, brightness ${percent(hsv.v)}`}
          style={{ left: percent(hsv.s), top: percent(1 - hsv.v), backgroundColor: hsvToHex(hsv) }}
          onKeyDown={onFieldKey}
        />
      </div>
      <input
        type="range"
        className="isotone-hue"
        aria-label="Hue"
        min={0}
        max={359}
        step={1}
        value={Math.round(hsv.h)}
        onChange={(e) => apply({ ...hsv, h: Number(e.target.value) })}
      />
      <div className="isotone-colour-row">
        <span className="isotone-colour-hash" aria-hidden="true">#</span>
        <input
          type="text"
          className="isotone-colour-hex"
          aria-label="Hex colour"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          value={draft.replace(/^#/, '')}
          onChange={(e) => setDraft(`#${e.target.value.replace(/^#/, '')}`)}
          onBlur={commitDraft}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } }}
        />
        {dropper && (
          <button
            type="button"
            className="isotone-icon"
            aria-label="Pick a colour from the page"
            title="Pick from the page"
            onClick={() => {
              void new dropper().open().then((r) => {
                const hex = normalizeHex(r.sRGBHex);
                if (hex) apply(hexToHsv(hex));
              }).catch(() => {});
            }}
          >
            <Icon name="pipette" />
          </button>
        )}
      </div>
    </fieldset>
  );
}
