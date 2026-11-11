/**
 * Where the panel meets its edges: the card's rim, and how scrolled content leaves view.
 *
 * The rim is drawn over the card's content. Drawn beneath it, as an inset shadow, sticky
 * headers and the defaults bar hid it near the ends and an overscroll bounce uncovered it.
 *
 * At each end of a list, scrolled content blurs and fades into the surface, and each row
 * recedes a little as it goes. A stuck section header and the defaults bar float over the
 * list as one material with that fade, rather than solid blocks with a fade beside them.
 */

const STEPS = Array.from({ length: 11 }, (_, index) => index / 10);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Gradient stops easing from clear at `from` to solid at `to` (or back with `down`), so a
 *  fade has no visible start or end line. `at` turns an opacity into a colour; `lo` and `hi`
 *  bound the opacity, to join two ramps into one curve. */
function ramp(at: (opacity: number) => string, from: string, to: string, down = false, lo = 0, hi = 1): string {
  return STEPS.map((t) => `${at(+(lo + (hi - lo) * smooth(down ? 1 - t : t)).toFixed(3))} calc(${from} + (${to} - ${from}) * ${t})`).join(
    ', ',
  );
}
/** Opacity for a mask. */
const ink = (opacity: number) => `rgb(0 0 0 / ${opacity})`;
/** The panel surface at an opacity, for a fade drawn over content. */
const surface = (opacity: number) => `color-mix(in oklch, var(--iso-bg) ${+(opacity * 100).toFixed(1)}%, transparent)`;

const INSET = 'var(--iso-panel-inset)';
const SECTIONS = '.isotone-vars-body:has(> .isotone-section:first-child)';

// Comments live in code here rather than in the CSS, which every host page downloads.

// The rim: a 1px ring over the card's content, lit from above in the dark theme.
const RIM = `
.isotone-root :is(.isotone-panel, .isotone-float)::after {
  content: ''; position: absolute; inset: 0; z-index: 2; padding: 1px; border-radius: inherit; pointer-events: none;
  background: var(--iso-panel-rim);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}`;

// Scroll edges. The blur is progressive: four stacked layers, each twice as blurred as the last, take
// over from one another across the band, under an eased fade into the surface. A single blurred layer
// faded in over sharp content leaves a halo around still-sharp text, which reads as a glow; here only
// the lightest blur ever meets sharp content. Bands reach a pixel past their edge, so rounding never
// leaves a row of sharp content between a band and the edge it meets.
//
// At rest a band fills only the empty space at its edge, so nothing at rest is ever blurred. Once
// content can pass under it, it reaches --iso-edge-length further in over as much scrolling. The band
// is always its full reach, edge to edge, taking no room beside the flex gap; its painted size grows.
// Growing needs scroll-driven animations; without them a band stays at rest. The top band is last in
// the markup, so it changes no sibling selector, and first in the column (order: -1), so it can stick
// to the top. The bottom band's rest is the inset plus the defaults bar's room (--iso-bar-room, which
// eases with the bar). The layers' windows run along the band from its inner edge (0%) out, so the
// blur begins once the fade is under way.
//
// Scroll padding keeps keyboard focus clear of each band at its full reach.
const BANDS = `
.isotone-root { --iso-edge-blur: 8px; --iso-edge-length: 16px; --iso-depth-scale: .96; }
.isotone-vars-body {
  scroll-padding-block: calc(${INSET} + var(--iso-edge-length)) calc(${INSET} + var(--iso-bar-room) + var(--iso-edge-length));
}
.isotone-edge {
  --iso-edge-rest: ${INSET}; --iso-edge-reach: calc(var(--iso-edge-rest) + var(--iso-edge-length));
  position: sticky; z-index: 1; flex: none; height: var(--iso-edge-reach); margin-inline: calc(0px - ${INSET}); pointer-events: none;
  background-repeat: no-repeat; background-size: 100% var(--iso-edge-rest); mask-size: 100% var(--iso-edge-rest);
}
.isotone-edge-top {
  order: -1; top: calc(-1px - ${INSET}); margin-block: calc(0px - ${INSET}) calc(0px - var(--iso-edge-reach));
  background-image: linear-gradient(to top, ${ramp(surface, '0%', '100%')});
}
.isotone-edge-bottom {
  --iso-edge-rest: calc(${INSET} + var(--iso-bar-room)); z-index: 4;
  bottom: calc(-1px - ${INSET}); margin-block: calc(0px - var(--iso-edge-reach)) calc(0px - ${INSET});
  background-position: 0 100%; background-image: linear-gradient(to bottom, ${ramp(surface, '0%', '100%')});
}
@keyframes isotone-edge-grow { to { background-size: 100% var(--iso-edge-reach); mask-size: 100% var(--iso-edge-reach); } }
@supports (animation-timeline: scroll()) {
  .isotone-edge { animation: isotone-edge-grow linear both; animation-timeline: scroll(nearest); }
  .isotone-edge-top { animation-range: 0 var(--iso-edge-length); }
  .isotone-edge-bottom { animation-direction: reverse; animation-range: calc(100% - var(--iso-edge-length)) 100%; }
}
.isotone-edge > i {
  position: absolute; inset: 0; mask-size: inherit; mask-repeat: no-repeat;
  -webkit-backdrop-filter: blur(var(--iso-edge-r)); backdrop-filter: blur(var(--iso-edge-r));
}
.isotone-edge-bottom > i { mask-position: 0 100%; }
.isotone-edge > i:nth-child(1) { --iso-edge-r: calc(var(--iso-edge-blur) / 8); --iso-edge-window: transparent 15%, #000 32%, #000 48%, transparent 64%; }
.isotone-edge > i:nth-child(2) { --iso-edge-r: calc(var(--iso-edge-blur) / 4); --iso-edge-window: transparent 32%, #000 48%, #000 64%, transparent 80%; }
.isotone-edge > i:nth-child(3) { --iso-edge-r: calc(var(--iso-edge-blur) / 2); --iso-edge-window: transparent 48%, #000 64%, #000 80%, transparent 96%; }
.isotone-edge > i:nth-child(4) { --iso-edge-r: var(--iso-edge-blur); --iso-edge-window: transparent 64%, #000 80%; }
.isotone-edge-top > i { mask-image: linear-gradient(to top, var(--iso-edge-window)); }
.isotone-edge-bottom > i { mask-image: linear-gradient(to bottom, var(--iso-edge-window)); }`;

// With sections, a stuck header floats over a material instead of a solid block, as under an iOS bar:
// content passing beneath it blurs and fades into the surface, nearly opaque behind the header's label
// and then gradually below it. At rest the material ends where the first selector starts: the inset,
// the 24px toggle less the header's -4px margin, and the section's gap (--iso-head-h). When sections
// lead the list, every selector is in one, since loose ones come first. With every section collapsed
// there is nothing to pass beneath, and a band reaching further than the short list would make it
// scroll, so it stays at rest. The selectors are :where()-wrapped so forced colours' solid header wins.
// Elsewhere a header stays solid, and its fade below eases out instead of ending in a line. The
// defaults bar is the bottom band's material the same way: one surface over the list, darkening and
// blurring toward the bottom.
const MATERIALS = `
.isotone-vars-body { --iso-head-h: calc(${INSET} + 20px + var(--iso-space)); }
.isotone-vars-body:has(> .isotone-section) { scroll-padding-top: calc(var(--iso-head-h) + var(--iso-edge-length)); }
${SECTIONS} > .isotone-edge-top {
  --iso-edge-rest: var(--iso-head-h);
  background-image: linear-gradient(to bottom, ${ramp(surface, '0px', 'calc(var(--iso-head-h) - 11px)', true, 0.94)}, ${ramp(surface, 'calc(var(--iso-head-h) - 11px)', '100%', true, 0, 0.94)});
}
${SECTIONS}:not(:has(> .isotone-section[data-collapsed='false'])) { --iso-edge-length: 0px; }
:where(${SECTIONS}) .isotone-section-head { background: none; }
:where(${SECTIONS}) .isotone-section-head::after { display: none; }
.isotone-section-head::after { background: linear-gradient(to top, ${ramp(surface, '0%', '100%')}); }
.isotone-vars[data-saving='true'] .isotone-edge-bottom {
  background-image: linear-gradient(to top, ${ramp(surface, '0px', 'var(--iso-bar-room)', true, 0.94)}, ${ramp(surface, 'var(--iso-bar-room)', '100%', true, 0, 0.94)});
}`;

// The note list's mask fades with eased ends, with a light blur band at each; a dialog's scrolled rows
// fade with the same eased ends.
const LISTS = `
.isotone-list { mask-image: linear-gradient(to bottom, ${ramp(ink, '0px', 'var(--iso-space)')}, ${ramp(ink, 'calc(100% - var(--iso-space))', '100%', true)}); }
.isotone-pages + .isotone-list { mask-image: linear-gradient(to bottom, ${ramp(ink, '6px', '18px')}, ${ramp(ink, 'calc(100% - var(--iso-space))', '100%', true)}); }
.isotone-list::before, .isotone-list::after {
  content: ''; position: sticky; z-index: 1; flex: none; height: var(--iso-space); pointer-events: none;
  -webkit-backdrop-filter: blur(1.5px); backdrop-filter: blur(1.5px);
}
.isotone-list::before { top: calc(-1px - var(--iso-space)); margin: calc(0px - var(--iso-space)) -8px 0; mask-image: linear-gradient(to top, ${ramp(ink, '0%', '100%')}); }
.isotone-list::after { bottom: calc(-1px - var(--iso-space)); margin: 0 -8px calc(0px - var(--iso-space)); mask-image: linear-gradient(to bottom, ${ramp(ink, '0%', '100%')}); }
.isotone-pages + .isotone-list::before { top: -19px; height: 18px; margin-top: -18px; }
.isotone-menu-scroll { mask-image: linear-gradient(to bottom, ${ramp(ink, '0px', 'var(--iso-space)')}, ${ramp(ink, 'calc(100% - var(--iso-scroll-fade-bottom))', '100%', true)}); }`;

// Each row recedes on its own from where it meets a band, so a tall selector's lower rows stay full
// size while its top row leaves. The timeline's insets are the bands' inner edges. A row is animated
// only while it crosses one: one fully in view carries no animation, so it is no stacking context,
// and the fading key over a picked thumbnail (keyFade) still slides between its slot and picture.
const RECEDE = `
@keyframes isotone-recede-in { from { scale: var(--iso-depth-scale); } }
@keyframes isotone-recede-out { to { scale: var(--iso-depth-scale); } }
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .isotone-root :is(.isotone-axis > :not(.isotone-grid), .isotone-grid > *, .isotone-list > .isotone-note) {
      --iso-recede: view(block var(--iso-recede-top, ${INSET}) var(--iso-recede-bottom, ${INSET}));
      animation: isotone-recede-in linear none, isotone-recede-out linear none;
      animation-timeline: var(--iso-recede), var(--iso-recede);
      animation-range: entry, exit;
    }
    .isotone-vars-body { --iso-recede-bottom: calc(${INSET} + var(--iso-bar-room)); }
    ${SECTIONS} { --iso-recede-top: var(--iso-head-h); }
    .isotone-list { --iso-recede-top: var(--iso-space); --iso-recede-bottom: var(--iso-space); }
    .isotone-pages + .isotone-list { --iso-recede-top: 18px; }
  }
}`;

export const EDGES_CSS = RIM + BANDS + MATERIALS + LISTS + RECEDE;
