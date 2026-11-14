import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { MOTION, stillMotion } from '../motion';

const settlingCount = new WeakMap<HTMLElement, number>();

/**
 * Mark the dock as settling while `animation` runs: a panel easing to the size it let go of drives its
 * own layout, and the dock's motion stands aside until every such ease has landed.
 */
export function whileSettling(root: HTMLElement, animation: Animation) {
  settlingCount.set(root, (settlingCount.get(root) ?? 0) + 1);
  root.dataset.settling = 'true';
  let done = false;
  animation.addEventListener('finish', end);
  animation.addEventListener('cancel', end);
  function end() {
    if (done) return;
    done = true;
    const left = (settlingCount.get(root) ?? 1) - 1;
    settlingCount.set(root, left);
    if (left <= 0) delete root.dataset.settling;
  }
}

/** Whether the pointer rests on the dock: a mouse or pen over it, not a finger that tapped it. */
export function pointerResting(root: HTMLElement): boolean {
  return root.dataset.touch !== 'true' && root.matches(':hover');
}

/**
 * Let go of a hold once the pointer leaves the dock, or a resize handle is taken up by pointer or key, so
 * the reviewer's own size applies. Returns the function that lets go at once.
 */
export function releaseOnLeave(root: HTMLElement, release: (eased: boolean) => void): () => void {
  const handle = ['pointerdown', 'keydown', 'focusin'];
  const done = (event?: Event) => {
    if (event && event.type !== 'pointerleave' && !(event.target as Element).closest?.('.isotone-resize')) return;
    root.removeEventListener('pointerleave', done);
    for (const type of handle) root.removeEventListener(type, done, true);
    release(Boolean(event));
  };
  root.addEventListener('pointerleave', done);
  for (const type of handle) root.addEventListener(type, done, true);
  return () => done();
}

/**
 * While the pointer rests on the dock, Feedback keeps its height whenever its contents would change it (a
 * note arriving or leaving, a note opened for editing or put back): the list takes the difference and
 * scrolls, so the composer, the rows and the panel beside it stay where they are. Once the pointer
 * leaves, the panel takes its new height, which the dock eases. A finger never holds it.
 */
export function useHoverHold(panelRef: RefObject<HTMLElement | null>, active: boolean) {
  const seen = useRef(0);
  const held = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !active || typeof ResizeObserver === 'undefined') return;
    // Read after layout, in the observer, so nothing here forces one.
    const observer = new ResizeObserver(() => {
      seen.current = panel.getBoundingClientRect().height;
    });
    observer.observe(panel);
    return () => {
      observer.disconnect();
      held.current?.();
      seen.current = 0;
    };
  }, [panelRef, active]);
  // After every render, before paint: a height that changed under a resting pointer goes back to what showed.
  const hold = () => {
    const panel = panelRef.current;
    const root = panel?.closest<HTMLElement>('.isotone-root');
    if (!active || held.current || !panel || !root || !seen.current || root.dataset.easing || !pointerResting(root)) return;
    if (Math.abs(panel.getBoundingClientRect().height - seen.current) < 0.5) return;
    const height = `${seen.current}px`;
    panel.style.setProperty('--iso-notes-hold', height);
    panel.style.setProperty('--iso-notes-hold-min', height);
    panel.dataset.held = 'true';
    held.current = releaseOnLeave(root, (eased) => {
      held.current = null;
      // From the height that shows, held or, where the layout gave the hold no say, not.
      const from = panel.getBoundingClientRect().height;
      panel.style.removeProperty('--iso-notes-hold');
      panel.style.removeProperty('--iso-notes-hold-min');
      delete panel.dataset.held;
      // Then to the height it now needs, in one ease of its own.
      const to = panel.getBoundingClientRect().height;
      if (!eased || Math.abs(to - from) < 0.5 || stillMotion(panel) || typeof panel.animate !== 'function') return;
      const box = { boxSizing: 'border-box', flexShrink: 0 };
      whileSettling(
        root,
        panel.animate(
          [
            { ...box, height: `${from}px` },
            { ...box, height: `${to}px` },
          ],
          { duration: MOTION.enter, easing: MOTION.easeOut },
        ),
      );
    });
  };
  useLayoutEffect(hold);
  // Typing changes the composer's height without rendering the panel: look again before the next frame.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !active) return;
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => hold());
    };
    panel.addEventListener('input', later);
    return () => {
      panel.removeEventListener('input', later);
      cancelAnimationFrame(frame);
    };
  });
  useEffect(() => () => held.current?.(), []);
}
