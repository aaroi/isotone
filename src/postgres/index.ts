/**
 * isotone/postgres — collected feedback into Postgres, from a connection URL.
 *
 * `store: postgres(process.env.DATABASE_URL)` is the whole setup for any
 * hosted Postgres (Neon, Supabase, Xata, Aiven, RDS, Nevia). It connects with
 * the `pg` package, which the app installs. An app that already has a database
 * client, or runs where `pg` cannot (an edge runtime), passes that client to
 * `postgresStore` from `isotone/feedback` instead and never loads this file.
 */
import type { FeedbackStore, PostgresClient, PostgresOptions } from '../feedback/index';
import { postgresStore } from '../feedback/index';

export interface PostgresUrlOptions extends PostgresOptions {
  /**
   * The certificate authority that signed the database's certificate, as PEM
   * text. Needed where the provider runs its own CA (Aiven, RDS, Nevia), which
   * the connection otherwise refuses; providers with a public certificate
   * (Neon, Supabase) need nothing. Line breaks written as `\n`, as a
   * one-line environment variable holds them, are read as line breaks.
   */
  ca?: string;
}

type Store = Required<FeedbackStore>;

interface Pool extends PostgresClient {
  on?(event: 'error', listener: (error: unknown) => void): unknown;
}
interface PoolModule {
  Pool: new (config: { connectionString: string; max: number; ssl?: { ca: string } }) => Pool;
}

/** One pool per database for the life of the process: a dev server that
 *  reloads the route's module must not open a new pool each time. */
const POOLS = Symbol.for('isotone.postgres.pools');
type PoolCache = Map<string, Promise<PostgresClient>>;

/** What Node reports when a certificate's signer is not one it trusts. */
const UNTRUSTED = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

/** The URL without the settings that would replace the `ca` passed beside it. */
function withoutTlsSettings(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of ['sslmode', 'sslrootcert', 'uselibpqcompat']) parsed.searchParams.delete(name);
    return parsed.href;
  } catch {
    return url; // Not a URL: the driver says what is wrong with it.
  }
}

async function connect(url: string, ca: string | undefined): Promise<PostgresClient> {
  let pg: PoolModule;
  try {
    const loaded = (await import('pg')) as unknown as PoolModule & { default?: PoolModule };
    pg = loaded.default?.Pool ? loaded.default : loaded;
  } catch (cause) {
    throw new Error('isotone/postgres connects with the "pg" package. Install it in the app: npm install pg', { cause });
  }
  // Feedback arrives a row at a time; a small pool leaves the database's connections to the app.
  const pool = new pg.Pool(ca ? { connectionString: withoutTlsSettings(url), ssl: { ca }, max: 2 } : { connectionString: url, max: 2 });
  // An idle connection the database closed (a restart, a suspended serverless database) is reported
  // here. Unheard, it would be an uncaught exception in the app's server; the pool opens another itself.
  pool.on?.('error', (error) => console.error('[isotone] An idle Postgres connection closed:', error));
  return pool;
}

/** A failure a developer can act on says how; anything else passes through. */
function explained(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string' || !UNTRUSTED.has(code)) return error;
  return new Error(
    "The database's certificate is signed by an authority this server does not know, which is usual for Aiven, RDS and Nevia. " +
      'Pass the CA certificate your provider gives you: postgres(url, { ca: process.env.DATABASE_CA }).',
    { cause: error },
  );
}

/**
 * A store that keeps each record in the database at `url`, in the table
 * `isotone_feedback` (or `options.table`), created on first use. Nothing
 * connects until the first record arrives.
 */
export function postgres(url: string | undefined, options: PostgresUrlOptions = {}): Store {
  const shared = globalThis as { [POOLS]?: PoolCache };
  shared[POOLS] ??= new Map();
  const pools = shared[POOLS];
  // A host whose variables hold one line keeps the certificate's line breaks as "\n".
  const ca = options.ca?.replaceAll('\\n', '\n').trim() || undefined;
  let ready: Promise<Store> | null = null;
  const prepare = async (): Promise<Store> => {
    // An unset variable must fail at the first record, not while the app builds.
    if (!url) throw new Error('isotone/postgres got no connection URL. Set the environment variable you pass to postgres().');
    const cached = `${url}\n${ca ?? ''}`;
    let pool = pools.get(cached);
    if (!pool) {
      pool = connect(url, ca);
      pools.set(cached, pool);
      pool.catch(() => pools.delete(cached));
    }
    return postgresStore(await pool, options);
  };
  // Checked now, so a bad table name is a startup error.
  postgresStore({ query: async () => undefined }, options);
  const write = async <T>(run: (store: Store) => T | Promise<T>): Promise<T> => {
    ready ??= prepare();
    const pending = ready;
    let store: Store;
    try {
      store = await pending;
    } catch (error) {
      // No pool this time (the package is missing, the URL unset): try again on the next record.
      if (ready === pending) ready = null;
      throw error;
    }
    try {
      return await run(store);
    } catch (error) {
      throw explained(error);
    }
  };
  return {
    save: (entry, request) => write((store) => store.save(entry, request)),
    remove: (id, keyHash, request) => write((store) => store.remove(id, keyHash, request)),
  };
}
