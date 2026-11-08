/** Knobs: the adjustable properties in `.isotone/knobs.json`. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KnobAxis } from '../../core/variants/overlay';
import { KNOBS_FILE, type VariantsStoreOptions } from './options';
import { isValidVariantId } from './paths';

/** The host's knobs, dropping entries that are not a usable axis and later duplicates of an id. */
export function readKnobs(opts: VariantsStoreOptions): KnobAxis[] {
  const seen = new Set<string>();
  return readRawKnobs(opts).filter((k): k is KnobAxis => {
    if (knobProblem(k) !== null) return false;
    const { id } = k as KnobAxis;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** The parsed entries of the knobs file, or [] when it is missing or not a JSON list. */
function readRawKnobs(opts: VariantsStoreOptions): unknown[] {
  const file = resolve(opts.root, KNOBS_FILE);
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const isHex = (v: unknown) => typeof v === 'string' && /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(v);
const isNamedList = (list: unknown, value?: (o: Record<string, unknown>) => boolean) =>
  Array.isArray(list) && list.every((o) => o && typeof o.id === 'string' && typeof o.label === 'string' && (!value || value(o)));

/** Why an entry of the knobs file is not a usable knob, in words for the person editing it; null when it is. */
export function knobProblem(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'not a JSON object.';
  const k = entry as Record<string, unknown>;
  if (typeof k.id !== 'string' || !isValidVariantId(k.id)) return 'id must be lowercase letters, digits and dashes.';
  if (typeof k.label !== 'string') return 'label must be a string.';
  if (k.route !== undefined && typeof k.route !== 'string' && !(Array.isArray(k.route) && k.route.every((r) => typeof r === 'string')))
    return 'route must be a route pattern or a list of them.';
  if (k.section !== undefined && typeof k.section !== 'string') return 'section must be a string.';
  if (k.showWhen !== undefined) {
    const w = k.showWhen as Record<string, unknown> | null;
    if (
      !w ||
      typeof w.axis !== 'string' ||
      (w.equals !== undefined && typeof w.equals !== 'string') ||
      (w.not !== undefined && typeof w.not !== 'string')
    )
      return 'showWhen needs an axis id, and equals or not as strings.';
  }
  if (k.kind === 'range') {
    const nums = [k.min, k.max, k.step, k.defaultValue];
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return 'a range needs numeric min, max, step and defaultValue.';
    const [min, max, step, value] = nums as [number, number, number, number];
    if (!(min < max) || !Number.isFinite(max - min)) return 'min must be below max.';
    if (!(step > 0)) return 'step must be above 0.';
    if (value < min || value > max) return 'defaultValue must be between min and max.';
    if (k.unit !== undefined && typeof k.unit !== 'string') return 'unit must be a string.';
    return null;
  }
  if (k.kind === 'color') {
    if (!isHex(k.defaultColor)) return 'defaultColor must be a hex colour such as #3366ff.';
    if (!isNamedList(k.swatches, (o) => isHex(o.value))) return 'swatches must be a list of { id, label, value } with hex values.';
    return null;
  }
  if (k.kind === 'select') {
    if (!isNamedList(k.options) || !(k.options as unknown[]).length) return 'a select needs options, each with an id and a label.';
    if (!(k.options as { id: string }[]).some((o) => o.id === k.defaultOption)) return 'defaultOption must be one of the option ids.';
    return null;
  }
  return 'kind must be "select", "range" or "color".';
}
