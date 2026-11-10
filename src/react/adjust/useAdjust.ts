import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hexColor, type StyleEdit } from '../../core/style-edits';
import type { IsotoneElement } from '../../core/types';
import { type Declared, findDeclared } from './declared';
import { ADJUST_FIELDS, type AdjustField, joinSides } from './fields';
import { applyPreview, supportsValue, withoutPreview } from './preview';

const EMPTY: StyleEdit[] = [];

/** Each pinned element's values before any edit, by selector then property. */
type Baselines = Record<string, Record<string, string>>;
/** What the reviewer set, by selector then property. */
type Edits = Record<string, Record<string, string>>;

export interface FieldState {
  field: AdjustField;
  /** The value shown: the edit, else where the element started. Null when the pinned elements differ. */
  value: string | null;
  changed: boolean;
}

export interface Adjust {
  /** The experiment is on and something is pinned. */
  available: boolean;
  open: boolean;
  toggle(): void;
  close(): void;
  fields: FieldState[];
  /** Set a property on every pinned element; false when the browser will not take the value. */
  set(property: string, value: string): boolean;
  reset(property?: string): void;
  /** Properties changed, over every pinned element. */
  count: number;
  /** The edits to send with the note. */
  edits: StyleEdit[];
  /** Take up edits made earlier: a saved note's, or those of a note that could not be sent. */
  restore(edits: readonly StyleEdit[]): void;
}

function readBaseline(element: Element): Record<string, string> {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const values: Record<string, string> = {};
  if (!style) return values;
  for (const field of ADJUST_FIELDS) {
    values[field.property] = hexColor(joinSides(field.read.map((name) => style.getPropertyValue(name).trim())));
  }
  values.display = style.getPropertyValue('display');
  return values;
}

const applies = (field: AdjustField, target: IsotoneElement, baseline: Record<string, string> | undefined) =>
  field.when === 'gap' ? /flex|grid/.test(baseline?.display ?? '') : field.when === 'text' ? Boolean(target.text) : true;

/**
 * The style editor's state: where each pinned element started, what the
 * reviewer set, and the preview that shows it. Starting values are read once
 * per element, before its first preview rule exists, so `from` is always the
 * page's own value and never an earlier edit.
 */
export function useAdjust(
  enabled: boolean,
  targets: IsotoneElement[],
  locate: (selector: string) => Element | null,
  /** The feedback panel is open: a closed panel leaves the page as it really is, and shows the changes again when reopened. */
  showing = true,
): Adjust {
  const [open, setOpen] = useState(false);
  const [baselines, setBaselines] = useState<Baselines>({});
  const [edits, setEdits] = useState<Edits>({});
  // Starting values a saved note recorded: they stand in for the page's, which may have moved on since.
  const [recorded, setRecorded] = useState<Baselines>({});
  // Where the page sets each property, read with the baseline; kept beside it, never shown.
  const declared = useRef<Record<string, Record<string, Declared>>>({});
  const selectors = useMemo(() => targets.map((target) => target.selector), [targets]);
  const key = selectors.join('\n');
  const latest = useRef({ selectors, baselines, recorded });
  latest.current = { selectors, baselines, recorded };

  // Unpinned elements take their edits with them; newly pinned ones are read while the editor is open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the selectors.
  useEffect(() => {
    const kept = new Set(selectors);
    const prune = <T>(all: Record<string, T>) =>
      Object.keys(all).every((selector) => kept.has(selector))
        ? all
        : Object.fromEntries(Object.entries(all).filter(([selector]) => kept.has(selector)));
    setEdits(prune);
    setRecorded(prune);
    for (const selector of Object.keys(declared.current)) if (!kept.has(selector)) delete declared.current[selector];
    // Nothing pinned, nothing to adjust: the next pin starts with the editor closed.
    if (!selectors.length) setOpen(false);
    const added: Baselines = {};
    if (enabled && open) {
      const missing = selectors.filter((selector) => !latest.current.baselines[selector]);
      // Read with the preview off: an edit to a parent (its colour, its type size) must not pass for the child's own value.
      if (missing.length) {
        withoutPreview(document, () => {
          for (const selector of missing) {
            const element = locate(selector);
            if (!element) continue;
            added[selector] = readBaseline(element);
            declared.current[selector] = findDeclared(
              element,
              ADJUST_FIELDS.map((field) => field.property),
            );
          }
        });
      }
    }
    setBaselines((current) => {
      const next = prune(current);
      return Object.keys(added).length ? { ...next, ...added } : next;
    });
  }, [key, enabled, open, locate]);

  const list = useMemo<StyleEdit[]>(
    () =>
      selectors.flatMap((selector) => {
        const changes = Object.entries(edits[selector] ?? {}).map(([property, to]) => {
          const set = declared.current[selector]?.[property];
          return {
            property,
            from: recorded[selector]?.[property] || baselines[selector]?.[property] || '',
            to,
            ...(set ? { rule: set.rule, declared: set.value } : {}),
          };
        });
        return changes.length ? [{ selector, changes }] : [];
      }),
    [selectors, edits, baselines, recorded],
  );

  // The page shows exactly the edits held here, and nothing once this unmounts.
  // What it then computes is what the untouched fields show: a larger type size moves the line height with it.
  const [live, setLive] = useState<Baselines>({});
  const [resized, setResized] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the selectors.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyPreview(document, enabled && showing ? list : []);
    if (!enabled || !open || !showing) return;
    const next: Baselines = {};
    for (const selector of selectors) {
      const element = locate(selector);
      if (element) next[selector] = readBaseline(element);
    }
    setLive((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, [list, enabled, open, showing, key, locate, resized]);
  // A breakpoint can change every value shown; the starting values stay those read at the width the pin was made.
  useEffect(() => {
    if (!enabled || !open || typeof window === 'undefined') return;
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setResized((n) => n + 1));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
    };
  }, [enabled, open]);
  useEffect(
    () => () => {
      if (typeof document !== 'undefined') applyPreview(document, []);
    },
    [],
  );

  const set = useCallback((property: string, value: string) => {
    if (!supportsValue(property, value)) return false;
    const { selectors, baselines, recorded } = latest.current;
    setEdits((current) => {
      const next = { ...current };
      for (const selector of selectors) {
        const own = { ...next[selector] };
        // Back at the starting value is no change at all.
        if ((recorded[selector]?.[property] || baselines[selector]?.[property]) === value) delete own[property];
        else own[property] = value;
        if (Object.keys(own).length) next[selector] = own;
        else delete next[selector];
      }
      return next;
    });
    return true;
  }, []);
  const reset = useCallback((property?: string) => {
    setEdits((current) =>
      property === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(current).flatMap(([selector, own]) => {
              const { [property]: _dropped, ...rest } = own;
              return Object.keys(rest).length ? [[selector, rest]] : [];
            }),
          ),
    );
  }, []);
  const restore = useCallback((saved: readonly StyleEdit[]) => {
    if (!saved.length) return;
    const byProperty = (pick: 'from' | 'to') =>
      Object.fromEntries(
        saved.map(({ selector, changes }) => [selector, Object.fromEntries(changes.map((change) => [change.property, change[pick]]))]),
      );
    setEdits((current) => ({ ...current, ...byProperty('to') }));
    for (const { selector, changes } of saved)
      declared.current[selector] = {
        ...declared.current[selector],
        ...Object.fromEntries(changes.flatMap((c) => (c.rule ? [[c.property, { rule: c.rule, value: c.declared ?? '' }]] : []))),
      };
    // Where each started is what the note recorded. The page itself is still read when the editor opens, for
    // every other field and for which fields apply.
    setRecorded((current) => {
      const next = { ...current };
      for (const [selector, values] of Object.entries(byProperty('from'))) next[selector] = { ...next[selector], ...values };
      return next;
    });
  }, []);

  const fields = useMemo<FieldState[]>(() => {
    const first = targets[0];
    if (!first) return [];
    // An element the page cannot be asked about (inside a shadow root or a frame) has no values to show or preview.
    if (!targets.every((target) => baselines[target.selector])) return [];
    return ADJUST_FIELDS.filter((field) => targets.every((target) => applies(field, target, baselines[target.selector]))).map((field) => {
      const values = targets.map(
        ({ selector }) =>
          edits[selector]?.[field.property] ?? live[selector]?.[field.property] ?? baselines[selector]?.[field.property] ?? '',
      );
      return {
        field,
        value: values.every((value) => value === values[0]) ? (values[0] ?? '') : null,
        changed: targets.some((target) => edits[target.selector]?.[field.property] !== undefined),
      };
    });
  }, [targets, edits, baselines, live]);

  const available = enabled && targets.length > 0;
  return {
    available,
    open: available && open,
    toggle: useCallback(() => setOpen((was) => !was), []),
    close: useCallback(() => setOpen(false), []),
    fields,
    set,
    reset,
    count: enabled ? list.reduce((sum, edit) => sum + edit.changes.length, 0) : 0,
    // Turned off mid-session, the editor sends nothing it can no longer show.
    edits: enabled ? list : EMPTY,
    restore,
  };
}
