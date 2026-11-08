import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react';

export type Surface = 'notes' | 'variants';

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
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const cancel = useCallback(() => cancelAnimationFrame(frame.current), []);
  const later = useCallback((move: () => void) => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(move);
  }, []);

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
        (button && !button.closest('[inert]') ? button : fabRef.current)?.focus();
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
    [cancel, inDock, remember, launcher, later, fieldRef],
  );
}

export type DockFocus = ReturnType<typeof useDockFocus>;
