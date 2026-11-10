/** The style editor experiment: adjust pinned elements on the page and send the changes with the note. */
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IsotonePanel } from '../../src/react/index';
import { byText, click, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

const sheet = () => document.head.querySelector('style[data-isotone-adjust]')?.textContent ?? null;
const input = (label: string) => container.querySelector<HTMLInputElement>(`.isotone-num input[aria-label="${label}"]`);

async function type(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('no field');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function key(el: Element | null, name: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, ...init }));
  });
}

/** What the pointer is over, for select mode; jsdom has no layout to ask. */
let under: Element | null = null;
beforeEach(() => {
  Object.defineProperty(document, 'elementFromPoint', { value: () => under, configurable: true });
});

/** Open Feedback in select mode and pin the page's elements by clicking them. */
async function pin(experimental: { styleEditor: boolean } | undefined, ...selectors: string[]) {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<main id="page"><h1 id="title" style="font-size: 20px; padding: 4px 8px; color: rgb(17, 17, 17)">Title</h1><div id="row" style="display: flex; row-gap: 6px; column-gap: 6px; padding: 2px"><i></i></div></main>',
  );
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' }, experimental }));
  await act(async () => {
    container.querySelector('.isotone-fab')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  });
  for (const selector of selectors) await pinMore(selector);
}
async function pinMore(selector: string) {
  const el = document.querySelector(selector) as HTMLElement;
  under = el;
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 5, clientY: 5 }));
  });
  under = null;
}

afterEach(() => {
  document.getElementById('page')?.remove();
  document.head.querySelector('style[data-isotone-adjust]')?.remove();
  Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('the style editor', () => {
  it('offers nothing with the flag off, and nothing until something is pinned', async () => {
    await pin(undefined, '#title');
    expect(byText('Adjust styles')).toBeUndefined();
  });

  it('is offered once an element is pinned, and costs the page nothing until a value changes', async () => {
    await pin({ styleEditor: true });
    expect(byText('Adjust styles')).toBeUndefined();
    await pinMore('#title');
    expect(byText('Adjust styles')).toBeDefined();
    await click(byText('Adjust styles'));
    expect(container.querySelector('.isotone-adjust')).not.toBeNull();
    expect(sheet()).toBeNull();
    // Read from the page, where the element started.
    expect(input('Size')?.value).toBe('20');
    expect(input('Pad ↕')?.value).toBe('4');
    expect(input('Pad ↔')?.value).toBe('8');
    // A gap needs a flex or grid box; a heading has none.
    expect(input('Gap')).toBeNull();
  });

  it('previews a typed value under the pin’s own selector, steps with the arrow keys and resets', async () => {
    await pin({ styleEditor: true }, '#title');
    await click(byText('Adjust styles'));
    await type(input('Size'), '24');
    expect(sheet()).toBe('#title:not(#\\:isotone):not(#\\:isotone){font-size:24px !important;transition:none !important}');
    // The page's element itself is untouched.
    expect(document.getElementById('title')?.getAttribute('style')).toContain('font-size: 20px');
    await key(input('Size'), 'ArrowUp');
    expect(sheet()).toContain('font-size:25px');
    await key(input('Size'), 'ArrowDown', { shiftKey: true });
    expect(sheet()).toContain('font-size:15px');
    expect(container.querySelector('.isotone-context')?.textContent).toContain('1 style change');
    // Back at the starting value is no change.
    await type(input('Size'), '20');
    expect(sheet()).toBeNull();
    await type(input('Pad ↕'), '12');
    await click(byText('Reset Pad ↕'));
    expect(sheet()).toBeNull();
    expect(input('Pad ↕')?.value).toBe('4');
  });

  it('keeps a value the browser would not take out of the preview, and says so on the field', async () => {
    await pin({ styleEditor: true }, '#title');
    await click(byText('Adjust styles'));
    await type(input('Size'), 'big');
    expect(input('Size')?.getAttribute('aria-invalid')).toBe('true');
    expect(sheet()).toBeNull();
    await key(input('Size'), 'Escape');
    expect(input('Size')?.value).toBe('20');
    expect(container.querySelector('.isotone-adjust')).not.toBeNull();
  });

  it('puts a field back on Escape, closes the editor on the next, and never closes the dock', async () => {
    await pin({ styleEditor: true }, '#title');
    await click(byText('Adjust styles'));
    await type(input('Size'), '24');
    await act(async () => input('Size')?.blur());
    // A second visit to the field: Escape goes back to 24, the value it held on focus, not to the page's 20.
    await act(async () => input('Size')?.focus());
    await type(input('Size'), '40');
    await key(input('Size'), 'Escape');
    expect(sheet()).toContain('font-size:24px');
    expect(container.querySelector('.isotone-adjust')).not.toBeNull();
    await key(input('Size'), 'Escape');
    expect(container.querySelector('.isotone-adjust')).toBeNull();
    // The changes stay on the note, and the feedback panel stays open.
    expect(sheet()).toContain('font-size:24px');
    expect(container.querySelector('.isotone-notes-panel')?.getAttribute('data-open')).toBe('true');
    expect(container.querySelector('.isotone-context')?.textContent).toContain('1 style change');
  });

  it('does not step a value that has nothing to step from', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<p id="odd" style="padding: 4px 8px 12px; border-radius: 50%; line-height: normal">Odd</p>',
    );
    await pin({ styleEditor: true }, '#odd');
    await click(byText('Adjust styles'));
    for (const label of ['Pad ↕', 'Radius', 'Line']) {
      expect(input(label)?.value).toBe('');
      await key(input(label), 'ArrowUp');
    }
    expect(sheet()).toBeNull();
    // Typing still sets it.
    await type(input('Radius'), '8');
    expect(sheet()).toContain('border-radius:8px');
    document.getElementById('odd')?.remove();
  });

  it('starts closed for the next pin after a note is sent', async () => {
    await pin({ styleEditor: true }, '#title');
    await click(byText('Adjust styles'));
    await type(input('Size'), '24');
    await click(byText('Send note'));
    await act(async () => {});
    expect(container.querySelector('.isotone-adjust')).toBeNull();
    await click(byText('Select elements'));
    await pinMore('#row');
    expect(container.querySelector('.isotone-adjust')).toBeNull();
    expect(byText('Adjust styles')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('gives the changes back when the note cannot be saved, and no text the reviewer did not write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? { ok: false, status: 400, json: async () => ({ error: 'no' }) }
          : { ok: true, status: 200, json: async () => [] },
      ),
    );
    await pin({ styleEditor: true }, '#title');
    await click(byText('Adjust styles'));
    await type(input('Size'), '24');
    await click(byText('Send note'));
    await act(async () => {});
    await act(async () => {});
    expect(container.querySelector('.isotone-notice')?.textContent).toContain('Could not save');
    expect(container.querySelector('textarea')?.value).toBe('');
    expect(sheet()).toBe('#title:not(#\\:isotone):not(#\\:isotone){font-size:24px !important;transition:none !important}');
    expect(container.querySelector('.isotone-context')?.textContent).toContain('1 style change');
  });

  it('sends the changes with the note, needing no words, and takes the preview off the page', async () => {
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)));
        return { ok: true, status: 200, json: async () => (init?.method === 'POST' ? { id: 'saved-1' } : []) };
      }),
    );
    await pin({ styleEditor: true }, '#title', '#row');
    await click(byText('Adjust styles'));
    // Two pins that differ read as mixed; a value set there goes to both.
    expect(input('Pad ↕')?.placeholder).toBe('Mixed');
    expect(input('Pad ↕')?.value).toBe('');
    await type(input('Pad ↕'), '10');
    expect(sheet()).toContain('#title:not');
    expect(sheet()).toContain('#row:not');
    const send = byText('Send note') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    await click(send);
    await act(async () => {});
    expect(posted[0]).toMatchObject({
      feedback: 'Apply these style changes.',
      styleEdits: [
        { selector: '#title', changes: [{ property: 'padding-block', from: '4px', to: '10px' }] },
        { selector: '#row', changes: [{ property: 'padding-block', from: '2px', to: '10px' }] },
      ],
    });
    expect(sheet()).toBeNull();
    expect(container.querySelector('.isotone-adjust')).toBeNull();
  });

  it('drops an element’s changes when it is unpinned, and all of them when the panel goes away', async () => {
    await pin({ styleEditor: true }, '#title', '#row');
    await click(byText('Adjust styles'));
    await type(input('Pad ↕'), '10');
    await click(byText('Remove pinned element 1'));
    expect(sheet()).toBe('#row:not(#\\:isotone):not(#\\:isotone){padding-block:10px !important;transition:none !important}');
    // With one flex box pinned, its gap can be set.
    expect(input('Gap')?.value).toBe('6');
    await click(byText('Remove style changes'));
    expect(sheet()).toBeNull();
    await type(input('Gap'), '12');
    expect(sheet()).toContain('gap:12px');
  });

  it('tells the note where the page sets each property today: the rule and its token, or inline', async () => {
    const posted: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)));
        return { ok: true, status: 200, json: async () => (init?.method === 'POST' ? { id: 'saved-2' } : []) };
      }),
    );
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: !query.includes('99999'),
      addEventListener() {},
      removeEventListener() {},
    }));
    const rules = document.createElement('style');
    rules.textContent =
      'p { padding: 1px } [title="a,b"], .tok, .other::before { padding: var(--space-4); color: var(--ink) } @media (min-width: 99999px) { .tok { padding: 9px } } #tok.tok { color: rebeccapurple }';
    document.head.append(rules);
    document.body.insertAdjacentHTML('beforeend', '<p id="tok" class="tok" style="font-size: 1.25rem">Token</p>');
    await pin({ styleEditor: true }, '#tok');
    await click(byText('Adjust styles'));
    await type(input('Pad ↕'), '40');
    await type(input('Size'), '30');
    await click(byText('Colour'));
    await act(async () => {
      const hex = container.querySelector<HTMLInputElement>('.isotone-colour-hex');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(hex, '00ff00');
      hex?.dispatchEvent(new Event('input', { bubbles: true }));
      hex?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await click(byText('Send note'));
    await act(async () => {});
    const sent = (posted[0]?.styleEdits ?? []) as { changes: Record<string, string>[] }[];
    const changes = sent[0]?.changes ?? [];
    const by = (property: string) => changes.find((change) => change.property === property);
    // The class rule wins over the tag rule, and the media query that does not apply is not read.
    // A comma inside an attribute value splits nothing, and a part that cannot match does not lose the rule.
    expect(by('padding-block')).toMatchObject({ rule: '[title="a,b"], .tok, .other::before', declared: 'var(--space-4)' });
    expect(by('font-size')).toMatchObject({ rule: 'inline', declared: '1.25rem' });
    expect(by('color')).toMatchObject({ rule: '#tok.tok', declared: 'rebeccapurple', to: '#00ff00' });
    rules.remove();
    document.getElementById('tok')?.remove();
  });

  it('shows the changes only while the feedback panel is open', async () => {
    await pin({ styleEditor: true }, '#title');
    await click(byText('Adjust styles'));
    await type(input('Size'), '24');
    await click(byText('Close feedback'));
    expect(sheet()).toBeNull();
    await click(container.querySelector('.isotone-rail-button[aria-label^="Feedback"]'));
    expect(sheet()).toContain('font-size:24px');
  });
});
