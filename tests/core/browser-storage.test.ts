import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createIsotoneStore } from '../../src/core/notes-client';
import type { IsotoneNote } from '../../src/core/index';
import { createOverlayVariantsSource, KNOBS_STORAGE_KEY } from '../../src/core/variants';

let values: Map<string, string>;
let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const currentKey = 'isotone-feedback';
const note = (id: string, feedback = id): IsotoneNote => ({
  id,
  feedback,
  route: '/',
  element: null,
  done: false,
  createdAt: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  vi.stubGlobal('window', { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

it('reports malformed local feedback instead of overwriting it', async () => {
  values.set(currentKey, '{broken');
  await expect(createIsotoneStore().listNotes()).rejects.toThrow('Browser storage has been left untouched');
  expect(values.get(currentKey)).toBe('{broken');
});

it('keeps notes in an explicitly configured namespace', async () => {
  values.set(currentKey, JSON.stringify([note('default')]));
  values.set('project-review', JSON.stringify([note('custom')]));
  expect(await createIsotoneStore({ key: 'project-review' }).listNotes()).toEqual([note('custom')]);
});

it('synchronizes offline feedback once and clears only acknowledged local copies', async () => {
  values.set(currentKey, JSON.stringify([note('offline')]));
  const posted: IsotoneNote[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const saved = JSON.parse(String(init.body));
        posted.push(saved);
        return { ok: true, json: async () => ({ id: saved.id }) };
      }
      return { ok: true, json: async () => posted };
    }),
  );
  const store = createIsotoneStore({ endpoint: '/notes' });
  await store.listNotes();
  await store.listNotes();
  expect(posted.map((item) => item.id)).toEqual(['offline']);
  expect(values.get(currentKey)).toBe('[]');
});

it('keeps the selections a note was filed under while it waits offline, and sends them', async () => {
  const posted: Record<string, unknown>[] = [];
  let online = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!online) throw new TypeError('Failed to fetch');
      if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => (init?.method === 'POST' ? { id: posted.at(-1)?.id } : posted) };
    }),
  );
  const store = createIsotoneStore({ endpoint: '/notes' });
  const id = await store.saveNote('/', 'Rounder', null, null, undefined, undefined, { selections: { 'card-radius': '24' } });
  expect(JSON.parse(values.get(currentKey) ?? '[]')[0]).toMatchObject({ id, selections: { 'card-radius': '24' } });
  online = true;
  await store.listNotes();
  expect(posted).toEqual([expect.objectContaining({ id, selections: { 'card-radius': '24' } })]);
});

it('restores saved knob values and reads blocked storage as empty', () => {
  values.set(KNOBS_STORAGE_KEY, JSON.stringify({ spacing: '12' }));
  const source = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', storage, knobRoot: null });
  expect(source.knobs.values).toEqual({ spacing: '12' });
  storage.getItem = () => {
    throw new Error('Blocked');
  };
  const blocked = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', storage, knobRoot: null });
  expect(blocked.knobs.values).toEqual({});
});
