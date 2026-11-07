// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { HINTS } from '../../src/react/hints';
import { PANEL_CSS } from '../../src/react/styles';

// jsdom has no layout, so this holds hints to the room the panel leaves them at a
// 375px viewport (measured in a browser), with a per-character width a little
// wider than common system UI fonts at that size. See docs/design.md,
// "Hints and instructions".
const ROOM = {
  /** The select-mode cover's text column in a 340px dock, beside the pin and Done. */
  picking: 186,
  /** The floating composer's toolbar between the crosshair and send buttons. */
  floating: 206,
};
const CHAR_WIDTH = { 10: 5.5, 12: 6.6 };
const width = (text: string, size: 10 | 12) => [...text].length * CHAR_WIDTH[size];

function rule(selector: string): CSSStyleDeclaration {
  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  document.head.append(style);
  try {
    const found = Array.from(style.sheet?.cssRules ?? []).find(
      (r): r is CSSStyleRule => 'selectorText' in r && (r as CSSStyleRule).selectorText === selector,
    );
    if (!found) throw new Error(`Missing rule: ${selector}`);
    return found.style;
  } finally {
    style.remove();
  }
}

describe('hints', () => {
  it('fit on one line in the select-mode cover, for pointer and touch', () => {
    for (const copy of [HINTS.picking.pointer, HINTS.picking.touch]) {
      expect(width(copy.title, 12), copy.title).toBeLessThanOrEqual(ROOM.picking);
      expect(width(copy.pause, 10), copy.pause).toBeLessThanOrEqual(ROOM.picking);
    }
  });

  it('fit on one line in the floating composer, for pointer and touch', () => {
    for (const copy of [HINTS.floating.pointer, HINTS.floating.touch]) {
      expect(width(copy, 10), copy).toBeLessThanOrEqual(ROOM.floating);
    }
  });

  it('stay on one line and are never clipped or ellipsized', () => {
    for (const selector of ['.isotone-picking span', '.isotone-picking small', '.isotone-float-hint']) {
      const style = rule(selector);
      expect(style.whiteSpace, selector).toBe('nowrap');
      expect(style.textOverflow, selector).toBe('');
      expect(style.overflow, selector).toBe('');
    }
    // The floating hint takes the room it needs rather than shrinking below its text.
    expect(rule('.isotone-float-hint').flexShrink).toBe('0');
  });
});
