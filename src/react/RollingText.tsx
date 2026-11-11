import { useLayoutEffect, useRef } from 'react';
import { MOTION, stillMotion } from './motion';

/** How far a character travels as it rolls, in its own font size. */
const TRAVEL = 0.6;

/**
 * Text whose changed characters roll into place, the way iOS rolls numbers: a
 * character that changes slides out while its replacement slides in, up when the
 * number grew and down when it shrank. Characters are matched from the right, so
 * a unit or a sign stays put while the figures change. Keyboard use and reduced
 * motion swap the text at once. Screen readers read it as plain text.
 */
export function RollingText({ text, className }: { text: string; className?: string }) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef(text);

  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = text;
    const root = node.current;
    if (!root || before === text || typeof root.animate !== 'function' || stillMotion(root)) return;
    const was = Number.parseFloat(before.replace(/[^\d.-]/g, ''));
    const now = Number.parseFloat(text.replace(/[^\d.-]/g, ''));
    const sign = Number.isNaN(was) || Number.isNaN(now) || now >= was ? 1 : -1;
    const timing = { duration: MOTION.enter, easing: MOTION.easeOut };
    const offset = before.length - text.length;
    Array.from(root.children as HTMLCollectionOf<HTMLElement>).forEach((cell, index) => {
      const old = before[index + offset];
      if (old === text[index]) return;
      cell.animate(
        [
          { transform: `translateY(${sign * TRAVEL}em)`, opacity: 0, filter: 'blur(1.5px)' },
          { transform: 'none', opacity: 1, filter: 'none' },
        ],
        timing,
      );
      if (old === undefined) return;
      // The character it replaces leaves the other way, over the same cell.
      const ghost = document.createElement('span');
      ghost.className = 'isotone-roll-out';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.textContent = old;
      cell.append(ghost);
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

  return (
    <span ref={node} className={className}>
      {Array.from(text, (character, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: keyed by distance from the end on purpose, so cells keep their place on the right as the text changes length.
        <span key={text.length - index} className="isotone-roll">
          {character}
        </span>
      ))}
    </span>
  );
}
