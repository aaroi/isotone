import { useLayoutEffect, type RefObject } from 'react';
import { MAX_ANIMATED_ITEMS, MOTION } from './motion';

type Position = { x: number; y: number; width: number; height: number; animation?: Animation };

/** Move panels without scaling their text, hit targets or corner shapes. */
export function useDockMotion(ref: RefObject<HTMLElement | null>, visible: boolean) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !visible) return;
    const previous = new Map<HTMLElement, Position>();
    const exits = new Map<HTMLElement, { ghost: HTMLElement; animation: Animation }>();
    const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const removeExit = (element: HTMLElement) => {
      const exit = exits.get(element);
      if (!exit) return;
      exit.animation.cancel();
      exit.ghost.remove();
      exits.delete(element);
    };
    const measure = () => {
      const instant = root.dataset.instant === 'true' || reduced?.matches;
      // Finish all reads before cancelling animations or adding exit snapshots.
      const panels = Array.from(root.querySelectorAll<HTMLElement>('.isotone-panel:not(.isotone-exit)'), element => {
        const open = element.dataset.open === 'true';
        const transform = open ? getComputedStyle(element).transform : 'none';
        const matrix = transform !== 'none' && typeof DOMMatrix !== 'undefined' ? new DOMMatrix(transform) : undefined;
        return { element, open, rect: open ? element.getBoundingClientRect() : null, dx: matrix?.m41 ?? 0, dy: matrix?.m42 ?? 0 };
      });
      const current = new Set(panels.map(({ element }) => element));
      for (const [element, item] of previous) {
        if (current.has(element)) continue;
        item.animation?.cancel();
        previous.delete(element);
        removeExit(element);
      }
      for (const { element, open, rect, dx, dy } of panels) {
        const old = previous.get(element);
        if (!open || !rect) {
          if (!old) continue;
          old.animation?.cancel();
          removeExit(element);
          if (!instant && typeof element.animate === 'function' && element.querySelectorAll('[data-motion-key]').length <= MAX_ANIMATED_ITEMS) {
            const ghost = element.cloneNode(true) as HTMLElement;
            ghost.classList.add('isotone-exit');
            ghost.dataset.open = 'true';
            ghost.inert = true;
            ghost.setAttribute('aria-hidden', 'true');
            ghost.removeAttribute('id');
            for (const node of ghost.querySelectorAll('[id]')) node.removeAttribute('id');
            Object.assign(ghost.style, { position: 'fixed', left: `${old.x}px`, top: `${old.y}px`, width: `${old.width}px`, height: `${old.height}px`, pointerEvents: 'none' });
            root.appendChild(ghost);
            const animation = ghost.animate(
              [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(4px)' }],
              { duration: MOTION.exit, easing: MOTION.easeOut, fill: 'forwards' },
            );
            exits.set(element, { ghost, animation });
            animation.onfinish = () => removeExit(element);
          }
          previous.delete(element);
          continue;
        }
        removeExit(element);
        const x = rect.x - dx;
        const y = rect.y - dy;
        if (old && old.x === x && old.y === y) {
          old.width = rect.width;
          old.height = rect.height;
          if (instant) old.animation?.cancel();
          continue;
        }
        old?.animation?.cancel();
        const animation = !instant && typeof element.animate === 'function' ? element.animate(
          [{ transform: `translate(${old ? old.x + dx - x : 0}px, ${old ? old.y + dy - y : 6}px)`, opacity: old ? 1 : 0 }, { transform: 'translate(0, 0)', opacity: 1 }],
          { duration: MOTION.enter, easing: MOTION.easeOut },
        ) : undefined;
        previous.set(element, { x, y, width: rect.width, height: rect.height, animation });
      }
      if (instant) for (const element of exits.keys()) removeExit(element);
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    observer?.observe(root);
    const mutations = new MutationObserver(records => {
      const changed = records.some(record => {
        if (record.type === 'attributes') return record.target === root ||
          (record.target instanceof Element && record.target.matches('.isotone-panel:not(.isotone-exit)'));
        return [...record.addedNodes, ...record.removedNodes].some(node =>
          node instanceof Element && node.matches('.isotone-panel:not(.isotone-exit)'));
      });
      if (changed) measure();
    });
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-open', 'data-instant'] });
    reduced?.addEventListener('change', measure);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      reduced?.removeEventListener('change', measure);
      window.removeEventListener('resize', measure);
      for (const element of exits.keys()) removeExit(element);
      for (const item of previous.values()) item.animation?.cancel();
    };
  }, [ref, visible]);
}
