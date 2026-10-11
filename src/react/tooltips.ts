import type { PointerEvent } from 'react';

/** Measure on hover so long lists need no observers or eager layout reads. */
export function showOverflowTitle(event: PointerEvent<HTMLElement>) {
  const label = event.currentTarget;
  if (label.scrollWidth > label.clientWidth) label.title = label.textContent?.trim() ?? '';
  else label.removeAttribute('title');
}
