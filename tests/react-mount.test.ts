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
});
