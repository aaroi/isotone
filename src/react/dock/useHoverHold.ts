import { type RefObject, useLayoutEffect, useRef } from 'react';

/**
 * While the pointer rests on the dock, a panel keeps its height when its contents change (a note
 * arriving or leaving): its list scrolls instead, so nothing under the pointer moves, and nothing pushes
 * the panel beside it. Once the pointer leaves the dock, or a resize handle is taken up by pointer or
 * key, it takes its new height, which the dock eases. `variable` is the CSS property capping its height.
 */
export function useHoverHold(panelRef: RefObject<HTMLElement | null>, change: unknown, variable: string, active: boolean) {
  const seen = useRef(0);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !active || typeof ResizeObserver === 'undefined') return;
    // Read after layout, in the observer, so nothing here forces one.
    const observer = new ResizeObserver(() => {
      seen.current = panel.getBoundingClientRect().height;
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [panelRef, active]);
  const was = useRef(change);
  useLayoutEffect(() => {
    const changed = was.current !== change;
    was.current = change;
    const panel = panelRef.current;
    const root = panel?.closest<HTMLElement>('.isotone-root');
    if (!changed || !active || !panel || !root || !seen.current || !root.matches(':hover')) return;
    panel.style.setProperty(variable, `${seen.current}px`);
    const handle = ['pointerdown', 'keydown', 'focusin'];
    const release = (event?: Event) => {
      if (event && event.type !== 'pointerleave' && !(event.target as Element).closest?.('.isotone-resize')) return;
      panel.style.removeProperty(variable);
      root.removeEventListener('pointerleave', release);
      for (const type of handle) root.removeEventListener(type, release, true);
    };
    root.addEventListener('pointerleave', release);
    for (const type of handle) root.addEventListener(type, release, true);
    return () => release();
  }, [panelRef, change, variable, active]);
}
