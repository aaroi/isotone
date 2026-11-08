/**
 * Instructional copy shown in the panel while selecting, for a hovering pointer
 * and for touch. Hints are never truncated: each one fits on a single line at
 * a 375px-wide viewport, so keep new copy within the same length.
 * `tests/react/hints.test.ts` holds the budget.
 */
export const HINTS = {
  /** The select-mode cover over the docked composer: what to do, then how to pause. */
  picking: {
    pointer: { title: 'Click elements on the page', pause: 'Hold ⇧ to use the page' },
    touch: { title: 'Tap elements on the page', pause: 'Tap Done to use the page' },
  },
  /** The floating composer beside a pinned element, while still selecting. */
  floating: {
    pointer: 'Click to pin more · ⇧ uses the page',
    touch: 'Tap to pin more · crosshair pauses',
  },
} as const;
