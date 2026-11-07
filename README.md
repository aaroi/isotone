# Isotone

Ask your coding agent for design variants, switch between them in your running
app, and pin feedback to the exact elements you want changed.

![Switching layout, spacing and colour variants, pinning a card with a note, and an agent picking the note up and closing it](docs/assets/loop.gif)

Try it in your browser at [isotone.vercel.app](https://isotone.vercel.app). Nothing to install.

## How it works

Isotone adds a small panel to your app while it runs in development.

Ask your agent for variants of anything on the page: a layout, a spacing scale,
a colour, a component. They appear in the panel's Variants tab as thumbnails,
segmented choices, colour swatches or sliders, and switching one updates the
live page. Save your picks as the defaults for the agent to apply, or leave
feedback on a single option.

![The Variants panel with thumbnail, segmented, colour and range selectors above the feedback notes](docs/assets/preview.png)

When something needs changing, open Feedback with **⌘/Ctrl + Shift + .**, click
the elements you mean, write the change and send. Each note is saved to a JSON
file in your project with the page route, the viewport size, and a selector and
the text of every element you pinned.

Your agent reads the notes with `npx isotone --json`, makes the changes, and
closes each note when it's done. The panel marks the note the agent is working
on and updates without a reload, so you can keep adding notes while it works.

Comparing design directions one prompt at a time is slow, and so is describing
UI to an agent in words. Element pickers built into agents such as Claude Code
only work inside the agent's own browser. Isotone works in the browser you
already use, with any agent that can run a command.

## Add it to a project

```sh
npm install -D isotone
npx isotone init --yes
```

`init` detects your setup, prints the one change to make, and adds a short
section to `AGENTS.md` that teaches your agent the loop. Your agent can apply
the change for you. Nothing is added to production builds.

On **Vite**, the change is one plugin, and it works with any framework. Vite
applies it only to the dev server, so production builds have no panel and no
endpoints:

```ts
import { iteration } from 'isotone/vite';

export default defineConfig({
  plugins: [/* your framework plugin */, iteration()],
});
```

On **any other dev server**, run `npx isotone serve` in the project and load the
panel from your development pages. This tag only loads on localhost, so it does
nothing if the page ships:

```html
<script>
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
    document.head.append(Object.assign(document.createElement('script'),
      { src: 'http://127.0.0.1:4123/isotone.js' }));
</script>
```

On Next, `init` prints the same panel as a `next/script` tag behind
`process.env.NODE_ENV === 'development'`. The [integration guide](docs/integrations.md)
covers route handlers, React embeds, themes and the production guards. Node.js 20
or later is required. Coming from the previous package? See the
[migration guide](docs/migration.md).

## Keys

**Enter** sends a note and **Shift + Enter** adds a newline. Click a saved note
to edit it. Opening Feedback with the mouse or **⌘/Ctrl + Shift + .** starts
select mode. With Feedback open, the same shortcut starts select mode again, or
finishes it if it's on. In select mode, click to pin or unpin, hold
**Shift** to use the page normally, and press **Enter** to finish or **Escape**
to clear what you pinned. After a pin, the note field opens next to the element
you clicked, and you can start typing right away. Once you're done selecting,
**Escape** moves the field back into the panel.

## Updates

The dev server checks npm for a newer version at most once a day and shows the
upgrade command in the panel. The check sends no project content and stays quiet
offline. Set `checkForUpdates: false` to turn it off. [Update details](docs/updates.md).

## For maintainers

[Development and contributing](https://github.com/aaroi/isotone/blob/main/docs/development.md)
covers the source, design language, checks and releases.

MIT.
