/**
 * The style editor's live preview: one stylesheet in the page's head, with a
 * rule per pinned element under that element's own selector. Nothing on the
 * host's elements is touched, so a re-render cannot drop a preview and
 * removing the stylesheet removes every trace of it.
 */
import { isStyleProperty, isStyleValue, type StyleEdit } from '../../core/style-edits';

const MARK = 'data-isotone-adjust';

/**
 * Two id-weight `:not()`s lift the rule over the page's own selectors, and
 * `!important` over its ordinary declarations. A page's own `!important` on a
 * stronger selector, in any cascade layer, or on the element's style attribute
 * still wins: the
 * field then shows a change the page does not, which the reviewer can see.
 */
const BOOST = ':not(#\\:isotone):not(#\\:isotone)';

/** Whether the browser takes the value for the property; a browser that cannot say is trusted on its shape alone. */
export function supportsValue(property: string, value: string): boolean {
  if (!isStyleProperty(property) || !isStyleValue(value)) return false;
  const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
  return typeof css?.supports === 'function' ? css.supports(property, value) : true;
}

/** The stylesheet text for a set of edits; values that cannot be one declaration are left out. */
export function previewCss(edits: readonly StyleEdit[]): string {
  return edits
    .map(({ selector, changes }) => {
      const body = changes
        .filter((change) => isStyleProperty(change.property) && isStyleValue(change.to))
        .map((change) => `${change.property}:${change.to} !important`)
        .join(';');
      // A selector that could close the rule is not one of ours. The page's own transitions are held still:
      // a value being typed or scrubbed should land at once, not ease in over the page's two seconds.
      return body && !/[{}<]/.test(selector) ? `${selector}${BOOST}{${body};transition:none !important}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Show these edits on the page, replacing what was shown; none removes the stylesheet. */
export function applyPreview(doc: Document, edits: readonly StyleEdit[]): void {
  const css = previewCss(edits);
  let sheet = doc.head.querySelector<HTMLStyleElement>(`style[${MARK}]`);
  if (!css) {
    sheet?.remove();
    return;
  }
  if (!sheet) {
    sheet = doc.createElement('style');
    sheet.setAttribute(MARK, '');
    doc.head.append(sheet);
  }
  if (sheet.textContent !== css) sheet.textContent = css;
}

/** Run `read` with the preview switched off, so computed styles are the page's own. */
export function withoutPreview(doc: Document, read: () => void): void {
  const sheet = doc.head.querySelector<HTMLStyleElement>(`style[${MARK}]`);
  if (!sheet) {
    read();
    return;
  }
  // `media` rather than `disabled`: it turns the rules off without the sheet leaving the document.
  const media = sheet.media;
  sheet.media = 'not all';
  try {
    read();
  } finally {
    sheet.media = media;
  }
}
