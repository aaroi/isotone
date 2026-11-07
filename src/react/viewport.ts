import { useEffect, type RefObject } from 'react';

/**
 * Small screens and touch. A phone shows one panel at a time, and an on-screen
 * keyboard covers the bottom of the layout viewport without resizing it, so
 * the dock and the floating composer measure what is actually visible.
 */
const COMPACT_QUERY = '(max-width: 640px), (max-height: 500px)';
const TOUCH_QUERY = '(hover: none) and (pointer: coarse)';
/** Less than this is browser chrome settling, not a keyboard. */
const KEYBOARD_MIN = 80;

function media(query: string): boolean {
  return typeof matchMedia === 'function' && Boolean(matchMedia(query)?.matches);
}
/** Too small for the variants and feedback panels to be open together. */
export function isCompactViewport(): boolean {
  return media(COMPACT_QUERY);
}
/** A first guess before any press; the panel then follows the last pointer used. */
export function prefersTouch(): boolean {
  return media(TOUCH_QUERY);
}

export interface VisibleBand {
  top: number;
  bottom: number;
}
/**
 * The rows of the layout viewport that can be seen, in client coordinates:
 * everything, or the part above an on-screen keyboard. Pinch zoom is left
 * alone; fixed elements are not meant to follow it.
 */
export function visibleBand(): VisibleBand {
  const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01 || innerHeight - viewport.height < KEYBOARD_MIN)
    return { top: 0, bottom: innerHeight };
  return { top: viewport.offsetTop, bottom: viewport.offsetTop + viewport.height };
}

/**
 * Keep the dock above an on-screen keyboard: `--iso-keyboard` lifts it and
 * `--iso-viewport` bounds its height while one is open.
 */
export function useKeyboardInset(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const node = ref.current;
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!active || !node || !viewport) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      const band = visibleBand();
      if (band.top === 0 && band.bottom === innerHeight) {
        node.style.removeProperty('--iso-keyboard');
        node.style.removeProperty('--iso-viewport');
        return;
      }
      node.style.setProperty('--iso-keyboard', `${Math.max(0, Math.round(innerHeight - band.bottom))}px`);
      node.style.setProperty('--iso-viewport', `${Math.round(band.bottom - band.top)}px`);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(apply);
    };
    apply();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      node.style.removeProperty('--iso-keyboard');
      node.style.removeProperty('--iso-viewport');
    };
  }, [ref, active]);
}
