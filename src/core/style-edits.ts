/**
 * Style edits: what a reviewer changed with the style editor, as exact CSS
 * property values an agent can carry into the source. Framework-free: the
 * panel builds them, the store bounds them and the CLI prints them from here.
 */

/** One property the reviewer changed on an element. */
interface StyleChange {
  /** A CSS property, e.g. `padding-block` or `font-size`. */
  property: string;
  /** Its computed value when the element was pinned. */
  from: string;
  /** The value the reviewer left it at. */
  to: string;
}

/** The changes to one pinned element, matched to it by its selector. */
export interface StyleEdit {
  selector: string;
  changes: StyleChange[];
}

const MAX_STYLE_EDITS = 50;
const MAX_STYLE_CHANGES = 24;
const MAX_VALUE = 160;

/** A CSS property name, and a value that cannot end its declaration or open another rule. */
const PROPERTY = /^[a-z][a-z-]{0,39}$/;
const VALUE = /^[^;{}<>!\\\n\r]{1,160}$/;

export const isStyleProperty = (name: unknown): name is string => typeof name === 'string' && PROPERTY.test(name);
export const isStyleValue = (value: unknown): value is string => typeof value === 'string' && VALUE.test(value) && value.trim() !== '';

/**
 * Style edits from anything a browser or a notes file may hold: bounded, with
 * malformed entries dropped. Undefined when nothing valid is left.
 */
export function styleEditsOf(value: unknown): StyleEdit[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const edits: StyleEdit[] = [];
  for (const entry of value.slice(0, MAX_STYLE_EDITS)) {
    if (!entry || typeof entry !== 'object') continue;
    const { selector, changes } = entry as { selector?: unknown; changes?: unknown };
    if (typeof selector !== 'string' || !selector || selector.length > 2000 || !Array.isArray(changes)) continue;
    const kept = changes.slice(0, MAX_STYLE_CHANGES).flatMap((change): StyleChange[] => {
      const { property, from, to } = (change ?? {}) as Partial<StyleChange>;
      if (!isStyleProperty(property) || !isStyleValue(to) || typeof from !== 'string') return [];
      return [{ property, from: from.replace(/[;{}<>\n\r]/g, ' ').slice(0, MAX_VALUE), to: to.trim() }];
    });
    if (kept.length) edits.push({ selector, changes: kept });
  }
  return edits.length ? edits : undefined;
}

/** How many properties changed, over every element. */
export const countStyleChanges = (edits: readonly StyleEdit[] | undefined): number =>
  (edits ?? []).reduce((sum, edit) => sum + edit.changes.length, 0);

/** `rgb(17, 17, 17)` as `#111111`, the form a stylesheet is searched for; anything else as it is. */
export function hexColor(value: string): string {
  return value.replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g, (match, r, g, b, a) => {
    const hex = [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    if (a === undefined || Number(a) === 1) return `#${hex}`;
    return Number(a) === 0 ? 'transparent' : match;
  });
}
