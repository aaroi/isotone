import { type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';

export type Surface = 'notes' | 'variants';

/**
 * Whether the last input was a key. A scripted focus with no focused element
 * before it shows the focus ring in Chrome even after a click, so closing a panel
 * with the pointer left a ring on the rail button in the corner.
 */
let lastInputWasKey = false;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => (lastInputWasKey = true), true);
  window.addEventListener('pointerdown', () => (lastInputWasKey = false), true);
}
/** Focus without drawing a ring the reviewer did not ask for with the keyboard. */
const quietFocus = (el: HTMLElement | null | undefined) => el?.focus({ focusVisible: lastInputWasKey } as FocusOptions);

/**
 * Where keyboard focus goes as the dock opens and closes. Moves wait for the
 * next frame, after the commit that shows their target, and a newer move
 * replaces a pending one.
 */
export function useDockFocus(
  rootRef: RefObject<HTMLElement | null>,
  fieldRef: RefObject<HTMLTextAreaElement | null>,
  fabRef: RefObject<HTMLButtonElement | null>,
  /** The dock's `useId`, which names each panel's rail button through `aria-controls`. */
  id: string,
) {
  const previous = useRef<HTMLElement | null>(null);
  const frame = useRef(0);
  // Focusing the composer after a pin must not leave select mode.
  const pinning = useRef(false);
  // A move asked for as a panel opens lands with the commit that shows its target, before the next key
  // can arrive: a frame later, text typed during the entrance had nowhere to go. The frame is the fallback
  // for an update that changes nothing and so commits nothing.
  const pending = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const cancel = useCallback(() => {
    cancelAnimationFrame(frame.current);
    pending.current = null;
  }, []);
  const later = useCallback((move: () => void) => {
    cancelAnimationFrame(frame.current);
    pending.current = null;
    frame.current = requestAnimationFrame(move);
  }, []);
  const flush = useCallback(() => {
    const move = pending.current;
    pending.current = null;
    move?.();
  }, []);
  useLayoutEffect(() => {
    if (!pending.current) return;
    cancelAnimationFrame(frame.current);
    flush();
  });
  const atCommit = useCallback(
    (move: () => void) => {
      later(flush);
      pending.current = move;
    },
    [later, flush],
  );

  /** Whether focus is in the dock, so closing it should put focus somewhere sensible. */
  const inDock = useCallback(() => {
    const root = rootRef.current;
    const active = (root?.getRootNode() as Document | ShadowRoot | undefined)?.activeElement;
    return Boolean(root && active && root.contains(active));
  }, [rootRef]);

  /** Remember the host control to return to on close. The dock itself (seen from outside as the shadow host) is
   *  not one: focus would land on a div that cannot take it, then on the body. Closing falls back to the launcher. */
  const remember = useCallback(() => {
    const active = document.activeElement;
    const root = rootRef.current;
    const ours = !root || active === (root.getRootNode() as ShadowRoot).host || (active !== null && root.contains(active));
    previous.current = active instanceof HTMLElement && active !== document.body && !ours ? active : null;
  }, [rootRef]);

  /** Focus the launcher: a rail button (this panel's, if given) while the rail shows, else the pill. */
  const launcher = useCallback(
    (panel?: Surface) =>
      later(() => {
        const selector = panel ? `.isotone-rail-button[aria-controls="${id}-${panel}"]` : '.isotone-rail-button';
        const button = rootRef.current?.querySelector<HTMLButtonElement>(selector);
        quietFocus(button && !button.closest('[inert]') ? button : fabRef.current);
      }),
    [later, id, rootRef, fabRef],
  );

  return useMemo(
    () => ({
      cancel,
      inDock,
      remember,
      launcher,
      composer: () => later(() => fieldRef.current?.focus()),
      /**
       * The caret in the note field of a panel that is opening, as it shows. While selecting it waits there
       * under the select-mode cover, so whatever is typed next ends selecting and lands in the field.
       */
      openComposer: (selecting: boolean) =>
        atCommit(() => {
          pinning.current = selecting;
          fieldRef.current?.focus({ preventScroll: true });
          pinning.current = false;
        }),
      /** Focus the composer beside a fresh pin without leaving select mode. */
      composerWhilePicking: () =>
        later(() => {
          pinning.current = true;
          fieldRef.current?.focus({ preventScroll: true });
          pinning.current = false;
        }),
      /** Whether the composer is taking focus for a pin, which keeps select mode on. */
      pinning: () => pinning.current,
      /** Return focus after everything closes: to the host control it came from, else the launcher. */
      restore: () => {
        cancel();
        if (previous.current?.isConnected) previous.current.focus();
        else launcher();
      },
    }),
    [cancel, inDock, remember, launcher, later, atCommit, fieldRef],
  );
}

export type DockFocus = ReturnType<typeof useDockFocus>;
