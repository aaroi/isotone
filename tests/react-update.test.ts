// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from '../src/core/update';
import { UpdateNotice, type UpdateNoticeProps } from '../src/react/UpdateNotice';

const available: UpdateInfo = {
  status: 'available',
  currentVersion: '0.3.4',
  latestVersion: '0.4.0',
  upgrade: { manager: 'pnpm', command: 'pnpm add -D isotone@0.4.0', cwd: '/workspace/design app' },
};
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(available)),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(endpoint: string | undefined = '/local-update', active = true, props: Partial<UpdateNoticeProps> = {}) {
  return act(async () => root.render(h(UpdateNotice, { endpoint, active, ...props })));
}

async function click(selector: string) {
  const element = host.querySelector<HTMLButtonElement>(selector);
  if (!element) throw new Error(`Missing test control: ${selector}`);
  await act(async () => element.click());
}

describe('quiet update checks', () => {
  it('does not check without an endpoint or while inactive', async () => {
    await act(async () => root.render(h(UpdateNotice, { active: true })));
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toBe('');
    await render('/local-update', false);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toBe('');
  });

  it.each(['current', 'ahead', 'unavailable', 'disabled'] as const)('stays invisible for %s', async (status) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...available, status, upgrade: null }));
    await render();
    expect(host.textContent).toBe('');
    expect(fetch).toHaveBeenCalledWith('/local-update', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('silently tolerates an offline or failing local adapter', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Offline'));
    await render();
    expect(host.textContent).toBe('');
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    await render('/another-update');
    expect(host.textContent).toBe('');
  });

  it('retries a checking response once, then stops within the deadline', async () => {
    vi.mocked(fetch).mockImplementation(async () =>
      Response.json({ ...available, status: 'checking', latestVersion: null, upgrade: null }),
    );
    await render();
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(5500));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetch).toHaveBeenCalledTimes(2);
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(true);
    expect(host.textContent).toBe('');
  });

  it('aborts in-flight work and cancels a scheduled retry on unmount', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...available, status: 'checking' }));
    await render();
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    await act(async () => root.unmount());
    mounted = false;
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards an old endpoint response and clears a previously displayed notice', async () => {
    let resolveOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await render('/old-update');
    await render('/new-update');
    expect(host.textContent).toContain('Isotone 0.4.0 is available');
    await act(async () => resolveOld(Response.json({ ...available, latestVersion: '99.0.0' })));
    expect(host.textContent).not.toContain('99.0.0');
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...available, status: 'unavailable' }));
    await render('/unavailable-update');
    expect(host.textContent).toBe('');
  });
});

describe('the update dialog', () => {
  it('leads with a one-line from → to and a single primary action', async () => {
    await render('/local-update', true, { onRequested: vi.fn() });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click('.isotone-update-trigger');
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('.isotone-update-versions')?.textContent).toBe('0.3.4 → 0.4.0');
    const ask = host.querySelector<HTMLButtonElement>('.isotone-update-ask');
    expect(ask?.textContent).toBe('Ask agent to update');
    expect(document.activeElement).toBe(ask);
    // The raw command stays reachable, behind a disclosure.
    expect(host.querySelector('[aria-label="Upgrade command"]')).toBeNull();
    expect(dialog?.querySelectorAll('p')).toHaveLength(0);
  });

  it('asks the server for the note with only the page, then shows it as requested', async () => {
    const onRequested = vi.fn();
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? Response.json({ id: 'u1', created: true }, { status: 201 }) : Response.json(available),
    );
    await render('/local-update', true, { onRequested, route: '/projects' });
    await click('.isotone-update-trigger');
    await click('.isotone-update-ask');
    const post = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/local-update');
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ route: '/projects' });
    expect(onRequested).toHaveBeenCalledOnce();
    expect(host.querySelector('.isotone-update-ask')).toBeNull();
    expect(host.querySelector('.isotone-update-requested')?.textContent).toBe('Update requested · in Feedback');
    expect(host.querySelector('.isotone-update-trigger')?.textContent).toBe('Update requested');
  });

  it('follows the note: requested while it is open, the button again once it is deleted', async () => {
    await render('/local-update', true, { onRequested: vi.fn(), requested: true });
    await click('.isotone-update-trigger');
    expect(host.querySelector('.isotone-update-ask')).toBeNull();
    expect(host.querySelector('.isotone-update-requested')).not.toBeNull();
    await render('/local-update', true, { onRequested: vi.fn(), requested: false });
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host.querySelector('.isotone-update-ask')).not.toBeNull();
  });

  it('says so when the request fails, and offers the prompt instead', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? Response.json({ error: 'busy' }, { status: 500 }) : Response.json(available),
    );
    await render('/local-update', true, { onRequested: vi.fn() });
    await click('.isotone-update-trigger');
    await click('.isotone-update-ask');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Could not ask. Copy the prompt instead.');
    expect(host.querySelector('.isotone-update-ask')).not.toBeNull();
  });

  it('offers no agent request where the panel keeps no notes', async () => {
    await render();
    await click('.isotone-update-trigger');
    expect(host.querySelector('.isotone-update-ask')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Copy prompt');
  });

  it('copies a ready-to-paste agent prompt with the versions, command and directory', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await render();
    await click('.isotone-update-trigger');
    await click('.isotone-update-actions button');
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      'Update Isotone in this project from 0.3.4 to 0.4.0: run `pnpm add -D isotone@0.4.0` in /workspace/design app, restart the dev server if you run it, check the Isotone panel still loads, then tell me what changed (the new CHANGELOG.md).',
    );
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Prompt copied');
    await click('[aria-label="Close update"]');
    await click('.isotone-update-trigger');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('shows the command and directory on request, selected for copying', async () => {
    await render();
    await click('.isotone-update-trigger');
    await click('[aria-expanded="false"].isotone-update-quiet');
    const command = host.querySelector<HTMLInputElement>('[aria-label="Upgrade command"]');
    expect(command?.value).toBe('pnpm add -D isotone@0.4.0');
    expect(command?.readOnly).toBe(true);
    expect(document.activeElement).toBe(command);
    expect(command?.selectionEnd).toBe(command?.value.length);
    expect(host.querySelector('.isotone-update-path')?.textContent).toBe('in /workspace/design app');
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/local-update']);
  });

  it('reveals the command when clipboard permission is denied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    await render();
    await click('.isotone-update-trigger');
    await click('.isotone-update-actions button');
    const command = host.querySelector<HTMLInputElement>('[aria-label="Upgrade command"]');
    expect(document.activeElement).toBe(command);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Could not copy. The command is below.');
  });

  it('closes on Escape and returns focus without propagating to the host app', async () => {
    const hostKey = vi.fn();
    await act(async () => root.render(h('div', { onKeyDown: hostKey }, h(UpdateNotice, { endpoint: '/local-update', active: true }))));
    await click('.isotone-update-trigger');
    await act(async () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('.isotone-update-trigger'));
    expect(hostKey).not.toHaveBeenCalled();
  });

  it('shows a useful explanation when the package manager could not be identified', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ ...available, upgrade: null, message: 'Open the app directory and run isotone check-update.' }),
    );
    await render('/local-update', true, { onRequested: vi.fn() });
    await click('.isotone-update-trigger');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Open the app directory and run isotone check-update.');
    expect(host.querySelector('.isotone-update-ask')).toBeNull();
    expect(host.querySelector('[aria-label="Upgrade command"]')).toBeNull();
  });
});
