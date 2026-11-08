// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { INSTRUMENT_MATERIAL, PALETTES, PALETTE_TOKEN_NAMES } from '../../src/react/appearance';
import { PANEL_CSS } from '../../src/react/styles';

// Themes set root-level palette tokens only. Components and states cannot
// fork, even through a media query or an indirect spacing-token override.
function themeViolations(css: string): string[] {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  try {
    if (!style.sheet) throw new Error('Stylesheet did not parse');
    const violations: string[] = [];
    function visit(rules: CSSRuleList) {
      for (const rule of Array.from(rules)) {
        if ('cssRules' in rule) visit(rule.cssRules as CSSRuleList);
        if (!('selectorText' in rule) || !('style' in rule)) continue;
        const selector = String(rule.selectorText);
        if (/data-appearance/.test(selector)) violations.push('retired appearance override');
        if (!/data-(appearance|theme)/.test(selector)) continue;
        if (!/^\.isotone-root\[data-theme=['"][\w-]+['"]\]$/.test(selector)) {
          violations.push('separate component or state rule');
        }
        const declaration = (rule as CSSStyleRule).style;
        for (const property of Array.from(declaration)) {
          if (!PALETTE_TOKEN_NAMES.has(property) && property !== 'color-scheme') violations.push(property);
        }
      }
    }
    visit(style.sheet.cssRules);
    return violations;
  } finally {
    style.remove();
  }
}

describe('theme boundary', () => {
  it('keeps themes on the same Instrument component and state rules', () => {
    expect(themeViolations(PANEL_CSS)).toEqual([]);
  });

  it('catches direct, token-based and responsive layout drift and separate control states', () => {
    expect(
      themeViolations(`
      .isotone-root[data-appearance='retired'] { padding: 8px; --iso-rail-gap: 12px; }
      @media (max-width: 600px) { .isotone-root[data-theme='light'] { width: 90px; --iso-swatch-radius: 50%; } }
      .isotone-root[data-appearance='retired'] button:hover { background: red; }
      .isotone-root[data-theme='light'] .isotone-seg[aria-pressed='true'] { box-shadow: none; }
    `),
    ).toEqual(
      expect.arrayContaining([
        'padding',
        '--iso-rail-gap',
        '--iso-swatch-radius',
        'width',
        'background',
        'box-shadow',
        'separate component or state rule',
        'retired appearance override',
      ]),
    );
  });

  it('requires complete contracts with resolvable, non-circular paint tokens in both themes', () => {
    const paletteKeys = Object.keys(PALETTES.dark).sort();
    for (const palette of Object.values(PALETTES)) {
      expect(Object.keys(palette).sort()).toEqual(paletteKeys);
      const values: Record<string, string> = { ...palette, ...INSTRUMENT_MATERIAL };
      function resolve(key: string, chain: string[] = []): void {
        if (/^zinc-(50|100|200|300|400|500|600|700|800|900|950)$/.test(key)) return;
        expect(chain, `circular token: ${key}`).not.toContain(key);
        expect(values[key], `missing token: ${key}`).toBeDefined();
        for (const [, ref = ''] of (values[key] ?? '').matchAll(/var\(--iso-([\w-]+)\)/g)) resolve(ref, [...chain, key]);
      }
      for (const key of Object.keys(values)) resolve(key);
    }
  });
});

describe('host isolation', () => {
  it('does not inherit direction or text styling from an RTL, styled host page', () => {
    const style = document.createElement('style');
    style.textContent = `body { direction: rtl; text-transform: uppercase; word-spacing: 4px; text-indent: 2em; }\n${PANEL_CSS}`;
    document.head.append(style);
    const root = document.createElement('div');
    root.className = 'isotone-root';
    document.body.append(root);
    try {
      const computed = getComputedStyle(root);
      expect(computed.direction).toBe('ltr');
      expect(computed.textTransform).toBe('none');
      expect(computed.wordSpacing).toBe('normal');
      expect(computed.textIndent).toBe('0px');
    } finally {
      root.remove();
      style.remove();
    }
  });
});

function selectors(css: string): string[] {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  try {
    const found: string[] = [];
    const visit = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if ('cssRules' in rule) visit(rule.cssRules as CSSRuleList);
        if ('selectorText' in rule) found.push(...String(rule.selectorText).split(','));
      }
    };
    if (style.sheet) visit(style.sheet.cssRules);
    return found.map((selector) => selector.trim());
  } finally {
    style.remove();
  }
}

describe('input modality', () => {
  // The root flips data-instant on the first key after a click and back on the next press. A rule that reaches
  // every descendant or tag restyles thousands of elements on the stress page and stalls the host's own inputs.
  it('makes only named surfaces instant, never every descendant', () => {
    const instant = selectors(PANEL_CSS).filter((selector) => selector.includes('data-instant'));
    expect(instant.length).toBeGreaterThan(0);
    for (const selector of instant) expect(selector).toMatch(/\[data-instant='true'\] \.isotone-[\w-]+$/);
  });
});

describe('variants list', () => {
  // A label of one long word used to make its segment as wide as the word, so the list scrolled sideways.
  it('keeps an option no wider than its row and the list from scrolling sideways', () => {
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    document.head.append(style);
    const root = document.createElement('div');
    root.className = 'isotone-root';
    root.innerHTML = '<div class="isotone-vars-body"><div class="isotone-segs"><div class="isotone-opt isotone-opt-seg"></div></div></div>';
    document.body.append(root);
    try {
      const body = getComputedStyle(root.querySelector('.isotone-vars-body') as Element);
      expect([body.overflowX, body.overflowY]).toEqual(['hidden', 'auto']);
      const option = getComputedStyle(root.querySelector('.isotone-opt-seg') as Element);
      expect([option.minWidth, option.maxWidth]).toEqual(['auto', '100%']);
    } finally {
      root.remove();
      style.remove();
    }
  });
});

describe('forced colors', () => {
  // High contrast drops shadows and author colours, which drew the selection and the slider.
  it('marks selections, swatches and sliders with system colours', () => {
    const block = PANEL_CSS.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const forced = selectors(block);
    for (const selector of [
      ".isotone-seg[aria-checked='true']",
      ".isotone-thumb[aria-checked='true']",
      ".isotone-swatch[aria-checked='true']",
      '.isotone-range::-webkit-slider-thumb',
      '.isotone-range::-webkit-slider-runnable-track',
    ])
      expect(forced).toContain(selector);
    expect(block).toMatch(/Highlight/);
  });
});
