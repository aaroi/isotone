// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateInfo } from '../src/core/update';
import { UpdateNotice } from '../src/react/UpdateNotice';

const available: UpdateInfo = {
  status: 'available', currentVersion: '0.3.4', latestVersion: '0.4.0',
  upgrade: { manager: 'pnpm', command: 'pnpm add -D isotone@0.4.0', cwd: '/workspace/design app' },
};
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(available)));
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

function render(endpoint: string | undefined = '/local-update', active = true) {
  return act(async () => root.render(h(UpdateNotice, { endpoint, active })));
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

  it.each(['current', 'ahead', 'unavailable', 'disabled'] as const)('stays invisible for %s', async status => {
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
    vi.mocked(fetch).mockImplementation(async () => Response.json({ ...available, status: 'checking', latestVersion: null, upgrade: null }));
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
    vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await render('/old-update');
    await render('/new-update');
    expect(host.textContent).toContain('Update 0.4.0');
    await act(async () => resolveOld(Response.json({ ...available, latestVersion: '99.0.0' })));
    expect(host.textContent).not.toContain('99.0.0');
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...available, status: 'unavailable' }));
    await render('/unavailable-update');
    expect(host.textContent).toBe('');
  });
});

describe('upgrade instructions', () => {
  it('shows exact versions, directory and command from the local adapter', async () => {
    await render();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click('.isotone-update-trigger');
    const dialog = host.querySelector('[role="dialog"]');
    const command = host.querySelector<HTMLInputElement>('[aria-label="Upgrade command"]');
    expect(dialog?.textContent).toContain('0.3.4 → 0.4.0');
    expect(host.querySelector('.isotone-update-path')?.textContent).toBe('/workspace/design app');
    expect(command?.value).toBe('pnpm add -D isotone@0.4.0');
    expect(command?.readOnly).toBe(true);
    expect(document.activeElement).toBe(command);
    expect(command?.selectionStart).toBe(0);
    expect(command?.selectionEnd).toBe(command?.value.length);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/local-update']);
  });

  it('copies the command, announces success and resets the confirmation when reopened', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await render();
    await click('.isotone-update-trigger');
    await click('.isotone-update-actions button');
    expect(writeText).toHaveBeenCalledExactlyOnceWith('pnpm add -D isotone@0.4.0');
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Ready to paste in your terminal');
    expect(host.querySelector('.isotone-update-actions button')?.textContent).toBe('Copied');
    await click('[aria-label="Close update instructions"]');
    await click('.isotone-update-trigger');
    expect(host.querySelector('.isotone-update-actions button')?.textContent).toBe('Copy command');
  });

  it('selects the command for manual copying when clipboard permission is denied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    await render();
    await click('.isotone-update-trigger');
    await click('.isotone-update-actions button');
    const command = host.querySelector<HTMLInputElement>('[aria-label="Upgrade command"]');
    expect(document.activeElement).toBe(command);
    expect(command?.selectionStart).toBe(0);
    expect(command?.selectionEnd).toBe(command?.value.length);
    expect(host.querySelector('[role="status"]')?.textContent).toBe('');
  });

  it('closes on Escape and returns focus without propagating to the host app', async () => {
    const hostKey = vi.fn();
    await act(async () => root.render(h('div', { onKeyDown: hostKey }, h(UpdateNotice, { endpoint: '/local-update', active: true }))));
    await click('.isotone-update-trigger');
    const command = host.querySelector<HTMLInputElement>('[aria-label="Upgrade command"]');
    await act(async () => command?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('.isotone-update-trigger'));
    expect(hostKey).not.toHaveBeenCalled();
  });

  it('shows a useful explanation when the package manager could not be identified', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ...available, upgrade: null, message: 'Open the app directory and run isotone check-update.' }));
    await render();
    await click('.isotone-update-trigger');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Open the app directory and run isotone check-update.');
    expect(host.querySelector('[aria-label="Upgrade command"]')).toBeNull();
  });
});
