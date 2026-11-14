/**
 * Validators for note fields that arrive from the browser. Each one bounds
 * what it keeps and drops anything malformed, so a hostile or buggy page
 * cannot bloat or corrupt the notes file.
 */
import { basename, dirname, resolve } from 'node:path';

import type { IsotoneElement, VariantReference, VariantRemoval } from '../../core/types';
import { MAX_SELECTOR, PAYLOAD_MAX } from '../../core/limits';
import { realPath, toPosixPath } from '../fs/paths';

function cap(v: string, max: number): string {
  return v.slice(0, max);
}

/** The app a notes file belongs to: the directory holding its `.isotone/`, where the agent runs the CLI. */
export function notesApp(file: string): string {
  const own = dirname(resolve(file));
  return basename(own) === '.isotone' ? dirname(own) : own;
}

/**
 * A `source` the page gave as an absolute path (Vue's `__file`, a source map's
 * `file://` source) as a path from the app. A file outside the app stays absolute.
 */
function fromApp(source: string, app: string): string {
  let real = app;
  try {
    real = realPath(app);
  } catch {}
  const posix = source.replaceAll('\\', '/');
  for (const dir of [app, real]) {
    const base = toPosixPath(dir).replace(/\/?$/, '/');
    if (posix.startsWith(base)) return source.slice(base.length);
  }
  return source;
}

/** A pinned element, or null without an object and a selector. `app` makes an absolute `source` relative. */
export function elementOf(value: unknown, app?: string): IsotoneElement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const selector = (value as { selector?: unknown }).selector;
  return typeof selector === 'string' && selector ? elementFields(value, app) : null;
}

/** Every element field, each bounded, from any object; a missing selector is empty. */
export function elementFields(value: object, app?: string): IsotoneElement {
  const v = value as { tag?: unknown; text?: unknown; selector?: unknown };
  const context = elementContext(value);
  if (context.source && app) context.source = fromApp(context.source, app);
  return {
    tag: cap(String(v.tag ?? ''), 30),
    text: cap(String(v.text ?? ''), 120),
    selector: cap(String(v.selector ?? ''), MAX_SELECTOR),
    ...context,
  };
}

function stringList(value: unknown, count: number, length: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item !== '')
        .slice(0, count)
        .map((item) => cap(item, length))
    : [];
}

/** The optional identifying fields, each bounded; anything malformed is dropped. */
function elementContext(value: object): Partial<IsotoneElement> {
  const v = value as Record<string, unknown>;
  const out: Partial<IsotoneElement> = {};
  if (v.attributes && typeof v.attributes === 'object' && !Array.isArray(v.attributes)) {
    const entries = Object.entries(v.attributes)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !UNSAFE_KEYS.has(entry[0]))
      .slice(0, 20)
      .map(([name, text]): [string, string] => [cap(name, 60), cap(text, 300)]);
    if (entries.length) out.attributes = Object.fromEntries(entries);
  }
  const component = stringList(v.component, 8, 80);
  if (component.length) out.component = component;
  const within = stringList(v.within, 6, 120);
  if (within.length) out.within = within;
  if (typeof v.source === 'string' && v.source) out.source = cap(v.source, 300);
  if (typeof v.near === 'string' && v.near) out.near = cap(v.near, 120);
  const rect = v.rect as Record<string, unknown> | null | undefined;
  if (rect && typeof rect === 'object' && [rect.x, rect.y, rect.w, rect.h].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    out.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h } as NonNullable<IsotoneElement['rect']>;
  }
  if (v.styles && typeof v.styles === 'object' && !Array.isArray(v.styles)) {
    const entries = Object.entries(v.styles)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '' && STYLE_NAME.test(entry[0]))
      .slice(0, 32)
      .map(([name, text]): [string, string] => [name, cap(text, 160)]);
    if (entries.length) out.styles = Object.fromEntries(entries);
  }
  return out;
}

/** A CSS property name: nothing else is a key of `styles`. */
const STYLE_NAME = /^[a-z][a-z-]{0,39}$/;

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function variantOf(value: unknown): VariantReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Partial<VariantReference>;
  if (typeof v.axisId !== 'string' || typeof v.label !== 'string') return null;
  return {
    axisId: cap(v.axisId, 200),
    label: cap(v.label, 200),
    ...(typeof v.optionId === 'string' ? { optionId: cap(v.optionId, 200) } : {}),
    ...(typeof v.optionLabel === 'string' ? { optionLabel: cap(v.optionLabel, 200) } : {}),
    ...(typeof v.value === 'string' ? { value: cap(v.value, 200) } : {}),
  };
}

/**
 * The selections a note was filed under, from the browser: at most 32, each an
 * axis id (an overlay group without a name joins its members' ids with `+`)
 * and a value of up to 64 printable characters. Anything else is dropped; null
 * when nothing is left.
 */
export function selectionsOf(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value)
    .filter(
      (entry): entry is [string, string] =>
        /^[a-z0-9][\w.+-]{0,199}$/i.test(entry[0]) && typeof entry[1] === 'string' && /^[^\p{Cc}]{1,64}$/u.test(entry[1]),
    )
    .slice(0, 32);
  return entries.length ? Object.fromEntries(entries) : null;
}

/** A sane `{ w, h }` from an untrusted viewport value, else null. */
export function viewportOf(v: unknown): { w: number; h: number } | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const w = Math.round(Number((v as { w?: unknown }).w));
  const h = Math.round(Number((v as { h?: unknown }).h));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (w <= 0 || h <= 0 || w > 100_000 || h > 100_000) return null;
  return { w, h };
}

/** Whether an opaque payload is serializable and inside {@link PAYLOAD_MAX}. */
export function withinPayloadCap(payload: unknown): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8') <= PAYLOAD_MAX;
  } catch {
    return false; // circular or otherwise unserializable
  }
}

export function removalOf(value: unknown): VariantRemoval | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Partial<VariantRemoval>;
  if (
    typeof v.axisId !== 'string' ||
    !v.axisId ||
    v.axisId.length > 200 ||
    !['remove-option', 'remove-axis', 'keep-default', 'keep-option'].includes(v.action ?? '')
  )
    return;
  if (
    (v.action === 'remove-option' || v.action === 'keep-option') &&
    (typeof v.optionId !== 'string' || !v.optionId || v.optionId.length > 200)
  )
    return;
  return {
    axisId: v.axisId,
    action: v.action as VariantRemoval['action'],
    ...(typeof v.optionId === 'string' ? { optionId: v.optionId.slice(0, 200) } : {}),
  };
}
