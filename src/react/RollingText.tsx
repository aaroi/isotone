import { useLayoutEffect, useRef } from 'react';
import { MOTION, stillMotion } from './motion';

/** How far a character travels as it rolls, in its own font size. */
const TRAVEL = 0.6;

/** A figure's size, to tell which way it moved: hex colours as hex, anything else by its number. */
function magnitude(text: string): number {
  return text.startsWith('#') ? Number.parseInt(text.slice(1), 16) : Number.parseFloat(text.replace(/[^\d.-]/g, ''));
}

/**
 * Text whose changed characters roll into place, the way iOS rolls numbers: a
 * character that changes slides out while its replacement slides in, up when the
 * figure grew and down when it shrank. Characters are matched from the right, so
 * a unit or a sign stays put while the figures change.
 *
 * It rolls whatever changed the figure, except Compare, which is instant both ways.
 * Changes in quick succession, as from a dragged slider, swap at once until they
 * pause, so the figure stays readable. Keyboard use and reduced motion swap
 * it at once too. Screen readers, and the element's text, get the whole text once:
 * the cells draw their characters from an attribute, so React never manages text
 * inside a cell that a leaving character is added to.
 */
export function RollingText({ text, className }: { text: string; className?: string }) {
  const cells = useRef<HTMLSpanElement>(null);
  const shown = useRef(text);
  const comparing = useRef(false);
  const changed = useRef(Number.NEGATIVE_INFINITY);

  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = text;
    const root = cells.current;
    const wasComparing = comparing.current;
    comparing.current = Boolean(root?.closest('[data-comparing="true"]'));
    if (!root || before === text || typeof root.animate !== 'function' || typeof root.getAnimations !== 'function') return;
    const cell = Array.from(root.children as HTMLCollectionOf<HTMLElement>);
    for (const each of cell) for (const roll of each.getAnimations({ subtree: true })) roll.cancel();
    // Changes in quick succession (a dragged slider) swap at once until they pause.
    const at = performance.now();
    const quick = at - changed.current < MOTION.enter;
    changed.current = at;
    if (quick || comparing.current || wasComparing || stillMotion(root)) return;
    const was = magnitude(before);
    const now = magnitude(text);
    const sign = Number.isNaN(was) || Number.isNaN(now) || now >= was ? 1 : -1;
    const timing = { duration: MOTION.enter, easing: MOTION.easeOut };
    const old = Array.from(before);
    const next = Array.from(text);
    const offset = old.length - next.length;
    cell.forEach((each, index) => {
      const leaving = old[index + offset];
      if (leaving === next[index]) return;
      each.animate(
        [
          { transform: `translateY(${sign * TRAVEL}em)`, opacity: 0, filter: 'blur(1.5px)' },
          { transform: 'none', opacity: 1, filter: 'none' },
        ],
        timing,
      );
      if (leaving === undefined) return;
      // The character it replaces leaves the other way, over the same cell.
      const ghost = document.createElement('span');
      ghost.className = 'isotone-roll-out';
      ghost.dataset.c = leaving;
      each.append(ghost);
      ghost
        .animate(
          [
            { transform: 'none', opacity: 1, filter: 'none' },
            { transform: `translateY(${-sign * TRAVEL}em)`, opacity: 0, filter: 'blur(1.5px)' },
          ],
          { ...timing, fill: 'forwards' },
        )
        .finished.catch(() => {})
        .finally(() => ghost.remove());
    });
  }, [text]);

  const characters = Array.from(text);
  return (
    <span className={className}>
      <span className="isotone-roll-text">{text}</span>
      <span ref={cells} aria-hidden="true">
        {characters.map((character, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: keyed by distance from the end on purpose, so cells keep their place on the right as the text changes length.
          <span key={characters.length - index} className="isotone-roll" data-c={character} />
        ))}
      </span>
    </span>
  );
}
