import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type FeedbackEntry, postgresStore } from '../../src/feedback/index';

// A real Postgres, in process: the statements are checked by the database itself.
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.waitReady;
});
afterAll(() => db.close());

const request = new Request('https://app.example/api/feedback', { method: 'POST' });
const entry = (over: Partial<FeedbackEntry> = {}): FeedbackEntry => ({
  id: 'note-1',
  keyHash: 'hash-of-adas-key',
  createdAt: '2026-11-13T10:00:00.000Z',
  author: 'Ada Lovelace',
  feedback: "The title's wrap is off; DROP TABLE isotone_feedback;--",
  route: '/projects',
  elements: [{ tag: 'h1', text: 'Projects', selector: 'main > h1' }],
  browser: { userAgent: 'Mozilla/5.0 Test', language: 'fi-FI' },
  ...over,
});
const rows = async (table: string) => (await db.query<Record<string, unknown>>(`select * from ${table} order by id`)).rows;

describe('a Postgres store', () => {
  it('creates the table on the first write and stores each note as a row', async () => {
    const store = postgresStore(db);
    expect(await store.save(entry(), request)).toBe(true);
    await store.save(
      entry({
        id: 'note-2',
        identity: 'ada@example.com',
        url: 'https://app.example/projects',
        release: 'a1b2c3d',
        viewport: { w: 1280, h: 720 },
        variant: { axisId: 'layout', label: 'Layout' },
        selections: { layout: 'grid' },
        payload: { plan: 'pro' },
      }),
      request,
    );
    const stored = await rows('isotone_feedback');
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      id: 'note-1',
      key_hash: 'hash-of-adas-key',
      author: 'Ada Lovelace',
      identity: null,
      feedback: "The title's wrap is off; DROP TABLE isotone_feedback;--",
      route: '/projects',
      url: null,
      release: null,
      user_agent: 'Mozilla/5.0 Test',
      viewport: null,
      elements: [{ tag: 'h1', text: 'Projects', selector: 'main > h1' }],
      variant: null,
      selections: null,
      browser: { userAgent: 'Mozilla/5.0 Test', language: 'fi-FI' },
      payload: null,
      updated_at: null,
    });
    expect(new Date(String(stored[0]?.created_at)).toISOString()).toBe('2026-11-13T10:00:00.000Z');
    expect(stored[1]).toMatchObject({
      identity: 'ada@example.com',
      url: 'https://app.example/projects',
      release: 'a1b2c3d',
      viewport: { w: 1280, h: 720 },
      variant: { axisId: 'layout', label: 'Layout' },
      selections: { layout: 'grid' },
      payload: { plan: 'pro' },
    });
    // What a developer would write on day one.
    const found = await db.query('select author from isotone_feedback where route = \'/projects\' and elements @> \'[{"tag":"h1"}]\'');
    expect(found.rows).toHaveLength(2);
  });

  it('stores a note sent twice once, without calling the retry an edit', async () => {
    const store = postgresStore(db, { table: 'retried' });
    await store.save(entry(), request);
    expect(await store.save(entry(), request)).toBe(true);
    expect(await rows('retried')).toMatchObject([{ id: 'note-1', updated_at: null }]);
  });

  it('replaces what the writer changed, and keeps where and when the note was first written', async () => {
    const store = postgresStore(db, { table: 'edited' });
    await store.save(
      entry({
        payload: { plan: 'pro' },
        viewport: { w: 1280, h: 720 },
        url: 'https://app.example/projects',
        selections: { layout: 'grid' },
      }),
      request,
    );
    // Edited later from a phone, on another page, with other selections.
    const saved = await store.save(
      entry({
        feedback: 'Shorter now',
        author: 'Ada L.',
        elements: [],
        variant: { axisId: 'layout', label: 'Layout' },
        createdAt: '2026-11-14T08:00:00.000Z',
        route: '/settings',
        url: 'https://app.example/settings',
        viewport: { w: 390, h: 844 },
        selections: { layout: 'list' },
        browser: { userAgent: 'Phone' },
      }),
      request,
    );
    expect(saved).toBe(true);
    const [row] = await rows('edited');
    expect(row).toMatchObject({
      feedback: 'Shorter now',
      author: 'Ada L.',
      elements: [],
      variant: { axisId: 'layout', label: 'Layout' },
      route: '/projects',
      url: 'https://app.example/projects',
      viewport: { w: 1280, h: 720 },
      selections: { layout: 'grid' },
      user_agent: 'Mozilla/5.0 Test',
      payload: { plan: 'pro' },
    });
    expect(new Date(String(row?.created_at)).toISOString()).toBe('2026-11-13T10:00:00.000Z');
    expect(row?.updated_at).not.toBeNull();
  });

  it('keeps who the app said wrote a note when it is edited signed out', async () => {
    const store = postgresStore(db, { table: 'identified' });
    await store.save(entry({ identity: 'ada@example.com' }), request);
    await store.save(entry({ feedback: 'Edited after signing out' }), request);
    await store.save(entry({ id: 'note-2' }), request);
    await store.save(entry({ id: 'note-2', identity: 'grace@example.com' }), request);
    expect(await rows('identified')).toMatchObject([
      { feedback: 'Edited after signing out', identity: 'ada@example.com' },
      // A note written signed out gains an identity when its writer edits it signed in.
      { id: 'note-2', identity: 'grace@example.com' },
    ]);
  });

  it('leaves a note alone for any other key, and says so', async () => {
    const store = postgresStore(db, { table: 'guarded' });
    await store.save(entry(), request);
    expect(await store.save(entry({ keyHash: 'someone-elses', feedback: 'Overwritten!' }), request)).toBe(false);
    await store.remove('note-1', 'someone-elses', request);
    const [row] = await rows('guarded');
    expect(row).toMatchObject({ feedback: expect.stringContaining('wrap is off'), key_hash: 'hash-of-adas-key', updated_at: null });
  });

  it('removes a note for the key that wrote it, and is quiet about one that is not there', async () => {
    const store = postgresStore(db, { table: 'removed' });
    await store.save(entry(), request);
    await store.save(entry({ id: 'note-2' }), request);
    await store.remove('note-1', 'hash-of-adas-key', request);
    await store.remove('note-1', 'hash-of-adas-key', request);
    await store.remove("x'; drop table removed;--", 'hash-of-adas-key', request);
    expect((await rows('removed')).map((row) => row.id)).toEqual(['note-2']);
  });

  it('reads what postgres.js answers, which is the rows themselves', async () => {
    const answers: unknown[] = [[], [{ id: 'note-1' }], []];
    const store = postgresStore({ query: async () => answers.shift() });
    expect(await store.save(entry(), request)).toBe(true);
    expect(await store.save(entry(), request)).toBe(false);
  });

  it('casts JSON through text, so a driver that types its parameters does not encode it twice', async () => {
    const statements: string[] = [];
    const store = postgresStore({
      query: async (text) => {
        statements.push(text);
        return { rows: [{ id: 'note-1' }] };
      },
    });
    await store.save(entry(), request);
    const upsert = statements.find((text) => text.startsWith('insert')) ?? '';
    expect(upsert.match(/::text::jsonb/g)).toHaveLength(6);
    expect(upsert.replaceAll('::text::jsonb', '')).not.toContain('::jsonb');
  });

  it('writes to a named table, in a schema too', async () => {
    await db.exec('create schema app');
    await postgresStore(db, { table: 'app.reviews' }).save(entry(), request);
    expect((await db.query('select id from app.reviews')).rows).toEqual([{ id: 'note-1' }]);
  });

  it('refuses a table name that is more than a name', () => {
    for (const table of ['feedback; drop table users', 'a.b.c', '"quoted"', '', '1st'])
      expect(() => postgresStore(db, { table })).toThrow('table must be a plain name');
  });

  it('creates the table once per process, and writes even when it may not create', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (text: string) => {
        statements.push(text.slice(0, 6));
        if (text.startsWith('create')) throw new Error('permission denied for schema public');
        return { rows: [{ id: 'x' }] };
      }),
    };
    const store = postgresStore(client);
    await store.save(entry(), request);
    await store.save(entry({ id: 'note-2' }), request);
    await store.remove('note-2', 'hash-of-adas-key', request);
    expect(statements).toEqual(['create', 'insert', 'insert', 'delete']);
  });

  it('reports a failed write, and looks for the table again on the next one', async () => {
    const store = postgresStore(db, { table: 'dropped' });
    await store.save(entry(), request);
    await db.exec('drop table dropped');
    await expect(store.save(entry({ id: 'note-2' }), request)).rejects.toThrow(/dropped/);
    await store.save(entry({ id: 'note-3' }), request);
    expect((await db.query('select id from dropped')).rows).toEqual([{ id: 'note-3' }]);
  });
});
