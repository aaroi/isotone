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
