import { Fragment, useEffect, useRef, useState } from 'react';

import {
  axisDefault,
  type ColorVariantAxis,
  formatRangeValue,
  isDirty,
  type RangeVariantAxis,
  type SelectVariantAxis,
  type VariantSelections,
  type VariantsSource,
  visibleAxes,
} from '../core/variants';

/** Static: `input[type=color]` sits invisibly on top and does the picking. */
const PICKER_GRADIENT =
  'conic-gradient(from 0deg, #ef4444, #eab308, #22c55e, #3b82f6, #a855f7, #ef4444)';

/**
 * Some sources (the overlay adapter) learn their axes from the network and
 * expose `refresh()` for it. The contract does not name it, so feature-detect
 * rather than widen `VariantsSource` for one adapter.
 */
export function refreshSource(source: VariantsSource): void {
  const candidate = (source as { refresh?: unknown }).refresh;
  if (typeof candidate !== 'function') return;
  // The panel shows whatever the source already has; a failed refresh means
  // stale axes, not a broken panel, so the rejection is swallowed here.
  void Promise.resolve((candidate as () => unknown).call(source)).catch(() => {});
}

/** Re-render on every source notification. */
export function useVariantsSource(source: VariantsSource | undefined) {
  const [, setTick] = useState(0);
  useEffect(() => source?.subscribe(() => setTick((t) => t + 1)), [source]);
}

/**
 * Every variant control the source declares, in order, grouped by section
 * and scoped by `showWhen`; Revert while anything is off its default; Save
 * as defaults when the source can persist them.
 *
 * The view owns no state beyond the save button's: the source is the model
 * and every change goes back through it, so a host that syncs selections to
 * the URL or to a dev server sees exactly what the panel shows.
 */
export function VariantsView({
  source,
  showTitle = true,
}: {
  source: VariantsSource;
  /**
   * Standalone, the view names itself in a header row above the controls.
   * Under the panel's tab bar the tab already says Variants, so the panel
   * passes `false`: the row then holds only Revert, right-aligned, and is
   * left out altogether while nothing is dirty.
   */
  showTitle?: boolean;
}) {
  useVariantsSource(source);
  // On mount, so the overlay source lists variants each time the panel opens.
  useEffect(() => refreshSource(source), [source]);

  const axes = source.getAxes();
  const selections = source.getSelections();
  const shown = visibleAxes(axes, selections);
  const dirty = isDirty(axes, selections);
  const current = (axis: (typeof axes)[number]) => selections[axis.id] ?? axisDefault(axis);

  return (
    <div className="iso-iter-vars">
      {(showTitle || dirty) && (
        <div className={showTitle ? 'iso-iter-vars-head' : 'iso-iter-vars-head iso-iter-vars-head-bare'}>
          {showTitle && <span className="iso-iter-vars-title">{source.title ?? 'Variants'}</span>}
          {dirty && (
            <button
              type="button"
              data-iso-iterate
              className="iso-iter-revert"
              title="Revert every control to its default"
              onClick={() => source.reset()}
            >
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <title>Revert</title>
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Revert
            </button>
          )}
        </div>
      )}

      <div className="iso-iter-vars-body">
        {shown.map((axis, i) => (
          <Fragment key={axis.id}>
            {i > 0 && shown[i - 1].section !== axis.section && (
              <div className="iso-iter-hairline" />
            )}
            {axis.kind === 'range' ? (
              <RangeAxis axis={axis} value={current(axis)} onChange={source.setSelection} />
            ) : axis.kind === 'color' ? (
              <ColorAxis axis={axis} value={current(axis)} onChange={source.setSelection} />
            ) : (
              <SelectAxis axis={axis} value={current(axis)} onChange={source.setSelection} />
            )}
          </Fragment>
        ))}

        {source.saveDefaults && <SaveDefaults source={source} />}
      </div>
    </div>
  );
}

interface AxisProps<A> {
  axis: A;
  value: string;
  onChange: (axisId: string, value: string) => void;
}

function RangeAxis({ axis, value, onChange }: AxisProps<RangeVariantAxis>) {
  return (
    <div className="iso-iter-axis">
      <div className="iso-iter-axis-head">
        <h3 className="iso-iter-axis-label">{axis.label}</h3>
        <span className="iso-iter-axis-value">{formatRangeValue(axis, value)}</span>
      </div>
      <input
        type="range"
        className="iso-iter-range"
        aria-label={axis.label}
        min={axis.min}
        max={axis.max}
        step={axis.step}
        value={Number(value)}
        onChange={(e) => onChange(axis.id, e.target.value)}
      />
    </div>
  );
}

function ColorAxis({ axis, value, onChange }: AxisProps<ColorVariantAxis>) {
  const current = value.toLowerCase();
  return (
    <div className="iso-iter-axis">
      <div className="iso-iter-axis-head">
        <h3 className="iso-iter-axis-label">{axis.label}</h3>
        <span className="iso-iter-axis-value iso-iter-axis-hex">{value}</span>
      </div>
      <div className="iso-iter-swatches">
        {axis.swatches.map((sw) => (
          <button
            key={sw.id}
            type="button"
            data-iso-iterate
            title={sw.label}
            aria-label={sw.label}
            aria-pressed={current === sw.value.toLowerCase()}
            className={
              current === sw.value.toLowerCase()
                ? 'iso-iter-swatch iso-iter-swatch-on'
                : 'iso-iter-swatch'
            }
            style={{ backgroundColor: sw.value }}
            onClick={() => onChange(axis.id, sw.value)}
          />
        ))}
        <label
          className="iso-iter-picker"
          title="Custom colour"
          style={{ background: PICKER_GRADIENT }}
        >
          <input
            type="color"
            aria-label={`${axis.label}: custom colour`}
            value={value}
            onChange={(e) => onChange(axis.id, e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function SelectAxis({ axis, value, onChange }: AxisProps<SelectVariantAxis>) {
  const asGrid = axis.options.length > 0 && axis.options.every((o) => o.image);
  return (
    <div className="iso-iter-axis">
      <h3 className="iso-iter-axis-label">{axis.label}</h3>
      {asGrid ? (
        <div className="iso-iter-grid">
          {axis.options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-iso-iterate
              aria-pressed={value === o.id}
              title={o.hint ?? o.label}
              className={value === o.id ? 'iso-iter-thumb iso-iter-thumb-on' : 'iso-iter-thumb'}
              onClick={() => onChange(axis.id, o.id)}
            >
              <img src={o.image} alt="" />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="iso-iter-segs">
          {axis.options.map((o) => (
            <button
              key={o.id}
              type="button"
              data-iso-iterate
              aria-pressed={value === o.id}
              title={o.hint ?? o.label}
              className={value === o.id ? 'iso-iter-seg iso-iter-seg-on' : 'iso-iter-seg'}
              onClick={() => onChange(axis.id, o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_COPY: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved for the agent',
  error: "Couldn't save",
};

function SaveDefaults({ source }: { source: VariantsSource }) {
  const [state, setState] = useState<SaveState>('idle');
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);

  async function save() {
    if (state === 'saving') return;
    setState('saving');
    const selections: VariantSelections = { ...source.getSelections() };
    try {
      await source.saveDefaults?.(selections);
      setState('saved');
    } catch {
      setState('error');
    }
    // Both outcomes clear after a beat so the row reads as a button again.
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setState('idle'), 2000);
  }

  return (
    <div className="iso-iter-save-row">
      <button
        type="button"
        data-iso-iterate
        className="iso-iter-save"
        disabled={state === 'saving'}
        onClick={() => void save()}
      >
        Save as defaults
      </button>
      <span
        className={
          state === 'error' ? 'iso-iter-save-state iso-iter-save-state-error' : 'iso-iter-save-state'
        }
        role="status"
      >
        {SAVE_COPY[state]}
      </span>
    </div>
  );
}
