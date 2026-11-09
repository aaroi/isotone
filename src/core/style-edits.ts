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
  /** Where the page sets it today, when that could be found: a rule's selector as written, or `inline` for the style attribute. */
  rule?: string;
  /** The value as written there: a token (`var(--space-4)`), a relative unit, a shorthand. */
  declared?: string;
}

/** The changes to one pinned element, matched to it by its selector. */
export interface StyleEdit {
  selector: string;
  changes: StyleChange[];
}

const MAX_STYLE_EDITS = 50;
const MAX_STYLE_CHANGES = 24;
const MAX_VALUE = 160;

/**
 * The properties the editor changes. A note may arrive from any page, so
 * nothing else is kept: a `change:` line can only ever name one of these.
 */
export const STYLE_PROPERTIES: readonly string[] = [
  'padding-block',
  'padding-inline',
  'gap',
  'margin-block',
  'margin-inline',
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'border-radius',
  'opacity',
];

// One CSS value token: a number with a unit, a hex colour, or a colour function of numbers and a few fixed words.
const TOKEN = String.raw`(?:-?\d*\.?\d+(?:px|%|em|rem)?|#[0-9a-f]{3,8}|(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\((?:[\d\s.,%/+-]|none|deg|srgb|display-p3|rec2020){1,80}\))`;
/**
 * Up to four of them (`24px`, `16px 8px`, `#ff0080`, `rgba(0, 0, 0, 0.5)`), or
 * one keyword (`normal`, `transparent`). Never several words: nothing that
 * reads as prose or code gets through.
 */
const VALUE = new RegExp(`^(?:[a-z][a-z-]{0,23}|${TOKEN}(?:\\s+${TOKEN}){0,3})$`, 'i');

/** Page-authored CSS text as one bounded line, or nothing. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control and bidi characters are what this removes.
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const pageText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE) : '';

export const isStyleProperty = (name: unknown): name is string => typeof name === 'string' && STYLE_PROPERTIES.includes(name);
export const isStyleValue = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_VALUE && VALUE.test(value.trim());

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
      const { property, from, to, rule, declared } = (change ?? {}) as Partial<StyleChange>;
      if (!isStyleProperty(property) || !isStyleValue(to)) return [];
      // A starting value the editor could not have read is left blank rather than passed on.
      // The rule and its declared value are the page's own text: kept short, on one line, and quoted where printed.
      return [
        {
          property,
          from: isStyleValue(from) ? from.trim() : '',
          to: to.trim(),
          ...(pageText(rule) ? { rule: pageText(rule) } : {}),
          ...(pageText(rule) && pageText(declared) ? { declared: pageText(declared) } : {}),
        },
      ];
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
