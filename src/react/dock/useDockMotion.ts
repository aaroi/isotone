import { useLayoutEffect, type RefObject } from 'react';
import { MAX_ANIMATED_ITEMS, MOTION } from '../motion';

type Position = { x: number; y: number; width: number; height: number; animation?: Animation; scrolls?: number[] };

const SCROLLERS = '.isotone-list, .isotone-vars-body';
/** Where a panel's lists are scrolled, so its exit snapshot shows them as they were, not from the top. */
const scrollsOf = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>(SCROLLERS), (node) => node.scrollTop);

/**
 * Move and resize panels without scaling their text, hit targets or corner shapes. The dock hangs from its
 * bottom-right corner, so a panel moves when its bottom or right edge does, and slides there.
 *
 * A panel whose height changes (a note saved, Feedback taking room from Variants or giving it back) keeps
 * its bottom edge, and its card eases its height, so its top edge glides and a panel above follows it in
 * the layout. A panel opening beside another lays out at once and is revealed from its foot upward,
 * fading in, while the one above slides up; opening alone, it rises 6px and fades in; closing, it fades
 * where it was.
 *
 * Reduced motion, a resize the pointer drives or a key steps, a window resizing, panels a reload restored
 * and long lists (over `MAX_ANIMATED_ITEMS`) change at once.
 */
export function useDockMotion(ref: RefObject<HTMLElement | null>, visible: boolean) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !visible) return;
    const previous = new Map<HTMLElement, Position>();
    const exits = new Map<HTMLElement, { ghost: HTMLElement; animation: Animation }>();
    // Heights easing now. While they run, the dock's own resizes come from them and are not measured.
    const sizing = new Map<HTMLElement, Animation>();
    const reveals = new Map<HTMLElement, Animation>();
    const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const removeExit = (element: HTMLElement) => {
      const exit = exits.get(element);
      if (!exit) return;
      exit.animation.cancel();
      exit.ghost.remove();
      exits.delete(element);
    };
    // Until the observer's first report the dock may not be styled yet (a host mounting the panel itself
    // themes it in a later effect), so what is measured before then only records where things are.
    let settling = true;
    // Panels a reload restored stay at rest, contents and all, until the reviewer first presses a key or
    // the pointer; a window resize or a resize step from the keyboard lands where it is going at once.
    let restored: boolean | null = null;
    let landAt = 0;
    const land = () => {
      landAt = performance.now() + MOTION.enter;
    };
    const woke = () => {
      restored = false;
    };
    const reveal = (element: HTMLElement, from: number) => {
      reveals.get(element)?.cancel();
      const animation = element.animate(
        [
          { clipPath: `inset(${from}px -24px -24px -24px)`, opacity: 0 },
          { clipPath: 'inset(0px -24px -24px -24px)', opacity: 1 },
        ],
        { duration: MOTION.enter, easing: MOTION.easeOut },
      );
      reveals.set(element, animation);
      animation.onfinish = () => reveals.delete(element);
    };
    const measure = (now = false) => {
      const instant = now || settling || root.dataset.instant === 'true' || root.dataset.resizing === 'true' || reduced?.matches;
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
      restored ??= shown.length > 0;
      const long = shown.some(({ element }) => element.querySelectorAll('[data-motion-key]').length > MAX_ANIMATED_ITEMS);
      // Heights glide after a key too: they follow from what the key did.
      const still =
        now ||
        settling ||
        restored ||
        long ||
        performance.now() < landAt ||
        root.dataset.resizing === 'true' ||
        reduced?.matches ||
        typeof root.animate !== 'function';
      const resizing = still
        ? []
        : shown.flatMap(({ element, rect }) => {
            const old = previous.get(element);
            const from = showing.get(element) ?? old?.height;
            const to = (rect as DOMRect).height;
            return old && from !== undefined && Math.abs(from - to) > 0.5 ? [{ element, from, to }] : [];
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
          reveals.get(element)?.cancel();
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
            ghost.querySelectorAll<HTMLElement>(SCROLLERS).forEach((node, i) => {
              node.scrollTop = old.scrolls?.[i] ?? 0;
            });
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
        const beside = shown.length > 1 && !still;
        // How far its anchored edges moved: the right and the bottom. While a height eases down, the
        // panels' places follow it in the layout, so nothing slides on top of that.
        const shiftX = old ? old.x + old.width - (x + rect.width) : 0;
        const shiftY = old ? old.y + old.height - (y + rect.height) : 6;
        // Revealed by as much as the panels above it slide up (its height and the gap), so its edge and the
        // panel above it keep the gap between them the whole way.
        if (!old && beside) reveal(element, rect.height + (Number.parseFloat(getComputedStyle(root).rowGap) || 0));
        if (old && (resizing.length > 0 || (Math.abs(shiftX) < 0.5 && Math.abs(shiftY) < 0.5))) {
          Object.assign(old, { x, y, width: rect.width, height: rect.height, scrolls: scrollsOf(element) });
          // A rise still running (a panel just opened, now growing as its list arrives) carries on.
          if (instant) old.animation?.cancel();
          continue;
        }
        old?.animation?.cancel();
        const animation =
          !instant && (old || !beside) && typeof element.animate === 'function'
            ? element.animate(
                [
                  { transform: `translate(${shiftX + (old ? dx : 0)}px, ${shiftY + (old ? dy : 0)}px)`, opacity: old ? 1 : 0 },
                  { transform: 'translate(0, 0)', opacity: 1 },
                ],
                { duration: MOTION.enter, easing: MOTION.easeOut },
              )
            : undefined;
        previous.set(element, { x, y, width: rect.width, height: rect.height, animation, scrolls: scrollsOf(element) });
      }
      // A changed height eases from what showed to what the panel needs, every changed panel on the same
      // clock, so the stack's total moves evenly between two layouts; the panel's content keeps to its foot
      // (a list above it gives way and scrolls), and the dock anchors its stack at the foot, so a panel
      // opening above runs past the room, not over the pill.
      if (resizing.length) root.dataset.easing = 'true';
      for (const { element, from, to } of resizing) {
        const box = { boxSizing: 'border-box', flexShrink: 0, justifyContent: 'flex-end' };
        const animation = element.animate(
          [
            { ...box, height: `${from}px` },
            { ...box, height: `${to}px` },
          ],
          { duration: MOTION.enter, easing: MOTION.easeOut },
        );
        sizing.set(element, animation);
        animation.onfinish = () => {
          if (sizing.get(element) !== animation) return;
          sizing.delete(element);
          if (sizing.size) return;
          delete root.dataset.easing;
          // Whatever changed while it eased is measured now.
          measure();
        };
      }
      if (!sizing.size) delete root.dataset.easing;
      if (instant) for (const element of exits.keys()) removeExit(element);
      if (still) for (const animation of reveals.values()) animation.finish();
    };
    measure();
    window.addEventListener('pointerdown', woke, true);
    window.addEventListener('keydown', woke, true);
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            // While a list lets go of room it held, the panel follows it in the layout; the dock stands
            // aside and records where things land.
            if (!sizing.size && !root.dataset.settling) measure();
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
      if (changed) measure(records.some((record) => record.attributeName === 'data-settling'));
    });
    mutations.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-open', 'data-resizing', 'data-settling'],
    });
    // An on-screen keyboard lifts the dock, and a resize sets its sizes, through the root's own style
    // (viewport.ts, useDockSize.ts): both land at once, so a key's step is exact.
    const lifted = new MutationObserver(() => {
      land();
      measure(true);
    });
    lifted.observe(root, { attributes: true, attributeFilter: ['style'] });
    const resized = () => {
      land();
      measure(true);
    };
    const reducedChange = () => measure();
    reduced?.addEventListener('change', reducedChange);
    window.addEventListener('resize', resized);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      lifted.disconnect();
      reduced?.removeEventListener('change', reducedChange);
      window.removeEventListener('resize', resized);
      window.removeEventListener('pointerdown', woke, true);
      window.removeEventListener('keydown', woke, true);
      delete root.dataset.easing;
      for (const element of exits.keys()) removeExit(element);
      for (const item of previous.values()) item.animation?.cancel();
      for (const animation of sizing.values()) animation.cancel();
      for (const animation of reveals.values()) animation.cancel();
    };
  }, [ref, visible]);
}
