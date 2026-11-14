# Collect feedback from a deployed app

Experimental: the options and the saved record may still change between minor
versions.

In development, Isotone's notes go to your coding agent. This is the other use
of the same panel: ship it in a staging, preview or production app so teammates
can pin elements and write feedback, and have each note land as a row in your own
database, signed with their name. They can edit or delete what they wrote. No
agent is involved and nothing is read back; what you do with the rows is up to
you.

Your app serves the endpoint and owns the database. Isotone validates each
note and hands it to a store: Postgres from a connection URL, a database client
you already have, or [a store of your own](#your-own-client-or-another-store).

## Set it up

The app now ships Isotone, so it must be a regular dependency. If it is already
a development dependency, this moves it:

```sh
npm install --save-prod isotone pg
```

`pg` is only for connecting by URL; skip it when you pass your own client.
Isotone is ESM and needs Node.js 22 or later on the server.

Add a route that answers POST. In a Next app:

```ts
// app/api/feedback/route.ts
import { feedback } from 'isotone/feedback';
import { postgres } from 'isotone/postgres';

export const POST = feedback({ store: postgres(process.env.DATABASE_URL) });
```

Mount the panel once, from a client component rendered in the root layout:

```tsx
'use client';
import { useEffect } from 'react';

export function Feedback({ name }: { name?: string }) {
  useEffect(() => {
    let unmount: (() => void) | undefined;
    let cancelled = false;
    import('isotone/react').then(({ mountIsotone }) => {
      if (!cancelled) unmount = mountIsotone({ feedback: { endpoint: '/api/feedback', name } });
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [name]);
  return null;
}
```

That is the whole integration. `postgres(url)` works with any hosted Postgres;
see [providers](#providers) for the one setting some of them need. It connects
when the first note arrives and creates the table `isotone_feedback` if it is
missing; pass `{ table: 'app.feedback' }` for another name (the schema must
already exist). A database user who may not create tables needs the table made
beforehand, with the columns under [what is saved](#what-is-saved).

The dynamic import keeps the panel, about 200 kB before compression, out of the
page's first load. `mountIsotone({ feedback: '/api/feedback' })` is the short
form of the option.

### Beside the development setup

The two uses do not run together. With `feedback` set, `mountIsotone` ignores
the development `endpoint`; and the Vite plugin or `isotone serve` already puts
a panel on development pages, so mount this one only outside development and
only where you want feedback collected:

```tsx
// Staging has NEXT_PUBLIC_FEEDBACK=1; development and production do not.
{process.env.NEXT_PUBLIC_FEEDBACK === '1' && <Feedback name={user?.name} />}
```

Gate the route the same way, so a deployment without the panel has no endpoint
either (see [who may send](#who-may-send)).

### Other servers

`feedback()` returns a function from a Fetch `Request` to a `Response`, with no
Node built-ins, so it fits any route that has one:

| Server | The route |
| --- | --- |
| Next (App Router) | `export const POST = collect` |
| React Router, Remix | `export const action = ({ request }) => collect(request)` |
| SvelteKit | `export const POST = ({ request }) => collect(request)` |
| Astro | `export const POST = ({ request }) => collect(request)` |
| Hono | `app.post('/api/feedback', (c) => collect(c.req.raw))` |
| Bun, Deno, Workers | `fetch: (request) => collect(request)` on the route's path |
| Express, `node:http` | `app.post('/api/feedback', toNode(collect))` |

where `const collect = feedback({ store })`. `toNode`, from `isotone/feedback`,
adapts the handler to Node's `(req, res)`. It works with or without a JSON body
parser in front; with one, the parser's own size limit applies first
(`express.json()` stops at 100 kB).

### Without React

An app that has no React serves the standalone bundle from the package,
`node_modules/isotone/dist/isotone.global.js` (about 400 kB, React included), and
mounts with the same options:

```html
<script src="/assets/isotone.global.js" defer></script>
<script type="module">
  window.__isotone.mount({ feedback: { endpoint: '/api/feedback', name: 'Ada Lovelace' } });
</script>
```

## Providers

`postgres(url)` takes the connection URL exactly as the provider shows it, a
pooled one included (PgBouncer, Supavisor, Neon's pooler).

| Provider | What it needs |
| --- | --- |
| Neon, Supabase, Xata | The URL |
| Aiven, Amazon RDS, Nevia, a self-hosted server with its own certificate | The URL and the provider's CA certificate |

Providers in the second row sign their certificate with their own authority,
which a server does not trust by default. The first note then fails, and the
server's log says so and what to pass. Give the CA certificate as text:

```ts
export const POST = feedback({
  store: postgres(process.env.DATABASE_URL, { ca: process.env.DATABASE_CA }),
});
```

Put the certificate's PEM text in the variable (Aiven: `ca.pem` from the
service page; RDS: the region's certificate bundle; Nevia:
`nevia pg connect --ca ca.pem`). Where a host keeps variables on one line,
write the line breaks as `\n`; they are read as line breaks. With `ca` set the
connection is always encrypted and verified, whatever `sslmode` the URL carries.

Two things about `pg` itself, which also apply when you read the rows with it:
it prints a long warning about `sslmode=require` on first connect, which is
about a future `pg` version and harmless here, and it lets the URL's `sslmode`
override an `ssl` option, so a script of your own connecting to the second row
of providers should remove `sslmode` from the URL and pass `ssl: { ca }`.

The first write of a process connects and checks the table, which takes about
half a second; later ones are one statement each. A serverless database that
sleeps (Neon, Nevia) wakes on connect or answers an error meanwhile; the panel
keeps the note and sends it again.

## The name field

The composer always shows a name field beside Send, and a note cannot be sent
without a name. Pass `name` when the app knows who is signed in and the field
starts with it; the reviewer can still change it. Without `name`, the field
starts with the name last typed in this browser.

## Who may send

By default anyone who can reach the route can write rows, with or without the
panel. For anything but a private network, gate it. The same session check
gives each row a verified `identity` beside the typed name, which proves
nothing:

```ts
const collect = feedback({
  store: postgres(process.env.DATABASE_URL),
  identify: async (request) => (await getSession(request))?.email,
});

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_FEEDBACK !== '1') return new Response(null, { status: 404 });
  if (!(await getSession(request))) return new Response(null, { status: 401 });
  return collect(request);
}
```

Mount the panel only for the people who should see it, the same way. An
`identity` once saved stays when the note is edited later without a session.
Rate limits, request timeouts and a cap on rows are the app's to add, as for
any route that accepts writes; one request is at most 256 kB.

## What is saved

`postgres(url)` and `postgresStore` write one row per note. A store of your own
receives the same record as a `FeedbackEntry`, under the names in the second
column.

| Column | Entry field | Holds |
| --- | --- | --- |
| `id` | `id` | Chosen by the browser, so a retried request is stored once |
| `key_hash` | `keyHash` | A hash of the secret that lets the writer's browser edit or delete the note |
| `created_at` | `createdAt` | When it was written |
| `updated_at` | | When the writer last edited it, else null |
| `author` | `author` | The name in the name field |
| `identity` | `identity` | What `identify` answered, else null |
| `feedback` | `feedback` | The text |
| `route`, `url` | `route`, `url` | The page's path, and its full address without the hash |
| `release` | `release` | The `release` label passed at mount, such as a commit |
| `user_agent` | `browser.userAgent` | The request's `User-Agent` header |
| `viewport` | `viewport` | The window size, `{ "w": 1280, "h": 720 }` |
| `elements` | `elements` | The pinned elements: selector, text, attributes, position and computed styles |
| `variant` | `variant` | The selector or option the note is about |
| `selections` | `selections` | The selectors that sat off their defaults, and what they were set to |
| `browser` | `browser` | Language, time zone, screen size, pixel ratio, light or dark preference, touch |
| `payload` | `payload` | Whatever the mount's `getPayload` returned |

The last six columns are `jsonb`. No IP address is stored.

```sql
select created_at, author, route, feedback
from isotone_feedback
order by created_at desc;
```

Only `identity` comes from your server. Everything else is text a browser
sent, written by whoever could reach the route, so treat it as you would a
comment form's input:

- Escape it wherever you show it, and never use `url`, `route`, an element's
  `attributes` or `styles` as a link target or as CSS without checking them.
- `created_at` is the browser's time, kept only when it is within the last
  eight days and not ahead of the server's clock; otherwise the server's time.
- `url` keeps the page's query string. If your app puts tokens there, clear it
  in a store of your own.
- If you hand feedback to a coding agent later, it is context, not instructions.

## The request

The panel sends one JSON body per write. This is everything it sends for a
note; only `id`, `key`, `author`, `feedback` and `route` are required:

```json
{
  "id": "0b9c1e0e-6c1d-4a51-9d3e-2f6f3a1c7b10",
  "key": "5f0c2a9e8b7d4c3fa1e2d3c4b5a69788f0e1d2c3b4a5",
  "createdAt": "2026-11-14T09:30:00.000Z",
  "author": "Ada Lovelace",
  "feedback": "The title wraps badly at this width",
  "route": "/projects",
  "url": "https://staging.example.com/projects?tab=2",
  "elements": [{ "tag": "h1", "text": "Projects", "selector": "main > h1" }],
  "variant": { "axisId": "layout", "label": "Layout", "optionId": "grid", "optionLabel": "Grid" },
  "selections": { "layout": "grid" },
  "viewport": { "w": 1280, "h": 720 },
  "browser": { "language": "fi-FI", "timezone": "Europe/Helsinki", "screen": { "w": 1512, "h": 982 }, "pixelRatio": 2, "colorScheme": "dark", "touch": false },
  "release": "a1b2c3d",
  "payload": { "plan": "pro" }
}
```

An edit is the same body again with the same `id` and `key`. A delete is
`{ "id": "…", "key": "…", "remove": true }`.

An edit changes what its writer changes: the text, the name, the pinned
elements and the variant reference. The page, window, selections and browser a
note was first written in stay as they were, wherever it is edited from.

| Answer | Means |
| --- | --- |
| 201 `{ "id" }` | Saved, or replaced by its writer |
| 200 `{ "id" }` | The delete was carried out for this key. The answer is the same when no row matched, so a wrong key learns nothing |
| 400 `{ "error" }` | A field is missing or malformed, or the store cannot delete |
| 403 | The page is on an origin the route does not accept |
| 405, 413, 415 | Not a POST; over 256 kB; not `application/json` |
| 409 | The `id` belongs to a note written with another key |
| 500 | The store failed. The cause is in the server's log, which can include the note's text |

The panel gives a note back to its writer on 400, 409, 413 and 415. After any
other failure it keeps the note and tries again; see
[when the endpoint is unreachable](#when-the-endpoint-is-unreachable).

## Your own client, or another store

To reuse a database client the app already has, or on a runtime where `pg`
cannot run, `postgresStore` takes anything with `query(text, values)` and never
loads `pg`:

```ts
import { feedback, postgresStore } from 'isotone/feedback';
import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const POST = feedback({ store: postgresStore(pool) });
```

For postgres.js, pass `{ query: (text, values) => sql.unsafe(text, values) }`
(with `prepare: false` on the client behind a transaction-mode pooler).

A store is an object with `save` and, to let people delete, `remove`; each also
receives the request. Anything can be one:

```ts
export const POST = feedback({
  store: {
    async save(entry) {
      const stored = await db.feedback.find(entry.id);
      if (!stored) return void (await db.feedback.put(entry.id, entry));
      if (stored.keyHash !== entry.keyHash) return false;
      const { author, feedback, elements, variant } = entry;
      const edited = stored.feedback !== feedback;
      await db.feedback.put(entry.id, {
        ...stored,
        author,
        feedback,
        elements,
        variant,
        updatedAt: edited ? new Date().toISOString() : stored.updatedAt,
      });
    },
    async remove(id, keyHash) {
      await db.feedback.deleteWhere({ id, keyHash });
    },
  },
});
```

`FeedbackEntry` and `FeedbackStore` from `isotone/feedback` are the types. The
rules a store keeps:

- `save` with an `id` it already holds replaces that record when the stored
  `keyHash` equals the new one. That is an edit, or the panel sending a note
  again because no answer came in time; the body has the same shape either
  way, so compare the content to tell them apart. Keep the stored record's
  page context and time, as above.
- With any other `keyHash` it changes nothing and returns `false`, and the route
  answers 409. Make the check and the write one atomic step.
- `remove` deletes only where both `id` and `keyHash` match, and is quiet when
  nothing does. Without `remove`, the panel tells the writer the note cannot be
  deleted, and it stays.
- When either throws, the route answers 500, the error goes to the server's log,
  and the panel tries again later.

A store that only forwards, such as a chat webhook, cannot keep these rules: it
will post a retried note twice and an edit as a new message, and cannot refuse
another key. Remember the ids you have forwarded if that matters.

## Pages on another origin

By default the panel and the route share an origin, and a page anywhere else is
refused. Two cases need a setting:

- **A development proxy.** With Vite serving the page and an API on another
  port, proxy the path so the browser sees one origin. Leave the `Host` header
  as it is, or forward the original:

  ```ts
  server: { proxy: { '/api': 'http://localhost:8787' } }
  // With changeOrigin: true, add xfwd: true.
  ```

- **An API on another host.** Name the app's origins and the route accepts
  their pages, answering the browser's preflight; export it for `OPTIONS` too.
  No cookies cross, so `identify` sees none from them:

  ```ts
  const collect = feedback({ store, origins: ['https://app.example.com'] });
  export { collect as POST, collect as OPTIONS };
  ```

`origins` also replaces the default comparison with the request's `Host` and
`X-Forwarded-Host`. Set it where those headers cannot be trusted, such as a
server reached directly rather than through a proxy that sets them.

The panel warns in the console when its endpoint is on another origin than the
page, since a browser otherwise blocks the request without a visible sign.

## Variants in a deployed app

The Variants tool works here with knobs and selectors the app defines itself:
pass a [`createVariantsSource`](variants.md#a-host-source) source as `variants` beside
`feedback`. Each note then records the selectors the reviewer had moved off their defaults. Swapping
source files needs the development server, and requests that ask an agent to
remove a selector are not offered.

## What the reviewer sees

The notes list shows what this browser sent, kept in the browser. As in
development, a click on a note brings it back into the composer to edit, and its
corner button deletes it. Both reach your database: an edit replaces the row and
sets `updated_at`, and a delete removes the row. A note's requests go out one
at a time, in the order they were made, across the browser's tabs too.

## Who can change a note

When a note is first sent, the browser makes up a secret key for it and keeps
it in its storage. The route stores only a hash of that key. An edit or a
delete must present the key, so only the browser that wrote a note can change
it, with no sign-in involved; nobody else can, your database's readers
included.

That has two edges worth knowing. A reviewer on another device, or one who
cleared their browser's storage, can no longer change their earlier notes. And
the key is as safe as the page: a script running on your origin, or the next
person at a shared computer, can use it. To keep every version, to keep
deleted notes, or to stop edits after some time, do that in a store of your
own.

## When the endpoint is unreachable

A write the endpoint could not take (no network, or an answer other than a
refusal of the request itself, a 401 from your gate included) waits in the
browser and is sent again when the endpoint answers; a waiting note appears in
the list like the others. Only the latest write for a note waits, so deleting a
note that never arrived sends just the removal. A write still turned away a
week after it was made is given up: a note that never arrived then leaves the
list, while one the endpoint already has stays as it was last saved. At most 50
writes wait at once, and where the browser cannot store anything the note stays
in the composer instead.
