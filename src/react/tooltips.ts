import type { PointerEvent } from 'react';

/** Measure on hover so long lists need no observers or eager layout reads. Covers cut lines and clamped ones. */
export function showOverflowTitle(event: PointerEvent<HTMLElement>) {
  const label = event.currentTarget;
  if (label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight) label.title = label.textContent?.trim() ?? '';
  else label.removeAttribute('title');
}
