import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIterationStore, type IterationNote } from '../src/core';
import { FEEDBACK_STORAGE_KEY } from '../src/core/browser-storage';
import { MAX_FEEDBACK_LENGTH } from '../src/core/limits';
import { createOverlayVariantsSource, createVariantsSource, visibleAxes, type OverlayVariantsList, type SelectVariantAxis } from '../src/core/variants';
import { request } from '../src/core/request';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
  return values;
}

describe('offline recovery', () => {
  it('does not discard a note when a successful HTTP response has no acknowledgement', async () => {
    storage();
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => Response.json(init?.method === 'POST' ? {} : [])));
    const store = createIterationStore({ endpoint: '/notes' });
    const id = await store.saveNote('/', 'Keep until acknowledged', null, null);
    expect(store.lastSave).toBe('local');
    expect(await store.listNotes()).toMatchObject([{ id, feedback: 'Keep until acknowledged' }]);
    expect(await createIterationStore().listNotes()).toHaveLength(1);
  });
  it('reuses the id when the server saved a note but its response was lost', async () => {
    storage();
    const saved = new Map<string, IterationNote>();
    let fail = true;
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const item = JSON.parse(String(init.body));
        saved.set(item.id, { ...item, createdAt: new Date().toISOString(), done: false });
        if (fail) { fail = false; throw new Error('Connection lost after commit'); }
        return Response.json({ id: item.id });
      }
      return Response.json([...saved.values()]);
    }));
    const store = createIterationStore({ endpoint: '/notes' });
    const id = await store.saveNote('/', 'Keep me exactly once', null, null);
    expect(store.lastSave).toBe('local');
    const notes = await store.listNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].id).toBe(id);
    expect(saved.size).toBe(1);
  });

  it('acknowledges successful items individually when a later upload fails', async () => {
    storage();
    const local = createIterationStore();
    const first = await local.saveNote('/', 'First', null, null);
    const second = await local.saveNote('/', 'Second', null, null);
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (!init?.method) return Response.json([]);
      const item = JSON.parse(String(init.body));
      posted.push(item.id);
      return item.id === first ? Response.json({ id: first }) : new Response(null, { status: 503 });
    }));
    const remote = createIterationStore({ endpoint: '/notes' });
    await remote.listNotes();
    await remote.listNotes();
    expect(posted).toEqual([first, second, second]);
    expect(await local.listNotes()).toMatchObject([{ id: second }]);
  });

  it('rejects overlong feedback before an offline save can block the queue', async () => {
    storage();
    const fetcher = vi.fn(async () => { throw new Error('Offline'); });
    vi.stubGlobal('fetch', fetcher);
    const store = createIterationStore({ endpoint: '/notes' });
    await expect(store.saveNote('/', 'x'.repeat(MAX_FEEDBACK_LENGTH + 1), null, null))
      .rejects.toThrow(`at most ${MAX_FEEDBACK_LENGTH} characters`);
    expect(await createIterationStore().listNotes()).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps old or rejected notes locally while syncing later valid notes', async () => {
    const values = storage();
    const old = { id: 'old-long', route: '/', feedback: 'x'.repeat(MAX_FEEDBACK_LENGTH + 1),
      element: null, done: false, createdAt: '2026-01-01T00:00:00Z' };
    const rejected = { ...old, id: 'rejected', feedback: 'Server rejects this', createdAt: '2026-01-01T00:00:01Z' };
    const later = { ...old, id: 'later', feedback: 'Sync this', createdAt: '2026-01-01T00:00:02Z' };
    values.set(FEEDBACK_STORAGE_KEY, JSON.stringify([old, rejected, later]));
    const posted: string[] = [];
    const remote: IterationNote[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const item = JSON.parse(String(init.body)) as IterationNote;
        posted.push(item.id);
        if (item.id === rejected.id) return Response.json({ error: 'invalid' }, { status: 400 });
        remote.push(item);
        return Response.json({ id: item.id });
      }
      return Response.json(remote);
    }));
    const store = createIterationStore({ endpoint: '/notes' });
    expect((await store.listNotes()).map(note => note.id)).toEqual(['later', 'rejected', 'old-long']);
    expect(posted).toEqual(['rejected', 'later']);
    expect(remote.map(note => note.id)).toEqual(['later']);
    expect(store.hasUnsyncedNotes).toBe(true);
    expect((await createIterationStore().listNotes()).map(note => note.id)).toEqual(['rejected', 'old-long']);
    await store.saveNote('/', 'New successful note', null, null);
    expect(store.lastSave).toBe('local');
  });

  it('keeps new notes and newer edits made while a backlog request is in flight', async () => {
    storage();
    const local = createIterationStore();
    const id = await local.saveNote('/', 'Before', null, null);
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') { await paused; return Response.json({ id }); }
      return Response.json([]);
    }));
    const remote = createIterationStore({ endpoint: '/notes' });
    const firstRead = remote.listNotes();
    const concurrentRead = remote.pendingNotes();
    await local.saveNote('/', 'After', null, id);
    await local.saveNote('/', 'New note', null, null);
    release();
    await Promise.all([firstRead, concurrentRead]);
    expect((await local.listNotes()).map((note) => note.feedback).sort()).toEqual(['After', 'New note']);
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('shows unsynced notes during an outage and does not queue validation errors', async () => {
    storage();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Offline')));
    const store = createIterationStore({ endpoint: '/notes' });
    const id = await store.saveNote('/', 'Offline note', null, null);
    expect(await store.listNotes()).toMatchObject([{ id }]);
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 400 }));
    await expect(store.saveNote('/', 'Invalid request', null, null)).rejects.toThrow('400');
    expect(await createIterationStore().listNotes()).toHaveLength(1);
  });

  it('can save to the server when browser storage is blocked', async () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('Storage blocked'); } });
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => Response.json({ id: JSON.parse(String(init?.body)).id })));
    const store = createIterationStore({ endpoint: '/notes' });
    await expect(store.saveNote('/', 'Server persisted', null, null)).resolves.toBeTypeOf('string');
    expect(store.lastSave).toBe('server');
  });
});

describe('bounded local transport', () => {
  function stalledBody(status = 200) {
    const response = new Response(null, { status });
    vi.spyOn(response, 'json').mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', vi.fn(async () => response));
  }

  it('times out a JSON body even after its headers arrived', async () => {
    vi.useFakeTimers();
    stalledBody();
    const reading = request('/notes', undefined, response => response.json());
    const rejected = expect(reading).rejects.toThrow('did not respond in time');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a save offline when its response body stalls', async () => {
    vi.useFakeTimers();
    storage();
    stalledBody();
    const store = createIterationStore({ endpoint: '/notes' });
    const saving = store.saveNote('/', 'Still here', null, null);
    await vi.advanceTimersByTimeAsync(5000);
    const id = await saving;
    expect(store.lastSave).toBe('local');
    expect(await createIterationStore().listNotes()).toMatchObject([{ id, feedback: 'Still here' }]);
  });

  it('does not queue a rejected save when its error body stalls', async () => {
    vi.useFakeTimers();
    storage();
    stalledBody(400);
    const store = createIterationStore({ endpoint: '/notes' });
    const rejected = expect(store.saveNote('/', 'Invalid', null, null)).rejects.toThrow('400');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(await createIterationStore().listNotes()).toEqual([]);
  });

  it('honors a cancelled caller before starting any request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    const controller = new AbortController();
    controller.abort(new Error('Cancelled by caller'));
    await expect(request('/notes', { signal: controller.signal })).rejects.toThrow('Cancelled by caller');
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a caller cancellation during body consumption and cleans the timer', async () => {
    vi.useFakeTimers();
    stalledBody();
    const controller = new AbortController();
    const reading = request('/notes', { signal: controller.signal }, response => response.json());
    const rejected = expect(reading).rejects.toThrow('Stop reading');
    await Promise.resolve();
    controller.abort(new Error('Stop reading'));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('large selector graphs', () => {
  const axis = (id: string): SelectVariantAxis => ({ id, label: id, defaultOption: 'on', options: [{ id: 'on', label: 'On' }, { id: 'off', label: 'Off' }] });

  it('evaluates 10,000 dependent axes without recursion or leaking hidden descendants', () => {
    const axes = Array.from({ length: 10_000 }, (_, i) => ({ ...axis(String(i)),
      ...(i ? { showWhen: { axis: String(i - 1), equals: 'on' } } : {}),
    })).reverse();
    expect(visibleAxes(axes, {})).toHaveLength(10_000);
    expect(visibleAxes(axes, { '0': 'off' }).map((a) => a.id)).toEqual(['0']);
  });

  it('hides cycles and ignores invalid initial selections', () => {
    const a = { ...axis('a'), showWhen: { axis: 'b', equals: 'on' } };
    const b = { ...axis('b'), showWhen: { axis: 'a', equals: 'on' } };
    expect(visibleAxes([a, b], {})).toEqual([]);
    expect(createVariantsSource({ axes: [axis('a')], selections: { a: 'unknown', missing: 'on' } }).getSelections()).toEqual({ a: 'on' });
  });
});

describe('overlay activation races', () => {
  const listing: OverlayVariantsList = {
    active: [],
    variants: ['a', 'b'].map((id) => ({ id, label: id, group: id, createdAt: '', files: {}, stale: [], missing: [] })),
  };
  const source = () => createOverlayVariantsSource({ endpoint: '/variants', getRoute: () => '/', storage: null, knobRoot: null });
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('serializes rapid picks and keeps both groups when an earlier activation fails', async () => {
    let release!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { release = resolve; });
    const posts: string[][] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json(listing);
      const { active } = JSON.parse(String(init.body));
      posts.push(active);
      return posts.length === 1 ? first : Response.json({ active });
    }));
    const store = source();
    await store.refresh();
    store.setSelection('a', 'a');
    await settle();
    store.setSelection('b', 'b');
    expect(store.getSelections()).toEqual({ a: 'a', b: 'b' });
    expect(posts).toEqual([['a']]);
    release(new Response(null, { status: 503 }));
    await settle();
    expect(posts).toEqual([['a'], ['a', 'b']]);
    expect(store.list?.active).toEqual(['a', 'b']);
    expect(store.getError?.()).toBeNull();
  });

  it('reports failure, rolls back to confirmed selections and can retry', async () => {
    let failing = true;
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method !== 'POST') return Response.json(listing);
      return failing ? new Response(null, { status: 409 }) : Response.json({ active: ['a'] });
    }));
    const store = source();
    await store.refresh();
    store.setSelection('a', 'a');
    await settle();
    expect(store.getError?.()).toContain('409');
    expect(store.getSelections().a).toBe('default');
    failing = false;
    store.setSelection('a', 'a');
    await settle();
    expect(store.getError?.()).toBeNull();
    expect(store.getSelections().a).toBe('a');
  });

  it('does not let an older listing undo an activation completed during refresh', async () => {
    let release!: (response: Response) => void;
    let getCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      if (init?.method === 'POST') return Response.json({ active: ['a'] });
      if (++getCount === 1) return Response.json(listing);
      return new Promise<Response>((resolve) => { release = resolve; });
    }));
    const store = source();
    await store.refresh();
    const refresh = store.refresh();
    store.setSelection('a', 'a');
    await settle();
    release(Response.json(listing));
    await refresh;
    expect(store.getSelections().a).toBe('a');
  });
});
