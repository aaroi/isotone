import { afterEach, expect, it, vi } from 'vitest';
import { createIterationStore } from '../src/core/index';

afterEach(() => vi.unstubAllGlobals());

it('replaces pending defaults offline and migrates only the latest snapshot', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  const local = createIterationStore({ key: 'defaults-test' });
  const first = await local.saveNote('/', '[set-defaults] v1', null, null, { variants: 'old' });
  const second = await local.saveNote('/', '[set-defaults] v2', null, null, { variants: 'new' });
  expect(second).toBe(first);
  await local.saveNote('/other', '[set-defaults] other', null, null);
  await local.saveNote('/', 'A normal note', null, null);
  const notes = await local.listNotes('/');
  expect(notes).toHaveLength(2);
  expect(notes.find(n => n.id === first)?.payload).toEqual({ variants: 'new' });
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const item = JSON.parse(String(init.body));
      posted.push(item);
      return { ok: true, json: async () => ({ id: item.id }) };
    }
    return { ok: true, json: async () => [] };
  }));
  await createIterationStore({ key: 'defaults-test', endpoint: '/notes' }).listNotes();
  expect(posted.filter(n => n.route === '/' && String(n.feedback).startsWith('[set-defaults]'))).toEqual([expect.objectContaining({ feedback: '[set-defaults] v2', payload: { variants: 'new' } })]);
});
