import { type RefObject, useLayoutEffect } from 'react';

const px = (value: string) => parseFloat(value) || 0;

/**
 * The least height Feedback can take without its own parts spilling out: everything but the list, which
 * scrolls, at its full height. A list squeezed to nothing reaches only into the panel's top padding, which
 * its fade covers. Feedback stacks from the bottom, so a cap below this (a hold under a resting pointer, or
 * a height stored when the panel held less) would push the page chips and the composer out past its top
 * edge. Published as `--iso-notes-floor`, the least its max-height can be.
 */
function floorOf(panel: HTMLElement): number {
  const style = getComputedStyle(panel);
  let floor = px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  let inFlow = 0;
  for (const child of panel.children) {
    if (!(child instanceof HTMLElement) || child.classList.contains('isotone-list')) continue;
    const own = getComputedStyle(child);
    if (own.display === 'none' || own.position === 'absolute' || own.position === 'fixed') continue;
    inFlow++;
    floor += px(own.marginTop) + px(own.marginBottom) + child.offsetHeight;
  }
  return Math.ceil(floor + Math.max(0, inFlow - 1) * px(style.rowGap));
}

/** Keep `--iso-notes-floor` current as the composer grows, the page chips come and go, or the panel resizes. */
export function useNotesFloor(panelRef: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !active || typeof ResizeObserver === 'undefined') return;
    let last = '';
    const update = () => {
      const next = `${floorOf(panel)}px`;
      if (next === last) return;
      last = next;
      panel.style.setProperty('--iso-notes-floor', next);
    };
    const sizes = new ResizeObserver(update);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(panel);
      for (const child of panel.children) sizes.observe(child);
      update();
    };
    const children = new MutationObserver(watch);
    children.observe(panel, { childList: true });
    watch();
    return () => {
      sizes.disconnect();
      children.disconnect();
      panel.style.removeProperty('--iso-notes-floor');
    };
  }, [panelRef, active]);
}
