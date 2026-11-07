/**
 * isotone — where an element's styles come from (experimental, browser only).
 *
 * `getComputedStyle` says what a value is; this says who set it. It walks the
 * document's stylesheets once, keeps the rules that declare an inspector
 * property, and for an element picks the declaration the cascade most likely
 * applies: importance, cascade layer, specificity, then source order. The
 * result names the rule's selector (a Tailwind utility, a CSS module class, a
 * CSS-in-JS hash), the value as written (`var(--card-padding)`), and the custom
 * properties it reads. That is the context an agent needs to make a change in
 * the project's own styling system instead of an inline style.
 *
 * It is a best effort: cross-origin sheets cannot be read, and container
 * queries, `@scope` and layer order are approximated.
 */
import { STYLE_PROPERTIES, type StyleProperty, normalizeColor, parseLength, parseRgb } from './style';

/** Stylesheets Isotone itself adds carry this attribute and are skipped. */
export const PREVIEW_SHEET_ATTRIBUTE = 'data-isotone-style-preview';

interface IndexedRule {
  selector: string;
  style: CSSStyleDeclaration;
  order: number;
  layered: boolean;
}

export interface StyleRuleIndex {
  /** Candidate rules by inspector property name. */
  byProperty: Map<string, IndexedRule[]>;
  /** Custom property names declared anywhere, in source order. */
  customProperties: string[];
}

/** Where one property's value comes from on one element. */
export interface StyleOrigin {
  rule?: string;
  declared?: string;
  tokens?: Record<string, string>;
}

const MAX_RULES = 20_000;
const MAX_CUSTOM_PROPERTIES = 600;

function triggers(property: StyleProperty): string[] {
  return [property.name, ...(property.longhands ?? [])];
}

/** Which inspector properties each declared (longhand) name can feed. */
const FEEDS = (() => {
  const map = new Map<string, string[]>();
  for (const property of STYLE_PROPERTIES) {
    for (const name of triggers(property)) map.set(name, [...(map.get(name) ?? []), property.name]);
  }
  return map;
})();

/**
 * Index the document's rules once per inspection. Media and supports rules
 * count only when they currently apply; nested rules are rewritten against
 * their parent with `:is()`.
 */
export function indexStyleRules(doc: Document): StyleRuleIndex {
  const byProperty = new Map<string, IndexedRule[]>();
  const custom = new Set<string>();
  const view = doc.defaultView;
  let order = 0;
  let count = 0;
  const visit = (rules: CSSRuleList | undefined | null, layered: boolean, parent: string | null) => {
    if (!rules) return;
    for (const rule of Array.from(rules)) {
      if (count++ > MAX_RULES) return;
      const any = rule as CSSRule & {
        selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList;
        media?: MediaList; conditionText?: string; styleSheet?: CSSStyleSheet | null;
      };
      if (typeof any.selectorText === 'string' && any.style) {
        const own = any.selectorText;
        const selector = parent === null ? own : own.includes('&') ? own.replaceAll('&', `:is(${parent})`) : `:is(${parent}) ${own}`;
        const indexed: IndexedRule = { selector, style: any.style, order: order++, layered };
        const fed = new Set<string>();
        for (let i = 0; i < any.style.length; i++) {
          const name = any.style[i];
          if (name.startsWith('--')) {
            if (custom.size < MAX_CUSTOM_PROPERTIES && !name.startsWith('--tw-')) custom.add(name);
            continue;
          }
          for (const property of FEEDS.get(name) ?? []) fed.add(property);
        }
        for (const property of fed) {
          const list = byProperty.get(property);
          if (list) list.push(indexed);
          else byProperty.set(property, [indexed]);
        }
        if (any.cssRules?.length) visit(any.cssRules, layered, selector);
        continue;
      }
      const type = rule.constructor?.name ?? '';
      if (any.styleSheet !== undefined) {
        // @import: its sheet may be cross-origin.
        try { visit(any.styleSheet?.cssRules, layered, parent); } catch {}
        continue;
      }
      if (type === 'CSSMediaRule' || any.media) {
        const media = any.media?.mediaText ?? any.conditionText ?? '';
        if (media && view?.matchMedia && !view.matchMedia(media).matches) continue;
        visit(any.cssRules, layered, parent);
        continue;
      }
      if (type === 'CSSSupportsRule') {
        try { if (any.conditionText && !CSS.supports(any.conditionText)) continue; } catch {}
        visit(any.cssRules, layered, parent);
        continue;
      }
      if (type === 'CSSStartingStyleRule' || type === 'CSSKeyframesRule' || type === 'CSSFontFaceRule') continue;
      // Layers, containers, scopes and anything newer: include their rules.
      visit(any.cssRules, layered || type === 'CSSLayerBlockRule', parent);
    }
  };
  const sheets: CSSStyleSheet[] = [
    ...Array.from(doc.styleSheets),
    ...((doc as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? []),
  ];
  for (const sheet of sheets) {
    const owner = sheet.ownerNode as Element | null;
    if (owner?.hasAttribute?.(PREVIEW_SHEET_ATTRIBUTE) || owner?.closest?.('[data-isotone]')) continue;
    let rules: CSSRuleList | null = null;
    try { rules = sheet.cssRules; } catch { continue; } // Cross-origin.
    visit(rules, false, null);
  }
  return { byProperty, customProperties: [...custom] };
}

/* ---------------------------------------------------------------------------
 * Specificity, for picking the winning declaration.
 * ------------------------------------------------------------------------- */

export type Specificity = [number, number, number];

function skipIdent(s: string, i: number): number {
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') { i += 2; continue; }
    if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127) { i++; continue; }
    break;
  }
  return i;
}

function skipBalanced(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      for (i++; i < s.length && s[i] !== quote; i++) if (s[i] === '\\') i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i + 1;
  }
  return s.length;
}

/** Split a selector list on its top-level commas. */
export function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter(Boolean);
}

function maxSpecificity(list: string): Specificity {
  return splitSelectorList(list).map(specificity).reduce<Specificity>(
    (best, next) => (compareSpecificity(next, best) > 0 ? next : best), [0, 0, 0]);
}

const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

/** Selectors Level 4 specificity of one complex selector (not a list). */
export function specificity(selector: string): Specificity {
  const s = selector;
  const total: Specificity = [0, 0, 0];
  const add = (x: Specificity) => { total[0] += x[0]; total[1] += x[1]; total[2] += x[2]; };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '#') { total[0]++; i = skipIdent(s, i + 1); }
    else if (ch === '.') { total[1]++; i = skipIdent(s, i + 1); }
    else if (ch === '[') { total[1]++; i = skipBalanced(s, i, '[', ']'); }
    else if (ch === ':') {
      if (s[i + 1] === ':') {
        total[2]++;
        i = skipIdent(s, i + 2);
        if (s[i] === '(') i = skipBalanced(s, i, '(', ')');
        continue;
      }
      const start = i + 1;
      i = skipIdent(s, start);
      const name = s.slice(start, i).toLowerCase();
      if (s[i] === '(') {
        const end = skipBalanced(s, i, '(', ')');
        const inner = s.slice(i + 1, end - 1);
        i = end;
        if (name === 'where') continue;
        if (name === 'is' || name === 'not' || name === 'has' || name === 'matches' || name === '-webkit-any') add(maxSpecificity(inner));
        else if (name === 'nth-child' || name === 'nth-last-child') {
          total[1]++;
          const of = /\bof\s+(.+)$/i.exec(inner);
          if (of) add(maxSpecificity(of[1]));
        } else total[1]++;
      } else if (LEGACY_PSEUDO_ELEMENTS.has(name)) total[2]++;
      else total[1]++;
    } else if (ch === '*' || ch === '&') i++;
    else if (/[A-Za-z_-]/.test(ch) || ch === '\\' || ch.charCodeAt(0) > 127) {
      total[2]++;
      i = skipIdent(s, i);
      if (s[i] === '|') i = skipIdent(s, i + 1); // Namespace prefix.
    } else i++;
  }
  return total;
}

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The specificity a rule's selector list applies to `el` with: its highest matching branch. */
function matchedSpecificity(el: Element, list: string): Specificity | null {
  let best: Specificity | null = null;
  for (const part of splitSelectorList(list)) {
    let matches = false;
    try { matches = el.matches(part); } catch { continue; }
    if (!matches) continue;
    const spec = specificity(part);
    if (!best || compareSpecificity(spec, best) > 0) best = spec;
  }
  return best;
}

/* ---------------------------------------------------------------------------
 * Origins.
 * ------------------------------------------------------------------------- */

function declaredValue(style: CSSStyleDeclaration, property: StyleProperty): { value: string; important: boolean } | null {
  const names = [property.name, ...(property.shorthands ?? []), ...(property.longhands ?? [])];
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) {
      const shown = name === property.name ? value : `${name}: ${value}`;
      return { value: shown, important: style.getPropertyPriority(name) === 'important' };
    }
  }
  return null;
}

/** The custom properties `declared` reads, resolved on `el`. */
export function tokensIn(declared: string, el: Element): Record<string, string> | undefined {
  // Tailwind's `--tw-*` properties are its own plumbing (ring and shadow
  // stacks), not design tokens a project would change.
  const names = [...new Set([...declared.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((match) => match[1]))]
    .filter((name) => !name.startsWith('--tw-'));
  if (!names.length) return undefined;
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  const tokens: Record<string, string> = {};
  for (const name of names.slice(0, 12)) tokens[name] = computed?.getPropertyValue(name).trim() ?? '';
  return tokens;
}

/** A compact element label for inherited origins, e.g. `div.app`. */
export function elementLabel(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const first = Array.from(el.classList).find((name) => name.length < 40);
  return first ? `${tag}.${first}` : tag;
}

function ownOrigin(el: Element, property: StyleProperty, index: StyleRuleIndex): StyleOrigin | null {
  const inline = (el as HTMLElement).style ? declaredValue((el as HTMLElement).style, property) : null;
  if (inline?.important) return { rule: 'style attribute', declared: inline.value };
  let best: { rule: IndexedRule; value: string; important: boolean; spec: Specificity } | null = null;
  for (const rule of index.byProperty.get(property.name) ?? []) {
    const declared = declaredValue(rule.style, property);
    if (!declared) continue;
    const spec = matchedSpecificity(el, rule.selector);
    if (!spec) continue;
    if (!best) { best = { rule, ...declared, spec }; continue; }
    // Important beats normal. Among normal declarations unlayered beats
    // layered; among important ones it is the reverse.
    const rank = (r: { important: boolean; rule: IndexedRule }) =>
      (r.important ? 2 : 0) + (r.important === r.rule.layered ? 1 : 0);
    const diff = rank({ important: declared.important, rule }) - rank(best)
      || compareSpecificity(spec, best.spec)
      || rule.order - best.rule.order;
    if (diff >= 0) best = { rule, ...declared, spec };
  }
  if (inline && !best?.important) return { rule: 'style attribute', declared: inline.value };
  if (!best) return null;
  return { rule: best.rule.selector.length > 200 ? `${best.rule.selector.slice(0, 199)}…` : best.rule.selector, declared: best.value };
}

/**
 * Who sets `property` on `el`: the winning rule and its written value, or the
 * nearest ancestor's for an inherited property. Null when only the browser's
 * defaults apply.
 */
export function styleOrigin(el: Element, property: StyleProperty, index: StyleRuleIndex): StyleOrigin | null {
  let origin = ownOrigin(el, property, index);
  if (!origin && property.inherited) {
    let up = el.parentElement;
    for (let depth = 0; up && depth < 12 && !origin; depth++, up = up.parentElement) {
      const found = ownOrigin(up, property, index);
      if (found) origin = { ...found, rule: `${found.rule === 'style attribute' ? `${elementLabel(up)} style attribute` : found.rule} (inherited)` };
    }
  }
  if (!origin) return null;
  const tokens = origin.declared ? tokensIn(origin.declared, el) : undefined;
  return tokens ? { ...origin, tokens } : origin;
}

/* ---------------------------------------------------------------------------
 * Token suggestions: custom properties whose value equals a new value.
 * ------------------------------------------------------------------------- */

let canvas: CanvasRenderingContext2D | null | undefined;
function context2d(doc: Document): CanvasRenderingContext2D | null {
  if (canvas !== undefined) return canvas;
  try {
    canvas = doc.createElement('canvas').getContext('2d', { willReadFrequently: true }) ?? null;
  } catch {
    canvas = null;
  }
  return canvas;
}

/**
 * Any CSS colour as `[r, g, b, a]` in sRGB, via a 1×1 canvas so `oklch()` and
 * `color()` work too. Without a canvas (tests, old engines), hex and rgb only.
 */
export function colorChannels(value: string, doc: Document = document): [number, number, number, number] | null {
  const parsed = parseRgb(value);
  if (parsed) return parsed;
  const ctx = context2d(doc);
  if (!ctx) return null;
  ctx.fillStyle = '#010203';
  ctx.fillStyle = value;
  const first = ctx.fillStyle;
  ctx.fillStyle = '#030201';
  ctx.fillStyle = value;
  if (ctx.fillStyle !== first) return null; // Not a colour: the sentinel survived.
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b, Math.round((a / 255) * 1000) / 1000];
}

/** `#rrggbb` for a colour input, whatever notation the value used. */
export function toHexColor(value: string, doc: Document = document): string | null {
  const channels = colorChannels(value, doc);
  if (!channels) return null;
  const hex = normalizeColor(`rgb(${channels[0]} ${channels[1]} ${channels[2]})`);
  return hex.startsWith('#') ? hex : null;
}

function lengthPx(value: string, el: Element): number | null {
  const length = parseLength(value);
  if (!length) return null;
  const view = el.ownerDocument.defaultView;
  if (length.unit === 'px' || (length.unit === '' && length.n === 0)) return length.n;
  if (length.unit === 'rem') return length.n * Number.parseFloat(view?.getComputedStyle(el.ownerDocument.documentElement).fontSize ?? '16');
  if (length.unit === 'em') return length.n * Number.parseFloat(view?.getComputedStyle(el).fontSize ?? '16');
  return null;
}

/**
 * Up to four custom properties whose current value on `el` equals `to`, so
 * the agent can reach for the project's token instead of a raw number.
 */
export function matchingTokens(el: Element, property: StyleProperty, to: string, index: StyleRuleIndex): string[] {
  if (property.kind !== 'color' && property.kind !== 'length') return [];
  const computed = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!computed) return [];
  const doc = el.ownerDocument;
  const key = (value: string): string | null => {
    if (property.kind === 'color') {
      const channels = colorChannels(value, doc);
      return channels ? channels.join(',') : null;
    }
    const px = lengthPx(value, el);
    return px === null ? null : String(Math.round(px * 100) / 100);
  };
  const wanted = key(to);
  if (wanted === null) return [];
  const found: string[] = [];
  for (const name of index.customProperties) {
    const value = computed.getPropertyValue(name).trim();
    if (value && key(value) === wanted) found.push(name);
    if (found.length === 4) break;
  }
  return found;
}
