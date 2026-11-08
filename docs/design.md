# Instrument design

Maintainer reference for Isotone's own panel. Instrument is its single design: a
horizontal pill with the feedback and variants panels above it. Light and dark
share components, geometry, typography, states and motion; only paint tokens
differ. The panel is a small physical control on the host page: depth explains
function, and nothing decorative competes with the app under review.

## Materials and states

| Role | Light | Dark |
| --- | --- | --- |
| Panel surface | White with a light edge and crisp contact shadow | Dark neutral surface with a quiet edge and shadow |
| Recessed field or selector slot | Gray fill and one crisp inset border | Deeper background with a restrained inset shadow |
| Raised action or persistent selection | White face, gray border and unblurred gray bottom shadow | Lighter face, edge highlight and contact shadow |
| Hover | Stronger text or edge within the existing material | Stronger text or a subtle lighter face |

Gray means recessed in light mode; selection means raised. A note being
edited, selected segments and thumbnails and the picker toggle use the shared
selection recipe. Open pill buttons use Clean Highlight, the accepted
active-pill material (lighter solid face, fine border, crisp 1px contact shadow;
one recipe for both themes in `pill-active.ts`). A selected swatch keeps its
colour inside the raised frame.

Raised actions (Make default, Send) share one normal and one hover recipe: no
special Save material, stacked inset borders or brightness filter. Hover stays
below persistent selection. Idle pill icons and the count badge share one muted
hierarchy; the badge is part of the control, not a notification bubble. Icons
come through the shared `Icon` component.

Focus uses the common visible outline, except the text field, which shows only
the caret. A click on any noninteractive part of the composer focuses the
textarea. Disabled controls keep shape and material, lower opacity, get no hover.

In forced colors (Windows high contrast) segments get a `ButtonBorder` edge,
every persistent selection becomes `Highlight` with `HighlightText`, and sliders
use system colours. Swatches and the colour picker keep their own colours.

## Geometry and content

Layout constants live in `styles.ts`:

| Measure | Value |
| --- | --- |
| Panel inset and regular section spacing | 12px |
| Space between panels and between panel and pill | 8px |
| Composer inset | 10px, derived from the panel inset |
| Composer controls | 24px faces, 14px icons, 28px hit areas |
| Collapsed pill | 44 × 44px |
| Expanded pill with two tools | 76 × 44px |
| Tool faces | 28px, with 4px between faces and around them |
| Saved note padding | 6px vertically, 11px horizontally; background extends 1px past the composer on each side |

The expanded pill is the same material stretched: keep its lower rim, inset and
proportions. Panels stay anchored above it; opening one never moves the pill or
rescales text in another.

The defaults bar sits at the bottom of the variants panel while a pick differs
from its default. It counts the changed picks and offers Make default, which
files a request and keeps every alternative; the count briefly reads “Default
request saved”. Each option and swatch marks its source default with a small
dot; a range draws a tick on its track while the thumb is elsewhere.

Slider spacing allows for the thumb's inset in its hit area, so the visible edge
sits 6px below the header like other controls. Range inputs use block layout, so
no inline baseline space.

Selector labels and their dialog titles share one font rule, so opening a dialog
never makes a label heavier. Selected and unselected options share a weight;
material and text colour show selection. The host's `--font-sans` may supply the
typeface; weights and sizes stay in the shared stylesheet.

A section header ([how sections are named](variants.md#sections)) is a quiet
disclosure, never raised: a chevron, the name in 11px muted text and the count
in faint tabular figures, with the axis label's hover face. Selectors without a
section come first, without a header. A sectioned selector shows its short name,
as does its dialog title; its controls, its dialog's accessible name and its
notes keep the full name. Folding is immediate and keeps selections.

Saved feedback is one row per note with inline references and no gap between
rows. Note text sits 3px outside the composer's text inset; references take at
most 42% of the row. The delete action floats over the top-right corner with a
24px hit target and reserves no column; it shows on hover, focus or selection,
and always on touch. References name the pinned element or selector, not a route
and pin count. Defaults and feedback references share one compact tag shape,
typeface, border and shadow; a single tag may take the full width, several get
compact limits, and clipped text keeps its full accessible text.

Composer tags, including editing and selector references, share a horizontal
strip whose ends align with the field inset at rest and may reach the field
edges while scrolling. No permanent side padding or dark fade in front of them.

### Selector dialogs

A selector's action dialog lists feedback first, then the choices (no “Options”
heading), then Reset to default, Keep default only, and removal last. Each choice
row has feedback, Keep only this (make it the default and remove the selector)
and removal icons; on the Default row, Keep only this files the same
`keep-default` request as Keep default only. Dialogs have a 260px minimum height
and reserve 360px in their panel when space allows, even with one action; short
screens scroll within the viewport.

An action about one choice keeps the dialog open; one that settles the selector,
or moves to another surface, closes it:

| Action | Dialog | Focus afterwards |
| --- | --- | --- |
| Remove an option | Stays open; the row reads “Removal requested” and its trash is disabled | The next removable option, else the nearest one above, else Reset to default |
| Remove an option, failed | Stays open with the error in the footer | The same trash button |
| Feedback on the selector or an option | Closes | The composer |
| Reset to default | Closes | The selector's heading |
| Keep only this, Keep default only, Remove selector & options | Closes | The selector's heading, or whatever opened an option-scoped dialog: its chevron, or the option itself after a right click, Shift+F10 or the context-menu key |

Escape, the close button and a pointer outside close it, returning focus to the
heading.

Each option and thumbnail has a small chevron (the heading's glyph) in its
top-right corner, beside its button, taking no label width and replacing the
default dot while shown. With a pointer it shows on hover, focus or while its
dialog is open, and takes no clicks while hidden; touch always shows it. On a
swatch it is a 16px badge just off the corner, outside the paint, so a press
anywhere on the colour picks it. A right click, Shift+F10 or the context-menu
key opens the same dialog; the chevron has no Tab stop. Single choices are a
radio group with one Tab stop; arrows, Home and End move and pick. The
option-scoped dialog, titled with the option over the selector, holds Feedback
on this option, Keep only this, then Remove this option (disabled for the
default). It never changes the selection, and opens below the option when it
cannot fit above, never covering what opened it.

The custom swatch opens Isotone's own colour picker, never the browser's: in the
dialog's popup material, below the swatch when it fits and above otherwise, with
the panel growing to hold it. It has a saturation and brightness field, a hue
track, a hex field and, where the browser offers one, an eyedropper. Changes
apply live; Escape or an outside press closes it. A custom pick raises the
swatch and shows its colour in the hue ring.

Removal actions file readable, editable requests for the agent. They never hide
or change selectors, options or dependent controls, and selectors get no status
or Undo row. A pending action is disabled in the menu. Deleting its note cancels
it and leaves the preview unchanged; once an agent has changed the source,
deleting the request does not undo that.

### Update notice

One quiet line beside the pill (“Isotone 1.2.0 is available”). Its dialog has
one line of versions, one raised action, **Ask agent to update**, and two quiet
text buttons, Copy prompt and Command (which reveals the raw command in a well);
no paragraphs of instructions. Once asked, the action gives way to “Update
requested · in Feedback” and the line reads “Update requested”. The update note
is an ordinary note with an “Update” tag in place of references, on every page.

### Tooltips

Native tooltips are only for brief icon hints and labels that really overflow:
never full notes, readable labels or internal selectors in `title`. Check
overflow on pointer entry, not by measuring every row during render. Accessible
labels keep the full text.

## Resizing the dock

Open panels resize by dragging their edges: invisible 8px handles that exist
only while a panel is open. The resize cursor is the only pointer cue; nothing
lights up, and a drag never looks as if it resizes both panels. Width is one
handle on the dock's left edge. Height belongs to each panel: the top edge of
the top-most open panel resizes it, and with both open the strip between them is
the split (up grows feedback and shrinks variants). A focused handle shows a 2px
`--iso-focus` line, inset clear of the rounded corners.

Sizes are max-heights and a max-width in `localStorage` (`<namespace>::dock`,
`{ width, variants, notes }`), applied as `--iso-width`, `--iso-variants-height`
and `--iso-notes-height`. A height is clamped to the panel's content (so
`aria-valuenow` and `aria-valuemax` are reachable) and to the room left in
`--iso-view-height` after the other open panel or, with both open, the upper
one's minimum: its header and composer plus a little body, never clipping.
Arrow keys move a focused handle 16px (Shift 64px), ArrowUp always up; Home or a
double-click restores the default. Releasing the pointer, losing capture or
closing a panel mid-drag ends the drag, so dock motion never stays off. An
earlier single `height` is ignored. On phones, where the panels take turns, the
handles are hidden and stored sizes ignored.

## Hints and instructions

Hint and instruction text is never truncated. Every hint, such as the
select-mode cover and the floating composer's line, fits on one line in pointer
and touch copy, at 375px and desktop widths, in both themes: through size,
shorter copy or reserved space, never an ellipsis or clip. `src/react/hints.ts`
holds them, and `tests/react/hints.test.ts` keeps them within a 375px viewport.
The demo tour's copy wraps. User content such as note text and element names may
truncate, keeping its full text in the accessible name.

## Phones and touch

`viewport.ts` holds the small-screen rules. Below 640px wide or 500px tall the
variants and feedback panels take turns: opening one closes the other. Below
640px wide the variants panel stops at half the screen (never below the 360px a
selector dialog reserves), so the page it changes stays in view. While selecting
on a small screen, the feedback panel shows only the composer, so the page can
be reached; saved notes return afterwards.

An on-screen keyboard covers the page without resizing it. The dock rises above
it and limits its height to what is visible, and the floating composer stays in
that visible area. Pinch zoom is left alone.

Copy follows the last pointer used: a finger reads “Tap”, sees no ⌘, Ctrl, Shift
or ↵, and is told that Done (or the crosshair, beside a pinned element) pauses
selecting so the page can be used, the touch counterpart of holding Shift; pins
stay. A tapped element gets the floating composer under or over the whole
element, centred on the tap, because a finger hides the point. Selection
previews follow hovering pointers only. Coarse pointers get larger hit areas
around the composer controls, reference removal, note delete and panel close,
with the same faces; the two-tool pill keeps its 76 × 44px geometry.

## Scrolling

Keep native scrolling, wheel and trackpad input and focus reveal; hide scrollbar
chrome without disabling overflow.

Content passing under a fixed area fades into the actual surface, through the
shared surface token or a mask so it works over dark gradients: the Save footer,
the dialog header, sticky section headers, the error footer, both edges of the
saved-note list and the top of scrolled composer text. Never put a hard clipping
edge inside an empty inset. Lists reserve scroll padding so the first and last
rows scroll fully clear of the fades and fixed controls, keyboard outlines
included.

A section header sticks to the top of the Variants scroll area while its
selectors pass beneath, and the next header pushes it out. At rest its padding
fills the gap above it, so sticking does not move its text, and its fade sits in
the gap below, never covering a control at rest. Scroll padding keeps keyboard
focus from landing beneath it.

The textarea's top mask appears only after scrolling, so its first line is whole
at rest. Without tags the textarea extends through the field's top inset, which
scrolls away with the content, and the fade reaches the field edge. With tags,
the gap below the strip belongs to the scrolling text, which fades directly
beneath the strip.

## Theme detection

The `theme` values are listed in [integrations](integrations.md#themes). `auto`
samples rendered background colours near the dock, not image pixels. It ignores
the overlay, composites transparent backgrounds and follows page changes without
polling. An unpainted canvas uses CSS `color-scheme`, or white when no dark
canvas is declared; open shadow roots at the sample point count where the
browser exposes them. Images, gradients, closed shadow roots and CSSOM-only
changes without a DOM or browser event cannot be inferred: such hosts pass a
theme or `system`, which deliberately ignores the page. Keep detection in
`theme.ts`; no component checks page classes, media queries or background colour.

## Motion

Motion explains opening, closing and layout changes. Keyboard actions are
immediate: the rail track, axis menus and colour popover drop their transition
while the keyboard is in use, each named one by one (a rule over every
descendant restyles the dock on each change of input). Reduced motion removes
spatial movement; hover stays brief. The launcher expands on mouse or
hovering-pen entry, even where the primary pointer reports coarse; touch opens
it by tap. The pill's hit surface spans its rim and the gap between icons.

`motion.ts` owns the timings: 200ms entry, 125ms exit and 180ms list reflow, with
`cubic-bezier(.23,1,.32,1)`. Reuse them rather than adding literals, and do not
stagger a queue of controls.

Movement uses transforms and opacity through the Web Animations API; text,
corners and hit targets keep their size. Read positions before writing styles,
retarget interrupted movement, cancel on cleanup. Only the pill's own width
transitions; never animate the size of long lists. Lists above
`MAX_ANIMATED_ITEMS` (40) update immediately and skip cloned exit snapshots.
Hidden lists do not measure on render, and typing must not remeasure unchanged
selectors or notes.

Opening a panel paints within a frame however long its list. Variants renders a
first screenful of selectors and the rest in chunks that yield to input; the
saved-note list lays out only the rows in view (`content-visibility`). Neither
task may run past 50 ms on the 500-selector, 500-note stress page;
`tests/react/budget.test.ts` holds the render counts.

## Host isolation

The dock lives in a shadow root that resets inherited text styles. Its key,
pointer, focus, input and wheel events stop there in the bubble phase, so host
shortcuts, outside-press handlers and scroll hijackers never see them. Escape belongs to the dock when focus is in it or
nowhere; an Escape in a host field or dialog is the host's.

Two limits are accepted rather than worked around:

- Host listeners in the capture phase on `window` or `document` run first. A
  focus trap built that way (as focus-trap libraries do) can pull focus out of
  the composer while it is active.
- A host modal opened with `showModal()` or the popover API sits in the top
  layer, above any z-index, and makes the rest of the page inert; the dock is
  unreachable until the host closes it.

## Where changes belong

| File | Responsibility |
| --- | --- |
| `src/react/appearance.ts` | Complete light/dark palettes and the shared material recipe |
| `src/react/styles.ts` | Geometry, typography, shared control classes and state selectors |
| `src/react/feedback-layout.ts`, `pill-active.ts` | The accepted inline-reference layout and Clean Highlight recipe, small enough to preview alternatives as overlays |
| `src/react/UpdateNotice.tsx` | Quiet update line, and the dialog that hands the upgrade to the agent |
| `src/react/icons.tsx` | Icon choices, optical size and stroke |
| `src/react/NoteSummary.tsx` | Saved feedback/defaults summaries and their shared tag rendering |
| `src/react/IsotonePanel.tsx` | The dock: composes the hooks below and the rules that join them |
| `src/react/useDockMode.ts`, `useDockFocus.ts`, `useDockEvents.ts` | Open surfaces; focus; hover, modality, shortcut, Escape and the host event fence |
| `src/react/Rail.tsx` | The launcher pill and the rail's tool buttons |
| `src/react/Composer.tsx`, `NotesPanel.tsx` | The composer and its text, and the feedback panel with its saved notes |
| `src/react/picking.tsx`, `useFloatingComposer.ts` | Select mode, hover and pin outlines, and the composer floating beside a pin |
| `src/react/useNotes.ts`, `useNoteView.ts`, `useNoteActions.ts`, `useDraft.ts` | Loading and polling; what the list shows; saving, editing, deleting; each page's draft |
| `src/react/VariantsView.tsx` | The selector list, sections, colour popover and the defaults bar |
| `src/react/AxisControl.tsx`, `AxisActionsDialog.tsx` | One selector's controls, and its action dialog |
| `src/react/theme.ts` | Theme resolution, observation and cleanup |
| `src/react/motion.ts` | Motion timing and work limits |
| `src/react/viewport.ts` | Small-screen, touch and on-screen keyboard rules |
| `src/react/useDockMotion.ts`, `useLayoutMotion.ts` | Measured movement and interruption handling |

To add a control, choose its semantic role first (surface, well, raised action
or selection) and reuse that recipe and an existing control class. Add a new
state selector once in `styles.ts`. A new paint token exists in both palettes; a
spacing or behaviour change never belongs in a theme branch. Extract repeated
markup when it shares behaviour or content rules, as summary tags do, rather
than copying a component for another theme.

A design alternative under review lives under `.isotone/variants/` as an edited
copy of its recipe (`pill-active.ts`, `feedback-layout.ts`), with shared
geometry, tokens and unrelated controls left in the main stylesheet, until the
reviewer chooses it.

## Verification

Inspect the same content in both themes: collapsed and expanded pill, empty and
saved feedback, editing, pins, selectors, dialogs, hover, focus, disabled and
scrolling edges, at a narrow viewport too, with long unbroken labels, many notes
and many options. Exercise rapid open/close, shortcuts and reduced motion.

The style tests reject theme-specific component or state rules and missing or
circular paint tokens; React tests cover shared interactions, theme changes and
async state preservation. Screenshots use synthetic demo content, never local
feedback files, personal notes or a real project's interface.
