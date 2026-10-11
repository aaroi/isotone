import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createIterationStore, type IterationNote } from '../src/core/index';
import { createOverlayVariantsSource, KNOBS_STORAGE_KEY } from '../src/core/variants';

let values: Map<string, string>;
let storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const previousKey = 'iso-iterate-feedback';
const currentKey = 'isotone-feedback';
const note = (id: string, feedback = id): IterationNote => ({
  id, feedback, route: '/', element: null, done: false, createdAt: '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: key => { values.delete(key); },
  };
  vi.stubGlobal('window', { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

it('merges offline notes and defaults by ID while keeping current copies and complete context', async () => {
  const previous = { ...note('previous'), elements: [{ tag: 'button', text: 'Save', selector: '#save' }], payload: { context: 'kept' } };
  const defaults = { ...note('defaults', '[set-defaults] compact'), payload: { knobs: 'spacing:8' } };
  values.set(previousKey, JSON.stringify([previous, note('shared', 'Old edit'), defaults]));
  values.set(currentKey, JSON.stringify([note('shared', 'Current edit'), note('current')]));
  const notes = await createIterationStore().listNotes();
  expect(notes).toHaveLength(4);
  expect(notes).toContainEqual(previous);
  expect(notes).toContainEqual(defaults);
  expect(notes.find(item => item.id === 'shared')?.feedback).toBe('Current edit');
  expect(JSON.parse(values.get(currentKey) ?? '[]')).toEqual(expect.arrayContaining(notes));
  expect(values.has(previousKey)).toBe(false);
});

it.each(['throws', 'does not persist'])('retains readable legacy notes when migration %s', async failure => {
  values.set(previousKey, JSON.stringify([note('previous')]));
  storage.setItem = () => { if (failure === 'throws') throw new Error('Storage full'); };
  expect(await createIterationStore().listNotes()).toEqual([note('previous')]);
  expect(values.has(previousKey)).toBe(true);
  expect(values.has(currentKey)).toBe(false);
});

it('preserves both queues and reports malformed local feedback instead of overwriting it', async () => {
  values.set(previousKey, '{broken');
  values.set(currentKey, JSON.stringify([note('current')]));
  await expect(createIterationStore().listNotes()).rejects.toThrow('Browser storage has been left untouched');
  expect(values.get(previousKey)).toBe('{broken');
  expect(JSON.parse(values.get(currentKey) ?? '[]')).toEqual([note('current')]);
});

it('leaves explicitly configured custom namespaces alone', async () => {
  values.set(previousKey, JSON.stringify([note('unrelated')]));
  values.set('project-review', JSON.stringify([note('custom')]));
  expect(await createIterationStore({ key: 'project-review' }).listNotes()).toEqual([note('custom')]);
  expect(values.has(previousKey)).toBe(true);
  expect(values.has(currentKey)).toBe(false);
});

it('synchronizes migrated feedback once and clears only acknowledged local copies', async () => {
  values.set(previousKey, JSON.stringify([note('offline')]));
  const posted: IterationNote[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const saved = JSON.parse(String(init.body));
      posted.push(saved);
      return { ok: true, json: async () => ({ id: saved.id }) };
    }
    return { ok: true, json: async () => posted };
  }));
  const store = createIterationStore({ endpoint: '/notes' });
  await store.listNotes();
  await store.listNotes();
  expect(posted.map(item => item.id)).toEqual(['offline']);
  expect(values.has(previousKey)).toBe(false);
  expect(values.get(currentKey)).toBe('[]');
});

it('merges saved knob values with current selections winning collisions', () => {
  values.set('iso-iterate:knobs', JSON.stringify({ spacing: '8', accent: '#112233' }));
  values.set(KNOBS_STORAGE_KEY, JSON.stringify({ spacing: '12', radius: '4' }));
  const source = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', storage, knobRoot: null });
  expect(source.knobs.values).toEqual({ spacing: '12', accent: '#112233', radius: '4' });
  expect(values.has('iso-iterate:knobs')).toBe(false);
  expect(JSON.parse(values.get(KNOBS_STORAGE_KEY) ?? '{}')).toEqual(source.knobs.values);
});

it('uses legacy knob values for the page even when migration cannot be saved', () => {
  values.set('iso-iterate:knobs', JSON.stringify({ spacing: '8' }));
  storage.setItem = () => { throw new Error('Storage full'); };
  const source = createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', storage, knobRoot: null });
  expect(source.knobs.values).toEqual({ spacing: '8' });
  expect(values.has('iso-iterate:knobs')).toBe(true);
});
