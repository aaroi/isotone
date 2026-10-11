import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIterationStore } from '../src/core';
import { createNoteId } from '../src/core/id';

afterEach(() => vi.unstubAllGlobals());

describe('note IDs on HTTP development hosts', () => {
  it('uses random bytes when randomUUID is unavailable', async () => {
    let next = 0;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = next++;
        return bytes;
      },
    });
    const first = createNoteId();
    const second = createNoteId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);

    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return Response.json({ id: body.id });
    }));
    const store = createIterationStore({ endpoint: '/notes' });
    const id = await store.saveNote('/', 'Review this layout', null, null);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).id).toBe(id);
  });

  it('still creates distinct IDs if Web Crypto is entirely unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    const first = createNoteId();
    const second = createNoteId();
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
