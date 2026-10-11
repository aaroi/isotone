import { useLayoutEffect, useRef, type RefObject } from 'react';
import { MAX_ANIMATED_ITEMS, MOTION } from './motion';

type Position = { top: number; animation?: Animation };

function clearPositions(positions: Map<string, Position>) {
  for (const item of positions.values()) item.animation?.cancel();
  positions.clear();
}

/** Reflow small visible lists only when their contents change. Read before writing. */
export function useLayoutMotion(ref: RefObject<HTMLElement | null>, revision: unknown, active = true) {
  const previous = useRef(new Map<string, Position>());
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision signals a content/layout change without measuring on unrelated renders.
  useLayoutEffect(() => {
    const container = ref.current;
    const clear = () => clearPositions(previous.current);
    if (!container || !active) { clear(); return; }
    const elements = container.querySelectorAll<HTMLElement>('[data-motion-key]');
    if (elements.length > MAX_ANIMATED_ITEMS) { clear(); return; }
    const instant = container.closest('[data-instant="true"]') ||
      (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (instant) { clear(); return; }
    const measurements = Array.from(elements, element => {
      const key = element.dataset.motionKey ?? '';
      const old = previous.current.get(key);
      const transform = old?.animation ? getComputedStyle(element).transform : 'none';
      const offset = transform !== 'none' && typeof DOMMatrix !== 'undefined' ? new DOMMatrix(transform).m42 : 0;
      return { element, key, old, top: element.offsetTop, offset };
    });
    const next = new Map<string, Position>();
    for (const { element, key, old, top, offset } of measurements) {
      old?.animation?.cancel();
      let animation: Animation | undefined;
      const delta = old ? old.top + offset - top : 0;
      if (typeof element.animate === 'function') {
        if (old && Math.abs(delta) > 0.5) {
          animation = element.animate(
            [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
            { duration: MOTION.reflow, easing: MOTION.easeOut },
          );
        } else if (!old) {
          animation = element.animate(
            [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
            { duration: MOTION.exit, easing: MOTION.easeOut },
          );
        }
      }
      next.set(key, { top, animation });
    }
    for (const [key, item] of previous.current) if (!next.has(key)) item.animation?.cancel();
    previous.current = next;
  }, [ref, revision, active]);
  useLayoutEffect(() => {
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const changed = () => { if (media?.matches) clearPositions(previous.current); };
    media?.addEventListener('change', changed);
    return () => {
      media?.removeEventListener('change', changed);
      clearPositions(previous.current);
    };
  }, []);
}
