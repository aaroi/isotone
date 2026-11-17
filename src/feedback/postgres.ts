import type { FeedbackEntry } from '../core/feedback';
import type { FeedbackStore } from './handler';

/**
 * Anything that runs one parameterized statement: a `pg` Pool or Client, the
 * Pool of `@neondatabase/serverless`, PGlite. For postgres.js, wrap it:
 * `{ query: (text, values) => sql.unsafe(text, values) }`.
 */
export interface PostgresClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export interface PostgresOptions {
  /** The table records go to, optionally with a schema (`app.feedback`).
   *  Default `isotone_feedback`. It is created on first use when missing. */
  table?: string;
}

const DEFAULT_TABLE = 'isotone_feedback';
/** One or two plain identifiers: the name is written into the statements. */
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}(\.[A-Za-z_][A-Za-z0-9_]{0,62})?$/;

/** The columns, in the order {@link values} fills them. What a developer
 *  filters on is a column of its own; the rest is `jsonb`. */
const COLUMNS = [
  'id text primary key',
  'key_hash text not null',
  'created_at timestamptz not null',
  'author text not null',
  'identity text',
  'feedback text not null',
  'route text not null',
  'url text',
  'release text',
  'user_agent text',
  'viewport jsonb',
  'elements jsonb not null',
  'variant jsonb',
  'selections jsonb',
  'browser jsonb not null',
  'payload jsonb',
] as const;
const JSON_FROM = COLUMNS.findIndex((column) => column.includes('jsonb'));
/** What an edit can change: what the writer says, about what, under which name. The page, window and
 *  browser a note was first written in stay as they were, wherever it is edited from. */
const EDITED = ['author', 'feedback', 'elements', 'variant'];
/** The stored row, where a statement tells it from the one being written. */
const ALIAS = 'stored';

const jsonOrNull = (value: unknown) => (value === undefined ? null : JSON.stringify(value));

function values(entry: FeedbackEntry): unknown[] {
  return [
    entry.id,
    entry.keyHash,
    entry.createdAt,
    entry.author,
    entry.identity ?? null,
    entry.feedback,
    entry.route,
    entry.url ?? null,
    entry.release ?? null,
    entry.browser.userAgent ?? null,
    jsonOrNull(entry.viewport),
    JSON.stringify(entry.elements),
    jsonOrNull(entry.variant),
    jsonOrNull(entry.selections),
    JSON.stringify(entry.browser),
    jsonOrNull(entry.payload),
  ];
}

/** A driver's answer as rows: `pg`, Neon and PGlite answer `{ rows }`, postgres.js the rows themselves. */
function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null | undefined)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * A store that keeps each record as one row. The table is created on the
 * first write of a process when it does not exist; a database user who may
 * not create tables needs it made beforehand, and the writes then just work.
 * A record sent again with its key replaces its row (an edit, or a retry
 * after a lost answer) and sets `updated_at`; `created_at` stays. Without the
 * key a row is never changed or removed.
 */
export function postgresStore(client: PostgresClient, options: PostgresOptions = {}): Required<FeedbackStore> {
  const table = options.table ?? DEFAULT_TABLE;
  if (!TABLE_NAME.test(table)) throw new TypeError(`table must be a plain name such as "${DEFAULT_TABLE}" or "app.feedback"`);
  const names = COLUMNS.map((column) => column.slice(0, column.indexOf(' ')));
  const create = `create table if not exists ${table} (${COLUMNS.join(', ')}, updated_at timestamptz)`;
  const replaced = [
    ...EDITED.map((name) => `${name} = excluded.${name}`),
    // Who the app first said wrote it stays, whoever holds the key later (signed out, say);
    // and the payload a host attaches only to a new note is not lost to an edit without one.
    `identity = coalesce(${ALIAS}.identity, excluded.identity)`,
    `payload = coalesce(excluded.payload, ${ALIAS}.payload)`,
  ];
  // The same note sent again (a retry after a lost answer) is not an edit.
  const changed = `(${EDITED.map((name) => `${ALIAS}.${name}`).join(', ')}) is distinct from (${EDITED.map((name) => `excluded.${name}`).join(', ')})`;
  // JSON goes over as text and becomes jsonb here. The text cast first matters: a driver that
  // sees a jsonb parameter (postgres.js) would encode the string again and store a string.
  const upsert = `insert into ${table} as ${ALIAS} (${names.join(', ')}) values (${names
    .map((_, index) => `$${index + 1}${index >= JSON_FROM ? '::text::jsonb' : ''}`)
    .join(
      ', ',
    )}) on conflict (id) do update set ${replaced.join(', ')}, updated_at = case when ${changed} then now() else ${ALIAS}.updated_at end where ${ALIAS}.key_hash = excluded.key_hash returning id`;
  const remove = `delete from ${table} where id = $1 and key_hash = $2`;
  let ready: Promise<unknown> | null = null;
  const run = async (text: string, params: unknown[]) => {
    // Once per process. A failure here (no right to create tables, two
    // instances racing) is not the answer: the statement is.
    ready ??= client.query(create).catch(() => {});
    await ready;
    try {
      return await client.query(text, params);
    } catch (error) {
      ready = null; // The table may have been dropped: look again on the next write.
      throw error;
    }
  };
  return {
    // No row comes back when the id is taken by a record with another key.
    save: async (entry) => rowsOf(await run(upsert, values(entry))).length > 0,
    remove: async (id, keyHash) => {
      await run(remove, [id, keyHash]);
    },
  };
}
