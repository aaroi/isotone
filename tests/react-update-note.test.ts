// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IterationNote } from '../src/core/index';
import type { UpdateInfo } from '../src/core/update';
import { IterationPanel } from '../src/react/index';

const info: UpdateInfo = {
  status: 'available', currentVersion: '1.1.3', latestVersion: '1.2.0',
  upgrade: { manager: 'pnpm', command: 'pnpm add -D --exact isotone@1.2.0', cwd: '/workspace/app' },
};
let container: HTMLDivElement;
let root: Root | null = null;
let notes: IterationNote[];
let rev = 0;

/** A small stand-in for the dev server: notes, and the update endpoint that files one. */
function server(url: string, init?: RequestInit): Response {
  const method = (init?.method ?? 'GET').toUpperCase();
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname === '/update') {
    if (method === 'GET') return Response.json(info);
    const open = notes.find((note) => note.update && !note.done);
    if (open) return Response.json({ id: open.id, created: false });
    const { route } = JSON.parse(String(init?.body)) as { route: string };
    notes.push({ id: 'update-1', route, feedback: 'Update Isotone 1.1.3 → 1.2.0', element: null, done: false, createdAt: new Date().toISOString(),
      update: { from: '1.1.3', to: '1.2.0', command: info.upgrade?.command ?? '', cwd: '/workspace/app', manager: 'pnpm' } });
    rev++;
    return Response.json({ id: 'update-1', created: true }, { status: 201 });
  }
  if (method === 'DELETE') {
    notes = notes.filter((note) => note.id !== parsed.searchParams.get('id'));
    rev++;
    return Response.json({ ok: true });
  }
  return Response.json({ rev: String(rev), notes: notes.filter((note) => !note.done) });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  notes = [{ id: 'other', route: '/pricing', feedback: 'Plan names are too similar.', element: null, done: false, createdAt: '2026-01-01T00:00:00.000Z' }];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => server(url, init)));
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
function find(selector: string) {
  const found = container.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`Missing: ${selector}`);
  return found;
}
function button(label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')]
    .find((el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

describe('asking the agent to update from the panel', () => {
  it('files a note in Feedback on every page, which cancels the request when deleted', async () => {
    root = createRoot(container);
    const mounted = root;
    await act(async () => mounted.render(createElement(IterationPanel, {
      route: '/', theme: 'light', store: { endpoint: '/notes' }, updateEndpoint: '/update',
    })));
    await click(find('.isotone-fab'));
    if (find('.isotone-notes-panel').dataset.open !== 'true') await click(button('Feedback'));
    await settle();
    expect(find('.isotone-notes-panel').dataset.open).toBe('true');
    expect(find('.isotone-update-trigger').textContent).toBe('Isotone 1.2.0 is available');
    await click(find('.isotone-update-trigger'));
    await click(button('Ask agent to update'));
    await settle();

    // The note sits with this page's feedback, tagged rather than pinned to an element.
    const row = [...container.querySelectorAll('.isotone-note')].find((li) => li.textContent?.includes('Update Isotone 1.1.3 → 1.2.0'));
    expect(row).toBeDefined();
    expect(row?.querySelector('.isotone-chip')?.textContent).toBe('Update');
    expect(container.querySelector('.isotone-update-requested')?.textContent).toBe('Update requested · in Feedback');
    expect(find('.isotone-update-trigger').textContent).toBe('Update requested');
    // It does not count toward page chips (only /pricing has page notes), and a
    // note on another page stays there.
    expect(container.querySelector('.isotone-pages')).toBeNull();
    expect(container.textContent).not.toContain('Plan names are too similar.');

    await click(button('Cancel update request'));
    await settle();
    expect(notes.some((note) => note.update)).toBe(false);
    expect(find('.isotone-update-trigger').textContent).toBe('Isotone 1.2.0 is available');
    expect(container.querySelector('.isotone-update-ask')).not.toBeNull();
  });

  it('shows an update note asked for on another page, and the notice as requested', async () => {
    notes.push({ id: 'update-1', route: '/pricing', feedback: 'Update Isotone 1.1.3 → 1.2.0', element: null, done: false, createdAt: '2026-01-02T00:00:00.000Z',
      update: { from: '1.1.3', to: '1.2.0', command: 'pnpm add -D --exact isotone@1.2.0', cwd: '/workspace/app', manager: 'pnpm' } });
    root = createRoot(container);
    const mounted = root;
    await act(async () => mounted.render(createElement(IterationPanel, {
      route: '/', theme: 'light', store: { endpoint: '/notes' }, updateEndpoint: '/update',
    })));
    await click(find('.isotone-fab'));
    if (find('.isotone-notes-panel').dataset.open !== 'true') await click(button('Feedback'));
    await settle();
    expect(find('.isotone-list').textContent).toContain('Update Isotone 1.1.3 → 1.2.0');
    expect(find('.isotone-list').textContent).not.toContain('/pricing');
    expect(find('.isotone-update-trigger').textContent).toBe('Update requested');
  });
});
