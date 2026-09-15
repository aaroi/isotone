<p align="center">
  <img src="iso-iterate.png" width="160" alt="iso-iterate icon" />
</p>

# iso-iterate

Click the thing you want changed instead of describing it.

iso-iterate is a dev-only feedback loop between a person reviewing a running
web app and the coding agent building it. A small panel sits bottom right of
the dev build. You write a note, press the crosshair, and click the element
it is about. The note lands in a JSON file in the repo with the route, a CSS
selector and your window size. The agent reads the file with one command,
does the work, and marks the note done, so the queue drains as it works.

The same panel has a Variants tab. When a note asks for an alternative, the
agent makes a variant instead of editing the real file, and you switch
between the versions in place while looking at the page.

Works with any agent that can run a CLI. Notes never render in a production
build. There is no database and no hosted service, only files in the repo.

## Quick start

`npx iso-iterate init` looks at the repo and prints which block below fits.

### Vite

```bash
npm install -D iso-iterate
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { iteration } from 'iso-iterate/vite';

export default defineConfig({ plugins: [react(), iteration()] });
```

Start `vite dev` as usual. The dev server serves the notes and variants
endpoints, injects the panel into every page the visibility rule allows, and
does nothing in `vite build`. The panel is React, so `react` and `react-dom`
must be installed; a Vite app in another framework uses the script tag
below. Keep the React plugin (or your framework's) in the list: it is what
makes a variant switch swap the component in place instead of reloading.

### Any dev server: one script tag

```bash
npx iso-iterate serve
```

Run it inside the repo under review, then add one line to the dev page:

```html
<script src="http://127.0.0.1:4123/iso-iterate.js" defer></script>
```

React ships inside the script, so the host needs no bundler and no React.
`http://127.0.0.1:4123` shows the tag with a copy button and a bookmarklet
for pages you cannot edit. The server binds loopback and accepts requests
only from loopback origins. `--port`, `--host` and `--file` change the
defaults. `examples/plain-html/index.html` is a page wired this way. This
path carries notes; variants need the Vite plugin or your own source.

### A framework's own dev API

For a server that hands you a `Request`, serve the endpoint from a route
handler and mount the panel from a dev-only client module:

```ts
// app/api/iteration/notes/route.ts
import { serveNotesRequest } from 'iso-iterate/server';

const handle = async (req: Request) => {
  const { status, headers, body } = await serveNotesRequest('.iteration-feedback.json', req);
  return Response.json(body, { status, headers });
};
export { handle as GET, handle as POST, handle as DELETE };
```

```ts
// client, dev only
import { mountIteration } from 'iso-iterate/react';

if (process.env.NODE_ENV === 'development') {
  mountIteration({ endpoint: '/api/iteration/notes' });
}
```

A `(req, res)` server calls `notesResponse` from the same module and
serializes `body` itself. `iso-iterate/server` imports neither React nor
Vite.

## Using the panel

- Type, press **Enter**. The field clears and keeps focus.
- The crosshair pins an element: hover highlights, click attaches.
- Click a note to edit it. Delete appears on hover.
- Unsent text survives closing the panel.
- Done notes leave the list as the agent marks them.

The panel renders in a shadow root, so its styles and the page's never mix.
It matches the page's light or dark background on its own, and hides itself
on auth and error routes by default (see Options).

## Variants

A variant is an alternative of one specific element, chosen from the
panel's Variants tab. Two host shapes:

**A Vite host with no variant system** gets overlay variants, on by default.
A variant is a directory under `.iso-iterate/variants/<id>/` holding copies
of source files at their repo-relative paths plus a `variant.json`
manifest. While the variant is active, the plugin serves the copy in place
of the real file. Variants that override the same files, or share a
`--group`, are alternatives of one decision and appear as one selector with
Default and each option; unrelated variants get their own selectors and can
be active at the same time. A selector shows only on the variant's route;
a variant made without a route shows everywhere.

**A host with its own variant system** hands the panel a `VariantsSource`:

```ts
import { createVariantsSource, mountIteration } from 'iso-iterate/react';

const source = createVariantsSource({ axes, onChange: applySelections });
mountIteration({ variants: source, defaultTab: 'variants' });
```

The panel renders select, range and colour axes, thumbnail grids,
conditional axes, sections and Revert; the app keeps its own state and URL
sync. `npx iso-iterate init --approach host` prints a complete example.

**The loop.** Pin an element and write the ask. The agent starts a variant
from the note and edits the copy. You switch between Default and the
alternatives in the panel; the switch applies in place. **Save as
defaults** files your picks as a note, and the agent lands the named
variants over the real files with `variant promote`. Nothing else changes:
other variants stay until you ask for one to be dropped.

Variant files are committed by default, since they are the change under
review; `variants: { ignored: true }` keeps them local. The active pointer,
`.iso-iterate/active.json`, is local and never committed. `ISO_VARIANT=<id>`
(a comma-separated list) bakes variants into a `vite build` for a preview.

## What live switching needs from the host

A switch is delivered as a Vite hot update, so it swaps in place exactly
where an edit to that file would.

- **React Fast Refresh**, through `@vitejs/plugin-react` or the framework
  plugin that wraps it. Without it every switch reloads the page.
- **Component-only exports.** A file that also exports data or a hook
  cannot be swapped alone; the update climbs to its importer, and an entry
  with no accept handler reloads. Accept the import in the entry and
  re-render from the new module, or move the extra exports out.
- **Tailwind v4** scans only the sources it is pointed at. Add
  `@source "../.iso-iterate/variants/**/*.{ts,tsx}";` (relative to the CSS
  file) or classes new to a variant render unstyled.
- **A sibling dev server** that aliases into another package sets
  `variants: { root: '../that-package' }` so both serve the same variants.
- **Routes** come from `window.location.pathname`. An app on a memory
  router sees `/` everywhere; leave `--route` off there.
- **Linters** should ignore `.iso-iterate` (Biome: `"!.iso-iterate"` in
  `files.includes`; ESLint: `{ ignores: ['.iso-iterate/**'] }`).

## The agent side

```bash
npx iso-iterate                # open notes, all routes
npx iso-iterate /projects      # one route
npx iso-iterate --done <id>    # mark addressed (an id prefix is enough)
npx iso-iterate --all          # include done notes
npx iso-iterate variant list   # every variant, its group, active ones marked
npx iso-iterate variant new <id> --note <prefix>   # start one from a note
npx iso-iterate variant add <id> <file...>         # copy files into it
npx iso-iterate variant use <id>                   # switch the dev server
npx iso-iterate variant promote <id>               # land the winner
npx iso-iterate --help         # everything, also `variant --help`
```

A note prints with its route, element, viewport and any host context:

```
## /projects
- [a85a7b93] (2026-08-29 14:49 · 900×620)
  ↳ <button> "Join the waitlist" — #primary-cta
  Default label should be Get started, with cursor-pointer.
```

AGENTS.md in this repo is a drop-in brief for the agent, and
`npx iso-iterate init --approach <name> --yes` appends a shorter version to
the host repo's own AGENTS.md.

## Options

```ts
iteration({
  file: '.iteration-feedback.json', // where notes persist; kept out of git via .git/info/exclude
  rule: { hidden: ['/login'] },     // route visibility: hidden, visible (allowlist), alwaysHidden
  key: 'my-app',                    // localStorage namespace per app
  variants: {                       // overlay variants; omit for these defaults, false to turn off
    root: '.',                      // the package the file paths are relative to
    dir: '.iso-iterate/variants',   // where variants live, relative to root
    ignored: false,                 // true keeps the directory out of git
  },
})
```

`rule.hidden` defaults to `/login`, `/logout`, `/register` and `/error`;
`alwaysHidden` to `/api`, `/auth` and `/login`. To review a login page:
`iteration({ rule: { hidden: [], alwaysHidden: ['/api', '/auth'] } })`.

`mountIteration` takes `endpoint`, `variants` (a source, or `'overlay'`),
`defaultTab`, `key`, `rule`, `getRoute` for a sub-app whose route is not
the pathname, and `getPayload` for host context on each new note.
`<IterationPanel/>` is the same panel for rendering inside your own tree.

## FAQ

**Does anything ship to production?** No. The plugin serves and injects
only under `vite dev`; the panel is not in the bundle. A host that passes
its own `VariantsSource` to `mountIteration` renders the Variants tab
wherever that call runs, which is the one opt-in exception.

**Do teammates install anything?** With the plugin, `npm install` is all;
variants travel with the branch and each machine has its own notes file.
On the `serve` path each machine runs `npx iso-iterate serve`.

**Two dev servers?** Each writes notes next to its own root. Two servers
over the same variants root, which `variants.root` sets up, switch together.

**No panel in `curl` output?** The plugin injects on navigation requests
only; send `Accept: text/html`.

## Development

```bash
pnpm install
pnpm check   # typecheck, lint, build, test
```

MIT.
