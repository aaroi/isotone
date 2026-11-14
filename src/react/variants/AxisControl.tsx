import { type CSSProperties, type KeyboardEvent, memo, type ReactNode } from 'react';
import { formatRangeValue, type VariantAxis, type VariantsSource } from '../../core/variants';
import { Icon } from '../icons';
import { GRID_COLUMNS } from '../styles/panel';
import { showOverflowTitle } from '../tooltips';
import { useKeyFade } from './keyFade';
import { useSegmentLayout } from './segmentLayout';
import { RollingText } from '../RollingText';

export type OpenMenu = (axis: VariantAxis, opener: HTMLButtonElement | null, optionId?: string | null) => void;

interface AxisControlProps {
  source: VariantsSource;
  /** One of the first screenful, laid out at its real height from the first frame. */
  eager?: boolean;
  axis: VariantAxis;
  /** The selector's own name, without its section. */
  label: string;
  /** The name with its section, for accessible names and notes. */
  fullLabel: string;
  value: string;
  /** Whose action dialog is open on this selector: `null` for the heading, an option id, or undefined for none. */
  menuFor: string | null | undefined;
  colourOpen: boolean;
  onOpenMenu: OpenMenu;
  onColour: (axis: VariantAxis, trigger: HTMLButtonElement) => void;
}

/**
 * One selector: its heading, which opens the selector's action dialog, and its
 * control. Single choices are a radio group with one tab stop; arrow keys move
 * and select, and Shift+F10 or the context-menu key opens an option's actions.
 * Memoized, so typing elsewhere or changing another selector does not re-render it.
 */
export const AxisControl = memo(function AxisControl({
  source,
  eager = false,
  axis,
  label,
  fullLabel,
  value,
  menuFor,
  colourOpen,
  onOpenMenu,
  onColour,
}: AxisControlProps) {
  const thumbnails = axis.kind !== 'range' && axis.kind !== 'color' && axis.options.length > 0 && axis.options.every((o) => o.image);
  const segments = useSegmentLayout<HTMLDivElement>(
    axis.kind === 'range' || axis.kind === 'color' || thumbnails ? '' : axis.options.map((o) => o.label).join('\n'),
  );
  const leave = useKeyFade(segments, value, axis.kind === 'range' || axis.kind === 'color' ? 0 : axis.options.length);
  const optionFrame = (id: string, optionLabel: string, className: string, child: ReactNode) => (
    <OptionFrame key={id} className={className} label={optionLabel} open={menuFor === id} onOpen={(opener) => onOpenMenu(axis, opener, id)}>
      {child}
    </OptionFrame>
  );
  return (
    <div className="isotone-axis" data-motion-key={axis.id} data-eager={eager || undefined}>
      <div className="isotone-axis-head">
        <button
          type="button"
          className="isotone-axis-label"
          aria-label={`${fullLabel} actions`}
          aria-haspopup="dialog"
          aria-expanded={menuFor === null}
          onClick={(e) => onOpenMenu(axis, e.currentTarget)}
        >
          <span onPointerOver={showOverflowTitle}>{label}</span>
          <Icon name="chevron" size={12} />
        </button>
        {(axis.kind === 'range' || axis.kind === 'color') && (
          <RollingText className="isotone-axis-value" text={axis.kind === 'range' ? formatRangeValue(axis, value) : value.toUpperCase()} />
        )}
      </div>
      {axis.kind === 'range' ? (
        <div
          className="isotone-range-wrap"
          style={{ '--iso-default-at': String((axis.defaultValue - axis.min) / (axis.max - axis.min || 1)) } as CSSProperties}
        >
          <input
            type="range"
            className="isotone-range"
            aria-label={fullLabel}
            aria-valuetext={formatRangeValue(axis, value)}
            min={axis.min}
            max={axis.max}
            step={axis.step}
            value={Number(value)}
            onChange={(e) => source.setSelection(axis.id, e.target.value)}
          />
          {Number(value) !== axis.defaultValue && <i className="isotone-range-tick" aria-hidden="true" />}
        </div>
      ) : axis.kind === 'color' ? (
        <div className="isotone-swatches" role="radiogroup" aria-label={fullLabel} onKeyDown={moveChoice}>
          {axis.swatches.map((sw, index) => {
            const checked = value.toLowerCase() === sw.value.toLowerCase();
            const isDefault = sw.value.toLowerCase() === axis.defaultColor.toLowerCase();
            const tabbable = checked || (index === 0 && !axis.swatches.some((s) => s.value.toLowerCase() === value.toLowerCase()));
            return optionFrame(
              sw.id,
              sw.label,
              'isotone-opt-swatch',
              // biome-ignore lint/a11y/useSemanticElements: an option face holds a thumbnail, its label and the default dot.
              <button
                type="button"
                role="radio"
                title={isDefault ? `${sw.label} (default)` : sw.label}
                aria-label={sw.label}
                aria-checked={checked}
                aria-keyshortcuts="Shift+F10"
                tabIndex={tabbable ? 0 : -1}
                className={`isotone-swatch${isDefault ? ' isotone-is-default' : ''}`}
                style={{ backgroundColor: sw.value }}
                onClick={() => source.setSelection(axis.id, sw.value)}
              />,
            );
          })}
          <button
            type="button"
            className="isotone-picker"
            title="Custom colour"
            aria-label={`${fullLabel}: custom colour`}
            aria-expanded={colourOpen}
            data-custom={!axis.swatches.some((sw) => sw.value.toLowerCase() === value.toLowerCase())}
            style={{ '--iso-custom': value } as CSSProperties}
            onClick={(e) => onColour(axis, e.currentTarget)}
          />
        </div>
      ) : (
        <div
          ref={segments}
          role="radiogroup"
          aria-label={fullLabel}
          className={thumbnails ? 'isotone-grid' : 'isotone-segs'}
          onKeyDown={moveChoice}
        >
          {axis.options.map((o, index) => {
            const checked = value === o.id;
            const tabbable = checked || (index === 0 && !axis.options.some((x) => x.id === value));
            return optionFrame(
              o.id,
              o.label,
              thumbnails ? 'isotone-opt-thumb' : 'isotone-opt-seg',
              // biome-ignore lint/a11y/useSemanticElements: an option face holds a thumbnail, its label and the default dot.
              <button
                type="button"
                role="radio"
                aria-label={o.label}
                aria-checked={checked}
                aria-keyshortcuts="Shift+F10"
                tabIndex={tabbable ? 0 : -1}
                className={`${thumbnails ? 'isotone-thumb' : 'isotone-seg'}${checked ? ' isotone-seg-on' : ''}${o.id === axis.defaultOption ? ' isotone-is-default' : ''}`}
                onClick={(e) => {
                  leave(e, o.id);
                  source.setSelection(axis.id, o.id);
                }}
              >
                {thumbnails && <img src={o.image} alt="" />}
                <span onPointerOver={showOverflowTitle}>{o.label}</span>
                {o.id === axis.defaultOption && <i className="isotone-default-dot" title="Default" aria-hidden="true" />}
              </button>,
            );
          })}
        </div>
      )}
    </div>
  );
});

/**
 * Arrow keys, Home and End move between a group's radios and select the one
 * reached. Left and Right go along the group and wrap; in a thumbnail grid Up
 * and Down go a row, and stop at the first and last.
 */
function moveChoice(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (target.getAttribute('role') !== 'radio') return;
  const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const at = radios.indexOf(target as HTMLButtonElement);
  const row = event.currentTarget.classList.contains('isotone-grid') ? GRID_COLUMNS : 1;
  const wrap = (index: number) => (index + radios.length) % radios.length;
  const next = {
    ArrowRight: wrap(at + 1),
    ArrowLeft: wrap(at - 1),
    ArrowDown: row > 1 ? Math.min(at + row, radios.length - 1) : wrap(at + 1),
    ArrowUp: row > 1 ? Math.max(at - row, 0) : wrap(at - 1),
    Home: 0,
    End: radios.length - 1,
  }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  if (next === at) return;
  radios[next]?.focus();
  radios[next]?.click();
}

/**
 * Positions an option's actions button beside its own button: a button cannot
 * nest in a button. The chevron is out of the tab order; keyboard users reach
 * the same dialog with Shift+F10 or the context-menu key on the option. A right
 * click or a key opens it from the option, so focus returns there, not to the
 * chevron.
 */
function OptionFrame({
  label,
  className,
  open,
  onOpen,
  children,
}: {
  label: string;
  className: string;
  open: boolean;
  onOpen: (opener: HTMLButtonElement | null) => void;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: right click is a pointer shortcut; Shift+F10 on the option is the keyboard one.
    <div
      className={`isotone-opt ${className}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpen(e.currentTarget.querySelector('button'));
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
        e.preventDefault();
        onOpen(e.currentTarget.querySelector('button'));
      }}
    >
      {children}
      <button
        type="button"
        tabIndex={-1}
        className={`isotone-icon isotone-opt-more${className === 'isotone-opt-swatch' ? ' isotone-x' : ''}`}
        aria-label={`Actions for ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => onOpen(e.currentTarget)}
      >
        <Icon name="chevron" size={12} />
      </button>
    </div>
  );
}
