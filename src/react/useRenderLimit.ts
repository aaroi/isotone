import { startTransition, useEffect, useState } from 'react';

/** Rows added per task after the first commit; each chunk stays well inside a frame on a slow machine. */
const PER_CHUNK = 48;

/**
 * How many items of a long list to render. None while closed. Opening renders
 * `first` items and paints; the rest follow a chunk per task, so a list of
 * hundreds opens at once and no single task holds up input.
 */
export function useRenderLimit(open: boolean, total: number, first: number): number {
  const [limit, setLimit] = useState(0);
  const rendered = open ? Math.min(Math.max(limit, first), total) : 0;
  useEffect(() => {
    if (!open) {
      setLimit(0);
      return;
    }
    if (rendered >= total) return;
    // Each chunk waits for the frame that shows the last one to be painted. A transition renders in slices
    // that yield to input, so a click or keystroke meanwhile goes first.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => startTransition(() => setLimit(rendered + PER_CHUNK)));
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [open, rendered, total]);
  return rendered;
}
