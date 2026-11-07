/**
 * Live style previews for the experimental style editor.
 *
 * Edits never touch an element's inline style, which the host's framework may
 * own and rewrite. Each edited element gets a generated attribute, and one
 * stylesheet appended to the document applies the overrides with `!important`
 * under a tripled attribute selector, so ordinary author rules (utilities,
 * modules, CSS-in-JS) lose to the preview. Reverting removes the attributes
 * and the sheet; nothing else on the page changed.
 */
import {
  STYLE_PROPERTY,
  diffStyleValues,
  readStyleValues,
  sameValue,
  type StyleEdit,
  type StyleValues,
} from '../core/style';
import { indexStyleRules, matchingTokens, PREVIEW_SHEET_ATTRIBUTE, styleOrigin } from '../core/style-source';

export const PREVIEW_ATTRIBUTE = 'data-isotone-style';

export type StyleSnapshot = Map<Element, Record<string, string>>;

export interface StylePreview {
  /** Computed values before this preview first touched the element. */
  baseline(el: Element): StyleValues;
  /** Values as shown: the override where there is one, otherwise computed. */
  current(el: Element): StyleValues;
  /** Set or (with null) clear one override. Returns false when the browser rejects the value. */
  set(el: Element, property: string, value: string | null): boolean;
  overrides(el: Element): Readonly<Record<string, string>>;
  /** Elements that have at least one override. */
  edited(): Element[];
  /** Total number of overridden properties. */
  count(): number;
  snapshot(): StyleSnapshot;
  restore(snapshot: StyleSnapshot): void;
  /** Revert one element, or every element. */
  revert(el?: Element): void;
  /** Revert every element not in `keep`. */
  retain(keep: Iterable<Element>): void;
  /** Called after every change, for the panel's summary. */
  subscribe(listener: () => void): () => void;
}

/** Characters that could end a declaration or rule if they ever reached the sheet. */
const UNSAFE_VALUE = /[;{}<>]|!\s*important/i;

export function createStylePreview(doc: Document = document): StylePreview {
  let sheet: HTMLStyleElement | null = null;
  let nextId = 1;
  const ids = new Map<Element, string>();
  const values = new Map<Element, Record<string, string>>();
  const baselines = new WeakMap<Element, StyleValues>();
  const listeners = new Set<() => void>();
  const view = doc.defaultView;

  const computed = (el: Element) => readStyleValues(view?.getComputedStyle(el) ?? { getPropertyValue: () => '' });

  function baseline(el: Element): StyleValues {
    let saved = baselines.get(el);
    if (!saved) {
      // The inspector asks for this as soon as an element is selected, so it
      // is read before any override of ours applies to the element.
      saved = computed(el);
      baselines.set(el, saved);
    }
    return saved;
  }

  function write() {
    const rules: string[] = [];
    for (const [el, props] of values) {
      const entries = Object.entries(props);
      if (!entries.length) continue;
      const id = ids.get(el);
      if (!id) continue;
      const selector = `[${PREVIEW_ATTRIBUTE}="${id}"]`.repeat(3);
      const body = entries.map(([name, value]) => `${name}: ${value} !important;`).join(' ');
      // Transitions would make scrubbing lag behind the pointer.
      rules.push(`${selector} { ${body} transition-duration: 0s !important; }`);
    }
    if (!rules.length) {
      sheet?.remove();
      sheet = null;
      return;
    }
    if (!sheet) {
      sheet = doc.createElement('style');
      sheet.setAttribute(PREVIEW_SHEET_ATTRIBUTE, '');
    }
    // Last in the document, so equal-strength rules resolve to the preview.
    const parent = doc.head ?? doc.documentElement;
    if (sheet.parentNode !== parent || sheet.nextSibling) parent.appendChild(sheet);
    sheet.textContent = rules.join('\n');
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function valid(property: string, value: string): boolean {
    if (UNSAFE_VALUE.test(value)) return false;
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
    try { return CSS.supports(property, value); } catch { return true; }
  }

  function drop(el: Element) {
    values.delete(el);
    ids.delete(el);
    el.removeAttribute(PREVIEW_ATTRIBUTE);
  }

  return {
    baseline,
    current(el) {
      const live = computed(el);
      return { ...live, ...(values.get(el) ?? {}) };
    },
    set(el, property, value) {
      if (!STYLE_PROPERTY.has(property)) return false;
      const before = baseline(el);
      const props = { ...(values.get(el) ?? {}) };
      const next = value?.trim() ?? '';
      if (!next || sameValue(before[property] ?? '', next, property)) delete props[property];
      else if (!valid(property, next)) return false;
      else props[property] = next;
      if (Object.keys(props).length) {
        if (!ids.has(el)) {
          const id = String(nextId++);
          ids.set(el, id);
          el.setAttribute(PREVIEW_ATTRIBUTE, id);
        }
        values.set(el, props);
      } else drop(el);
      write();
      notify();
      return true;
    },
    overrides(el) {
      return values.get(el) ?? {};
    },
    edited() {
      return [...values.keys()];
    },
    count() {
      let total = 0;
      for (const props of values.values()) total += Object.keys(props).length;
      return total;
    },
    snapshot() {
      return new Map([...values].map(([el, props]) => [el, { ...props }]));
    },
    restore(snapshot) {
      for (const el of [...values.keys()]) if (!snapshot.has(el)) drop(el);
      for (const [el, props] of snapshot) {
        if (!el.isConnected) continue;
        baseline(el);
        if (!ids.has(el)) {
          const id = String(nextId++);
          ids.set(el, id);
          el.setAttribute(PREVIEW_ATTRIBUTE, id);
        }
        values.set(el, { ...props });
      }
      write();
      notify();
    },
    revert(el) {
      if (el) {
        if (!values.has(el)) return;
        drop(el);
      } else {
        if (!values.size && !sheet) return;
        for (const edited of [...values.keys()]) drop(edited);
      }
      write();
      notify();
    },
    retain(keep) {
      const kept = new Set(keep);
      let changed = false;
      for (const el of [...values.keys()]) {
        if (!kept.has(el)) { drop(el); changed = true; }
      }
      if (changed) { write(); notify(); }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The structured diff for a note: for every pinned element with overrides,
 * each change with the rule and tokens behind its old value and any tokens
 * that already equal the new one.
 */
export function buildStyleEdits(
  entries: readonly { selector: string; el: Element }[],
  preview: StylePreview,
): StyleEdit[] {
  const edited = entries.filter(({ el }) => Object.keys(preview.overrides(el)).length);
  if (!edited.length) return [];
  const doc = edited[0].el.ownerDocument;
  const index = indexStyleRules(doc);
  return edited.map(({ selector, el }) => {
    const changes = diffStyleValues(preview.baseline(el), preview.overrides(el)).map((change) => {
      const property = STYLE_PROPERTY.get(change.property);
      if (!property) return change;
      const origin = styleOrigin(el, property, index);
      const matches = matchingTokens(el, property, change.to, index);
      return {
        ...change,
        ...(origin?.rule ? { rule: origin.rule } : {}),
        ...(origin?.declared ? { declared: origin.declared } : {}),
        ...(origin?.tokens ? { tokens: origin.tokens } : {}),
        ...(matches.length ? { matches } : {}),
      };
    });
    const classes = Array.from(el.classList).filter(Boolean);
    return { selector, ...(classes.length ? { classes } : {}), changes };
  }).filter((edit) => edit.changes.length);
}
