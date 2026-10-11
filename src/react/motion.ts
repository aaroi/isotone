/** Shared timing for CSS surfaces and transform-only layout motion. */
export const MOTION = {
  enter: 200,
  exit: 125,
  reflow: 180,
  easeOut: 'cubic-bezier(.23,1,.32,1)',
};

// Large review queues stay immediate instead of starting hundreds of animations.
export const MAX_ANIMATED_ITEMS = 40;
