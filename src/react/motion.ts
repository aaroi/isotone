/** Shared timing for CSS surfaces and transform-only layout motion. */
export const MOTION = {
  enter: 200,
  exit: 125,
  reflow: 180,
  /** A colour or a line of text changing in place. */
  swap: 150,
  easeOut: 'cubic-bezier(.23,1,.32,1)',
};

// Large review queues stay immediate instead of starting hundreds of animations.
export const MAX_ANIMATED_ITEMS = 40;

/** The reviewer is using the keyboard: what it changes changes at once. */
export function keyboardInstant(node: Element): boolean {
  return Boolean(node.closest('[data-instant="true"]'));
}

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Keyboard use and reduced motion make the panel immediate. */
export function stillMotion(node: Element): boolean {
  return keyboardInstant(node) || reducedMotion();
}

/**
 * Something the reviewer just added settles into place: it fades in from a
 * slightly different scale, set by the caller's `transform-origin`. Reduced
 * motion keeps the fade alone; keyboard use shows it at once.
 */
export function settleIn(node: HTMLElement, scale: number) {
  if (typeof node.animate !== 'function' || keyboardInstant(node)) return;
  node.animate(
    reducedMotion()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `scale(${scale})` },
          { opacity: 1, transform: 'none' },
        ],
    { duration: MOTION.exit, easing: MOTION.easeOut },
  );
}

/**
 * Fade an element in once, when it mounts. A CSS animation would replay
 * whenever the panel switches between keyboard and pointer use, since that
 * toggles animations off and on again; an animation started here cannot.
 * `data-still` on the element skips it.
 */
export function fadeIn(node: HTMLElement | null) {
  if (!node || typeof node.animate !== 'function' || node.dataset.still === 'true' || stillMotion(node)) return;
  node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}

/** The same, for a control whose surface stays put while its content arrives. */
export function fadeInContent(node: HTMLElement | null) {
  if (!node || stillMotion(node)) return;
  for (const child of node.children)
    if (typeof child.animate === 'function') child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
}

const PULSE_MS = 2000;

/**
 * Pulse a node on the document's own clock. Every pulse starts at the timeline's
 * origin, so the launcher ring and every note dot beat together whenever they
 * appear, instead of each starting from its own mount time.
 */
function syncPulse(spread: number) {
  return (node: HTMLElement | null) => {
    if (!node || typeof node.animate !== 'function' || stillMotion(node)) return;
    const tint = 'color-mix(in srgb, var(--iso-focus) 55%, transparent)';
    const pulse = node.animate(
      [
        { boxShadow: `0 0 0 0 ${tint}`, offset: 0 },
        { boxShadow: `0 0 0 ${spread}px transparent`, offset: 0.7 },
        { boxShadow: `0 0 0 ${spread}px transparent`, offset: 1 },
      ],
      { duration: PULSE_MS, iterations: Infinity, easing: 'ease-out' },
    );
    pulse.startTime = 0;
  };
}
export const dotPulse = syncPulse(6);
export const ringPulse = syncPulse(8);
