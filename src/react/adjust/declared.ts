/**
 * Where a property is set today: the page's own rule and the value it wrote
 * there (`var(--space-4)`, `1rem`), or the element's style attribute. A
 * computed value says what to change from; this says where. Best effort: it
 * reads the stylesheets the page lets it read and ranks matching rules by
 * specificity and order, without cascade layers or `!important`. It is a
 * pointer for the agent to check, never something the preview depends on.
 */

/** Rules read before giving up: enough for an app's own CSS, bounded for a framework's whole output. */
const MAX_RULES = 8000;

export interface Declared {
  /** The rule's selector as written, or `inline` for the style attribute. */
  rule: string;
  /** The value as written there. */
  value: string;
}

/** The declarations that can set a field's property, most specific name first. */
const SOURCES: Record<string, readonly string[]> = {
  'padding-block': ['padding-block', 'padding-top', 'padding'],
  'padding-inline': ['padding-inline', 'padding-left', 'padding'],
  'margin-block': ['margin-block', 'margin-top', 'margin'],
  'margin-inline': ['margin-inline', 'margin-left', 'margin'],
  gap: ['gap', 'row-gap', 'grid-gap'],
  'line-height': ['line-height', 'font'],
  'font-size': ['font-size', 'font'],
  'font-weight': ['font-weight', 'font'],
  'background-color': ['background-color', 'background'],
  'border-radius': ['border-radius', 'border-top-left-radius'],
};

/** A rough specificity, as one comparable number: ids, then classes and attributes, then tags. */
function specificity(selector: string): number {
  const bare = selector.replace(/:(?:not|is|where|has)\(/g, ' (');
  const ids = (bare.match(/#(?:\\.|[\w-])+/g) ?? []).length;
  const classes = (bare.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (bare.match(/(?:^|[\s>+~(])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10_000 + classes * 100 + tags;
}

/** A selector list split at its own commas, not those inside `:is(a, b)` or `[title="a,b"]`. */
function topLevelParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i] as string;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(list.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function declaredIn(style: CSSStyleDeclaration, names: readonly string[]): string | null {
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) return value;
  }
  return null;
}

/** Where each of `properties` is set on `element`, for those that can be found. */
export function findDeclared(element: Element, properties: readonly string[]): Record<string, Declared> {
  const found: Record<string, Declared & { weight: number }> = {};
  const view = element.ownerDocument.defaultView;
  let seen = 0;
  const matches = (part: string) => {
    try {
      return element.matches(part);
    } catch {
      // A pseudo-element or a selector this browser does not know matches nothing.
      return false;
    }
  };
  const visit = (rules: CSSRuleList | undefined) => {
    for (const rule of Array.from(rules ?? [])) {
      if (seen++ > MAX_RULES) return;
      const group = rule as CSSGroupingRule & { media?: MediaList };
      const styled = rule as CSSStyleRule;
      if (typeof styled.selectorText === 'string') {
        // The part of a selector list that matches is the one whose specificity counts.
        const matched = topLevelParts(styled.selectorText)
          .filter(matches)
          .sort((x, y) => specificity(y) - specificity(x))[0];
        if (matched) {
          for (const property of properties) {
            const value = declaredIn(styled.style, SOURCES[property] ?? [property]);
            const weight = specificity(matched);
            // Later wins a tie, as in the cascade.
            if (value && weight >= (found[property]?.weight ?? -1)) found[property] = { rule: styled.selectorText, value, weight };
          }
        }
      }
      // Rules nested in a media query count only while it applies. Rules nested in a style rule are written
      // relative to it (`&:hover`, `.child`) and would match on their own what they do not style: not read.
      if (
        typeof styled.selectorText !== 'string' &&
        group.cssRules &&
        (!group.media || !view?.matchMedia || view.matchMedia(group.media.mediaText).matches)
      )
        visit(group.cssRules);
    }
  };
  for (const sheet of Array.from(element.ownerDocument.styleSheets)) {
    // The panel's own preview is not where the page sets anything.
    if ((sheet.ownerNode as Element | null)?.hasAttribute?.('data-isotone-adjust')) continue;
    try {
      visit(sheet.cssRules);
    } catch {
      // A stylesheet from another origin cannot be read; its rules are simply not named.
    }
  }
  // Past the cap the rules not read are the later ones, which win: better to name nothing than the loser.
  const complete = seen <= MAX_RULES;
  const inline = (element as HTMLElement).style;
  const out: Record<string, Declared> = {};
  for (const property of properties) {
    const own = inline ? declaredIn(inline, SOURCES[property] ?? [property]) : null;
    const rule = found[property];
    if (own) out[property] = { rule: 'inline', value: own };
    else if (rule && complete) out[property] = { rule: rule.rule, value: rule.value };
  }
  return out;
}
