# Install in a project

Run setup from the app's directory, including in a monorepo:

```sh
npm install -D isotone
npx isotone init --yes
```

`init` detects the project and prints the development-only integration to add
and a short first run for the agent (skipped once the project has variants or
knobs). It never edits app code or installs anything. `--yes` also writes the
Isotone section of `AGENTS.md`, between `<!-- isotone:start … -->` and
`<!-- isotone:end -->`, and for Vite `.isotone/variants/README.md`. Running it
again rewrites only the text between the markers, so keep your own notes outside
them; a section from Isotone 1.2.4 or earlier, which has no markers, is replaced
and its old text printed. `--json` prints the plan and `--approach
overlay|host|serve` overrides the recommendation. From then on, agents work as
[the agent guide](agent-guide.md) describes.

Isotone is a development tool. Every integration below keeps it out of production
by default; see [Production](#production) for how each one does that.

## Vite: one plugin

Add `isotone()` to the existing plugins array. Keep the framework plugins:

```ts
import { isotone } from 'isotone/vite';

// Inside the existing defineConfig(...):
plugins: [/* existing plugins */, isotone()]
```

Configs written before 1.3 import `iteration`, the same plugin under its old
name. It keeps working, and goes away in a later minor release.

Restart the dev server. Source-file variants and notes are available immediately.
The panel carries its own React runtime, so React, Vue, Svelte and vanilla Vite
projects use the same setup, and it does not enter the host's dependency
optimizer or Fast Refresh graph. The plugin acts only on the dev server: `vite
build` injects nothing and serves no endpoints, so it needs no guard of its own.

**This machine only.** The panel and its endpoints answer only the machine the
dev server runs on. Started with `--host` (or `server.host`), Vite still serves
the app to other devices, but without the panel, and Isotone's endpoints answer
them 403. Pages served under a name other than `localhost`, `*.localhost`,
`*.test`, a loopback address or one in Vite's `server.allowedHosts` are refused,
and so is a request a local tunnel forwards for another machine. The plugin also
adds the notes file, the Blast session and `.isotone/` to Vite's
`server.fs.deny`, so Vite's static server never hands them out.

If the app mounts `IsotonePanel` or `mountIsotone` itself, use
`isotone({ panel: false })` to keep local endpoints and source variants without
injecting a second panel. A manual mount can use
`updateEndpoint: '/api/isotone/update'` for the optional update notice and
its update note.
The adapters check for updates in the background; see [Updates](updates.md) for
the cache, explicit upgrade commands, and opt-out controls.

The notes file resolves against Vite's `root`. In a monorepo, run the CLI in that
directory or pass `--file path/to/.isotone/notes.json`. Options:

```ts
isotone({
  theme: 'auto',
  file: '.isotone/notes.json', // the default
  variants: false, // optional: notes only
})
```

## Any other local dev server

Run this inside the project in a second terminal:

```sh
npx isotone serve
```

Then load the panel in development only. The page itself must come from your own
dev server or any local static server on `localhost`: `isotone serve` serves the
panel and its endpoints, not your pages, and a page opened as a `file://` URL
never loads the panel. For plain HTML pages, add this loader to each page; it
requests nothing unless the page is on localhost, so it stays inert if deployed:

```html
<script>
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
    document.head.append(Object.assign(document.createElement('script'),
      { src: 'http://127.0.0.1:4123/isotone.js' }));
</script>
```

A plain `<script src="http://127.0.0.1:4123/isotone.js" defer></script>` works
only behind the template's development flag: shipped, it would make every
visitor's browser request its own localhost. In a Next app, render it from the
root layout (`app/layout.tsx`, or `pages/_app.tsx`) behind the development check,
which Next inlines at build time:

```tsx
import Script from 'next/script';

// Inside <body>:
{process.env.NODE_ENV === 'development' && (
  <Script src="http://127.0.0.1:4123/isotone.js" strategy="afterInteractive" />
)}
```

Open the printed setup URL for a copyable tag or a bookmarklet. This path supports
notes and [knobs](variants.md#knobs) from `.isotone/knobs.json` in the directory
where `serve` runs; the panel shows a Variants tool once that file holds a valid
knob (reload after adding the first). Swapping whole source files needs the Vite
plugin, or a host-owned `VariantsSource`.

`--port 4124` selects another port. `serve` prints the `panel` URL and the
loader `tag` for the port it listens on, so paste those as printed, and keep the
port in one place with a script such as `"isotone": "isotone serve --port 4124"`.
`--file` selects a notes file and `--theme` the panel theme. The server binds to
`127.0.0.1` and answers only this machine; another device on the network gets
403 even if your app's dev server listens on every interface (`next dev` does).
An HTTPS page may block the HTTP script.

## Client mount

Use this when the app should mount the panel from its own code, with the
host's React. Install `react` and `react-dom` if the app does not already have
them. Run `npx isotone serve` as above, then mount from a client component once,
and clean up on unmount:

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

Render `<ReviewTools />` once in the app layout. The effect handles Strict Mode
and route unmounts, and the dynamic import behind the check keeps the panel out
of production bundles.

## Endpoint rules

Every endpoint (the Vite plugin's and `isotone serve`'s) applies the same rules,
which keep other devices and other websites away from your notes:

- The request must come from this machine (its socket's peer address, and any
  address a proxy or tunnel forwarded for, is loopback), and its `Host` header
  must be `localhost`, `*.localhost`, `*.test` or a loopback address; on Vite, a
  name in `server.allowedHosts` too.
- A browser's `Origin` must match the Host, port included; `isotone serve`
  accepts a page on any loopback port, since it never serves the page. A request without an `Origin`, such as `curl` or a
  script, is accepted, so any process on this machine can write a note: one
  more reason notes are context, not instructions. (The CLI reads and writes
  the notes file directly.)
- A POST must send `Content-Type: application/json`, or it gets 415.
- A note `id`, when a host chooses its own, is 1–64 letters, digits, `-` or `_`, and does not start with `-`
  (400 otherwise). Routes are capped at 2,000 characters, and a notes file at
  10,000 notes: a new note past that gets 409 until done notes are deleted.
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
2. Run `npx isotone --json` in the app directory. Confirm the note's route,
   viewport and selector.
3. Run `npx isotone --done <id-prefix> --force` (a test note needs no file
   change) and check that it leaves the panel.
4. Build the production app and search the output for `isotone` and
   `/api/isotone`. With the localhost-only loader, the tag remains in the HTML
   but loads nothing outside localhost.

If the panel is visible but the CLI has no notes, compare the dev server's printed
notes path with the CLI's working directory. If the endpoint is unreachable, the
panel retains unsent notes locally until it can retry; keep that browser profile
until they reach the file.

The panel polls the notes endpoint with `?rev=<revision>` while its tab is
visible; an unchanged file is answered from its metadata.
