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
import { createVariant } from '../../src/node/variants';
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

describe('within: the titles around a pinned element', () => {
  /** `within` for the element whose text is `text`. */
  const within = (html: string, text: string) => {
    document.body.innerHTML = html;
    const pinned = [...document.body.querySelectorAll('*')].find((node) => node.textContent === text && !node.children.length);
    if (!pinned) throw new Error(`Missing fixture: ${text}`);
    return describeIsotoneElement(elementAsNode(pinned)).within;
  };

  it('credits an ancestor with its own heading, not the card inside it that holds the element', () => {
    expect(
      within('<main><h1>Simple pricing</h1><section class="card"><h2>Pro</h2><button>Get started</button></section></main>', 'Get started'),
    ).toEqual(['<main> headed "Simple pricing"', '<section> headed "Pro"']);
    // A header holding the element titles itself; its parent gets nothing from it.
    expect(within('<div><header><h1>Acme</h1><button>Menu</button></header></div>', 'Menu')).toEqual(['<header> headed "Acme"']);
    // A link inside the heading is still its text.
    expect(within('<main><h2><a href="/docs">Docs</a></h2><div><button>Read</button></div></main>', 'Read')).toEqual([
      '<main> headed "Docs"',
    ]);
  });

  it('takes a heading from a header or hgroup before the element, never over a heading of its own', () => {
    expect(
      within('<main><header><h1>Billing</h1><nav><a href="/">Back</a></nav></header><div><button>Upgrade</button></div></main>', 'Upgrade'),
    ).toEqual(['<main> headed "Billing"']);
    expect(
      within('<section><header><div class="row"><h2>Team</h2></div></header><ul><li><button>Remove</button></li></ul></section>', 'Remove'),
    ).toEqual(['<section> headed "Team"']);
    expect(within('<section><hgroup><h2>Plans</h2><p>Monthly</p></hgroup><button>Compare</button></section>', 'Compare')).toEqual([
      '<section> headed "Plans"',
    ]);
    expect(
      within('<section><h2>Members</h2><header><h3>Admins</h3></header><div><button>Invite</button></div></section>', 'Invite'),
    ).toEqual(['<section> headed "Members"']);
  });

  it('borrows nothing from a card, column or wrapper beside the element', () => {
    const cards =
      '<main><div class="grid"><div class="card"><h3>Free</h3><a>Start free</a></div><div class="card featured"><h3>Pro</h3><a>Get Pro</a></div><div class="card"><span>Team</span><a>Get Team</a></div></div></main>';
    expect(within(cards, 'Get Team')).toBeUndefined();
    const feature = (title: string, text: string) => `<div class="feature"><svg></svg><h3>${title}</h3><span>${text}</span></div>`;
    const grid = `<main>${feature('Fast', 'Quick builds')}${feature('Secure', 'Encrypted')}${feature('Private', 'Yours alone')}</main>`;
    expect(within(grid, 'Yours alone')).toEqual(['<div> headed "Private"']);
    const sidebar =
      '<div class="layout"><div class="sidebar"><h2>Filters</h2><label>Size</label></div><div class="content"><button>Load more</button></div></div>';
    expect(within(sidebar, 'Load more')).toBeUndefined();
    const stats =
      '<div class="dash"><div class="stat"><h3>Revenue</h3><p>$1</p></div><div class="panel"><button>Export</button></div></div>';
    expect(within(stats, 'Export')).toBeUndefined();
    expect(within('<main><section><h2>Free</h2></section><div><button>Get started</button></div></main>', 'Get started')).toBeUndefined();
    // A card header that is a plain div is a wrapper like any other: no label beats a wrong one.
    const card =
      '<div class="card"><div class="card-header"><h3>Team</h3></div><div class="card-content"><button>Invite</button></div></div>';
    expect(within(card, 'Invite')).toBeUndefined();
  });

  it('prefers the label a block names with aria-labelledby, then aria-label', () => {
    expect(
      within(
        '<p id="a">Team</p><p id="b">plan</p><section aria-labelledby="a b" aria-label="Plan"><h3>Monthly</h3><button>Start</button></section>',
        'Start',
      ),
    ).toEqual(['<section> labelled "Team plan"']);
    expect(
      within('<section aria-labelledby="missing" aria-label="Plan"><h3>Monthly</h3><button>Start</button></section>', 'Start'),
    ).toEqual(['<section> labelled "Plan"']);
    // Inside a shadow root the ids resolve there.
    document.body.innerHTML = '<div id="host"></div>';
    const shadow = (document.getElementById('host') as Element).attachShadow({ mode: 'open' });
    shadow.innerHTML = '<p id="t">Settings</p><section aria-labelledby="t"><button>Save</button></section>';
    expect(describeIsotoneElement(elementAsNode(shadow.querySelector('button') as Element)).within).toEqual([
      '<section> labelled "Settings"',
    ]);
  });
});

describe('the React components that wrote the element', () => {
  const pin = (fiber: object) => {
    document.body.innerHTML = '<button>Get started</button>';
    const button = document.querySelector('button') as Element;
    Object.assign(button, { __reactFiber$abc: fiber });
    return button;
  };
  const component = (name: string) => {
    const type = () => {};
    Object.defineProperty(type, 'name', { value: name });
    return type;
  };
  /** A React 19 creation stack: the call that made the element, then where it was written. */
  const made = (...frames: string[]) => ({ stack: ['Error: react-stack-top-frame', ...frames.map((f) => `    at ${f}`)].join('\n') });
  const reactBottom = 'Object.react_stack_bottom_frame (http://localhost:3000/_next/static/chunks/react-dom_cjs_1.js:2859:93)';

  const next = (file: string) => `webpack-internal:///(app-pages-browser)/./${file}`;

  it('names the page a framework created, and stops at the framework', () => {
    // Next with webpack: ClientPageRoot is served from node_modules, so the walk ends there.
    const root = {
      type: component('ClientPageRoot'),
      _debugStack: made(`fakeJSXCallSite (${next('node_modules/next/dist/compiled/react-server-dom-webpack/client.js')}:1:1)`),
      _debugOwner: null,
    };
    const page = {
      type: component('Pricing'),
      _debugStack: made(
        `jsx (${next('node_modules/next/dist/compiled/react/jsx-runtime.js')}:1:1)`,
        `ClientPageRoot (${next('node_modules/next/dist/client/components/client-page.js')}:20:3)`,
      ),
      _debugOwner: root,
    };
    const button = pin({
      type: 'button',
      _debugStack: made(
        `jsxDEV (${next('node_modules/next/dist/compiled/react/jsx-dev-runtime.js')}:1:1)`,
        `Pricing (${next('src/app/pricing/page.tsx')}:24:5)`,
      ),
      _debugOwner: page,
      // The parents above it are the framework's and the layout's providers.
      return: { type: component('ThemeProvider'), return: { type: component('Providers'), return: { type: component('AppRouter') } } },
    });
    expect(describeIsotoneElement(elementAsNode(button))).toMatchObject({ component: ['Pricing'], source: 'src/app/pricing/page.tsx:24' });
  });

  it('names the route a router created', () => {
    const at = (file: string) =>
      made('exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:33)', file);
    const provider = {
      type: component('RouterProvider'),
      _debugStack: at('main (http://localhost:5173/src/main.tsx:8:3)'),
      _debugOwner: null,
    };
    const rendered = {
      type: component('RenderedRoute'),
      _debugStack: at('RouterProvider (http://localhost:5173/node_modules/.vite/deps/react-router.js:100:3)'),
      _debugOwner: provider,
    };
    const route = {
      type: component('Pricing'),
      _debugStack: at('RenderedRoute (http://localhost:5173/node_modules/.vite/deps/react-router.js:200:3)'),
      _debugOwner: rendered,
    };
    const button = pin({ type: 'button', _debugStack: at('Pricing (http://localhost:5173/src/Pricing.tsx:12:7)'), _debugOwner: route });
    expect(describeIsotoneElement(elementAsNode(button))).toMatchObject({ component: ['Pricing'], source: '/src/Pricing.tsx:12' });
  });

  it("names a framework component Turbopack serves from a hashed chunk, which looks like the app's", () => {
    // Next 16 with Turbopack bundles ClientPageRoot into a chunk with the app's providers, so the
    // URL cannot tell it from app code: it is named, and the walk ends where nothing made it.
    const root = {
      type: component('ClientPageRoot'),
      _debugStack: made(
        'fakeJSXCallSite (http://localhost:3000/_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_1.js:2093:21)',
        'Function.all (<anonymous>:1:21)',
      ),
      _debugOwner: null,
    };
    const page = {
      type: component('Pricing'),
      _debugStack: made(
        'exports.jsx (http://localhost:3000/_next/static/chunks/node_modules_next_dist_compiled_1.js:1150:33)',
        'ClientPageRoot (http://localhost:3000/_next/static/chunks/_0kb1y._.js:173:46)',
        reactBottom,
      ),
      _debugOwner: root,
    };
    const button = pin({
      type: 'button',
      _debugStack: made(
        'exports.jsxDEV (http://localhost:3000/_next/static/chunks/_0kb1y._.js:1313:33)',
        'Pricing (http://localhost:3000/_next/static/chunks/src_app_client_page_tsx_1.js:24:219)',
        reactBottom,
      ),
      _debugOwner: page,
    });
    expect(describeIsotoneElement(elementAsNode(button))).toMatchObject({
      component: ['ClientPageRoot', 'Pricing'],
      source: '/_next/static/chunks/src_app_client_page_tsx_1.js:24',
    });
  });

  it('names server components from their debug info, with no source from the server bundle', () => {
    const flight =
      'fakeJSXCallSite (http://localhost:3000/_next/static/chunks/node_modules_next_dist_compiled_react-server-dom-turbopack_1.js:2093:21)';
    const server = (name: string) => `${name} (about://React/Prerender/file:///app/.next/dev/server/chunks/ssr/root_1.js:7:5)`;
    const home = { name: 'Home', env: 'Prerender', debugStack: made(flight, 'Function.all (<anonymous>:1:21)'), owner: null };
    const card = { name: 'PricingCard', env: 'Prerender', debugStack: made(flight, server('Home')), owner: home };
    const button = pin({ type: 'button', _debugStack: made(flight, server('PricingCard')), _debugOwner: card });
    const described = describeIsotoneElement(elementAsNode(button));
    expect(described.component).toEqual(['Home', 'PricingCard']);
    expect(described.source).toBeUndefined();
  });

  it('names a forwardRef component by its displayName', () => {
    const at = (file: string) =>
      made('exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:33)', file);
    const page = { type: component('Pricing'), _debugStack: at('App (http://localhost:5173/src/App.tsx:3:3)'), _debugOwner: null };
    const forwarded = { $$typeof: Symbol.for('react.forward_ref'), render: () => null, displayName: 'Button' };
    const owner = { type: forwarded, _debugStack: at('Pricing (http://localhost:5173/src/Pricing.tsx:9:3)'), _debugOwner: page };
    const button = pin({ type: 'button', _debugStack: at('render (http://localhost:5173/src/ui/button.tsx:20:3)'), _debugOwner: owner });
    expect(describeIsotoneElement(elementAsNode(button)).component).toEqual(['Pricing', 'Button']);
  });

  it("climbs out of a library's insides to the app code that used it, and keeps app names a framework also uses", () => {
    const at = (file: string) =>
      made('exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:33)', file);
    const app = { type: component('AppRouter'), _debugStack: at('main (http://localhost:5173/src/main.tsx:8:3)'), _debugOwner: null };
    const pricing = { type: component('Pricing'), _debugStack: at('AppRouter (http://localhost:5173/src/App.tsx:20:7)'), _debugOwner: app };
    const kitButton = {
      type: component('Button'),
      _debugStack: at('Pricing (http://localhost:5173/src/Pricing.tsx:12:7)'),
      _debugOwner: pricing,
    };
    const base = {
      type: component('ButtonBase'),
      _debugStack: at('Button (http://localhost:5173/node_modules/.vite/deps/ui-kit.js:40:9)'),
      _debugOwner: kitButton,
    };
    const button = pin({
      type: 'button',
      _debugStack: at('ButtonBase (http://localhost:5173/node_modules/.vite/deps/ui-kit.js:90:9)'),
      _debugOwner: base,
    });
    expect(describeIsotoneElement(elementAsNode(button))).toMatchObject({
      component: ['AppRouter', 'Pricing', 'Button'],
      source: '/src/Pricing.tsx:12',
    });
  });

  it("reads React 18's _debugSource, skipping minified names", () => {
    const at = (fileName: string, lineNumber: number) => ({ _debugSource: { fileName, lineNumber } });
    const tabs = { type: component('UsageTabs'), ...at('src/page.tsx', 3), _debugOwner: null };
    const minified = { type: { name: 'minified_x' }, ...at('src/tabs.tsx', 30), _debugOwner: tabs };
    const tab = { type: component('TabButton'), ...at('src/tabs.tsx', 40), _debugOwner: minified };
    const button = pin({ type: 'button', ...at('src/tabs.tsx', 12), _debugOwner: tab });
    expect(describeIsotoneElement(elementAsNode(button))).toMatchObject({
      component: ['UsageTabs', 'TabButton'],
      source: 'src/tabs.tsx:12',
    });
    // A dependency's own element, with nothing of the app's above it, says nothing.
    const button2 = pin({ type: 'button', ...at('/app/node_modules/ui-kit/button.js', 4), _debugOwner: null });
    expect(describeIsotoneElement(elementAsNode(button2)).source).toBeUndefined();
  });

  it('reads the JSX callsite from React 19 debug stacks', () => {
    const jsx = 'exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1a2b:250:33)';
    const vite = made(jsx, 'TabButton (http://localhost:5173/src/tabs.tsx?t=1700000000:12:7)', reactBottom);
    expect(describeIsotoneElement(elementAsNode(pin({ type: 'button', _debugStack: vite }))).source).toBe('/src/tabs.tsx:12');
    const webpack = made(
      'jsxDEV (webpack-internal:///(app-pages-browser)/./node_modules/react/cjs/react-jsx-dev-runtime.development.js:10:1)',
      'TabButton (webpack-internal:///(app-pages-browser)/./src/app/tabs.tsx:30:5)',
    );
    expect(describeIsotoneElement(elementAsNode(pin({ type: 'button', _debugStack: webpack }))).source).toBe('src/app/tabs.tsx:30');
    // Firefox and Safari: no message line, `name@url` frames.
    const fs = [
      'jsxDEV@http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:1:1',
      'TabButton@http://localhost:5173/@fs/Users/me/app/src/tabs.tsx:8:3',
    ].join('\n');
    expect(describeIsotoneElement(elementAsNode(pin({ type: 'button', _debugStack: fs }))).source).toBe('/Users/me/app/src/tabs.tsx:8');
    // React 18's field still wins when present.
    const both = pin({ type: 'button', _debugSource: { fileName: 'src/old.tsx', lineNumber: 3 }, _debugStack: vite });
    expect(describeIsotoneElement(elementAsNode(both)).source).toBe('src/old.tsx:3');
  });

  it('maps a React 19 callsite back to the original line through the module source map', async () => {
    const stack = made(
      'exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js:250:33)',
      'TabButton (http://localhost:5173/src/tabs.tsx?t=1:2:7)',
    );
    const button = pin({ type: 'button', _debugStack: stack });
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
      expect(await resolveElementSource(pin({ type: 'button', _debugSource: { fileName: 'a.tsx', lineNumber: 1 } }))).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

it('keeps the context through the store and prints it for the agent', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'isotone-element-')));
  dirs.push(root);
  const file = join(root, '.isotone/notes.json');
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
    body: { id: 'n1', route: '/', feedback: 'hi', element, elements: [element], selections: { 'card-radius': '24' } },
  });
  expect(res.status).toBeLessThan(300);
  const [note] = readNotes(file);
  expect(note?.element?.selector).toBe(element.selector);
  expect(note?.elements?.[0]?.rect).toEqual(element.rect);
  // A long list is cut.
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`spacing-${i}`, '24']));
  notesResponse(file, { method: 'POST', url: '/', body: { id: 'n2', route: '/', feedback: 'roomier', element: null, selections: many } });
  // A pick that is a file variant: the page ran its copy.
  createVariant({ root }, { id: 'pricing-featured' });
  notesResponse(file, {
    method: 'POST',
    url: '/',
    body: { id: 'n3', route: '/', feedback: 'bolder', element: null, selections: { pricing: 'pricing-featured' } },
  });

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
    'selections: card-radius=24 (the page showed these, not the defaults)',
  ]) {
    expect(text).toContain(part);
  }
  const long = text.split('\n').find((line) => line.includes('spacing-0=24')) ?? '';
  expect(long.length).toBeLessThan(270);
  expect(long).toContain('… (the page showed these, not the defaults)');
  expect(text).toContain(
    'selections: pricing=pricing-featured (the page showed these, not the defaults; source lines may be lines of the active variant copy)',
  );
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
