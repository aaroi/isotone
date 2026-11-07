// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLAST, type BlastState } from '../src/core/blast';
import { BlastNotice, type BlastNoticeProps } from '../src/react/BlastNotice';
import { NoteSummary } from '../src/react/NoteSummary';

const NOW = Date.parse('2026-11-07T12:00:00Z');
function state(partial: Partial<BlastState> = {}): BlastState {
  return {
    startedAt: new Date(NOW - 10 * 60_000).toISOString(), endsAt: new Date(NOW + 32 * 60_000).toISOString(),
    every: 300_000, route: null, heartbeatAt: new Date(NOW).toISOString(), waiting: true,
    live: true, ended: false, now: new Date(NOW).toISOString(), ...partial,
  };
}

let host: HTMLDivElement;
let root: Root;
let session: BlastState | null;
let posts: unknown[];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  session = state();
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { action: string };
      posts.push(body);
      if (!session) return Response.json({ error: 'none' }, { status: 409 });
      session = body.action === 'stop'
        ? state({ endsAt: new Date(NOW).toISOString(), stoppedAt: new Date(NOW).toISOString(), stoppedBy: 'panel', live: false, ended: true, waiting: false })
        : state({ endsAt: new Date(Date.parse(session.endsAt) + 15 * 60_000).toISOString() });
      return Response.json({ session });
    }
    return Response.json({ session: session && { ...session, now: new Date().toISOString() } });
  }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(props: Partial<BlastNoticeProps> = {}) {
  return act(async () => root.render(h(BlastNotice, { endpoint: '/local-blast', active: true, ...props })));
}
const trigger = () => host.querySelector<HTMLButtonElement>('.isotone-blast-trigger');
async function click(element: Element | null | undefined) {
  if (!element) throw new Error('missing control');
  await act(async () => (element as HTMLElement).click());
}
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);

describe('the Blast indicator', () => {
  it('reads nothing without an endpoint or while the panel is closed', async () => {
    await render({ endpoint: undefined });
    await render({ active: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toBe('');
  });

  it('shows the time left during a live session, and a working state', async () => {
    await render();
    expect(trigger()?.textContent).toBe(`${BLAST.name} · 32 min left`);
    expect(host.querySelector('.isotone-blast-dot')?.getAttribute('data-working')).toBe('false');
    await render({ working: 1 });
    expect(host.querySelector('.isotone-blast-dot')?.getAttribute('data-working')).toBe('true');
    await click(trigger());
    expect(host.textContent).toContain('Working on a note');
    // The countdown follows the clock between polls.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(trigger()?.textContent).toBe(`${BLAST.name} · 31 min left`);
  });

  it('extends by 15 minutes and keeps the dialog open', async () => {
    await render();
    await click(trigger());
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(BLAST.name);
    expect(document.activeElement?.textContent).toBe('Extend 15 min');
    expect(host.textContent).toContain('Waiting for notes');
    await click(button('Extend 15 min'));
    expect(posts).toEqual([{ action: 'extend' }]);
    expect(trigger()?.textContent).toBe(`${BLAST.name} · 47 min left`);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Extended 15 min');
  });

  it('stops the session and says the agent ends at its next check', async () => {
    await render();
    await click(trigger());
    await click(button('Stop'));
    expect(posts).toEqual([{ action: 'stop' }]);
    expect(trigger()?.textContent).toBe(`${BLAST.name} stopped`);
    expect(host.textContent).toContain('your agent ends at its next check');
    await act(async () => { host.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(trigger()?.textContent).toBe(`Start ${BLAST.name}`);
  });

  it('offers Start Blast with no live session, and copies a prompt for the chosen time', async () => {
    session = null;
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await render();
    expect(trigger()?.textContent).toBe(`Start ${BLAST.name}`);
    expect(host.querySelector('.isotone-blast-dot')).toBeNull();
    await click(trigger());
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Paste it into your agent. Isotone can't start one.");
    expect(button('45 min')?.getAttribute('aria-pressed')).toBe('true');
    await click(button('15 min'));
    await click(button('Copy prompt'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('npx isotone blast --for 15m'));
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Prompt copied');
    expect(posts).toEqual([]);
  });

  it('shows the prompt to select when the clipboard is unavailable', async () => {
    session = state({ live: false, heartbeatAt: new Date(NOW - 3_600_000).toISOString() });
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    await render();
    expect(trigger()?.textContent).toBe(`Start ${BLAST.name}`);
    await click(trigger());
    await click(button('Copy prompt'));
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('npx isotone blast --for 45m');
  });

  it('polls while open and tolerates a failing adapter', async () => {
    await render();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(trigger()?.textContent).toBe(`${BLAST.name} · 32 min left`);
  });
});

describe('an agent reply under a note', () => {
  it('shows the question with the note, and nothing for a note without one', async () => {
    const note = { id: 'n1', route: '/', feedback: 'Make this nicer.', element: null, done: false, createdAt: new Date(NOW).toISOString() };
    await act(async () => root.render(h(NoteSummary, { note })));
    expect(host.querySelector('.isotone-reply')).toBeNull();
    await act(async () => root.render(h(NoteSummary, { note: { ...note, reply: { text: 'Spacing, copy or layout?', at: new Date(NOW).toISOString() } } })));
    expect(host.querySelector('.isotone-reply')?.textContent).toBe('Agent asks Spacing, copy or layout?');
    expect(host.textContent).toContain('Make this nicer.');
  });

  it('stops asking once the reviewer has answered by editing the note', async () => {
    const note = { id: 'n1', route: '/', feedback: 'Make the spacing nicer.', element: null, done: false, createdAt: new Date(NOW).toISOString(),
      reply: { text: 'Spacing, copy or layout?', at: new Date(NOW).toISOString(), answered: true } };
    await act(async () => root.render(h(NoteSummary, { note })));
    expect(host.querySelector('.isotone-reply')).toBeNull();
    expect(host.textContent).not.toContain('Agent asks');
    expect(host.textContent).toContain('Make the spacing nicer.');
  });
});
