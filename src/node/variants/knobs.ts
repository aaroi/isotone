/** Knobs: the adjustable properties in `.isotone/knobs.json`. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ColorVariantAxis, KnobAxis, RangeVariantAxis, SelectVariantAxis } from '../../core/variants';
import { KNOBS_FILE, type VariantsStoreOptions } from './options';
import { isValidVariantId } from './paths';

/** The host's knobs, dropping entries that are not a usable axis. */
export function readKnobs(opts: VariantsStoreOptions): KnobAxis[] {
  const file = resolve(opts.root, KNOBS_FILE);
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  return parsed
    .filter((k): k is KnobAxis => {
      if (!k || typeof k !== 'object') return false;
      const a = k as Partial<KnobAxis>;
      if (typeof a.id !== 'string' || !isValidVariantId(a.id) || typeof a.label !== 'string') return false;
      if (
        a.route !== undefined &&
        typeof a.route !== 'string' &&
        (!Array.isArray(a.route) || !a.route.every((route) => typeof route === 'string'))
      )
        return false;
      if (
        a.showWhen !== undefined &&
        (!a.showWhen ||
          typeof a.showWhen.axis !== 'string' ||
          (a.showWhen.equals !== undefined && typeof a.showWhen.equals !== 'string') ||
          (a.showWhen.not !== undefined && typeof a.showWhen.not !== 'string'))
      )
        return false;
      if (a.section !== undefined && typeof a.section !== 'string') return false;
      if (a.kind === 'range') {
        const { min, max, step, defaultValue } = a as Partial<RangeVariantAxis>;
        if (typeof min !== 'number' || typeof max !== 'number' || typeof step !== 'number' || typeof defaultValue !== 'number')
          return false;
        return (
          [min, max, step, defaultValue, max - min].every(Number.isFinite) &&
          min < max &&
          step > 0 &&
          defaultValue >= min &&
          defaultValue <= max &&
          (a.unit === undefined || typeof a.unit === 'string')
        );
      }
      if (a.kind === 'color') {
        const c = a as Partial<ColorVariantAxis>;
        const hex = (value: unknown) => typeof value === 'string' && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value);
        return (
          hex(c.defaultColor) &&
          Array.isArray(c.swatches) &&
          c.swatches.every((s) => s && typeof s.id === 'string' && typeof s.label === 'string' && hex(s.value))
        );
      }
      if (a.kind === 'select') {
        const s = a as Partial<SelectVariantAxis>;
        return (
          Array.isArray(s.options) &&
          s.options.length > 0 &&
          s.options.every((o) => o && typeof o.id === 'string' && typeof o.label === 'string') &&
          s.options.some((o) => o.id === s.defaultOption)
        );
      }
      return false;
    })
    .filter((axis) => {
      if (seen.has(axis.id)) return false;
      seen.add(axis.id);
      return true;
    });
}
