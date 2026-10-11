// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { INSTRUMENT_MATERIAL, PALETTES, PALETTE_TOKEN_NAMES } from '../src/react/appearance';
import { PANEL_CSS } from '../src/react/styles';

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
        if (!/^\.iso-iter-root\[data-theme=['"][\w-]+['"]\]$/.test(selector)) {
          violations.push('separate component or state rule');
        }
        const declaration = (rule as CSSStyleRule).style;
        for (let i = 0; i < declaration.length; i++) {
          const property = declaration[i];
          if (!PALETTE_TOKEN_NAMES.has(property) && property !== 'color-scheme') violations.push(property);
        }
      }
    }
    visit(style.sheet.cssRules);
    return violations;
  } finally { style.remove(); }
}

describe('theme boundary', () => {
  it('keeps themes on the same Instrument component and state rules', () => {
    expect(themeViolations(PANEL_CSS)).toEqual([]);
  });

  it('catches direct, token-based and responsive layout drift and separate control states', () => {
    expect(themeViolations(`
      .iso-iter-root[data-appearance='retired'] { padding: 8px; --iso-rail-gap: 12px; }
      @media (max-width: 600px) { .iso-iter-root[data-theme='light'] { width: 90px; --iso-swatch-radius: 50%; } }
      .iso-iter-root[data-appearance='retired'] button:hover { background: red; }
      .iso-iter-root[data-theme='light'] .iso-iter-seg[aria-pressed='true'] { box-shadow: none; }
    `)).toEqual(expect.arrayContaining(['padding', '--iso-rail-gap', '--iso-swatch-radius', 'width', 'background', 'box-shadow', 'separate component or state rule', 'retired appearance override']));
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
        for (const [, ref] of values[key].matchAll(/var\(--iso-([\w-]+)\)/g)) resolve(ref, [...chain, key]);
      }
      for (const key of Object.keys(values)) resolve(key);
    }
  });
});
