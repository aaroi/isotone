/** Area selection for select mode (with the experimental style editor on). */
import type { Rect } from './IterationPanel';

/**
 * The outermost page elements lying wholly inside `area` (viewport pixels):
 * dragging across three cards selects the cards, not their contents, and not
 * the section they sit in unless it is inside the area too.
 */
export function elementsInArea(area: Rect): Element[] {
  const inside = new Set<Element>();
  const slack = 2;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (el.closest('[data-isotone]') || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT|LINK|META)$/.test(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.left >= area.left - slack && r.top >= area.top - slack &&
      r.right <= area.left + area.width + slack && r.bottom <= area.top + area.height + slack) inside.add(el);
  }
  let found = [...inside].filter((el) => !el.parentElement || !inside.has(el.parentElement));
  // One container in the area is what a click would pick. When it holds a
  // run of like elements (cards, rows, list items), the area means those.
  let probe = found;
  while (probe.length === 1) {
    const children = Array.from(probe[0].children).filter((child) => inside.has(child));
    if (!children.length) break;
    probe = children;
  }
  if (probe.length > 1 && probe.every((el) => el.tagName === probe[0].tagName)) found = probe;
  return found;
}
