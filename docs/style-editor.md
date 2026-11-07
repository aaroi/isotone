# Style editor (experimental)

The style editor lets a reviewer adjust pinned elements visually, the way a
design tool's inspector does, and send the result to the coding agent as a
structured diff. The page only previews the change. The agent makes it in
source, with the project's own styling system.

It is off by default and may change between minor versions.

## Turn it on

| Integration | Option |
| --- | --- |
| Vite plugin | `iteration({ experimental: { styleEditor: true } })` |
| `npx isotone serve` | `--style-editor` |
| `serveIteration` | `serveIteration({ file, experimental: { styleEditor: true } })` |
| `mountIteration` | `mountIteration({ endpoint, experimental: { styleEditor: true } })` |
| `IterationPanel` | `<IterationPanel experimental={{ styleEditor: true }} … />` |

The editor needs the notes endpoint, because its output is a note.

## Use it

Open Feedback and press the pencil-and-ruler button in the composer, or on
the select-mode cover. Then pin elements: click one, Shift-click to use the page,
or drag across an area to pin the outermost elements inside it (dragging across
a row of cards pins the cards). The inspector docks above the feedback panel,
and the composer stays docked beneath it.

- **Fields** read `getComputedStyle`. Number fields scrub: drag the label (or a
  margin/padding cell) sideways, or press ↑/↓. Shift moves ten steps and Alt a
  tenth. A bare number means pixels where CSS needs a unit. Clearing a field
  and pressing Enter resets it. Escape restores what was there before typing.
- **Sections**: Layout (display, direction, wrap, gap, alignment, grid columns),
  Spacing (a margin and padding box), Size, Typography, and Fill and border
  (background, border, radius, opacity, shadow). Sections collapse; the
  inspector remembers which.
- **Tokens**: under each section, the custom properties that feed its values,
  with their current values, for example `--card-padding 18px`.
- **Several elements**: a field the elements disagree on shows Mixed. Typing a
  value sets it on all of them; ↑/↓ and scrubbing nudge each element's own value.
  The scope strip narrows edits to one element, or to a group of elements whose
  original styles are identical. A section with a Mixed value offers its values
  as chips; choosing one narrows the edit to the elements that have it.
- **Selection**: the breadcrumb shows the element's ancestors. Choose one, or
  press Alt+↑ outside a field, to move every pin in scope to that ancestor. The
  child button (or Alt+↓) moves each pin to its matching child, so three cards
  can become their three headings. Inside a number field Alt+↑/↓ is a fine step. An element with previewed changes stays pinned when you move
  away from it.
- **Undo**: ⌘Z and ⇧⌘Z (Ctrl on other systems) or the header buttons.

Send the note from the composer or with **Send to agent**. A note with no text
gets a summary such as `Style: padding-top 18px → 24px (3 elements)`.

## Preview and revert

Edits never touch an element's `style` attribute. Each edited element gets a
`data-isotone-style` attribute, and one `<style data-isotone-style-preview>`
appended to the document applies the overrides with `!important` under a
tripled attribute selector. Sending the note, closing the inspector, closing the
feedback panel, discarding the changes or unpinning an element removes the
overrides and attributes; the page is back to its own styles.

## What the note carries

The note's `elements` hold the usual pin descriptors. `styleEdits` holds one
entry per edited element, matched to `elements` by `selector`:

```json
{
  "selector": "#overview-cards > article:nth-child(1)",
  "classes": ["card"],
  "changes": [
    {
      "property": "padding-top",
      "from": "18px",
      "to": "24px",
      "rule": ".overview-cards article",
      "declared": "padding: var(--card-padding, 18px)",
      "tokens": { "--card-padding": "18px" },
      "matches": ["--space-6"]
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `property` | The CSS property, in kebab case. Margin and padding are per side; `gap`, `border-width`, `border-color`, `border-style` and `border-radius` are shorthands. |
| `from` | The computed value before the edit. sRGB colours are hex; `oklch()` and other spaces stay as the browser reported them. Lengths are rounded to a tenth of a pixel. |
| `to` | The value the reviewer chose, as entered. |
| `rule` | The selector of the rule that most likely set the old value: a utility (`.p-4`), a CSS module class, a CSS-in-JS class, `style attribute`, or a rule on an ancestor followed by `(inherited)`. Absent when only browser defaults apply. |
| `declared` | The value as written in that rule. A shorthand is named, as in `padding: …`. |
| `tokens` | Custom properties `declared` reads, with their current values. An empty value means the property is unset and the fallback applies. |
| `matches` | Custom properties whose current value already equals `to`. |

`npx isotone --json` returns `styleEdits` as stored and adds a `styleHint` to
open notes that have them. The text output prints each change under its
element:

```
  ↳ <article> "Active projects 12 +2 this month" — #overview-cards > article:nth-child(1)
    classes: card
    style: padding-top 18px → 24px  (rule .overview-cards article; declared padding: var(--card-padding, 18px); --card-padding: 18px; to equals --space-6)
```

Notes without style edits are unchanged; older clients and servers ignore the
field. The store drops malformed entries and bounds every string.

## Applying a style diff (for agents)

The diff records what the reviewer saw, not the code to write. Apply each
change the way the project styles that element:

1. Find the element from its descriptor (selector, components, source, text).
2. Find where the old value comes from. `rule` and `declared` usually name it.
   Utility classes: change the class, for example `p-4` → `p-6` for 16px → 24px
   with a 4px spacing scale. CSS modules or stylesheets: edit that rule.
   CSS-in-JS: edit the styled component or style object. A `style attribute`
   rule means the source sets an inline style; change it there.
3. Prefer tokens. When `declared` reads a custom property, decide whether the
   change is to this element (use another token or override locally) or to the
   token itself, which changes every user of it; change a shared token only when
   the note says so or every user should change. When `matches` names a token,
   use it instead of the raw value.
4. When several elements share the same change and the same rule, change the
   shared rule once rather than each element.
5. Keep the change at the viewport the note was written at when the project's
   styles are responsive.
6. Do not add inline styles or `!important` to reproduce the preview, and do not
   copy the `data-isotone-style` attribute; it exists only in the reviewer's
   browser.

Then verify in the browser and close the note as usual.

## Limitations

- Rule origins are a best effort. Cross-origin stylesheets cannot be read;
  cascade layers are treated as one layer, and container queries and `@scope`
  are included without evaluating them. Shadow DOM inside the host page is not
  pickable.
- An author declaration marked `!important` inside a cascade layer, or an inline
  `!important`, can beat the preview.
- A pin made after editing an ancestor's inherited property reads that preview
  as its starting value.
- If the host re-creates an element (a remount or list re-key), its preview is
  lost until it is edited again.
- Previews do not survive a reload, and drafts keep pins and text, not style
  edits. Editing a saved note keeps its style diff, but does not preview it.
