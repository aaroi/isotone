import { expect, it } from 'vitest';
import { describeIsotoneElement, elementAsNode } from '../../src/core/element';

it('describes an element without visiting unrelated DOM subtrees', () => {
  document.body.innerHTML = '<main><button>Selected</button><section><span>Unrelated</span></section></main>';
  const section = document.querySelector('section');
  Object.defineProperty(section, 'children', {
    get() {
      throw new Error('Unrelated subtree visited');
    },
  });
  Object.defineProperty(section, 'textContent', {
    get() {
      throw new Error('Unrelated text read');
    },
  });
  const button = document.querySelector('button');
  if (!button) throw new Error('Missing fixture button');
  expect(describeIsotoneElement(elementAsNode(button))).toEqual({
    tag: 'button',
    text: 'Selected',
    selector: 'main:nth-child(1) > button:nth-child(1)',
  });
});

it('produces queryable selectors for numeric and framework-generated ids', () => {
  const button = document.createElement('button');
  document.body.replaceChildren(button);
  for (const id of ['123', ':r1:', 'one.two', 'hello world']) {
    button.id = id;
    const descriptor = describeIsotoneElement(elementAsNode(button));
    expect(document.querySelector(descriptor.selector)).toBe(button);
  }
});

it('separates block children in the pinned text instead of running them together', () => {
  document.body.innerHTML =
    '<article><p>Active projects</p><strong>12</strong><small style="display: block">+2 this <b>month</b></small></article>';
  const card = document.querySelector('article');
  if (!card) throw new Error('Missing fixture card');
  expect(describeIsotoneElement(elementAsNode(card)).text).toBe('Active projects 12 +2 this month');
});

it('prefers the browser rendering of the text when it has one', () => {
  document.body.innerHTML = '<div>One<div>Two</div></div>';
  const div = document.querySelector('div') as HTMLElement;
  Object.defineProperty(div, 'innerText', { value: 'One\nTwo' });
  expect(describeIsotoneElement(elementAsNode(div)).text).toBe('One Two');
});

it('keeps the case of SVG tags, so the selector finds the element again', () => {
  document.body.innerHTML =
    '<svg><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><foreignObject><p>Hi</p></foreignObject></svg>';
  for (const target of [document.querySelector('stop'), document.querySelector('foreignObject p')] as Element[]) {
    const { selector } = describeIsotoneElement(elementAsNode(target), 8);
    expect(document.querySelector(selector)).toBe(target);
  }
});

it('records the computed styles a painted element differs by, with colours as hex', () => {
  document.body.innerHTML =
    '<button style="display: flex; gap: 8px; padding: 8px 16px; font-size: 14px; font-weight: 600; color: rgb(17, 17, 17); background-color: rgb(255, 0, 128); border-radius: 6px; margin: 0px; position: static; opacity: 1">Save</button>';
  const button = document.querySelector('button') as HTMLElement;
  button.getBoundingClientRect = () => ({ left: 10, top: 20, width: 80, height: 32 }) as DOMRect;
  const { styles } = describeIsotoneElement(elementAsNode(button));
  expect(styles).toMatchObject({
    display: 'flex',
    gap: '8px',
    padding: '8px 16px',
    'font-size': '14px',
    'font-weight': '600',
    color: '#111111',
    'background-color': '#ff0080',
    'border-radius': '6px',
  });
  // Values that say nothing are left out.
  for (const name of ['margin', 'position', 'opacity', 'box-shadow', 'z-index']) expect(styles).not.toHaveProperty(name);
});

it('records no styles for an element that is not painted', () => {
  document.body.innerHTML = '<p style="font-size: 20px">Hidden</p>';
  expect(describeIsotoneElement(elementAsNode(document.querySelector('p') as Element))).not.toHaveProperty('styles');
});
