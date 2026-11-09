import { afterEach, expect, it, vi } from 'vitest';
import { createIsotoneStore } from '../../src/core/notes-client';

afterEach(() => vi.unstubAllGlobals());

it('replaces pending defaults offline and migrates only the latest snapshot', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const local = createIsotoneStore({ key: 'defaults-test' });
  const first = await local.saveNote('/', '[set-defaults] v1', null, null, { variants: 'old' });
  const second = await local.saveNote('/', '[set-defaults] v2', null, null, { variants: 'new' });
  expect(second).toBe(first);
  await local.saveNote('/other', '[set-defaults] other', null, null);
  await local.saveNote('/', 'A normal note', null, null);
  const notes = await local.listNotes('/');
  expect(notes).toHaveLength(2);
  expect(notes.find((n) => n.id === first)?.payload).toEqual({ variants: 'new' });
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const item = JSON.parse(String(init.body));
        posted.push(item);
        return { ok: true, json: async () => ({ id: item.id }) };
      }
      return { ok: true, json: async () => [] };
    }),
  );
  await createIsotoneStore({ key: 'defaults-test', endpoint: '/notes' }).listNotes();
  expect(posted.filter((n) => n.route === '/' && String(n.feedback).startsWith('[set-defaults]'))).toEqual([
    expect.objectContaining({ feedback: '[set-defaults] v2', payload: { variants: 'new' } }),
  ]);
});

const closedNote = (id: string) => ({
  id,
  route: '/',
  feedback: `Note ${id}`,
  element: null,
  done: true,
  doneAt: new Date().toISOString(),
  createdAt: '2026-01-01T00:00:00Z',
  resolution: { at: new Date().toISOString() },
});

function memory() {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  return values;
}

it('lists closed notes awaiting a check in the local fallback, until checked or a week old', async () => {
  const values = memory();
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const note = (id: string, extra: object) => ({ id, route: '/', feedback: id, element: null, createdAt: at(10), ...extra });
  values.set(
    'check-test',
    JSON.stringify([
      note('open', { done: false }),
      note('closed', { done: true, doneAt: at(1), resolution: { summary: 'Gap to 24px', at: at(1) } }),
      note('checked', { done: true, doneAt: at(1), checkedAt: at(0), resolution: { at: at(1) } }),
      note('old', { done: true, doneAt: at(8), resolution: { at: at(8) } }),
      // Closed by a CLI from before closes were recorded.
      note('unrecorded', { done: true, doneAt: at(1) }),
      note('undated', { done: true }),
    ]),
  );
  const store = createIsotoneStore({ key: 'check-test' });
  const ids = async () => ((await store.pollNotes(null)).notes ?? []).map((n) => n.id).sort();
  expect(await ids()).toEqual(['closed', 'open']);
  expect((await store.pendingNotes()).map((n) => n.id).sort()).toEqual(['closed', 'open']);
  await store.checkNote(closedNote('closed'));
  expect(await ids()).toEqual(['open']);
});

it('reopens a closed note saved unchanged with reopen, locally and on the server', async () => {
  const values = memory();
  values.set(
    'reopen-test',
    JSON.stringify([
      {
        id: 'a',
        route: '/',
        feedback: 'More room',
        element: null,
        done: true,
        doneAt: new Date().toISOString(),
        createdAt: '2026-01-01T00:00:00Z',
        resolution: { summary: 'x', at: '2026-01-01T00:00:00Z' },
      },
    ]),
  );
  const local = createIsotoneStore({ key: 'reopen-test' });
  await local.saveNote('/', 'More room', null, 'a', undefined, undefined, undefined, true);
  const [reopened] = await local.listNotes('/');
  expect(reopened).toMatchObject({ done: false, doneAt: null });
  expect(reopened).not.toHaveProperty('resolution');

  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)));
      return { ok: true, status: 200, json: async () => ({ id: 'b' }) };
    }),
  );
  const remote = createIsotoneStore({ key: 'remote-test', endpoint: '/notes' });
  await remote.saveNote('/', 'More room', null, 'b', undefined, undefined, undefined, true);
  await remote.checkNote(closedNote('b'));
  expect(posted).toEqual([expect.objectContaining({ id: 'b', reopen: true }), { id: 'b', route: '/', checked: true }]);
});

it('throws when the server refuses a check, so the panel can put the row back', async () => {
  memory();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })),
  );
  await expect(createIsotoneStore({ key: 'refuse-test', endpoint: '/notes' }).checkNote(closedNote('a'))).rejects.toThrow('(400)');
});

it('keeps a Not quite and a Looks good made while the server is away, and sends them when it is back', async () => {
  const values = memory();
  let up = false;
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!up) return { ok: false, status: 503, json: async () => ({ error: 'busy' }) };
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posted.push(body);
        return { ok: true, status: 200, json: async () => ({ id: body.id }) };
      }
      return { ok: true, status: 200, json: async () => ({ rev: 'r', notes: [] }) };
    }),
  );
  const store = createIsotoneStore({ key: 'away-test', endpoint: '/notes' });
  await store.saveNote('/', 'Note a', null, 'a', undefined, undefined, undefined, true);
  await store.checkNote(closedNote('b'));
  const queued = JSON.parse(values.get('away-test') ?? '[]') as Record<string, unknown>[];
  expect(queued).toEqual([
    expect.objectContaining({ id: 'a', reopen: true, done: false }),
    expect.objectContaining({ id: 'b', checked: true }),
  ]);
  // While waiting, the checked note is not listed again.
  expect((await store.pendingNotes()).map((n) => n.id)).toEqual(['a']);
  up = true;
  await store.pollNotes(null);
  expect(posted).toEqual([expect.objectContaining({ id: 'a', feedback: 'Note a', reopen: true }), { id: 'b', route: '/', checked: true }]);
  expect(JSON.parse(values.get('away-test') ?? '[]')).toEqual([]);
});

const askedNote = (id: string) => ({
  id,
  route: '/',
  feedback: `Note ${id}`,
  element: null,
  done: false,
  createdAt: '2026-01-01T00:00:00Z',
  reply: { text: 'Bolder, or more contrast?', at: '2026-01-01T00:01:00Z', choices: ['Bolder', 'More contrast'] },
});

it('keeps an answer given while the server is away, shows it answered, and sends it when the server is back', async () => {
  const values = memory();
  let up = false;
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (!up) throw new TypeError('Failed to fetch');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posted.push(body);
        return { ok: true, status: 200, json: async () => ({ id: body.id }) };
      }
      return { ok: true, status: 200, json: async () => ({ rev: 'r', notes: [askedNote('a')] }) };
    }),
  );
  const store = createIsotoneStore({ key: 'answer-test', endpoint: '/notes' });
  await store.answerNote(askedNote('a'), 'More contrast');
  expect(JSON.parse(values.get('answer-test') ?? '[]')).toEqual([expect.objectContaining({ id: 'a', answer: 'More contrast' })]);
  expect((await store.pendingNotes())[0]?.reply).toMatchObject({ answered: true, answer: { text: 'More contrast' } });
  up = true;
  await store.pollNotes(null);
  expect(posted).toEqual([{ id: 'a', route: '/', answer: 'More contrast' }]);
  expect(JSON.parse(values.get('answer-test') ?? '[]')).toEqual([]);
});

it('posts an answer, throws on a refusal, and drops a queued one the server calls moot', async () => {
  const values = memory();
  let status = 200;
  const posted: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push(JSON.parse(String(init.body)));
      return { ok: status < 300, status, json: async () => (status < 300 ? { id: 'a', rev: 'r', notes: [] } : { error: 'no' }) };
    }),
  );
  const store = createIsotoneStore({ key: 'answer-refuse', endpoint: '/notes' });
  await store.answerNote(askedNote('a'), 'Bolder');
  expect(posted).toEqual([{ id: 'a', route: '/', answer: 'Bolder' }]);
  status = 400;
  await expect(store.answerNote(askedNote('a'), 'Bolder')).rejects.toThrow('(400)');
  expect(values.get('answer-refuse')).toBeUndefined();
  // Queued while the server failed, then refused (the agent asked anew meanwhile): dropped, not retried for ever.
  status = 503;
  await store.answerNote(askedNote('a'), 'Bolder');
  expect(JSON.parse(values.get('answer-refuse') ?? '[]')).toHaveLength(1);
  status = 400;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  await store.pollNotes(null).catch(() => {});
  expect(JSON.parse(values.get('answer-refuse') ?? '[]')).toEqual([]);
});

it('answers in the browser alone when there is no endpoint', async () => {
  const values = memory();
  values.set('answer-local', JSON.stringify([askedNote('a')]));
  const store = createIsotoneStore({ key: 'answer-local' });
  await store.answerNote(askedNote('a'), 'Bolder');
  expect((await store.listNotes('/'))[0]?.reply).toMatchObject({ answered: true, answer: { text: 'Bolder' } });
});
