// @vitest-environment jsdom
/**
 * A pin has to mean one element, for the panel finding it again and for the
 * agent reading the note. Both used to rest on a path four levels deep, which
 * a repeated layout matches more than once.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/cli/run';
import { describeIsotoneElement, elementAsNode } from '../../src/core/element';
import { resolveElementSource } from '../../src/core/element';
import { applyKnobValues, knobDelta } from '../../src/core/variants';
import { notesResponse } from '../../src/node/notes/handler';
import { readNotes } from '../../src/node/notes/store';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const nest = (inner: string, depth: number): string => (depth === 0 ? inner : `<div>${nest(inner, depth - 1)}</div>`);

it('does not resolve to an earlier element with the same shape', () => {
  // The toolbar's first button and the tab's first button end the same way.
  document.body.innerHTML = `<header>${nest('<button>All workspaces</button>', 5)}</header><main>${nest('<button>Changes</button>', 5)}</main>`;
  const changes = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Changes');
  if (!changes) throw new Error('Missing fixture');
  const { selector } = describeIsotoneElement(elementAsNode(changes));
  expect(document.querySelectorAll(selector)).toHaveLength(1);
  expect(document.querySelector(selector)).toBe(changes);
});

it('roots a path at the body when it still matches elsewhere', () => {
  document.body.innerHTML = '<section><main><button>Nested</button></main></section><main><button>Top</button></main>';
  const top = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Top');
  if (!top) throw new Error('Missing fixture');
  expect(document.querySelector(describeIsotoneElement(elementAsNode(top)).selector)).toBe(top);
});

it('climbs past an id the page repeats', () => {
  document.body.innerHTML = '<div><span id="dup">a</span></div><div><span id="dup">b</span></div>';
  const second = document.querySelectorAll('span')[1] as Element;
  expect(document.querySelector(describeIsotoneElement(elementAsNode(second)).selector)).toBe(second);
});

it('says which element it is in terms an agent can search for', () => {
  document.body.innerHTML = `
    <section aria-label="Usage"><div data-testid="tabs">
      <h2>Spend</h2>
      <button role="tab" class="tab tab-on" data-state="active">Changes</button>
      <button aria-label="Close"><svg></svg></button>
    </div></section>`;
  const [tab, icon] = document.querySelectorAll('button') as unknown as [Element, Element];
  const described = describeIsotoneElement(elementAsNode(tab));
  expect(described.attributes).toEqual({ role: 'tab', class: 'tab tab-on', 'data-state': 'active' });
  expect(described.within).toEqual(['<section> labelled "Usage"', '<div data-testid="tabs">']);
  expect(described.near).toBeUndefined();
  expect(describeIsotoneElement(elementAsNode(icon)).near).toContain('Changes');
});

it('does not credit the element to a heading that comes after it', () => {
  document.body.innerHTML = '<main><div><button>New project</button></div><section><h2>Projects</h2></section></main>';
  const button = document.querySelector('button') as Element;
  expect(describeIsotoneElement(elementAsNode(button)).within).toBeUndefined();
  document.body.innerHTML = '<main><section><h2>Projects</h2></section><h2>Team</h2><button>Add</button></main>';
  const add = document.querySelector('button') as Element;
  expect(describeIsotoneElement(elementAsNode(add)).within).toEqual(['<main> headed "Team"']);
});

it('names the React components around it, skipping internal names', () => {
  document.body.innerHTML = '<button>Changes</button>';
  const button = document.querySelector('button') as Element;
  function TabButton() {}
  function UsageTabs() {}
  Object.assign(button, {
    __reactFiber$abc: {
      type: 'button',
      _debugSource: { fileName: 'src/tabs.tsx', lineNumber: 12 },
      return: { type: TabButton, return: { type: { name: 'minified_x' }, return: { type: UsageTabs, return: null } } },
    },
  });
  const described = describeIsotoneElement(elementAsNode(button));
  expect(described.component).toEqual(['UsageTabs', 'TabButton']);
  expect(described.source).toBe('src/tabs.tsx:12');
});

it('reads the JSX callsite from React 19 debug stacks', () => {
  document.body.innerHTML = '<button>Changes</button>';
  const button = document.querySelector('button') as Element;
  function TabButton() {}
  const vite = [
    'Error: react-stack-top-frame',
    '    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b:250:33)',
    '    at TabButton (http://localhost:5173/src/tabs.tsx?t=1700000000:12:7)',
    '    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=1a2b:4100:24)',
  ].join('\n');
  Object.assign(button, { __reactFiber$abc: { type: 'button', _debugStack: { stack: vite }, return: { type: TabButton, return: null } } });
  expect(describeIsotoneElement(elementAsNode(button)).source).toBe('/src/tabs.tsx:12');

  const next = ['Error: react-stack-top-frame', '    at TabButton (webpack-internal:///(app-pages-browser)/./src/app/tabs.tsx:30:5)'].join(
    '\n',
  );
  Object.assign(button, { __reactFiber$abc: { type: 'button', _debugStack: { stack: next }, return: null } });
  expect(describeIsotoneElement(elementAsNode(button)).source).toBe('src/app/tabs.tsx:30');

  const fs = ['Error', 'TabButton@http://localhost:5173/@fs/Users/me/app/src/tabs.tsx:8:3'].join('\n');
  Object.assign(button, { __reactFiber$abc: { type: 'button', _debugStack: fs, return: null } });
  expect(describeIsotoneElement(elementAsNode(button)).source).toBe('/Users/me/app/src/tabs.tsx:8');

  // React 18's field still wins when present.
  Object.assign(button, {
    __reactFiber$abc: {
      type: 'button',
      _debugSource: { fileName: 'src/old.tsx', lineNumber: 3 },
      _debugStack: { stack: vite },
      return: null,
    },
  });
  expect(describeIsotoneElement(elementAsNode(button)).source).toBe('src/old.tsx:3');
});

it('maps a React 19 callsite back to the original line through the module source map', async () => {
  document.body.innerHTML = '<button>Changes</button>';
  const button = document.querySelector('button') as Element;
  const stack = ['Error: react-stack-top-frame', '    at TabButton (http://localhost:5173/src/tabs.tsx?t=1:2:7)'].join('\n');
  Object.assign(button, { __reactFiber$abc: { type: 'button', _debugStack: { stack }, return: null } });
  expect(describeIsotoneElement(elementAsNode(button)).source).toBe('/src/tabs.tsx:2');
  // Generated line 2 maps to line 10 of tabs.tsx.
  const map = btoa(JSON.stringify({ version: 3, sources: ['tabs.tsx'], mappings: ';AASA' }));
  const fetch = vi.fn(async () => ({
    text: async () => `import x;\njsxDEV("button");\n//# sourceMappingURL=data:application/json;base64,${map}\n`,
  }));
  vi.stubGlobal('fetch', fetch);
  try {
    expect(await resolveElementSource(button)).toBe('/src/tabs.tsx:10');
    expect(fetch).toHaveBeenCalledWith('http://localhost:5173/src/tabs.tsx?t=1');
    // React 18's own field is already exact: nothing to fetch.
    Object.assign(button, { __reactFiber$abc: { type: 'button', _debugSource: { fileName: 'a.tsx', lineNumber: 1 }, return: null } });
    expect(await resolveElementSource(button)).toBeUndefined();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps the context through the store and prints it for the agent', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-element-')));
  dirs.push(root);
  const file = join(root, '.iteration-feedback.json');
  const element = {
    tag: 'button',
    text: 'Changes',
    selector: `body > ${'div:nth-child(1) > '.repeat(40)}button:nth-child(1)`,
    component: ['UsageTabs', 'TabButton'],
    source: 'src/tabs.tsx:12',
    within: ['<section> labelled "Usage"'],
    attributes: { role: 'tab', ['__proto__']: 'x' },
    rect: { x: 934, y: 292, w: 83, h: 35 },
    near: 'x',
  };
  const res = notesResponse(file, {
    method: 'POST',
    url: '/',
    body: { id: 'n1', route: '/', feedback: 'hi', element, elements: [element] },
  });
  expect(res.status).toBeLessThan(300);
  const [note] = readNotes(file);
  expect(note?.element?.selector).toBe(element.selector);
  expect(note?.elements?.[0]?.rect).toEqual(element.rect);

  let text = '';
  const stream = {
    write: (chunk: string) => {
      text += chunk;
    },
  };
  await runCli(['--all'], { cwd: root, stdout: stream, stderr: stream });
  for (const part of [
    'component: UsageTabs > TabButton',
    'source: src/tabs.tsx:12',
    'labelled "Usage"',
    'role="tab"',
    'at: 934,292 83×35',
  ]) {
    expect(text).toContain(part);
  }
});

describe('select knobs on the page', () => {
  it('writes the attribute and property, and tells the page once per change', () => {
    const axis = {
      kind: 'select' as const,
      id: 'ticks',
      label: 'Ticks',
      defaultOption: 'lines',
      options: [
        { id: 'lines', label: 'Lines' },
        { id: 'dots', label: 'Dots' },
      ],
    };
    const root = document.createElement('html');
    const seen: unknown[] = [];
    root.addEventListener('isotone:knob', (event) => seen.push((event as CustomEvent).detail));
    applyKnobValues([axis], { ticks: 'dots' }, root);
    applyKnobValues([axis], { ticks: 'dots' }, root);
    expect(root.getAttribute('data-knob-ticks')).toBe('dots');
    expect(root.style.getPropertyValue('--knob-ticks')).toBe('dots');
    expect(seen).toEqual([{ id: 'ticks', value: 'dots' }]);
    applyKnobValues([axis], {}, root);
    expect(root.hasAttribute('data-knob-ticks')).toBe(false);
    expect(seen).toEqual([
      { id: 'ticks', value: 'dots' },
      { id: 'ticks', value: null },
    ]);
    expect(knobDelta([axis], { ticks: 'dots' })[0]?.shown).toBe('Dots');
  });
});
