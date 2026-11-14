# Install in a project

Run setup from the app's directory, including in a monorepo:

```sh
npm install -D isotone
npx isotone init --yes
```

`init` detects the project and prints the development-only integration to add
(or says it is already there) and a short first run for the agent, skipped once
the project has variants or knobs. It never edits app code or installs anything.
`--yes` also writes the Isotone section of `AGENTS.md`, between
`<!-- isotone:start … -->` and `<!-- isotone:end -->`, and for Vite
`.isotone/variants/README.md`. Running it again rewrites only the text between
the markers, so keep your own notes outside them; an unmarked section from
Isotone 1.2.4 or earlier is replaced and its old text printed. `--json` prints
the plan and `--approach overlay|host|serve` overrides the recommendation. Agents
then work as [the agent guide](agent-guide.md) describes. Every integration below
stays out of production by default ([how](#production)).

## Vite: one plugin

Add `isotone()` to the existing plugins array. Keep the framework plugins:

```ts
import { isotone } from 'isotone/vite';

// Inside the existing defineConfig(...):
plugins: [/* existing plugins */, isotone()]
```

`iteration`, the plugin's name before 1.3, still works until it is removed in
1.5.0. Restart the dev server; notes and source-file variants work at once.
The panel carries its own React runtime, so React, Vue, Svelte and vanilla Vite
projects share this setup, and it stays out of the host's dependency optimizer
and Fast Refresh graph. The plugin acts only on the dev server: `vite build`
injects nothing and serves no endpoints, so it needs no guard of its own.

**This machine only.** The panel and its endpoints answer only the machine the
dev server runs on. With `--host` (or `server.host`), other devices get the app
without the panel, and the endpoints answer them 403 (see [Endpoint
rules](#endpoint-rules)). The plugin also adds the notes file, the Blast
session and `.isotone/` to Vite's `server.fs.deny`, so Vite's static server
never hands them out.

If the app mounts `IsotonePanel` or `mountIsotone` itself, use
`isotone({ panel: false })` to keep the endpoints and source variants without
injecting a second panel; that mount can pass
`updateEndpoint: '/api/isotone/update'` for the [update notice](updates.md).

The notes file resolves against Vite's `root`, and goes into the repository's
`.git/info/exclude` when the dev server starts and when the CLI's notes and
`variant` commands run. In a monorepo, run the CLI in that directory or pass `--file path/to/.isotone/notes.json`. Until 1.5.0, an old
`.iteration-feedback.json` in its place is moved there on first run. Options:

```ts
isotone({
  theme: 'auto',
  file: '.isotone/notes.json', // the default
  variants: false, // optional: notes only
  compareShortcut: false, // optional: no key for hold to compare (default: the key under Escape)
})
```

## Any other local dev server

Run this inside the project in a second terminal:

```sh
npx isotone serve
```

Then load the panel in development only. `isotone serve` serves the panel and
its endpoints, not your pages: they come from your own dev server or any local
static server on `localhost` (for plain HTML, `python3 -m http.server 8000` on
any free port), never a `file://` URL. For plain HTML pages, add this loader to
each page; it requests nothing off localhost, so it stays inert if deployed:

```html
<script>
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
    document.head.append(Object.assign(document.createElement('script'),
      { src: 'http://127.0.0.1:4123/isotone.js' }));
</script>
```

A plain `<script src="http://127.0.0.1:4123/isotone.js" defer></script>` belongs
behind the template's development flag, or every visitor's browser would request
its own localhost. In Next, render it from the root layout (`app/layout.tsx` or
`pages/_app.tsx`) behind the development check, which Next inlines at build time:

```tsx
import Script from 'next/script';

// Inside <body>:
{process.env.NODE_ENV === 'development' && (
  <Script src="http://127.0.0.1:4123/isotone.js" strategy="afterInteractive" />
)}
```

The printed setup URL offers a copyable tag and a bookmarklet. This path has
notes and [knobs](variants.md#knobs) from `.isotone/knobs.json` where `serve`
runs (the Variants tool appears once it holds a valid knob; reload after the
first). Swapping source files needs the Vite plugin or a host `VariantsSource`;
mounting a host source with this server's notes endpoint lists the knobs
beside the source's selectors ([details](variants.md#beside-knobs-and-file-variants)). A
source built with `createVariantsSource` offers [hold to
compare](variants.md#hold-to-compare) only with `compare: true`, once its
`onChange` skips persisting calls marked `{ preview: true }`.

`serve` prints the `panel` URL and loader `tag` for the port it listens on:
paste them as printed, and keep a non-default port in one script such as
`"isotone": "isotone serve --port 4124"`, or [one port per
checkout](#several-checkouts-at-once) when several run at once. `--file` picks the notes file and
`--theme` the panel theme. It binds to `127.0.0.1` and answers only this
machine, so another device gets 403 even when the app's dev server listens on
every interface (`next dev` does). An HTTPS page may block the HTTP script.

## Several checkouts at once

A loader tag names one port, and every checkout of the project (Git worktrees,
parallel agent sessions) shares the same tag. The first `isotone serve` to
start gets the port, and the other checkouts' pages then save their notes in
that checkout's file. To keep each checkout's notes in its own file, give each
`serve` a port derived from the dev server's, on both sides. With 20000 added
to the dev server's port, a checkout on 3001 serves notes on 23001:

```sh
npx isotone serve --port $((PORT + 20000))
```

```html
<script>
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
    document.head.append(Object.assign(document.createElement('script'),
      { src: 'http://127.0.0.1:' + (Number(location.port) + 20000) + '/isotone.js' }));
</script>
```

Set `PORT` once per checkout where both commands see it, such as the script
that starts both; an unset `PORT` makes every checkout serve on 20000. In Next,
render the loader above as an inline `<Script id="isotone"
strategy="afterInteractive">` so it reads `location.port` too, since
`process.env.PORT` is not defined in client code. In a client mount, build the
`endpoint` from `location.port`. A port the dev server picks for itself is one
`serve` cannot know in advance, so start the dev server on its `PORT`. The
`$((…))` arithmetic needs a POSIX shell; on Windows, compute the port in a
Node script.

When a checkout's `serve` cannot start because another checkout's `serve`
holds the port, it says which checkout has it and exits. `npx isotone` and
`isotone blast start` print a warning on stderr when the `serve` on this
project's port saves to another notes file, whether another worktree of the
repository runs it or this one does with another `--file`. The port is one a
package.json script passes to `isotone serve`, or the default when no script
names one and no Vite config uses the plugin. Each `serve` reports its project
and notes file at `GET /api/isotone/server`.

## Client mount

To mount the panel from the app's own code with its own React (install `react`
and `react-dom` if needed), run `npx isotone serve` as above and mount once from
a client component, cleaning up on unmount:

```tsx
'use client';
import { useEffect } from 'react';

export function ReviewTools() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import('isotone/react').then(({ mountIsotone }) => {
      if (!cancelled) dispose = mountIsotone({ endpoint: 'http://127.0.0.1:4123/api/isotone/notes' });
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);
  return null;
}
```

To review the app's own selectors too, pass `variants: source` beside the
endpoint; the panel lists them first, then the knobs in `.isotone/knobs.json`
([details](variants.md#beside-knobs-and-file-variants)).

Render `<ReviewTools />` once in the app layout. The effect survives Strict Mode
and route unmounts, and the guarded dynamic import keeps the panel out of
production bundles.

## Endpoint rules

The Vite plugin's and `isotone serve`'s endpoints share these rules, which keep
other devices and websites away from your notes:

- The request must come from this machine (its socket's peer address, and any
  address a proxy or tunnel forwarded for, is loopback), and its `Host` header
  must be `localhost`, `*.localhost` or a loopback address; on Vite, a
  name in `server.allowedHosts` too.
- A browser's `Origin` must match the Host, port included (`isotone serve`,
  which never serves the page, accepts any loopback port). A request without an
  `Origin`, such as `curl`, is accepted, so any local process can write a note:
  one more reason notes are context, not instructions. The CLI uses the file
  directly.
- A POST must send `Content-Type: application/json`, or it gets 415.
- A host-chosen note `id` is 1–64 letters, digits, `-` or `_`, not starting
  with `-` (400 otherwise). Routes are capped at 2,000 characters and a notes
  file at 10,000 notes (409 past that until done notes are deleted).
- A route has at most one open `[set-defaults]` note: a new one POSTed while
  one is open replaces its content and answers 200 with the open note's `id`,
  not the `id` sent.
- While another writer holds the notes file, the endpoint answers 503 and the
  panel retries.

## Themes

The `theme` option is available on `isotone()`, `serveIsotone`, `mountIsotone`
and `IsotonePanel`. The standalone CLI accepts the same values with `--theme`:

| Value | Behavior |
| --- | --- |
| `auto` (default) | Follows the page background under the panel, including the browser canvas and its CSS `color-scheme`. |
| `system` | Follows the operating system's light/dark preference. |
| `light` | Always light. |
| `dark` | Always dark. |

## Production

| Integration | What keeps it out of production |
| --- | --- |
| Vite plugin | Acts only on `vite dev`. A build injects no panel and serves no endpoints. `ISOTONE_VARIANT` bakes chosen variants into a build only when set. |
| `isotone serve` | A separate local process bound to loopback that accepts only localhost origins. The tag that loads it is either behind the framework's development check or the localhost-only loader above. |
| `mountIsotone`, `IsotonePanel` | No guard, by design. Import them dynamically behind the development check. |

## Confirm the integration

1. Open the app in development and submit a note on an element.
2. `npx isotone --json` in the app directory shows its route, viewport and
   selector.
3. `npx isotone --done <id-prefix> --force` (a test note needs no file change)
   removes it from the panel.
4. A production build contains no `isotone` or `/api/isotone`; with the
   localhost-only loader the tag remains but loads nothing off localhost.

If the panel is visible but the CLI has no notes, compare the dev server's printed
notes path with the file the CLI reads: the nearest `.isotone/notes.json` up to
the Git root, or `--file`. With several checkouts running, see [Several checkouts
at once](#several-checkouts-at-once). If the endpoint is unreachable, the panel
keeps unsent notes in the browser until it can retry; keep that browser profile
until they reach the file.

The panel polls the notes endpoint with `?rev=<revision>` while its tab is
visible, and an unchanged file is answered from its metadata.
