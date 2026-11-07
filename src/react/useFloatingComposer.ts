import { type RefObject, useLayoutEffect, useRef } from 'react';
import { MOTION, stillMotion } from './motion';
import type { Anchor } from './picking';
import { visibleBand } from './viewport';

/** Space between the clicked point and the floating composer, and its viewport margin. */
const FLOAT_GAP = 12;
const FLOAT_MARGIN = 8;

/**
 * Place the floating composer beside its anchor, inside the viewport. It opens
 * below the point when it fits and above otherwise, and keeps that side while
 * it grows, so typing never makes it jump. Moving to a new pin glides there;
 * leaving, it fades where it was instead of vanishing in one frame.
 */
export function useFloatingComposer(
  floatRef: RefObject<HTMLDivElement | null>,
  rootRef: RefObject<HTMLElement | null>,
  anchor: Anchor | null,
  locate: (selector: string) => Element | null,
) {
  // Where the floating composer last was, so moving to a new pin glides there.
  const lastFloat = useRef<{ left: number; top: number } | null>(null);
  const floatNode = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const float = floatRef.current;
    if (!anchor || !float) {
      lastFloat.current = null;
      return;
    }
    floatNode.current = float;
    const from = lastFloat.current;
    let frame: number | undefined;
    let side: 'below' | 'above' | null = null;
    const place = () => {
      frame = undefined;
      let { x, y } = anchor;
      const el = locate(anchor.selector);
      const r = el?.getBoundingClientRect();
      if (r) {
        x = r.left + anchor.dx;
        y = r.top + anchor.dy;
      }
      const vw = document.documentElement.clientWidth || innerWidth;
      const vh = innerHeight;
      // Above an on-screen keyboard, when one is open.
      const band = visibleBand();
      const minY = band.top + FLOAT_MARGIN;
      const maxY = band.bottom - FLOAT_MARGIN;
      const w = float.offsetWidth;
      const h = float.offsetHeight;
      const fits = (below: number, above: number) => [below + FLOAT_GAP + h <= maxY, above - FLOAT_GAP - h >= minY] as const;
      // A touch pin opens under or over the whole element, centred on the tap,
      // unless the element is too tall for either; a pointer pin opens at the point.
      let belowY = y;
      let aboveY = y;
      let left = x + FLOAT_GAP;
      if (anchor.beside && r && fits(r.bottom, r.top).some(Boolean)) {
        belowY = r.bottom;
        aboveY = r.top;
        left = x - w / 2;
      } else if (left + w > vw - FLOAT_MARGIN) left = x - FLOAT_GAP - w;
      left = Math.max(FLOAT_MARGIN, Math.min(left, vw - w - FLOAT_MARGIN));
      const [fitsBelow, fitsAbove] = fits(belowY, aboveY);
      if (side === null || (side === 'below' ? !fitsBelow && fitsAbove : !fitsAbove && fitsBelow))
        side = fitsBelow || !fitsAbove ? 'below' : 'above';
      float.style.left = `${left}px`;
      let top: number;
      if (side === 'below') {
        top = Math.max(minY, Math.min(belowY + FLOAT_GAP, maxY - h));
        float.style.top = `${top}px`;
        float.style.bottom = 'auto';
      } else {
        const bottom = Math.max(vh - maxY, Math.min(vh - aboveY + FLOAT_GAP, vh - h - minY));
        float.style.bottom = `${bottom}px`;
        float.style.top = 'auto';
        top = vh - bottom - h;
      }
      float.style.transformOrigin = `${x - left}px ${y - top}px`;
      lastFloat.current = { left, top };
    };
    const schedule = () => {
      frame ??= requestAnimationFrame(place);
    };
    place();
    // The composer grows out of the clicked point once, when it opens. A later
    // pin moves it, and it glides there rather than jumping.
    const to = lastFloat.current;
    let glide: Animation | undefined;
    if (stillMotion(float) || typeof float.animate !== 'function') {
      // Immediate: no movement.
    } else if (!from)
      glide = float.animate(
        [
          { opacity: 0, transform: 'scale(.96)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: MOTION.enter, easing: MOTION.easeOut },
      );
    else if (to && (from.left !== to.left || from.top !== to.top))
      glide = float.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0 0' }], {
        duration: MOTION.enter,
        easing: MOTION.easeOut,
      });
    // The pinned element can move without a scroll: an accordion opening, a reload.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined;
    observer?.observe(float);
    const pinned = locate(anchor.selector);
    if (pinned) observer?.observe(pinned);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    // An on-screen keyboard opening or closing changes the visible area.
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      glide?.cancel();
      observer?.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [anchor, locate, floatRef]);

  // Leaving the page, the floating composer fades where it was. Keyboard
  // actions and reduced motion stay immediate.
  const floating = anchor !== null;
  useLayoutEffect(() => {
    const last = floatNode.current;
    const root = rootRef.current;
    if (floating || !last || !root) return;
    floatNode.current = null;
    if (typeof last.animate !== 'function' || stillMotion(root)) return;
    const ghost = last.cloneNode(true) as HTMLElement;
    const field = last.querySelector('textarea');
    const copy = ghost.querySelector('textarea');
    if (field && copy) copy.value = field.value;
    ghost.classList.add('isotone-exit');
    ghost.inert = true;
    ghost.setAttribute('aria-hidden', 'true');
    ghost.removeAttribute('role');
    root.appendChild(ghost);
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(.98)' }], {
      duration: MOTION.exit,
      easing: MOTION.easeOut,
      fill: 'forwards',
    });
    fade.onfinish = () => ghost.remove();
    return () => {
      fade.cancel();
      ghost.remove();
    };
  }, [floating, rootRef]);
}
