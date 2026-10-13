// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { describeIterationElement, elementAsNode } from '../src/core';

it('describes an element without visiting unrelated DOM subtrees', () => {
  document.body.innerHTML = '<main><button>Selected</button><section><span>Unrelated</span></section></main>';
  const section = document.querySelector('section');
  Object.defineProperty(section, 'children', { get() { throw new Error('Unrelated subtree visited'); } });
  Object.defineProperty(section, 'textContent', { get() { throw new Error('Unrelated text read'); } });
  const button = document.querySelector('button');
  if (!button) throw new Error('Missing fixture button');
  expect(describeIterationElement(elementAsNode(button))).toEqual({
    tag: 'button', text: 'Selected', selector: 'main:nth-child(1) > button:nth-child(1)',
  });
});

it('produces queryable selectors for numeric and framework-generated ids', () => {
  const button = document.createElement('button');
  document.body.replaceChildren(button);
  for (const id of ['123', ':r1:', 'one.two', 'hello world']) {
    button.id = id;
    const descriptor = describeIterationElement(elementAsNode(button));
    expect(document.querySelector(descriptor.selector)).toBe(button);
  }
});

it('separates block children in the pinned text instead of running them together', () => {
  document.body.innerHTML = '<article><p>Active projects</p><strong>12</strong><small style="display: block">+2 this <b>month</b></small></article>';
  const card = document.querySelector('article');
  if (!card) throw new Error('Missing fixture card');
  expect(describeIterationElement(elementAsNode(card)).text).toBe('Active projects 12 +2 this month');
});

it('prefers the browser rendering of the text when it has one', () => {
  document.body.innerHTML = '<div>One<div>Two</div></div>';
  const div = document.querySelector('div') as HTMLElement;
  Object.defineProperty(div, 'innerText', { value: 'One\nTwo' });
  expect(describeIterationElement(elementAsNode(div)).text).toBe('One Two');
});
