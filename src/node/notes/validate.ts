/**
 * The note field validators for the development endpoint: those of core, with
 * a pinned element's `source` made relative to the app's directory, which only
 * a server on the developer's machine can do.
 */
import type { IsotoneElement } from '../../core/types';
import { elementFields as coreElementFields, elementOf as coreElementOf } from '../../core/validate';
import { realPath } from '../fs/paths';

export { removalOf, selectionsOf, variantOf, viewportOf, withinPayloadCap } from '../../core/validate';

/**
 * A `source` the page gave as an absolute path (Vue's `__file`, a source map's
 * `file://` source) as a forward-slash path from `app`, the directory holding
 * `.isotone/`. A file outside it stays as it is. Windows paths compare without
 * case, as the file system does.
 */
export function fromApp(source: string, app: string, caseless = process.platform === 'win32'): string {
  let real = app;
  try {
    real = realPath(app);
  } catch {}
  const fold = (path: string) => (caseless ? path.toLowerCase() : path);
  const posix = source.replaceAll('\\', '/');
  for (const dir of [app, real]) {
    const base = dir.replaceAll('\\', '/').replace(/\/?$/, '/');
    if (fold(posix).startsWith(fold(base))) return posix.slice(base.length);
  }
  return source;
}

const placed = (app: string | undefined) => (app ? (source: string) => fromApp(source, app) : undefined);

/** A pinned element, or null without an object and a selector. `app` makes an absolute `source` relative. */
export function elementOf(value: unknown, app?: string): IsotoneElement | null {
  return coreElementOf(value, placed(app));
}

/** Every element field, each bounded, from any object; a missing selector is empty. */
export function elementFields(value: object, app?: string): IsotoneElement {
  return coreElementFields(value, placed(app));
}
