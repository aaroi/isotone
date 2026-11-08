/**
 * Notes arriving while the panel is open, page scope and agent progress,
 * and pinning and composing from the keyboard.
 */
import { act, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IsotonePanel } from '../../src/react/index';
import { byText, click, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

describe('live notes', () => {
  const note = (id: string, extra: object = {}) => ({
    id,
    route: '/',
    feedback: `Note ${id}`,
    element: null,
    done: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  });
  const flush = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  type Answer = { rev: string; unchanged?: true; notes?: object[] } | 'down';
  function server(answers: Answer[]) {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const next = answers.length > 1 ? (answers.shift() as Answer) : answers[0];
        if (next === 'down') throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => next };
      }),
    );
    return urls;
  }
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));

  it('drops a note the agent closed, without a reload', async () => {
    // A server with real revisions: unchanged polls get no rows.
    let state = { rev: 'a', notes: [note('one'), note('two')] };
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        const asked = new URL(String(url), 'http://x').searchParams.get('rev');
        return { ok: true, status: 200, json: async () => (asked === state.rev ? { rev: state.rev, unchanged: true } : state) };
      }),
    );
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    await click(container.querySelector('.isotone-fab'));
    await flush();
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(2);
    state = { rev: 'b', notes: [note('two')] };
    await advance(2600);
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(1);
    // The next poll asks for the open backlog with the revision it last saw.
    await advance(2600);
    expect(urls.at(-1)).toBe('/notes?rev=b');
    expect(urls.some((url) => url.includes('all=1'))).toBe(false);
  });

  it('keeps the same list when the server says nothing changed', async () => {
    server([
      { rev: 'a', notes: [note('one')] },
      { rev: 'a', unchanged: true },
    ]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    await click(container.querySelector('.isotone-fab'));
    await flush();
    const row = container.querySelector('.isotone-note');
    await advance(2600);
    expect(container.querySelector('.isotone-note')).toBe(row);
  });

  it('backs off while the server is down and recovers', async () => {
    const urls = server(['down']);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    const start = urls.length;
    await advance(60_000);
    // 2.5s doubling to the 30s cap: far fewer than one request every 2.5s.
    expect(urls.length - start).toBeLessThanOrEqual(6);
  });

  it('does not poll a hidden tab, and catches up when it is shown', async () => {
    const urls = server([
      { rev: 'a', notes: [] },
      { rev: 'a', unchanged: true },
    ]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await flush();
    let hidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(2600);
    const asleep = urls.length;
    await advance(30_000);
    expect(urls.length).toBe(asleep);
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(urls.length).toBe(asleep + 1);
    Reflect.deleteProperty(document, 'hidden');
  });
});

describe('page scope and agent progress', () => {
  const note = (id: string, route: string, extra: object = {}) => ({
    id,
    route,
    feedback: `Note ${id}`,
    element: null,
    done: false,
    createdAt: new Date().toISOString(),
    ...extra,
  });
  const serve = (notes: object[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => notes })),
    );

  it('lists this page first and reveals other pages from a row of chips', async () => {
    serve([note('a', '/'), note('b', '/pricing'), note('c', '/pricing')]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(1);
    const chips = Array.from(container.querySelectorAll('.isotone-page'));
    expect(chips.map((chip) => chip.textContent)).toEqual(['This page1', '/pricing2']);
    await click(chips[1]);
    expect(container.querySelectorAll('.isotone-note')).toHaveLength(3);
    // Another page's note names its page.
    expect(container.textContent).toContain('/pricing');
  });

  it('shows no page chips while every note is on this page', async () => {
    serve([note('a', '/')]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelector('.isotone-pages')).toBeNull();
  });

  it('marks notes an agent started recently, and ignores a stale claim', async () => {
    serve([
      note('a', '/', { workingAt: new Date().toISOString() }),
      note('b', '/', { workingAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }),
    ]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    await click(container.querySelector('.isotone-fab'));
    expect(container.querySelectorAll('.isotone-working')).toHaveLength(1);
    expect(container.querySelector('.isotone-root')?.getAttribute('data-working')).toBe('true');
  });
});

it('pins a focused host control with Space without activating it', async () => {
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.isotone-fab'));
  await click(byText('Select elements'));
  const target = document.createElement('button');
  target.id = 'keyboard-target';
  target.textContent = 'Project actions';
  document.body.append(target);
  target.focus();
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
  await act(async () => {
    target.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(container.querySelector('.isotone-chip')?.textContent).toContain('Project actions');
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true }));
  });
  expect(container.querySelectorAll('.isotone-chip')).toHaveLength(1);
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  expect(container.querySelector('textarea')).toBe(document.activeElement);
  target.remove();
});

it('fades the composer top only after its text has scrolled', async () => {
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.isotone-fab'));
  const field = container.querySelector('textarea');
  if (!field) throw new Error('Missing composer');
  expect(field.dataset.scrolled).toBe('false');
  await act(async () => {
    field.scrollTop = 36;
    field.dispatchEvent(new Event('scroll'));
  });
  expect(field.dataset.scrolled).toBe('true');
  await act(async () => {
    field.scrollTop = 0;
    field.dispatchEvent(new Event('scroll'));
  });
  expect(field.dataset.scrolled).toBe('false');
});
