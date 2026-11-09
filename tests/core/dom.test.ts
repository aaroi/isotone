import { describe, expect, it } from 'vitest';
import { recordDiagnostics } from '../../src/core/diagnostics';
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

describe('page diagnostics', () => {
  it('keeps recent uncaught errors, rejections and failed loads, and nothing when the page is quiet', () => {
    const recorder = recordDiagnostics(window);
    expect(recorder.recent()).toBeUndefined();
    for (let i = 0; i < 2; i++)
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'TypeError: trail is undefined', filename: `${location.origin}/src/App.jsx?t=123`, lineno: 12 }),
      );
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = new RangeError('too far');
    window.dispatchEvent(rejection);
    const image = document.createElement('img');
    image.src = 'https://cdn.example.com/hero.png?token=secret#x';
    document.body.append(image);
    image.dispatchEvent(new Event('error'));
    const found = recorder.recent();
    expect(found?.errors).toEqual([
      { message: 'TypeError: trail is undefined', source: '/src/App.jsx:12', at: expect.any(String), count: 2 },
      { message: 'Unhandled rejection: RangeError: too far', at: expect.any(String) },
    ]);
    // The same image, seen a moment later as a 404 by the resource timings: still one entry.
    expect(found?.requests).toHaveLength(1);
    // No query or fragment: that is where tokens live.
    expect(found?.requests).toEqual([{ url: 'https://cdn.example.com/hero.png', at: expect.any(String) }]);
    // Old trouble belongs to something else.
    expect(recorder.recent(Date.now() + 6 * 60_000)).toBeUndefined();
    recorder.stop();
    window.dispatchEvent(new ErrorEvent('error', { message: 'after stop' }));
    expect(recorder.recent()?.errors).toHaveLength(2);
  });

  it('keeps only the newest few of each kind', () => {
    const recorder = recordDiagnostics(window);
    for (let i = 0; i < 9; i++) window.dispatchEvent(new ErrorEvent('error', { message: `Error ${i}` }));
    expect(recorder.recent()?.errors?.map((e) => e.message)).toEqual(['Error 4', 'Error 5', 'Error 6', 'Error 7', 'Error 8']);
    recorder.stop();
  });

  it('takes queries out of messages, names odd schemes plainly and skips browser noise', () => {
    const recorder = recordDiagnostics(window);
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'GET https://api.example.com/me?access_token=SECRET#frag failed\nthen /local/path?key=SECRET2 too',
        filename: 'webpack-internal:///./src/a.tsx',
        lineno: 4,
      }),
    );
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
    expect(recorder.recent()?.errors).toEqual([
      {
        message: 'GET https://api.example.com/me failed then /local/path too',
        source: 'webpack-internal:/src/a.tsx:4',
        at: expect.any(String),
      },
    ]);
    recorder.stop();
  });

  it('never throws into the page, whatever was thrown or rejected', () => {
    const recorder = recordDiagnostics(window);
    const rejection = new Event('unhandledrejection') as Event & { reason?: unknown };
    rejection.reason = Object.create(null);
    expect(() => window.dispatchEvent(rejection)).not.toThrow();
    expect(recorder.recent()?.errors?.[0]?.message).toBe('Unhandled rejection: Error');
    recorder.stop();
  });

  it("leaves out the panel's own endpoints and what fails to load inside the panel", () => {
    const recorder = recordDiagnostics(window, ['http://localhost:4123/custom/notes', undefined]);
    const fail = (src: string, parent: Element = document.body) => {
      const image = document.createElement('img');
      image.src = src;
      parent.append(image);
      image.dispatchEvent(new Event('error'));
    };
    fail('http://localhost:4123/custom/notes?rev=1');
    fail('/api/isotone/notes');
    const panel = document.createElement('div');
    panel.setAttribute('data-isotone', 'root');
    document.body.append(panel);
    fail('/inside-panel.png', panel);
    expect(recorder.recent()).toBeUndefined();
    fail('/real.png');
    expect(recorder.recent()?.requests).toEqual([{ url: '/real.png', at: expect.any(String) }]);
    recorder.stop();
  });

  it('keeps a repeating error as the newest, with its count', () => {
    const recorder = recordDiagnostics(window);
    const raise = (message: string) => window.dispatchEvent(new ErrorEvent('error', { message }));
    raise('Repeats');
    for (let i = 0; i < 4; i++) raise(`Other ${i}`);
    raise('Repeats');
    raise('Newest');
    expect(recorder.recent()?.errors?.map((e) => [e.message, e.count])).toEqual([
      ['Other 1', undefined],
      ['Other 2', undefined],
      ['Other 3', undefined],
      ['Repeats', 2],
      ['Newest', undefined],
    ]);
    recorder.stop();
  });
});
