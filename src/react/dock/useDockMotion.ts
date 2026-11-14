import { useLayoutEffect, type RefObject } from 'react';
import { MAX_ANIMATED_ITEMS, MOTION } from '../motion';

type Position = { x: number; y: number; width: number; height: number; animation?: Animation };

/**
 * Move and resize panels without scaling their text, hit targets or corner shapes. The dock hangs from its
 * bottom-right corner, so a panel moves when its bottom or right edge does, and it eases there. A change
 * of height (a note saved, a section folded, Feedback taking room from Variants or giving it back, a
 * panel opening beside another) eases the panel's height itself from what showed to what it now needs,
 * every panel together, so the stack's edges glide and none jumps. Opening alone, a panel rises into
 * place; closing, it fades where it was.
 */
export function useDockMotion(ref: RefObject<HTMLElement | null>, visible: boolean) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !visible) return;
    const previous = new Map<HTMLElement, Position>();
    const exits = new Map<HTMLElement, { ghost: HTMLElement; animation: Animation }>();
    // Heights easing now. While they run, the dock's own resizes come from them and are not measured.
    const sizing = new Map<HTMLElement, Animation>();
    const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const removeExit = (element: HTMLElement) => {
      const exit = exits.get(element);
      if (!exit) return;
      exit.animation.cancel();
      exit.ghost.remove();
      exits.delete(element);
    };
    // Panels already open at mount were open before a reload: they are simply there, without an entrance.
    // Until the observer's first report the dock may not be styled yet (a host mounting the panel itself
    // themes it in a later effect), so what is measured before then only records where things are.
    let settling = true;
    const measure = () => {
      const instant = settling || root.dataset.instant === 'true' || root.dataset.resizing === 'true' || reduced?.matches;
      // An interrupted ease starts the next from the height that shows now.
      const showing = new Map<HTMLElement, number>();
      for (const [element, animation] of sizing) {
        showing.set(element, element.getBoundingClientRect().height);
        animation.cancel();
      }
      sizing.clear();
      // Finish all reads before cancelling animations or adding exit snapshots.
      const panels = Array.from(root.querySelectorAll<HTMLElement>('.isotone-panel:not(.isotone-exit)'), (element) => {
        const open = element.dataset.open === 'true';
        const transform = open ? getComputedStyle(element).transform : 'none';
        const matrix = transform !== 'none' && typeof DOMMatrix !== 'undefined' ? new DOMMatrix(transform) : undefined;
        return { element, open, rect: open ? element.getBoundingClientRect() : null, dx: matrix?.m41 ?? 0, dy: matrix?.m42 ?? 0 };
      });
      const shown = panels.filter((panel) => panel.rect);
      const gap = shown.length > 1 ? Number.parseFloat(getComputedStyle(root).rowGap) || 0 : 0;
      // The heights to ease: each open panel's change, and a panel opening beside another from nothing.
      // Heights ease even after a key: they follow from what the key did, and a jump is never right. Only
      // reduced motion, a resize the pointer drives, and a mount still settling skip them.
      const still = settling || root.dataset.resizing === 'true' || reduced?.matches;
      const eases = still
        ? []
        : shown.flatMap(({ element, rect }) => {
            const old = previous.get(element);
            if (!old && shown.length < 2) return [];
            const from = showing.get(element) ?? old?.height ?? 0;
            const to = (rect as DOMRect).height;
            return Math.abs(from - to) > 0.5 && typeof element.animate === 'function' ? [{ element, from, to, opening: !old }] : [];
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
          if (
            !instant &&
            typeof element.animate === 'function' &&
            element.querySelectorAll('[data-motion-key]').length <= MAX_ANIMATED_ITEMS
          ) {
            const ghost = element.cloneNode(true) as HTMLElement;
            ghost.classList.add('isotone-exit');
            ghost.dataset.open = 'true';
            ghost.inert = true;
            ghost.setAttribute('aria-hidden', 'true');
            ghost.removeAttribute('id');
            for (const node of ghost.querySelectorAll('[id]')) node.removeAttribute('id');
            Object.assign(ghost.style, {
              position: 'fixed',
              left: `${old.x}px`,
              top: `${old.y}px`,
              width: `${old.width}px`,
              height: `${old.height}px`,
              pointerEvents: 'none',
            });
            root.appendChild(ghost);
            const animation = ghost.animate(
              [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: 'translateY(4px)' },
              ],
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
        // How far its anchored edges moved: the right and the bottom. While heights ease, the panels'
        // places follow them in the layout, so nothing slides on top of that.
        const shiftX = old ? old.x + old.width - (x + rect.width) : 0;
        const shiftY = old ? old.y + old.height - (y + rect.height) : eases.length ? 0 : 6;
        if (old && (eases.length > 0 || (Math.abs(shiftX) < 0.5 && Math.abs(shiftY) < 0.5))) {
          Object.assign(old, { x, y, width: rect.width, height: rect.height });
          if (instant || eases.length) old.animation?.cancel();
          continue;
        }
        old?.animation?.cancel();
        const animation =
          !instant && typeof element.animate === 'function'
            ? element.animate(
                [
                  { transform: `translate(${shiftX + (old ? dx : 0)}px, ${shiftY + (old ? dy : 0)}px)`, opacity: old ? 1 : 0 },
                  { transform: 'translate(0, 0)', opacity: 1 },
                ],
                { duration: MOTION.enter, easing: MOTION.easeOut },
              )
            : undefined;
        previous.set(element, { x, y, width: rect.width, height: rect.height, animation });
      }
      // Every height eases on the same clock, so the stack's total moves evenly between two layouts that
      // fit, and no panel is squeezed past its ease. One opening beside another unfolds from nothing,
      // with the gap between them, its contents clipped while it does.
      const last = shown.at(-1)?.element;
      for (const { element, from, to, opening } of eases) {
        const margin = element === last ? 'marginTop' : 'marginBottom';
        const { paddingTop, paddingBottom } = getComputedStyle(element);
        const box = { boxSizing: 'border-box', flexShrink: 0, overflow: 'hidden' };
        const animation = element.animate(
          [
            { ...box, height: `${from}px`, ...(opening ? { [margin]: `${-gap}px`, paddingTop: '0px', paddingBottom: '0px' } : {}) },
            { ...box, height: `${to}px`, ...(opening ? { [margin]: '0px', paddingTop, paddingBottom } : {}) },
          ],
          { duration: MOTION.enter, easing: MOTION.easeOut },
        );
        sizing.set(element, animation);
        animation.onfinish = () => {
          if (sizing.get(element) !== animation) return;
          sizing.delete(element);
          // Whatever changed while it eased is measured now.
          if (!sizing.size) measure();
        };
      }
      if (instant) for (const element of exits.keys()) removeExit(element);
    };
    measure();
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            if (!sizing.size) measure();
            settling = false;
          })
        : undefined;
    if (!observer) settling = false;
    observer?.observe(root);
    // A panel resizing inside a dock that keeps its size (one panel giving the other room) is seen too.
    for (const panel of root.querySelectorAll('.isotone-panel')) observer?.observe(panel);
    const mutations = new MutationObserver((records) => {
      const changed = records.some((record) => {
        if (record.type === 'attributes')
          return record.target === root || (record.target instanceof Element && record.target.matches('.isotone-panel:not(.isotone-exit)'));
        return [...record.addedNodes, ...record.removedNodes].some((node) => {
          const panel = node instanceof Element && node.matches('.isotone-panel:not(.isotone-exit)');
          if (panel && node.isConnected) observer?.observe(node);
          return panel;
        });
      });
      if (changed) measure();
    });
    mutations.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-open', 'data-resizing'],
    });
    // An on-screen keyboard lifts the dock through the root's own style (viewport.ts).
    const lifted = new MutationObserver(measure);
    lifted.observe(root, { attributes: true, attributeFilter: ['style'] });
    reduced?.addEventListener('change', measure);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      lifted.disconnect();
      reduced?.removeEventListener('change', measure);
      window.removeEventListener('resize', measure);
      for (const element of exits.keys()) removeExit(element);
      for (const item of previous.values()) item.animation?.cancel();
      for (const animation of sizing.values()) animation.cancel();
    };
  }, [ref, visible]);
}
