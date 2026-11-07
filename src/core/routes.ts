/**
 * Routes: the one grammar every route pattern in Isotone uses, and the route
 * gate (on which pages the panel may mount).
 *
 * A pattern is matched against a page's pathname:
 *
 *   (none), "" or "*"   every route
 *   /items              exactly /items (a trailing slash is ignored)
 *   /items/*            /items and every route under it (/items/42, /items/a/b)
 *   /items*             every route that starts with "/items" (/items, /items-archive)
 *
 * The same grammar scopes variants and knobs (`--route`, a knob's `route`),
 * filters `npx isotone <route>` and `blast start <route>`, and fills the panel's
 * `rule.visible` / `rule.hidden` lists. A pattern or route without a leading
 * slash gets one, so `about` means `/about`.
 */

/** `about` → `/about`, `/about/` → `/about`; drops a query or hash. `/` stays `/`. */
export function normalizeRoute(route: string): string {
  let path = route.trim().split(/[?#]/, 1)[0];
  if (!path.startsWith('/')) path = `/${path}`;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

/** Whether `route` is covered by `pattern` under the grammar above. */
export function matchRoute(pattern: string | undefined, route: string): boolean {
  if (pattern === undefined) return true;
  const raw = pattern.trim();
  if (raw === '' || raw === '*' || raw === '/*') return true;
  const path = normalizeRoute(route);
  if (raw.endsWith('/*')) {
    const base = normalizeRoute(raw.slice(0, -2));
    return path === base || path.startsWith(base === '/' ? '/' : `${base}/`);
  }
  if (raw.endsWith('*')) {
    const prefix = raw.slice(0, -1);
    return path.startsWith(prefix.startsWith('/') ? prefix : `/${prefix}`);
  }
  return path === normalizeRoute(raw);
}

/** A matcher over a console route: include a page only when it is not hidden
 *  (denylist) or, when a visible list is given, only when it matches. Every
 *  entry is a route pattern (see the grammar at the top of this file). */
export interface RouteGateOptions {
  /** Route patterns to NEVER show the panel on, e.g. the auth flow
   *  (`/login/*`). Defaults to the login, logout, register and error pages
   *  and everything under them. */
  hidden?: string[];
  /** When set, visible only on these route patterns (allowlist). Overrides
   *  `hidden`: used when a repo wants an explicit allow-list. */
  visible?: string[];
  /** Routes barred regardless of `visible`, each together with everything
   *  under it (`/api` also bars `/api/x`). Default `/api`, `/auth`, `/login`. */
  alwaysHidden?: string[];
}

const DEFAULT_HIDDEN = ['/login/*', '/logout/*', '/register/*', '/error/*', '/_error/*'];

/** Whether the panel may mount on the given route. Pure and unit-testable. */
export function isRouteVisible(route: string, rule: RouteGateOptions = {}): boolean {
  const hidden = rule.hidden ?? DEFAULT_HIDDEN;
  const alwaysHidden = rule.alwaysHidden ?? ['/api', '/auth', '/login'];
  // The panel must never appear on auth or API surfaces, whatever the
  // allow-list says, so each entry also covers everything under it.
  if (alwaysHidden.some((p) => matchRoute(p.endsWith('*') ? p : `${p.replace(/\/+$/, '')}/*`, route))) return false;
  if (rule.visible && rule.visible.length > 0) return rule.visible.some((v) => matchRoute(v, route));
  return !hidden.some((h) => matchRoute(h, route));
}
