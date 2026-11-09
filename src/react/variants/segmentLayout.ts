import { useLayoutEffect, useRef } from 'react';

/**
 * How a segmented selector lays out its options, from each option's natural
 * width and the room inside its track.
 *
 * - Every option fits side by side: one row.
 * - Otherwise rows that wrap, as few as the widest label allows and never fewer
 *   than two columns, balanced so the last row is as full as it can be. Labels
 *   that still do not fit their column truncate rather than stack.
 */
export function segmentLayout(widths: readonly number[], room: number, gap: number): { wraps: boolean; columns: number } {
  const count = widths.length;
  const row = widths.reduce((sum, width) => sum + width, 0) + gap * (count - 1);
  if (count <= 1 || row <= room) return { wraps: false, columns: count };
  const widest = Math.max(...widths);
  const fit = Math.min(count, Math.max(2, Math.floor((room + gap) / (widest + gap))));
  const rows = Math.ceil(count / fit);
  return { wraps: true, columns: Math.ceil(count / rows) };
}

type Layout = 'row' | 'wrap';

const tracks = new Set<HTMLElement>();
let observer: ResizeObserver | null = null;

/** Measures every changed track before writing any, so a resize lays out once. */
function relayout(targets: Iterable<HTMLElement>) {
  const plans: [HTMLElement, Layout, number][] = [];
  for (const track of targets) {
    if (!track.isConnected) continue;
    const plan = measure(track);
    if (plan) plans.push([track, ...plan]);
  }
  for (const [track, layout, columns] of plans) {
    if (track.dataset.layout !== layout) track.dataset.layout = layout;
    const value = String(columns);
    if (track.style.getPropertyValue('--iso-seg-cols') !== value) track.style.setProperty('--iso-seg-cols', value);
  }
}

function measure(track: HTMLElement): [Layout, number] | null {
  const faces = Array.from(track.querySelectorAll<HTMLElement>('.isotone-seg'));
  if (faces.length === 0) return null;
  const style = getComputedStyle(track);
  const room = track.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  if (!(room > 0)) return null;
  const gap = parseFloat(style.columnGap) || 0;
  const face = getComputedStyle(faces[0] as HTMLElement);
  const inset = parseFloat(face.paddingLeft) + parseFloat(face.paddingRight);
  const range = document.createRange();
  // The label's own width, not its box: a box already stretched by the grid would never let the layout grow back.
  const widths = faces.map((el) => {
    const label = el.querySelector('span');
    if (!label) return el.offsetWidth;
    range.selectNodeContents(label);
    return Math.ceil(range.getBoundingClientRect().width + inset);
  });
  const { wraps, columns } = segmentLayout(widths, room, gap);
  return [wraps ? 'wrap' : 'row', columns];
}

/**
 * Lays a segmented selector out as one row or as wrapped rows with aligned columns, and
 * keeps it right as the panel resizes, fonts load or the labels change. Writes
 * straight to the track, so a resize never re-renders the selector.
 */
export function useSegmentLayout<T extends HTMLElement>(labels: string) {
  const ref = useRef<T>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new labels mean new widths to measure.
  useLayoutEffect(() => {
    const track = ref.current;
    if (!track?.classList.contains('isotone-segs')) return;
    relayout([track]);
    if (typeof ResizeObserver === 'undefined') return;
    observer ??= new ResizeObserver((entries) => relayout(entries.map((entry) => entry.target as HTMLElement)));
    observer.observe(track);
    tracks.add(track);
    return () => {
      observer?.unobserve(track);
      tracks.delete(track);
    };
  }, [labels]);
  return ref;
}

// Labels measured in a fallback font are wider or narrower once the real one arrives.
if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', () => relayout(tracks));
