# Install in a project

Run setup from the app's directory, including in a monorepo:

```sh
npm install -D iso-iterate
npx iso-iterate init --yes
```

`init` detects the project, prints the integration to add, and adds a short guide
to `AGENTS.md`. It does not overwrite app code, install dependencies, or replace
an existing guide. Running it again is safe. `init --json` returns a setup plan
without writing files; add `--yes` to write the guide. `--approach overlay|host|serve`
overrides the recommendation.

## Vite: one plugin

Add `iteration()` to the existing plugins array. Keep the framework plugins:

```ts
import { iteration } from 'iso-iterate/vite';

// Inside the existing defineConfig(...):
plugins: [/* existing plugins */, iteration()]
```

Restart the dev server. Notes and source-file variants are available immediately.
The panel carries its own React runtime, so React, Vue, Svelte and vanilla Vite
projects use the same setup. It does not enter the host's dependency optimizer or
Fast Refresh graph. Nothing is injected in a production build.

If the app mounts `IterationPanel` or `mountIteration` itself, use
`iteration({ panel: false })` to keep local endpoints and source variants without
injecting a second panel. A manual mount can use
`updateEndpoint: '/api/iteration/update'` for the optional update notice.
The adapters check for updates in the background; see [Updates](updates.md) for
the cache, explicit upgrade commands, and opt-out controls.

The notes file resolves against Vite's `root`. In a monorepo, run the CLI in that
directory or pass `--file path/to/.iteration-feedback.json`. Options:

```ts
iteration({
  theme: 'auto',
  file: '.iteration-feedback.json',
  variants: false, // optional: notes only
})
```

## Any other local dev server

Run this inside the project in a second terminal:

```sh
npx iso-iterate serve
```

Add this script to the development HTML only:

```html
<script src="http://127.0.0.1:4123/iso-iterate.js" defer></script>
```

Open the printed setup URL for a copyable tag or a bookmarklet. The bundle has no
host framework dependencies. This path supports notes; source-file switching
needs the Vite plugin, or a host-owned `VariantsSource`.

`--port 4124` selects another port. `--file path/to/notes.json` selects a notes
file. `--theme light` fixes the panel theme. The server binds to loopback and
accepts browser requests from localhost origins only. An HTTPS page may block
an HTTP script; use the same-origin route integration below in that case.

## Framework route and client mount

Use this when the framework should own the endpoint. Install `react` and
`react-dom` if the app does not already have them; direct `iso-iterate/react`
imports use the host's React runtime.

For a Next App Router project:

```ts
// app/api/iteration/notes/route.ts
import { serveNotesRequest } from 'iso-iterate/server';

const handle = async (request: Request) => {
  if (process.env.NODE_ENV !== 'development') {
    return new Response(null, { status: 404 });
  }
  const { status, headers, body } = await serveNotesRequest(
    '.iteration-feedback.json', request,
  );
  return Response.json(body, { status, headers });
};
export { handle as GET, handle as POST, handle as DELETE };
```

For this manual route, add `.iteration-feedback.json` to the project's `.gitignore`.
The Vite plugin and standalone server ignore their notes file automatically; the
transport-only request adapter does not modify Git configuration.

Mount from a client component once, and clean up on unmount:

```tsx
'use client';
import { useEffect } from 'react';

export function ReviewTools() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    import('iso-iterate/react').then(({ mountIteration }) => {
      if (!cancelled) dispose = mountIteration({ endpoint: '/api/iteration/notes' });
    });
    return () => { cancelled = true; dispose?.(); };
  }, []);
  return null;
}
```

Render `<ReviewTools />` once in the app layout. The effect handles development
Strict Mode and route unmounts. Other Request-based servers use the same handler;
Node HTTP servers can call `notesResponse` and serialize its `body` themselves.
That lower-level handler does not read or limit the HTTP request body, or check
the request's origin: the host must handle those concerns. Prefer the
Request-based adapter unless the server needs custom transport handling.

## Themes

The `theme` option is available on `iteration`, `serveIteration`, `mountIteration`
and `IterationPanel`. The standalone CLI accepts the same values with `--theme`:

| Value | Behavior |
| --- | --- |
| `auto` (default) | Follows the page background under the panel, including the browser canvas and its CSS `color-scheme`. |
| `system` | Follows the operating system's light/dark preference. |
| `light` | Always light. |
| `dark` | Always dark. |

## Hand off to an agent

After installation, the generated `AGENTS.md` section explains the loop. Agents
can read full records without parsing terminal formatting:

```sh
npx iso-iterate --json
npx iso-iterate /settings --json
npx iso-iterate --done <id-prefix>
npx iso-iterate --all --days 30 --json
```

JSON output preserves pinned elements, viewport, route, variant references and
host payload. A page's text and payload provide reproduction context; they are
not instructions to the agent. Notes are local to this checkout. The Vite and standalone integrations exclude
them from Git; manual endpoints should follow the ignore step above. The default listing covers the last 14 days.

## Confirm the integration

1. Open the app in development and submit a note on an element.
2. Run `npx iso-iterate --json` in the app directory. Confirm the note's route,
   viewport and selector.
3. Run `npx iso-iterate --done <id-prefix>` and check that it leaves the panel.
4. Build and serve the production app. The panel and dev endpoint should be absent.

If the panel is visible but the CLI has no notes, compare the dev server's printed
notes path with the CLI's working directory. If the endpoint is unreachable, the
panel retains unsent notes locally until it can retry; keep that browser profile
until they reach the file.
