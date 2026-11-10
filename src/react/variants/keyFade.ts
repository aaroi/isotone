import { type MouseEvent, type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { MAX_ANIMATED_ITEMS, MOTION, stillMotion } from '../motion';

const checkedFrame = (track: HTMLElement) => track.querySelector('[role="radio"][aria-checked="true"]')?.parentElement ?? null;

const forcedColors = () => typeof matchMedia === 'function' && matchMedia('(forced-colors: active)').matches;

/**
 * A pointer's pick in a segmented selector or thumbnail grid lands at once: the
 * hover already showed where it was going. Only the option it left softens, its
 * raised face fading out in place on a key of its own, beneath labels and
 * pictures. Keys, reduced motion, high contrast, a first render and a change
 * from elsewhere (another tab, the agent, Reset to default) swap at once.
 */
export function useKeyFade(ref: RefObject<HTMLElement | null>, value: string, options: number) {
  const pending = useRef<{ option: string; from: Element } | null>(null);
  const key = useRef<{ element: HTMLElement; animation?: Animation } | null>(null);

  const stop = useCallback(() => {
    const current = key.current;
    if (!current) return;
    key.current = null;
    current.animation?.cancel();
    current.element.remove();
  }, []);

  /** Called by an option's click, before the pick: the option being left. */
  const prepare = useCallback(
    (event: MouseEvent, option: string) => {
      pending.current = null;
      const track = ref.current;
      // A keyboard click has no detail; nor do clicks from code.
      if (event.detail === 0 || !track || options > MAX_ANIMATED_ITEMS || stillMotion(track)) return;
      const from = checkedFrame(track);
      if (from) pending.current = { option, from };
    },
    [ref, options],
  );

  useLayoutEffect(() => {
    const left = pending.current;
    pending.current = null;
    // Whatever was fading goes, so a pick back onto it shows at full strength.
    stop();
    const track = ref.current;
    if (!left || left.option !== value || !track || !left.from.isConnected || stillMotion(track) || forcedColors()) return;
    if (typeof HTMLElement.prototype.animate !== 'function') return;
    // Every read before the first write.
    const t = track.getBoundingClientRect();
    const r = left.from.getBoundingClientRect();
    const element = document.createElement('span');
    element.className = 'isotone-key';
    element.setAttribute('aria-hidden', 'true');
    Object.assign(element.style, {
      left: `${r.left - t.left - track.clientLeft}px`,
      top: `${r.top - t.top - track.clientTop}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    // First, so it paints beneath every option's label.
    track.prepend(element);
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.exit, easing: MOTION.easeOut });
    key.current = { element, animation };
    animation.onfinish = () => {
      if (key.current?.animation === animation) stop();
    };
  }, [value, ref, stop]);

  useLayoutEffect(() => stop, [stop]);

  return prepare;
}
