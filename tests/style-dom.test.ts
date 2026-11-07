// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { STYLE_PROPERTY } from '../src/core/style';
import { indexStyleRules, PREVIEW_SHEET_ATTRIBUTE, styleOrigin } from '../src/core/style-source';
import { buildStyleEdits, createStylePreview, PREVIEW_ATTRIBUTE } from '../src/react/style-preview';
import { elementsInArea } from '../src/react/select-area';

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

function page(css: string, html: string) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  document.body.innerHTML = html;
}

const property = (name: string) => {
  const found = STYLE_PROPERTY.get(name);
  if (!found) throw new Error(name);
  return found;
};

describe('style origins', () => {
  it('names the rule that wins by specificity, then source order', () => {
    page(`
      .card { padding-top: 8px; }
      #first.card { padding-top: 12px; }
      .card { padding-top: 10px; }
    `, '<div id="first" class="card"></div><div id="second" class="card"></div>');
    const index = indexStyleRules(document);
    expect(styleOrigin(document.getElementById('first') as Element, property('padding-top'), index))
      .toMatchObject({ rule: '#first.card', declared: '12px' });
    expect(styleOrigin(document.getElementById('second') as Element, property('padding-top'), index))
      .toMatchObject({ rule: '.card', declared: '10px' });
  });

  it('prefers important declarations and inline styles over ordinary rules', () => {
    page(`
      .a { color: red !important; }
      #x { color: blue; }
      .b { margin-top: 4px; }
    `, '<p id="x" class="a">x</p><p id="y" class="b" style="margin-top: 9px">y</p>');
    const index = indexStyleRules(document);
    expect(styleOrigin(document.getElementById('x') as Element, property('color'), index)).toMatchObject({ rule: '.a' });
    expect(styleOrigin(document.getElementById('y') as Element, property('margin-top'), index))
      .toMatchObject({ rule: 'style attribute', declared: '9px' });
  });

  it('lets unlayered rules beat layered utilities, as the cascade does', () => {
    page(`
      @layer utilities { .p-4 { padding-left: 16px; } }
      .card { padding-left: 20px; }
    `, '<div id="x" class="card p-4"></div>');
    const index = indexStyleRules(document);
    expect(styleOrigin(document.getElementById('x') as Element, property('padding-left'), index)).toMatchObject({ rule: '.card' });
  });

  it('finds an inherited value on an ancestor and skips Isotone’s own sheets', () => {
    page('.app { font-size: 15px; }', '<main class="app"><p id="x">x</p></main>');
    const own = document.createElement('style');
    own.setAttribute(PREVIEW_SHEET_ATTRIBUTE, '');
    own.textContent = '#x { font-size: 99px; }';
    document.head.append(own);
    const index = indexStyleRules(document);
    expect(styleOrigin(document.getElementById('x') as Element, property('font-size'), index))
      .toMatchObject({ rule: '.app (inherited)', declared: '15px' });
  });

  it('records the custom properties a declared value reads', () => {
    page(':root { --gap: 12px; } .row { margin-bottom: var(--gap); }', '<div id="x" class="row"></div>');
    const origin = styleOrigin(document.getElementById('x') as Element, property('margin-bottom'), indexStyleRules(document));
    expect(origin?.declared).toContain('var(--gap)');
    expect(Object.keys(origin?.tokens ?? {})).toEqual(['--gap']);
  });
});

describe('area selection', () => {
  function place(el: Element, left: number, top: number, width: number, height: number) {
    el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
  }
  it('takes the like elements inside a lone container, and the container among unlike ones', () => {
    document.body.innerHTML = '<section id="row"><article></article><article></article><article></article></section><button id="b"><svg></svg><span>Go</span></button>';
    const row = document.getElementById('row') as Element;
    place(row, 0, 0, 300, 100);
    for (const [i, card] of Array.from(row.querySelectorAll('article')).entries()) place(card, i * 100, 0, 90, 100);
    const button = document.getElementById('b') as Element;
    place(button, 0, 200, 80, 30);
    place(button.querySelector('svg') as Element, 4, 204, 16, 16);
    place(button.querySelector('span') as Element, 24, 204, 40, 20);
    expect(elementsInArea({ left: -5, top: -5, width: 320, height: 120 }).map((el) => el.tagName)).toEqual(['ARTICLE', 'ARTICLE', 'ARTICLE']);
    expect(elementsInArea({ left: -5, top: 195, width: 100, height: 40 })).toEqual([button]);
    expect(elementsInArea({ left: -5, top: -5, width: 320, height: 300 })).toEqual([row, button]);
  });
});

describe('style preview', () => {
  it('overrides through one scoped sheet and reverts completely', () => {
    page('.card { padding-top: 8px; }', '<div id="a" class="card" style="color: red"></div><div id="b" class="card"></div>');
    const a = document.getElementById('a') as Element;
    const b = document.getElementById('b') as Element;
    const preview = createStylePreview(document);
    preview.baseline(a);
    expect(preview.set(a, 'padding-top', '20px')).toBe(true);
    expect(preview.set(b, 'margin-top', '4px')).toBe(true);
    expect(a.getAttribute('style')).toBe('color: red');
    expect(a.hasAttribute(PREVIEW_ATTRIBUTE)).toBe(true);
    const sheet = document.querySelector(`[${PREVIEW_SHEET_ATTRIBUTE}]`);
    expect(sheet?.textContent).toContain('padding-top: 20px !important');
    expect(preview.count()).toBe(2);
    expect(preview.current(a)['padding-top']).toBe('20px');

    // Setting a property back to where it started is no change at all.
    preview.set(b, 'margin-top', preview.baseline(b)['margin-top']);
    expect(b.hasAttribute(PREVIEW_ATTRIBUTE)).toBe(false);

    preview.revert();
    expect(a.hasAttribute(PREVIEW_ATTRIBUTE)).toBe(false);
    expect(document.querySelector(`[${PREVIEW_SHEET_ATTRIBUTE}]`)).toBeNull();
    expect(a.getAttribute('style')).toBe('color: red');
  });

  it('refuses values that could escape their declaration', () => {
    document.body.innerHTML = '<div id="a"></div>';
    const a = document.getElementById('a') as Element;
    const preview = createStylePreview(document);
    expect(preview.set(a, 'color', 'red; } body { display: none')).toBe(false);
    expect(preview.set(a, 'color', 'red !important')).toBe(false);
    expect(preview.set(a, 'not-a-property', '1px')).toBe(false);
    expect(preview.count()).toBe(0);
  });

  it('restores snapshots for undo and drops unpinned elements', () => {
    document.body.innerHTML = '<div id="a"></div><div id="b"></div>';
    const a = document.getElementById('a') as Element;
    const b = document.getElementById('b') as Element;
    const preview = createStylePreview(document);
    preview.set(a, 'width', '10px');
    const snapshot = preview.snapshot();
    preview.set(a, 'width', '20px');
    preview.set(b, 'height', '5px');
    preview.restore(snapshot);
    expect(preview.overrides(a)).toEqual({ width: '10px' });
    expect(preview.edited()).toEqual([a]);
    preview.retain([]);
    expect(preview.count()).toBe(0);
  });

  it('builds the note’s diff with classes and the rule behind each old value', () => {
    page('.card { padding-top: 8px; }', '<div id="a" class="card big"></div>');
    const a = document.getElementById('a') as Element;
    const preview = createStylePreview(document);
    preview.baseline(a);
    preview.set(a, 'padding-top', '24px');
    const [edit] = buildStyleEdits([{ selector: '#a', el: a }], preview);
    expect(edit).toMatchObject({ selector: '#a', classes: ['card', 'big'] });
    expect(edit.changes[0]).toMatchObject({ property: 'padding-top', to: '24px', rule: '.card', declared: '8px' });
    expect(buildStyleEdits([{ selector: '#b', el: document.body }], preview)).toEqual([]);
  });
});
