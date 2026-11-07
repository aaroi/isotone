# Instrument design

Maintainer reference for changing Isotone’s own panel. Projects using Isotone
should follow the integration and variants guides instead.

Instrument is the single design for Isotone: a horizontal pill with feedback
and variant panels above it. Light and dark mode share components, geometry,
typography, interaction states and motion. Only their paint tokens differ.

The panel should feel like a small physical control placed on the host page.
Depth explains function; decoration should not compete with the app being
reviewed.

## Materials and states

| Role | Light | Dark |
| --- | --- | --- |
| Panel surface | White with a light edge and crisp contact shadow | Dark neutral surface with a quiet edge and shadow |
| Recessed field or selector slot | Gray fill and one crisp inset border | Deeper background with a restrained inset shadow |
| Raised action or persistent selection | White face, gray border and unblurred gray bottom shadow | Lighter face, edge highlight and contact shadow |
| Hover | Stronger text or edge within the existing material | Stronger text or a subtle lighter face |

Gray means recessed in light mode. In the default design, selection means raised. Saved notes being
edited, selected segments and thumbnails, the element picker toggle and open
pill buttons indicate persistent selection. Segments, thumbnails and the picker
use the shared selection recipe; pill buttons use Clean Highlight's simpler
face, fine border and crisp contact shadow. A selected colour swatch
keeps its represented colour inside that raised frame.

Make default, Send and other raised actions share their normal and hover
recipes. Do not create a special Save button material, stack several inset
borders, or use a brightness filter that also washes out the border. Hover must
remain less prominent than a persistent selection.

Idle pill icons and the count badge use the same muted visual hierarchy. The
badge is part of the control, not a contrasting notification bubble. All icons
come through the shared `Icon` component.

Keyboard focus uses the common visible outline. The text field is an intentional
exception: focusing it reveals the caret without changing the field's border,
fill or bottom edge. Clicking any noninteractive area of the composer focuses
the textarea. Its buttons retain their own actions. Disabled controls keep their
shape and material, reduce opacity and do not receive hover treatment.

## Geometry and content

The layout constants live in `styles.ts`. Current anchors are:

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

The expanded pill is the same material stretched horizontally. Preserve its
lower surrounding rim, inset and proportions. Panels stay anchored above it;
opening one must not move the pill or scale the text in another. The defaults bar
sits at the bottom of the variants panel and appears only when a pick differs
from its default. It counts the changed picks and offers Make default, which
files a request and keeps every alternative; the count briefly reads “Default
request saved”. Each option and swatch marks its source default with a small
dot, and a range draws a tick on its track while the thumb is elsewhere.

Slider label spacing accounts for the thumb's inset within its hit area, so its
visible edge has the same 6px gap below the header as other controls. Range
inputs use block layout to avoid extra inline baseline space.

Selector labels and their action-dialog titles share one font rule. Opening a
dialog must not make the same label heavier. Selected and unselected options
use the same font weight; their material and text colour indicate selection. The host's `--font-sans` may provide
the typeface; component weights and sizing stay in the shared stylesheet.

Selector sections group a long Variants list by the part of the page each
selector changes. A section header is a quiet disclosure: a chevron, the section
name in 11px muted text and its selector count in faint tabular figures. It uses
the axis label's hover face and is never raised. Selectors without a section come
first, without a header. Section names come from a label prefix (`Header > Logo
size`) or an explicit `section`; the selector shows only its own name, while its
controls, its dialog's accessible name and its notes keep the full name. The
action dialog title shows the short name, like the heading that opened it.
Folding a section is immediate and keeps its selections.

Saved feedback uses one row with inline references and no extra gap between rows.
Note text sits 3px outside the composer text inset. References use at most 42%
of the row, leaving the note the remaining width. The delete action floats over
the top-right corner with a 24px hit target; it reserves no column. Show it on
hover, keyboard focus or selection, and always on touch devices.
References name the pinned element or selector rather than displaying a route
and pin count. Defaults and feedback references use the same compact tag shape,
typeface, border and shadow. A single tag may use all available width; multiple
tags receive compact width limits. Preserve the full accessible text when
clipping it visually.

Composer tags share a horizontal strip. At rest their first and last edges align
with the field's inset. While scrolling they can reach the field edges; there is
no permanent side padding or dark fade in front of them. Editing and selector
reference tags follow this same rule.

Selector action dialogs show feedback first, then individual choices without
an “Options” heading, followed by Reset to default, Keep default only and
removal last. Each choice row carries feedback, Keep only this (which makes that
choice the default and removes the selector) and removal icons. On the Default
row, Keep only this files the same `keep-default` request as Keep default only.

The custom colour swatch opens Isotone's own picker, never the browser's
native popup. It floats in the action dialog's popup material, below its swatch
when it fits and above it otherwise, and the panel grows to hold it. It has a
saturation and brightness field, a hue track, a hex field and, where the browser
offers one, an eyedropper. Changes apply live; Escape or a press elsewhere
closes it. A custom pick raises the swatch and shows its colour inside the hue ring.

An action about one choice keeps the dialog open; an action that settles the
whole selector, or that moves to another surface, closes it:

| Action | Dialog | Focus afterwards |
| --- | --- | --- |
| Remove an option | Stays open; the row reads “Removal requested” and its trash is disabled | The next removable option, else the nearest one above, else Reset to default |
| Remove an option, failed | Stays open with the error in the footer | The same trash button |
| Feedback on the selector or an option | Closes | The composer |
| Reset to default | Closes | The selector's heading |
| Keep only this, Keep default only, Remove selector & options | Closes | The selector's heading, or whatever opened an option-scoped dialog: its chevron, or the option itself after a right click, Shift+F10 or the context-menu key |

Escape, the close button and a pointer outside the dialog close it and return
focus to the heading.

Selector action dialogs have a 260px minimum height and reserve 360px in their
parent panel when space allows, even for a selector with only one action. The viewport remains the upper
bound; short screens scroll instead of pushing controls off-screen.

Each option and thumbnail carries a small chevron, the selector heading's own
glyph, in its top-right corner, beside its own button rather than inside it. With
a pointer it appears only on hover or keyboard focus, and while its dialog is
open; hidden, it takes no clicks. Touch screens always show it. It replaces the
default dot in that corner while it shows, and it never takes label width. On a
swatch it is a 16px badge just off the corner, overlapping only the rounded
corner outside the paint, so a press anywhere on the colour picks it. A right click opens the same thing, and so do
Shift+F10 and the context-menu key on a focused option; the chevron itself takes no Tab stop. Single choices
(segments, thumbnails, swatches) are a radio group with one Tab stop, where arrow keys, Home and End move and pick. Both open the selector
action dialog scoped to that option, titled with the option and the selector as
secondary text: Feedback on this option, Keep only this, then Remove this option
(disabled for the default). Opening it never changes the selection, and the dialog opens below the option
when it cannot fit above, so it never covers what opened it.

Removal actions create readable, editable requests for the coding agent. They do
not hide or mutate selectors, options or dependent controls. Cancel a pending
request from its feedback note; selectors do not add a status or Undo row. Pending actions are
disabled in the menu to avoid duplicate requests. Cancelling a pending request
leaves the preview unchanged. Once an agent applies a source change, deleting the
request does not undo that change.

The update notice is one quiet line beside the pill ("Isotone 1.2.0 is
available"). Its dialog has a single line of versions, one raised action, **Ask
agent to update**, and two quiet text buttons, Copy prompt and Command, the last
revealing the raw command in a well. No paragraphs of instructions. Once asked,
the raised action gives way to "Update requested · in Feedback" and the line
reads "Update requested". The update note is an ordinary saved note with an
"Update" tag in place of element references, shown on every page; deleting it
cancels the request, like a removal request.

Native tooltips are reserved for brief icon-only hints and labels that actually
overflow. Do not put full feedback notes, readable labels or internal selectors
in `title` attributes. Check label overflow on pointer entry, without observing
or measuring every row during render. Accessible labels retain the full text.

## Resizing the dock

The open panels resize by dragging their edges. The handles are invisible 8px
strips and exist only while a panel is open; the resize cursor is the only
pointer cue, so nothing lights up on hover and a drag never looks as if it
resizes both panels. Width is one handle on the dock's left edge. Height belongs
to each panel: the top edge of the top-most open panel resizes that panel, and
with both open the strip in the gap between them is the split, where moving it
up grows feedback and shrinks variants, and down does the reverse. Keyboard focus
draws a 2px `--iso-focus` line on the focused handle, inset to stay clear of the
rounded corners.

Sizes are max-heights and a max-width, stored in `localStorage` under
`<namespace>::dock` as `{ width, variants, notes }` and set as `--iso-width`,
`--iso-variants-height` and `--iso-notes-height`. A height is clamped to the
panel's content height, so dragging past the content stores nothing larger and
the handle's `aria-valuenow` and `aria-valuemax` are what the panel can really
reach. The upper bound is also the room left in `--iso-view-height` after the
other open panel (with both open, after the upper panel's minimum). Each panel
keeps its own minimum: its header and composer plus a little of its scrolling
body, never less than would clip its content. Arrow keys move a focused handle
16px (Shift 64px), where ArrowUp always moves a horizontal handle up; Home or a
double-click restores the default. Releasing the pointer, losing pointer capture
or closing a panel mid-drag ends the drag, so dock motion never stays switched
off. An earlier single `height` is ignored.

On phones, where the panels take turns, the handles are hidden and the stored
sizes are ignored.

## Hints and instructions

Instructional and hint text is never truncated. Every hint, such as the
select-mode cover and the floating composer's line, is fully visible on one
line by default, in pointer and touch copy, at 375px and desktop widths, in
both themes. Make it fit with a smaller size, shorter copy or more reserved
space; never with an ellipsis or a clip. `src/react/hints.ts` holds the panel's
hints, and `tests/react/hints.test.ts` keeps them within the width a 375px
viewport leaves. The demo tour follows the same rule: its copy wraps.

User content, such as note text and element names, may still truncate, with
its full text kept in the accessible name.

## Phones and touch

`viewport.ts` holds the small-screen rules. Below 640px wide or 500px tall the
variants and feedback panels take turns: opening one closes the other. Below
640px wide the variants panel stops at half the screen (never below the 360px a
selector dialog reserves), so the page it changes stays in view. While
selecting on a small screen, the feedback panel hides its saved notes and keeps
only the composer, so the page can be reached; they return afterwards.

An on-screen keyboard covers the page without resizing it. The dock rises above
it and limits its height to what is visible, and the floating composer is
placed within the same visible area. Pinch zoom is left alone.

Copy follows the last pointer used: a finger reads "Tap", sees no ⌘, Ctrl,
Shift or ↵, and is told that Done (or the crosshair, beside a pinned element)
pauses selecting so the page can be used, which is the touch counterpart of
holding Shift; pins stay. A tapped element gets the floating composer under or
over the whole element, centred on the tap, because a finger hides the point.
Selection previews follow hovering pointers only. Coarse pointers get larger
hit areas around the composer controls, reference removal, note delete and
panel close without changing their faces. The two-tool pill keeps its
76 × 44px geometry.

## Scrolling

Keep native scrolling, wheel/trackpad input and keyboard focus reveal. Hide
scrollbar chrome without disabling overflow.

Content passing under a fixed area fades into the actual surface. This applies
to the Save footer, selector action-dialog header, sticky section headers,
conditional error footer and both edges of the saved-note list and the top of
scrolled composer text.

A section header sticks to the top edge of the Variants scroll area while its own
selectors pass beneath it, and the next section's header pushes it out. At rest
its padding fills the inset or gap above it, so sticking does not move its text,
and its fade sits in the gap below it, so it never covers a control at rest.
The list reserves scroll padding for the header, so keyboard focus never lands
beneath it. List
padding lets its first and last rows scroll fully clear of the fades. The textarea top
mask appears only after scrolling, preserving its first line at rest. Without
reference tags, the textarea extends through the field's top inset: that space
scrolls away with the content, and the fade reaches the field edge. With tags,
the gap below the reference strip also belongs to the scrolling text area;
scrolled text fades directly beneath the strip. Use the shared surface token or a mask so the
fade also works over dark gradients. Do not create a hard clipping edge inside
an otherwise empty inset. The first and last item must remain fully reachable;
reserve scroll padding for fixed controls and keyboard outlines.

## Theme configuration

`theme` accepts four values on the React panel, mount and integrations:

| Value | Meaning |
| --- | --- |
| `auto` (default) | Follow the actual page background near the dock |
| `system` | Follow the OS colour preference, independent of the host page |
| `light` | Always use the light palette |
| `dark` | Always use the dark palette |

Automatic detection ignores the overlay itself, composites transparent page
backgrounds and follows page changes without polling. An unpainted canvas uses
CSS `color-scheme`, or white when no dark canvas is declared. Open shadow roots
at the sample point are included where the browser exposes them.

Image and gradient backgrounds, closed shadow roots and CSSOM-only changes
without a DOM or browser event cannot be reliably inferred. Those hosts should
pass an explicit theme or use `system`. Keep detection in `theme.ts`; do not add
component-level checks of page classes, media queries or background colour.

## Motion

Motion explains opening, closing and layout changes. Keyboard-initiated actions
are immediate. Reduced motion removes spatial movement. Pointer hover stays
brief. The launcher expands on mouse or hovering-pen entry, including on hybrid
devices whose primary pointer reports as coarse. Touch still opens it by tap.
The pill has a continuous hit surface across its rim and the gap between icons.

`motion.ts` owns the shared timings: 200ms entry, 125ms exit and 180ms list reflow,
with `cubic-bezier(.23,1,.32,1)`. Reuse these values instead of adding timing
literals. There is no stagger across a queue of controls.

Panel and list movement uses transforms and opacity through the Web Animations
API. Text, corners and hit targets retain their natural size. Read positions
before writing styles, retarget interrupted movement, and cancel animations on
cleanup. The small pill width transition is bounded to the dock itself; do not
extend width or height animation to long content lists.

Lists above `MAX_ANIMATED_ITEMS` (40) update immediately. Large panels also skip
cloned exit snapshots. Hidden lists do not measure every render, and typing in
the composer must not remeasure unchanged selectors or notes.

## Where changes belong

| File | Responsibility |
| --- | --- |
| `src/react/appearance.ts` | Complete light/dark palettes and the shared material recipe |
| `src/react/styles.ts` | Geometry, typography, shared control classes and state selectors |
| `src/react/feedback-layout.ts`, `pill-active.ts` | Small material/layout recipes that can be independently previewed as overlays |
| `src/react/UpdateNotice.tsx` | Quiet update line, and the dialog that hands the upgrade to the agent |
| `src/react/icons.tsx` | Icon choices, optical size and stroke |
| `src/react/NoteSummary.tsx` | Saved feedback/defaults summaries and their shared tag rendering |
| `src/react/IterationPanel.tsx` | The dock: which surfaces are open, the rail, focus on close, host event fence and shortcut |
| `src/react/Composer.tsx`, `NotesPanel.tsx` | The composer and its text, and the feedback panel with its saved notes |
| `src/react/picking.tsx`, `useFloatingComposer.ts` | Select mode, hover and pin outlines, and the composer floating beside a pin |
| `src/react/useNotes.ts` | Loading, polling and optimistic writes of notes |
| `src/react/VariantsView.tsx` | The selector list, sections, colour popover and the defaults bar |
| `src/react/AxisControl.tsx`, `AxisActionsDialog.tsx` | One selector's controls, and its action dialog |
| `src/react/theme.ts` | Theme resolution, observation and cleanup |
| `src/react/motion.ts` | Motion timing and work limits |
| `src/react/viewport.ts` | Small-screen, touch and on-screen keyboard rules |
| `src/react/useDockMotion.ts`, `useLayoutMotion.ts` | Measured movement and interruption handling |

To add a control, choose its semantic role first: surface, well, raised action or
selection. Reuse that recipe and an existing control class where possible.
Add any new state selector once in `styles.ts`. A new paint token must exist in
both palettes; a spacing or behavior change never belongs in a theme branch.
Extract repeated markup when it has shared behavior or content rules, as with
summary tags, rather than copying a component for another theme.

## Verification

Inspect the same content in both themes: collapsed and expanded pill, empty and
saved feedback, editing, pinned references, selectors, action dialogs, hover,
keyboard focus, disabled actions and scrolling edges. Include a narrow viewport,
long unbroken labels, many notes and many selector options. Exercise rapid
open/close, keyboard shortcuts and reduced motion.

The style tests reject theme-specific component/state rules and missing or
circular paint tokens. React tests cover shared interactions, theme changes and
async state preservation. Run `pnpm check` before a release. For screenshots,
use synthetic demo content; never include local feedback files, personal notes
or a real project's private interface.

## Accepted design choices

Inline references is the feedback layout. Clean Highlight is the active-pill
material: a slightly lighter solid face, fine border and crisp 1px contact
shadow. Both themes use the same recipe in `pill-active.ts`.

Earlier list alternatives and the default, ring, dot, recessed and inset pill
experiments have been removed. New alternatives should start from this baseline
and remain separate until explicitly chosen.
