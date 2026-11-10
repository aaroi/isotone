import { type MouseEvent, type RefObject, useCallback, useLayoutEffect, useRef } from 'react';
import { MAX_ANIMATED_ITEMS, MOTION, stillMotion } from '../motion';

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where an option sits in its track, before any transform. The option's frame
 * is measured, not its button, which may still be easing back from a press.
 */
function boxIn(track: HTMLElement, element: Element): Box {
  const t = track.getBoundingClientRect();
  const r = element.getBoundingClientRect();
  return { x: r.left - t.left - track.clientLeft, y: r.top - t.top - track.clientTop, width: r.width, height: r.height };
}

const checkedFrame = (track: HTMLElement) => track.querySelector('[role="radio"][aria-checked="true"]')?.parentElement ?? null;

const forcedColors = () => typeof matchMedia === 'function' && matchMedia('(forced-colors: active)').matches;

/**
 * The raised key of a segmented selector or thumbnail grid travels to the
 * option a pointer picks, instead of jumping there. A key of its own moves
 * beneath the options while the picked option's face waits, so labels, the
 * default dot and the chevron never move, scale or blur.
 *
 * Only a pointer's pick travels, and only between two rendered options of the
 * same size. Keys, reduced motion, high contrast, a first render and a change
 * from elsewhere (another tab, the agent, Reset to default) swap at once. A
 * second pick mid-flight starts from where the key is.
 */
export function useKeyTravel(ref: RefObject<HTMLElement | null>, value: string, options: number) {
  const pending = useRef<{ option: string; from: Box } | null>(null);
  const key = useRef<{ element: HTMLElement; animation?: Animation } | null>(null);

  const stop = useCallback(() => {
    const current = key.current;
    if (!current) return;
    key.current = null;
    current.animation?.cancel();
    current.element.remove();
    const track = ref.current;
    if (track) delete track.dataset.key;
  }, [ref]);

  /** Called by an option's click, before the pick: where the key leaves from. */
  const prepare = useCallback(
    (event: MouseEvent, option: string) => {
      pending.current = null;
      const track = ref.current;
      // A keyboard click has no detail; nor do clicks from code.
      if (event.detail === 0 || !track || options > MAX_ANIMATED_ITEMS || stillMotion(track)) return;
      const from = key.current?.element ?? checkedFrame(track);
      if (from) pending.current = { option, from: boxIn(track, from) };
    },
    [ref, options],
  );

  useLayoutEffect(() => {
    const travel = pending.current;
    pending.current = null;
    const track = ref.current;
    if (!travel || travel.option !== value || !track || stillMotion(track) || forcedColors()) return stop();
    const frame = checkedFrame(track);
    if (!frame) return stop();
    // Every read before the first write.
    const to = boxIn(track, frame);
    const dx = travel.from.x - to.x;
    const dy = travel.from.y - to.y;
    if (Math.abs(travel.from.width - to.width) > 0.5 || Math.abs(travel.from.height - to.height) > 0.5) return stop();
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return stop();
    if (typeof HTMLElement.prototype.animate !== 'function') return stop();
    let current = key.current;
    current?.animation?.cancel();
    if (!current) {
      const element = document.createElement('span');
      element.className = 'isotone-key';
      element.setAttribute('aria-hidden', 'true');
      // First, so it paints beneath every option.
      track.prepend(element);
      current = key.current = { element };
    }
    Object.assign(current.element.style, { left: `${to.x}px`, top: `${to.y}px`, width: `${to.width}px`, height: `${to.height}px` });
    track.dataset.key = 'moving';
    const animation = current.element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: MOTION.reflow,
      easing: MOTION.easeOut,
    });
    current.animation = animation;
    animation.onfinish = () => {
      if (key.current?.animation === animation) stop();
    };
  }, [value, ref, stop]);

  useLayoutEffect(() => stop, [stop]);

  return prepare;
}
