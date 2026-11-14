# Soft design

Maintainer reference for Isotone's panel. Soft is its one design: a
horizontal pill with the feedback and variants panels above it, drawn as rounded
cards with capsule controls. Light and dark share everything but paint tokens.
The panel is a small physical control on the host page: depth explains function,
and no decoration competes with the app.

## Materials and states

| Role | Light | Dark |
| --- | --- | --- |
| Panel surface | Flat white, a fine edge and a short soft shadow | Flat dark neutral, a rim lit from above, a crisp outline against the page and a long soft shadow |
| Recessed field or selector slot | Light gray fill and one crisp hairline, never a blurred inner shadow | Deeper fill shaded from above, with a faint lit lower lip |
| Raised action or persistent selection | White face, fine edge and a small shadow | Lighter gradient face, lit top edge, quiet outline and small contact shadow |
| Popup (action dialog, colour picker, update dialog) | The panel's surface with a stronger shadow | A step lighter than the panel, with a stronger shadow |
| Hover | Stronger text or a faint fill within the existing material | Stronger text or a faint lighter fill |

Every surface a sticky header or fade has to match is flat, so a header never
shows as a band over a gradient. Depth comes from edges, highlights and shadows.

The rim is a 1px ring drawn over the card's content, so it reads the same all the
way round whatever passes beneath it: an inset shadow under the content would be
hidden by sticky headers and the defaults bar, and uncovered by an overscroll.

Gray means recessed in light mode; selection means raised. A note being
edited, selected segments, thumbnails and page chips, the picker toggle and the
open pill button use the shared raised key. A selected swatch keeps its colour
inside the raised frame.

Send is the one coloured control: an accent capsule that sinks to a quiet,
flat face while there is nothing to send. The count badge on the pill shares the
accent. Every other raised action (Make default, Ask agent to update, Done)
is a neutral key in regular weight, sharing one normal and one hover recipe: no
special Save material, stacked inset borders or brightness filter. Hover stays
below persistent selection. Icons come through the shared `Icon` component.

Focus uses the common visible outline, except the text field, which shows only
the caret. A click on any noninteractive part of the composer focuses the
textarea. Disabled controls keep shape and material, lower opacity, get no hover.

In forced colors segments get a `ButtonBorder` edge, persistent selection
becomes `Highlight` with `HighlightText`, and sliders use system colours;
swatches and the colour picker keep theirs.

## Geometry and content

Layout constants live in `styles/panel.ts`:

| Measure | Value |
| --- | --- |
| Panel inset | 14px; selectors are 14px apart, the feedback panel's parts 12px |
| Corners | Panels 18px, wells and the composer 12px, dialogs 14px, thumbnails and note rows 10px; controls, chips and segments are capsules |
| Space between panels and between panel and pill | 8px |
| Composer inset | 12px |
| Composer controls | 30px round select toggle; 44 × 30px send capsule with a 16px icon |
| Collapsed pill | 44 × 44px |
| Expanded pill with two tools | 76 × 44px |
| Tool faces | 28px, with 4px between faces and around them |
| Saved note padding | 6px vertically, 11px horizontally; background extends 1px past the composer on each side |

The pill is glass: its face lets the page through, blurred and a little more
saturated, under the same rim and shadow, so it sits in the host page rather than
on it; the update notice beside it shares the glass. The expanded pill is the
same material stretched, keeping its lower rim, inset and proportions. Panels stay anchored above it; opening one never moves the pill
or rescales another's text.

### Getting in

A tool's face on the pill opens it and, pressed again, closes it; a click or
tap on the folded pill, or Enter on it, reopens the tool used last in the tab
(else the host's `defaultTab`). Opening Feedback with the pointer or the
shortcut starts select mode, with the caret already in the note field under the
cover, placed in the commit that shows it, never a frame later, so nothing typed
during the entrance is lost; Enter or Space on a focused face goes straight to
the field, and a finger gets select mode with no caret, so no on-screen
keyboard rises over the page. The crosshair turns select mode on and off. The
first character, keyed or inserted, or a key that would edit or move the caret
unseen (Backspace, Delete, arrows, Home, End, Page Up and Down, select all),
ends selecting and acts in the field. Opening Variants, or a press anywhere in
the dock outside Feedback, ends selecting and keeps the pins, so the next click
on the page acts on the page. Focus passing through the dock does not: Tab and
Shift+Tab are how the keyboard reaches the page, where Space pins. Tabbing back
into the note field ends selecting, as a click there does, since the field is
where the next keys go.

The open panels are kept per tab (`sessionStorage`, `<namespace>::panels`, with
the page and the document that wrote them) and come back when that page is
reloaded, as a variant switch that reloads does, or when the panel remounts in
the same document; a new visit starts folded, and writes that it did. They come
back already in place, with no entrance for them or their contents until the
first key or press, and Variants at the same place in its list, kept from its
foot and held until the reviewer scrolls or presses there. Select mode and a
floating composer never come back. Where panels take turns, only the one used
last does.

Variants sits on the pill and Feedback above it. Opening Feedback, a note
saved into it or closing it never moves a selector: when room runs out,
Variants gives it from its top edge and its list scrolls by as much; room given
back is taken only as far as that scroll absorbs, and while the pointer rests on
the dock the rest waits until it leaves (or a resize handle is taken up by
pointer or key); closed from the keyboard, the list simply grows. Every such
change of size eases (see Motion). Opening Variants under an open Feedback
unfolds Variants and glides Feedback up: the one movement left, caused by the
reviewer's own click.

Escape returns focus to the control that opened the dock: the host's, or the
launcher when the dock was opened from the keyboard. Opened with the pointer, it
lets focus go, so the pill folds back with no ring on a face.

A link whose `?v=` the source did not apply (its optional `linkIgnored()`)
gets one quiet line beside the pill in the update notice's glass: “This link’s
variants aren’t shown”. It opens Variants, which says what the link asked for,
and moves focus to Variants' face. Once Variants has been opened with that link
in the tab, the line does not come back, after a reload included; a new `?v=`
asks again.

The defaults bar sits at the bottom of the variants panel while a pick differs
from its default: a count, Compare and Make default, which files a request and
keeps every alternative (the count briefly reads “Default request saved”). The
panel keeps the bar's room at its foot whenever it can show the bar, so the bar
coming or going never resizes the panel or moves a control under the pointer.
Compare is a quiet text button, never raised: held (pointer, Space or Enter, or
the page-wide key under Escape, ` or §) it shows every instantly switchable
selector at its default, the count reads “Showing defaults” (“Showing defaults,
except Hero and 1 more” when some keep their pick, “Defaults, except Hero +1”
in a bar under 260px; only the name truncates), the
selectors that switched show their defaults and ignore presses while still
scrolling, and `aria-pressed` turns its text to the foreground. A quick click
reads “Hold to compare” in the count for 1.5s. The switch is instant both ways,
with no motion. A button hold ends on release, lost capture, leaving the window
or the panel closing; a key hold works with the panel closed and ends on keyup;
blur or a hidden tab ends either. A small dot
marks each source default; a range draws a tick there while the thumb is
elsewhere. A slider's visible thumb edge sits 6px below its header like other
controls, and range inputs use block layout.

Selector labels, dialog titles, and selected and unselected options share one
light font weight (450); material and text colour show selection. Dialog titles
are a step larger than the label that opened them. The host's `--font-sans` may
supply the typeface; weights and sizes stay in the shared stylesheet.

A section header ([naming](variants.md#sections)) is a quiet disclosure, never
raised: chevron, name in 11px text between the foreground and muted, count in
faint tabular figures, the axis label's hover face. Unsectioned selectors come first. A sectioned selector
and its dialog title show the short name; controls, accessible names and notes
keep the full one. Folding is immediate and keeps selections; unfolding eases the selectors in (see Motion).

Saved feedback is one row per note, inline references, no gap between rows.
Note text sits 3px outside the composer's text inset; references take at most
a third of the row and name the pinned element or selector, not a route and pin
count. Delete floats over the top-right corner (24px hit target, no column),
shown on hover, focus or selection and always on touch. The list is one Tab
stop: Up, Down, Home and End move between notes, Left and Right between a note
and its delete, and a delete from the keyboard moves on to the next note's.
Defaults and feedback
references share one compact tag; a lone tag may take the full width, several
get compact limits. Composer tags share a horizontal strip whose ends align with
the field inset at rest and may reach its edges while scrolling, with no side
padding or dark fade in front.

### Selector dialogs

A selector's action dialog lists feedback, the choices (no “Options” heading),
Reset to default, Keep default only, and removal last. Each choice row has
feedback, Keep only this (make it the default, remove the selector) and removal;
on the Default row Keep only this files `keep-default`. Dialogs are at least
260px tall and reserve 360px in their panel when space allows; short screens
scroll within the viewport.

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
default dot while shown. In a capsule segment the chevron sits centred on the
right and the default dot leads the label, so both stay. With a pointer it shows on hover, focus or while its
dialog is open, and takes no clicks while hidden; touch always shows it. On a
swatch it is a 16px badge just off the corner, outside the paint, so a press
anywhere on the colour picks it. A right click, Shift+F10 or the context-menu
key opens the same dialog; the chevron has no Tab stop. Single choices are a
radio group with one Tab stop; arrows, Home and End move and pick. The
option-scoped dialog, titled with the option over the selector, holds Feedback
on this option, Keep only this, then Remove this option (disabled for the
default). It never changes the selection, and opens below the option when it
cannot fit above, never covering what opened it.

Every action dialog follows the same placement: above what opened it, else below.
When it fits on neither side it takes the roomier side and scrolls there, with a
longer fade at its foot; it covers its heading only when neither side has 160px.
It stays 12px clear of the panel's foot.

The custom swatch opens Isotone's own colour picker, never the browser's, in the
popup material below the swatch (above when it does not fit), growing the panel
to hold it: saturation and brightness field, hue track, hex field and, where
offered, an eyedropper. Changes apply live; Escape or an outside press closes
it. A custom pick raises the swatch and shows in the hue ring.

Removal actions file editable requests for the agent and never hide or change
selectors, options or dependent controls; there is no status or Undo row. A
pending action is disabled in the menu. Deleting its note cancels it without
changing the preview, and cannot undo a source change already made.

### Update notice

One quiet line beside the pill ([what it offers](updates.md#in-the-panel)). Its
dialog is one line of versions, one raised action and two quiet text buttons,
Command revealing the raw command in a well; no paragraphs of instructions. Once
asked, the action reads “Update requested · in Feedback” and the line “Update
requested”. The update note is an ordinary note tagged “Update” in place of
references.

### Tooltips

Native tooltips are only for brief icon hints and labels that really overflow,
never full notes, readable labels or internal selectors. Check overflow on
pointer entry, not by measuring rows during render.

## Resizing the dock

Open panels resize by dragging invisible 8px edge handles, cued only by the
resize cursor (nothing lights up). Width is the dock's left edge. Height is the
top edge of the top-most open panel, and with both open the strip between them
is the split (up grows variants). A focused handle shows a 2px `--iso-focus`
line inset clear of the corners.

Sizes are max-heights and a max-width in `localStorage` (`<namespace>::dock`,
`{ width, variants, notes }`), applied as `--iso-width`, `--iso-variants-height`
and `--iso-notes-height`. A height is clamped to the panel's content (so
`aria-valuenow` and `aria-valuemax` are reachable) and to the room left in
`--iso-view-height` after the other open panel or, with both open, the upper
one's minimum: its header and composer plus a little body, never clipping.
Arrows move a focused handle 16px (Shift 64px), ArrowUp always upward; Home or a double-click restores
the default. Releasing, losing capture or closing a panel ends a drag, so dock
motion never stays off. On phones the handles are hidden and stored sizes
ignored.

## Hints and instructions

Hints and instructions (the select-mode cover, the floating composer's line) are
never truncated: each fits on one line in pointer and touch copy, at 375px and
desktop, in both themes, by size, shorter copy or reserved space, never an
ellipsis or clip. `tests/react/hints.test.ts` holds `src/react/notes/hints.ts` to a
375px viewport; the demo tour's copy wraps. User content (note text, element
names) may truncate, keeping its full text in the accessible name.

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
or ↵, and learns that Done (or the crosshair beside a pin) pauses selecting, the
counterpart of holding Shift; pins stay. A tapped element gets the floating
composer under or over the whole element, centred on the tap, since a finger
hides the point. Selection previews follow hovering pointers only. Coarse
pointers get larger hit areas (composer controls, reference removal, note
delete, panel close) with the same faces; the pill stays 76 × 44px.

## Scrolling

Keep native scrolling, wheel and trackpad input and focus reveal; hide scrollbar
chrome without disabling overflow.

Content passing under a fixed area (the Save footer, dialog header, sticky
section headers, error footer, both edges of the saved-note list, the top of
scrolled composer text) fades into the actual surface, via the surface token or
a mask so it works over dark gradients; never a hard clipping edge inside an
empty inset. Scroll padding lets the first and last rows, and keyboard outlines,
clear the fades and fixed controls.

A section header sticks to the top of the Variants scroll area while its
selectors pass, until the next pushes it out. A stuck header follows the scroll, never a
list reflow: a pick after scrolling leaves it where it is. At rest its padding fills the gap
above (sticking does not move its text) and its fade sits in the gap below,
covering no control; scroll padding keeps focus from landing beneath it.

In Variants, content leaving view dissolves: it blurs progressively and fades into
the surface, and each row recedes a little (not with reduced motion). The notes
list does the same more lightly, and a dialog's scrolled rows fade with the same
eased ends. A stuck
header and the defaults bar are one material with that dissolve, nearly opaque
behind their text, rather than solid blocks beside a fade. At rest each band fills
only the empty space at its edge, so nothing at rest is ever blurred; once content
can pass under it, it reaches further in, and scroll padding keeps keyboard focus
clear of that reach. The defaults bar never hides the end of a list: the list
keeps room at its end for the bar, so it never resizes, and its text sits one
selector gap below the last selector. While the bar shows, the bottom band rests
over that room, easing in and out with the bar. A pick on a control partly
under it, in a list that scrolls, brings that control just clear; a press on the
bar within half a second of a press in the list, or before the pointer has moved
away from it, does nothing, so a second click never files a default request. The blur steps through layers, each
twice the last, so no faint blurred copy sits over sharp text as a glow. Every
fade eases in and out, so neither end reads as a line. `styles/edges.ts` owns it.

The textarea's top mask appears only after scrolling. Without tags the textarea
extends through the field's top inset, which scrolls away with the text, and the
fade reaches the field edge; with tags, text fades directly beneath the strip.

## Theme detection

The `theme` values are in [integrations](integrations.md#themes). `auto` samples
rendered background colours near the dock (not image pixels), ignoring the
overlay, compositing transparent backgrounds and following page changes without
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
spatial movement; hover stays brief.

No panel ever jumps. The dock hangs from its bottom-right corner, so a panel
moves when its bottom or right edge does, and slides there. A change of a
panel's height (a note saved, a section folded, Feedback taking room from
Variants or giving it back, the composer growing a line, a keyboard resize)
eases the card's height from what showed to what it needs, every changed panel
on the same clock, so the stack's total moves evenly between two layouts that
fit and the panels above glide with it. A panel opening beside another unfolds
from nothing, contents clipped, with the gap between them; one opening alone
rises 6px and fades in. Heights ease after a key too, since they follow from
what the key did; only reduced motion, a resize the pointer drives (which
tracks the pointer) and panels a reload restored are immediate. Inside a
height that eases, Variants' list scrolls by as much as its top edge moves, so
its controls stay still. `tests/browser/dock-motion.test.ts` samples every
painted frame and fails on an edge that jumps. The launcher expands on mouse or
hovering-pen entry, even where the primary pointer reports coarse; touch opens
it by tap. The pill's hit surface spans its rim and the gap between icons.

`motion.ts` owns the timings: 200ms entry, 125ms exit, 180ms list reflow and
150ms for a line of text changing in place, with
`cubic-bezier(.23,1,.32,1)`. Reuse them rather than adding literals, and do not
stagger a queue of controls.

A press answers at once. While pressed, an icon button's glyph scales to 92%,
a worded key (Done, Make default, a segment, a page chip) to 97%, a swatch to
94% and a thumbnail to 98%, over 100ms; a held slider knob grows to 112%.
Reduced motion leaves them all still.

A pointer's pick in a segmented selector or thumbnail grid lands at once, since
hover already showed where it was going; the option it left fades its raised
face out in place over 125ms, on a key of its own (`keyFade.ts`) beneath labels
and pictures. Keys, reduced motion, high contrast and a change from elsewhere
swap at once. The
defaults bar crossfades its saved message. A new pin fades in and a reference
added to the open composer settles in from 96%, over 125ms; pins and chips
already there when the overlay or composer appears never do. Reduced motion
keeps their fades.

A figure that changes in place (a slider's value, a colour's hex, the count on
the pill) rolls only the characters that changed, up for a larger number and down
for a smaller one, through its own clip, over 200ms (`RollingText.tsx`). It rolls
whatever changed it, except Compare, which is instant both ways; a change landing
in quick succession, as from a dragged slider, swaps at once so the figure stays readable. Opening a
section eases its selectors in from 6px under the header. While an agent works on
a note, a slow light passes along its text, quieter at rest; reduced motion keeps
it still and quiet. Keys and reduced motion swap figures and sections at once.

Scroll edges move with the scroll position rather than a clock: a band grows as
content starts to pass under it, and a row shrinks to 96% while it crosses a band
(scroll-driven animations, so a browser without them shows the bands at rest and
rows at full size; reduced motion keeps rows still). The defaults bar's material
and the bottom band's rest over its room ease in and out with the bar; the room
it floats in stays put.

Movement uses transforms and opacity through the Web Animations API (the
defaults bar's crossfade also uses a 2px blur, and a rolling figure 1.5px); a
working note's glint moves its text's gradient, a repaint that content-visibility
keeps to the rows in view, on the dots' shared clock; text,
corners and hit targets keep their size. Read positions before writing styles,
retarget interrupted movement, cancel on cleanup. Only the pill's own width
transitions, and a panel card's height eases as above (the card, never its
rows); never animate the size of long lists or their rows. Lists above
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

- Host capture-phase listeners on `window` or `document` run first, so a focus
  trap built that way (as focus-trap libraries do) can pull focus out of the
  composer while active.
- A host modal from `showModal()` or the popover API sits in the top layer and
  makes the page inert; the dock is unreachable until it closes.

## Where changes belong

| File | Responsibility |
| --- | --- |
| `src/react/styles/appearance.ts` | Complete light/dark palettes and the shared material recipe |
| `src/react/styles/panel.ts` | Geometry, typography, shared control classes, state selectors and the accepted recipes (inline references, the open pill's raised key) |
| `src/react/styles/edges.ts` | The card's rim, and every fade, blur band and receding row where scrolled content meets an edge |
| `src/react/dock/UpdateNotice.tsx` | Update line and dialog |
| `src/react/icons.tsx` | Icon choices, optical size and stroke |
| `src/react/notes/NoteSummary.tsx` | Saved note summaries and their tags |
| `src/react/IsotonePanel.tsx` | The dock, composing the hooks below |
| `src/react/dock/useDockMode.ts`, `useDockFocus.ts`, `useDockEvents.ts` | Open surfaces and what a tab keeps across a reload; focus; hover, modality, shortcut, Escape and the host event fence |
| `src/react/dock/Rail.tsx` | The launcher pill and the rail's tool buttons |
| `src/react/notes/Composer.tsx`, `NotesPanel.tsx` | The composer; the feedback panel |
| `src/react/dock/picking.tsx`, `useFloatingComposer.ts` | Select mode and outlines; the composer beside a pin |
| `src/react/notes/useNotes.ts`, `useNoteView.ts`, `useNoteActions.ts`, `useDraft.ts` | Loading and polling; what the list shows; saving, editing, deleting; each page's draft |
| `src/react/variants/VariantsView.tsx` | The selector list, sections, colour popover and the defaults bar |
| `src/react/variants/AxisControl.tsx`, `AxisActionsDialog.tsx` | A selector's controls; its action dialog |
| `src/react/styles/theme.ts` | Theme resolution, observation and cleanup |
| `src/react/motion.ts` | Motion timing and work limits |
| `src/react/dock/viewport.ts` | Small-screen, touch and on-screen keyboard rules |
| `src/react/dock/useDockMotion.ts`, `src/react/useLayoutMotion.ts`, `src/react/variants/keyFade.ts` | Measured movement and interruption handling |

To add a control, choose its semantic role first (surface, well, raised action
or selection) and reuse that recipe and an existing control class. Add a new
state selector once in `styles/panel.ts`. A new paint token exists in both palettes; a
spacing or behaviour change never belongs in a theme branch. Extract repeated
markup when it shares behaviour or content rules, as summary tags do, rather
than copying a component for another theme.

A design alternative under review lives under `.isotone/variants/` as an edited
copy of `styles/panel.ts`, with shared
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
