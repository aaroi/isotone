/** The route gate: on which pages the panel may mount. */

/** A matcher over a console route: include a page only when it is not hidden
 *  (denylist) or, when a visible list is given, only when it matches. */
export interface RouteGateOptions {
  /** Exact routes (or prefixes ending in `*`) to NEVER show the panel on,
   *  e.g. the auth flow. Defaults to the auth/login/error pages. */
  hidden?: string[];
  /** When set, visible only on these routes/prefixes (allowlist). Overrides
   *  `hidden` — used when a repo wants an explicit allow-list. */
  visible?: string[];
  /** Prefixes always barred regardless of `visible` (e.g. `/api`, `/auth`). */
  alwaysHidden?: string[];
}

const DEFAULT_HIDDEN = ['/login', '/logout', '/register', '/error', '/_error'];

function matchRoutePattern(route: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return route.startsWith(pattern.slice(0, -1));
  if (pattern.endsWith('/')) return route.startsWith(pattern);
  return route === pattern || route.startsWith(`${pattern}/`);
}

/** Whether the panel may mount on the given route. Pure and unit-testable. */
export function isRouteVisible(route: string, rule: RouteGateOptions = {}): boolean {
  const hidden = rule.hidden ?? DEFAULT_HIDDEN;
  const alwaysHidden = rule.alwaysHidden ?? ['/api', '/auth', '/login'];
  // A prefix match on the "always" list is unconditionally hidden — the panel
  // must never appear on auth or API surfaces regardless of allow-list.
  for (const p of alwaysHidden) {
    if (route === p || route.startsWith(`${p}/`)) return false;
  }
  if (rule.visible && rule.visible.length > 0) {
    return rule.visible.some((v) => matchRoutePattern(route, v));
  }
  return !hidden.some((h) => matchRoutePattern(route, h));
}
