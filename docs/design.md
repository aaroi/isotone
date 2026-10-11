# Instrument design

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

Save as defaults, Send and other raised actions share their normal and hover
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
opening one must not move the pill or scale the text in another. Save as defaults
sits at the bottom left of the variants panel and appears only when needed.

Slider label spacing accounts for the thumb's inset within its hit area, so its
visible edge has the same 6px gap below the header as other controls. Range
inputs use block layout to avoid extra inline baseline space.

Selector labels and their action-dialog titles share one font rule. Opening a
dialog must not make the same label heavier. Selected and unselected options
use the same font weight; their material and text colour indicate selection. The host's `--font-sans` may provide
the typeface; component weights and sizing stay in the shared stylesheet.

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
an “Options” heading, followed by Reset to default, Keep default only, and
removal last.

Selector action dialogs have a 260px minimum height and reserve 360px in their
parent panel when space allows, even for a selector with only one action. The viewport remains the upper
bound; short screens scroll instead of pushing controls off-screen.

Removal actions create readable, editable requests for the coding agent. They do
not hide or mutate selectors, options or dependent controls. Cancel a pending
request from its feedback note; selectors do not add a status or Undo row. Pending actions are
disabled in the menu to avoid duplicate requests. Cancelling a pending request
leaves the preview unchanged. Once an agent applies a source change, deleting the
request does not undo that change.

Native tooltips are reserved for brief icon-only hints and labels that actually
overflow. Do not put full feedback notes, readable labels or internal selectors
in `title` attributes. Check label overflow on pointer entry, without observing
or measuring every row during render. Accessible labels retain the full text.

## Scrolling

Keep native scrolling, wheel/trackpad input and keyboard focus reveal. Hide
scrollbar chrome without disabling overflow.

Content passing under a fixed area fades into the actual surface. This applies
to the Save footer, selector action-dialog header, conditional error footer and
both edges of the saved-note list and the top of scrolled composer text. List
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
| `src/react/UpdateNotice.tsx` | Quiet local update snapshot and explicit upgrade instructions |
| `src/react/icons.tsx` | Icon choices, optical size and stroke |
| `src/react/NoteSummary.tsx` | Saved feedback/defaults summaries and their shared tag rendering |
| `src/react/IterationPanel.tsx` | Dock, composer, feedback and element-picking behavior |
| `src/react/VariantsView.tsx` | Selectors, action dialogs and Save as defaults |
| `src/react/theme.ts` | Theme resolution, observation and cleanup |
| `src/react/motion.ts` | Motion timing and work limits |
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
