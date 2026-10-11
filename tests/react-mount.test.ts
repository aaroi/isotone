// @vitest-environment jsdom
/**
 * The self-mount against a host that puts its own React root on `document`.
 *
 * react-dom dedupes delegated listeners with a marker on the container and,
 * for every non-document container, on the owner document as well. A root
 * created on the document afterwards sees that marker and skips attaching its
 * listeners, so `hydrateRoot(document, …)` in a host that loaded the panel
 * first (React Router 7's default entry.client) ended up with no working
 * onClick anywhere. Both cases below run before any timer fires, so the
 * panel's deferred render stays out of the picture: the bug is in
 * `createRoot` itself, not in what we render.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountIteration } from '../src/react/index';

beforeEach(() => {
  // React's act() warns unless the environment declares itself.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Tear the panel down without ever rendering it: `off` before the mount
 *  timer fires makes the mount a no-op, and the unmount runs on its own timer. */
function dispose(off: () => void) {
  off();
  vi.runAllTimers();
}

describe('mountIteration next to a document-level host root', () => {
  it('leaves no react-dom marker on the document', () => {
    const before = Object.getOwnPropertyNames(document);
    const off = mountIteration({ endpoint: '/api/iteration/notes' });
    expect(Object.getOwnPropertyNames(document)).toEqual(before);
    dispose(off);
  });

  it('a host root created on document afterwards still receives events', async () => {
    const off = mountIteration({ endpoint: '/api/iteration/notes' });

    const onClick = vi.fn();
    const host = createRoot(document);
    await act(async () => {
      host.render(
        createElement(
          'html',
          null,
          createElement('head', null),
          createElement('body', null, createElement('button', { id: 'go', type: 'button', onClick }, 'go')),
        ),
      );
    });

    const button = document.getElementById('go');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClick).toHaveBeenCalledTimes(1);

    await act(async () => host.unmount());
    dispose(off);
  });

  it('re-attaches the host (shadow root and panel intact) when the body is replaced', async () => {
    const off = mountIteration({ endpoint: '/api/iteration/notes' });
    // Let the deferred mount run and the observer take over.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const host = document.querySelector('[data-isotone="root"]');
    expect(host).not.toBeNull();
    expect(host?.shadowRoot).not.toBeNull();

    // A whole-document React app that fails hydration re-renders the body
    // from scratch, dropping any runtime host div the way our host is dropped.
    document.body.replaceChildren();
    // The MutationObserver delivers in a microtask; flush it.
    await act(async () => {});

    // The observer re-appends the SAME host; nothing was re-mounted, so the
    // shadow root survives instead of a duplicate host appearing.
    expect(document.body.contains(host)).toBe(true);
    expect(document.querySelectorAll('[data-isotone="root"]')).toHaveLength(1);
    expect(host?.shadowRoot).not.toBeNull();

    dispose(off);
  });
});
