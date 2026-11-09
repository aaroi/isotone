/**
 * Notes the agent closed, waiting for the reviewer: the agent's summary in the
 * list, Looks good, Not quite, and showing the element again.
 */
import { act, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IsotonePanel } from '../../src/react/index';
import { byText, click, container, render, setUpPanelFixture } from '../helpers/panel';

setUpPanelFixture();

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const note = (id: string, extra: object = {}) => ({
  id,
  route: '/',
  feedback: `Note ${id}`,
  element: null,
  done: false,
  createdAt: minutesAgo(60),
  ...extra,
});
const closed = (id: string, minutes: number, extra: object = {}) =>
  note(id, { done: true, doneAt: minutesAgo(minutes), resolution: { summary: `Fixed ${id}`, at: minutesAgo(minutes) }, ...extra });

/** A notes endpoint: GET answers `notes`, POST is recorded and answered with `answer`. */
function serve(
  notes: object[],
  answer: (body: Record<string, unknown>) => { ok: boolean; status: number } = () => ({ ok: true, status: 200 }),
) {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        const { ok, status } = answer(body);
        return { ok, status, json: async () => (ok ? { id: body.id } : { error: 'no' }) };
      }
      return { ok: true, status: 200, json: async () => notes };
    }),
  );
  return posts;
}

async function open() {
  await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
  await click(container.querySelector('.isotone-fab'));
  // Opening focuses the composer a frame later; let that land before a test moves focus.
  await act(async () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
}

const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.isotone-note'));

describe('closed notes to check', () => {
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));

  it('lists them by when the agent closed them, among the open notes, with the agent summary under the note', async () => {
    serve([
      note('open-new', { createdAt: minutesAgo(1) }),
      closed('late', 5),
      note('open-old'),
      closed('early', 30, { resolution: { at: minutesAgo(30) } }),
    ]);
    await open();
    // Written an hour ago, closed 30 and 5 minutes ago, written a minute ago.
    expect(rows().map((row) => row.querySelector('p')?.textContent)).toEqual(['Note open-old', 'Note early', 'Note late', 'Note open-new']);
    const [, early, late] = rows();
    expect(late?.classList.contains('isotone-note-done')).toBe(true);
    expect(late?.querySelector('.isotone-reply')?.textContent).toBe('Agent Fixed late');
    expect(early?.querySelector('.isotone-reply')?.textContent).toBe('Done');
    expect(late?.querySelector('.isotone-checked [aria-hidden]')).not.toBeNull();
    // The launcher counts open notes only; the Feedback button names the ones to check.
    expect(container.querySelector('.isotone-badge')?.textContent).toBe('2');
    const feedback = container.querySelector('.isotone-rail-button');
    expect(feedback?.getAttribute('title')).toBe('Feedback · 2 to check');
    expect(feedback?.getAttribute('aria-label')).toBe('Feedback, 2 notes, 2 to check');
  });

  it('leaves out a checked note and one closed over a week ago', async () => {
    serve([closed('checked', 5, { checkedAt: minutesAgo(1) }), closed('old', 8 * 24 * 60), note('open')]);
    await open();
    expect(rows()).toHaveLength(1);
    expect(container.querySelector('.isotone-rail-button')?.getAttribute('title')).toBe('Feedback');
  });

  it('clears a note on Looks good, and puts it back when the server refuses', async () => {
    let accept = true;
    // A refusal puts the row back; a server that is away keeps the check for later (see the store's tests).
    const posts = serve([closed('a', 5), closed('c', 4), note('b')], () =>
      accept ? { ok: true, status: 200 } : { ok: false, status: 404 },
    );
    await open();
    await click(byText('Looks good: Note a'));
    expect(posts).toEqual([{ id: 'a', route: '/', checked: true }]);
    expect(rows().map((row) => row.querySelector('p')?.textContent)).toEqual(['Note b', 'Note c']);
    accept = false;
    await click(byText('Looks good: Note c'));
    expect(rows().map((row) => row.querySelector('p')?.textContent)).toEqual(['Note b', 'Note c']);
    expect(container.querySelector('.isotone-notice')?.textContent).toBe('Could not mark the note as checked. Try again.');
  });

  it('reopens through the composer on Not quite, even with the text unchanged', async () => {
    const posts = serve([closed('a', 5)]);
    await open();
    await click(byText('Not quite: Note a'));
    const field = container.querySelector('textarea');
    expect(field?.value).toBe('Note a');
    expect(field?.getAttribute('placeholder')).toBe('What is still off?');
    expect(container.querySelector('.isotone-context .isotone-chip')?.textContent).toBe('Reopening note');
    expect(container.querySelector('.isotone-editing-reply')?.textContent).toBe('Agent Fixed a');
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
    expect(field).toBe(document.activeElement);
    await click(byText('Reopen note'));
    expect(posts).toEqual([expect.objectContaining({ id: 'a', feedback: 'Note a', reopen: true })]);
    const [row] = rows();
    expect(row?.classList.contains('isotone-note-done')).toBe(false);
    expect(row?.querySelector('.isotone-reply')).toBeNull();
  });

  it('shows the element on the page when the row is pressed, briefly', async () => {
    const target = document.createElement('h1');
    target.id = 'title';
    const scrolled: unknown[] = [];
    target.scrollIntoView = (options) => scrolled.push(options);
    document.body.append(target);
    serve([
      closed('here', 5, { element: { tag: 'h1', text: 'Title', selector: '#title' } }),
      closed('gone', 4, { element: { tag: 'p', text: 'Gone', selector: '#missing' } }),
      closed('broken', 3, { element: { tag: 'p', text: 'Odd', selector: 'p[' } }),
      closed('elsewhere', 2, { route: '/pricing', element: { tag: 'h1', text: 'Title', selector: '#title' } }),
    ]);
    await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await click(container.querySelector('.isotone-page[aria-pressed="false"]'));
    const press = (text: string) =>
      click(
        rows()
          .find((row) => row.textContent?.includes(text))
          ?.querySelector('.isotone-note-hit'),
      );
    await press('Note gone');
    await press('Note broken');
    await press('Note elsewhere');
    expect(scrolled).toEqual([]);
    expect(container.querySelector('.isotone-selected')).toBeNull();
    await press('Note here');
    expect(scrolled).toEqual([{ block: 'center', behavior: 'smooth' }]);
    expect(container.querySelector('.isotone-selected')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(container.querySelector('.isotone-selected')).toBeNull();
    target.remove();
  });

  it('ends the list with a note the agent just closed, as its Tab stop and in view', async () => {
    serve([note('older'), closed('just', 0), note('open', { createdAt: minutesAgo(10) })]);
    await open();
    const last = rows().at(-1);
    expect(last?.classList.contains('isotone-note-done')).toBe(true);
    expect(last?.querySelector('p')?.textContent).toBe('Note just');
    const tabbable = Array.from(container.querySelectorAll<HTMLButtonElement>('.isotone-list button')).filter((b) => b.tabIndex === 0);
    expect(tabbable).toEqual([last?.querySelector('.isotone-note-hit')]);
    // The list opens scrolled to its foot, where the newest row is.
    const list = container.querySelector<HTMLElement>('.isotone-list');
    expect(list?.scrollTop).toBe((list?.scrollHeight ?? 0) - (list?.clientHeight ?? 0));
  });

  it('moves between a row and its two actions with the arrow keys, from one Tab stop, never onto another kind of action', async () => {
    serve([note('b'), closed('a', 5)]);
    await open();
    const press = (key: string) =>
      act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
    const focused = () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent;
    const tabbable = Array.from(container.querySelectorAll<HTMLButtonElement>('.isotone-list button')).filter((b) => b.tabIndex === 0);
    expect(tabbable.map((b) => b.textContent)).toEqual([expect.stringContaining('Note a')]);
    await act(async () => tabbable[0]?.focus());
    await press('ArrowUp');
    expect(focused()).toContain('Note b');
    await press('ArrowDown');
    expect(focused()).toContain('Note a');
    await press('ArrowRight');
    expect(focused()).toBe('Not quite: Note a');
    await press('ArrowRight');
    expect(focused()).toBe('Looks good: Note a');
    await press('ArrowRight');
    expect(focused()).toBe('Looks good: Note a');
    // The open note above has no such action: Up goes to the note itself, never its Delete.
    await press('ArrowUp');
    expect(focused()).toContain('Note b');
    await press('ArrowRight');
    expect(focused()).toBe('Delete note: Note b');
    // Nor does Down from a Delete land on Not quite.
    await press('ArrowDown');
    expect(focused()).toContain('Note a');
    await press('ArrowRight');
    await press('ArrowLeft');
    expect(focused()).toContain('Note a');
    // Looks good from the keyboard moves on to the neighbouring note, not its Delete.
    await press('End');
    await press('ArrowRight');
    await press('ArrowRight');
    await act(async () => document.activeElement?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(rows()).toHaveLength(1);
    expect(focused()).toContain('Note b');
  });

  it('answers a single click on each action, shown without hovering', async () => {
    const posts = serve([closed('a', 5), closed('c', 4)]);
    await open();
    const actions = rows()[0]?.querySelector('.isotone-check-actions');
    expect(Array.from(actions?.querySelectorAll('button') ?? []).map((b) => b.textContent)).toEqual(['Not quite', 'Looks good']);
    /** A pointer's whole press, as a browser sends it, with nothing hovered first. */
    const press = (target: Element | null | undefined) =>
      act(async () => {
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'])
          target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, detail: 1 }));
        target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 1 }));
      });
    await press(byText('Looks good: Note a'));
    expect(posts).toEqual([{ id: 'a', route: '/', checked: true }]);
    await press(byText('Not quite: Note c'));
    expect(container.querySelector('.isotone-context .isotone-chip')?.textContent).toBe('Reopening note');
  });

  it('says why a note cannot be shown on the page, until the next action', async () => {
    serve([
      closed('pinless', 5),
      closed('gone', 4, { element: { tag: 'p', text: 'Gone', selector: '#missing' } }),
      closed('elsewhere', 3, { route: '/pricing', element: { tag: 'h1', text: 'Plans', selector: 'h1' } }),
    ]);
    await open();
    await click(container.querySelector('.isotone-page[aria-pressed="false"]'));
    const notice = () => container.querySelector('.isotone-notice')?.textContent;
    const press = (text: string) =>
      click(
        rows()
          .find((row) => row.textContent?.includes(text))
          ?.querySelector('.isotone-note-hit'),
      );
    await press('Note pinless');
    expect(notice()).toBe('This note has no pinned element.');
    await press('Note gone');
    expect(notice()).toBe('That element is not on this page any more.');
    await press('Note elsewhere');
    expect(notice()).toBe('This note is on /pricing.');
    await click(byText('Not quite: Note gone'));
    expect(notice()).toBeUndefined();
  });

  it('counts notes to check on the pill quietly while none are open, and open notes in the accent', async () => {
    serve([closed('a', 5), closed('b', 4)]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    const badge = () => container.querySelector('.isotone-badge');
    expect(badge()?.textContent).toBe('2');
    expect(badge()?.hasAttribute('data-quiet')).toBe(true);
    expect(container.querySelector('.isotone-fab')?.getAttribute('aria-label')).toBe('Isotone, 2 to check');
  });

  it('keeps the accent count for open notes beside ones to check', async () => {
    serve([closed('a', 5), note('b')]);
    await render(createElement(IsotonePanel, { route: '/', store: { endpoint: '/notes' } }));
    const badge = container.querySelector('.isotone-badge');
    expect(badge?.textContent).toBe('1');
    expect(badge?.hasAttribute('data-quiet')).toBe(false);
    expect(container.querySelector('.isotone-fab')?.getAttribute('aria-label')).toBe('Isotone, 1 note, 1 to check');
  });
});
