import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackEntry } from '../../src/feedback/index';

const pools: { config: unknown; query: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[] = [];
let missing = false;

vi.mock('pg', () => {
  class Pool {
    query = vi.fn(async () => ({ rows: [{ id: 'note-1' }] }));
    on = vi.fn();
    constructor(config: unknown) {
      if (missing) throw new Error('Cannot find package');
      pools.push({ config, query: this.query, on: this.on });
    }
  }
  // `pg` is CommonJS: its exports arrive under `default`.
  return { default: { Pool } };
});

const request = new Request('https://app.example/api/feedback', { method: 'POST' });
const entry: FeedbackEntry = {
  id: 'note-1',
  keyHash: 'hash',
  createdAt: '2026-11-13T10:00:00.000Z',
  author: 'Ada',
  feedback: 'Too tight',
  route: '/',
  elements: [],
  browser: {},
};

async function load() {
  return (await import('../../src/postgres/index')).postgres;
}

beforeEach(() => {
  pools.length = 0;
  missing = false;
  // Each test starts as a fresh process would.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('isotone.postgres.pools')];
});
afterEach(() => vi.restoreAllMocks());

describe('postgres(url)', () => {
  it('connects on the first note, not when the route module loads', async () => {
    const postgres = await load();
    const { save, remove } = postgres('postgres://user:pw@db.example/app');
    expect(pools).toHaveLength(0);
    await save(entry, request);
    expect(await save({ ...entry, id: 'note-2' }, request)).toBe(true);
    await remove('note-2', 'hash', request);
    expect(pools).toHaveLength(1);
    expect(pools[0]?.config).toEqual({ connectionString: 'postgres://user:pw@db.example/app', max: 2 });
    const statements = pools[0]?.query.mock.calls.map(([text]) => String(text).split(' ').slice(0, 2).join(' '));
    expect(statements).toEqual(['create table', 'insert into', 'insert into', 'delete from']);
  });

  it('hears a dropped idle connection instead of letting it crash the app', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const postgres = await load();
    await postgres('postgres://db.example/app').save(entry, request);
    const [event, listener] = pools[0]?.on.mock.calls[0] ?? [];
    expect(event).toBe('error');
    const dropped = new Error('Connection terminated unexpectedly');
    expect(() => listener(dropped)).not.toThrow();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('isotone'), dropped);
  });

  it('verifies the certificate authority of a provider that runs its own, whatever sslmode the URL carries', async () => {
    const postgres = await load();
    const ca = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    await postgres('postgres://u:p@db.example:5432/app?sslmode=require&application_name=web', { ca: `${ca}\n` }).save(entry, request);
    expect(pools[0]?.config).toEqual({ connectionString: 'postgres://u:p@db.example:5432/app?application_name=web', ssl: { ca }, max: 2 });
    // Another certificate is another connection, not the cached one.
    await postgres('postgres://u:p@db.example:5432/app?sslmode=require&application_name=web').save(entry, request);
    expect(pools).toHaveLength(2);
    expect(pools[1]?.config).toEqual({
      connectionString: 'postgres://u:p@db.example:5432/app?sslmode=require&application_name=web',
      max: 2,
    });
  });

  it('says to pass the CA when the database certificate is not one the server trusts', async () => {
    const postgres = await load();
    const store = postgres('postgres://db.example/app');
    await store.save(entry, request);
    const untrusted = Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    pools[0]?.query.mockRejectedValueOnce(untrusted);
    await expect(store.save(entry, request)).rejects.toThrow('postgres(url, { ca: process.env.DATABASE_CA })');
    // Any other failure is the database's own words.
    await store.save(entry, request);
    pools[0]?.query.mockRejectedValueOnce(Object.assign(new Error('relation "x" does not exist'), { code: '42P01' }));
    await expect(store.remove('note-1', 'hash', request)).rejects.toThrow('relation "x" does not exist');
  });

  it('shares one pool per URL, however often the route module is evaluated', async () => {
    const postgres = await load();
    await postgres('postgres://db.example/app').save(entry, request);
    await postgres('postgres://db.example/app', { table: 'other' }).save(entry, request);
    await postgres('postgres://db.example/elsewhere').remove('note-1', 'hash', request);
    expect(pools.map((pool) => (pool.config as { connectionString: string }).connectionString)).toEqual([
      'postgres://db.example/app',
      'postgres://db.example/elsewhere',
    ]);
  });

  it('says which variable is unset when a note arrives, not while the app builds', async () => {
    const postgres = await load();
    const { save } = postgres(undefined);
    await expect(save(entry, request)).rejects.toThrow('got no connection URL');
    expect(pools).toHaveLength(0);
  });

  it('does not keep a pool that failed to open', async () => {
    const postgres = await load();
    const { save } = postgres('postgres://db.example/app');
    missing = true;
    await expect(save(entry, request)).rejects.toThrow('Cannot find package');
    missing = false;
    await save(entry, request);
    expect(pools).toHaveLength(1);
  });

  it('says to install pg when the app does not have it', async () => {
    vi.resetModules();
    vi.doMock('pg', () => {
      throw new Error("Cannot find package 'pg'");
    });
    try {
      const postgres = await load();
      await expect(postgres('postgres://db.example/app').save(entry, request)).rejects.toThrow('npm install pg');
    } finally {
      vi.doUnmock('pg');
      vi.resetModules();
    }
  });

  it('refuses a bad table name at startup', async () => {
    const postgres = await load();
    expect(() => postgres('postgres://db.example/app', { table: 'a;b' })).toThrow('table must be a plain name');
  });
});
