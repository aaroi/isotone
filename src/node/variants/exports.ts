/**
 * The runtime names a source file exports, read from its text without a
 * parser. Live variants need them to write a dispatcher module whose
 * `export` statements cover every version of a file; anything this cannot
 * read with certainty answers `null`, and the plugin falls back to swapping
 * that file whole.
 *
 * Only statements that start a line are read. Formatted code always puts a
 * top-level `export` at the start of its line, while one inside a template
 * string or a comment almost never is, and a stray hit there only adds a
 * name whose value is `undefined`. Type-only exports are skipped: they do
 * not exist at runtime.
 */

/** Exports whose names are only meaningful to a framework that reads the
 *  module itself (React Router and Remix route modules). Such a file is
 *  transformed by the framework's own plugin, which a dispatcher would hide
 *  the real exports from. */
const ROUTE_EXPORTS = new Set([
  'loader',
  'action',
  'clientLoader',
  'clientAction',
  'headers',
  'links',
  'meta',
  'handle',
  'shouldRevalidate',
  'middleware',
  'clientMiddleware',
  'unstable_middleware',
  'unstable_clientMiddleware',
  'HydrateFallback',
]);

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function scanExports(code: string): string[] | null {
  const names = new Set<string>();
  const lines = code.split('\n');
  for (let i = 0; i < lines.length; i++) {
    // A one-line block comment in front (`/** Doc */ export …`) is skipped.
    const line = (lines[i] ?? '').replace(/^(?:\/\*.*?\*\/\s*)+/, '');
    if (!line.startsWith('export')) continue;
    const rest = line.slice('export'.length);
    if (rest !== '' && !/^[\s{*]/.test(rest)) continue; // `exported = 1`
    const body = rest.trim();

    // `export { a, b as c } [from '…']`, possibly over several lines.
    if (body.startsWith('{') || body.startsWith('type {')) {
      if (body.startsWith('type')) continue;
      let clause = body;
      while (!clause.includes('}') && i + 1 < lines.length) clause += ` ${lines[++i]}`;
      const inner = clause.slice(clause.indexOf('{') + 1, clause.indexOf('}'));
      for (const raw of inner.split(',')) {
        const spec = raw.replace(/\/\/.*$/, '').trim();
        if (!spec || spec.startsWith('type ')) continue;
        const as = spec.split(/\s+as\s+/);
        const name = (as[1] ?? as[0] ?? '').trim().replace(/^["']|["']$/g, '');
        if (!name) return null;
        names.add(name);
      }
      continue;
    }

    if (/^type\s*\*/.test(body)) continue;
    // `export * as ns from '…'` names one binding; a bare `export *`
    // re-exports names this file cannot see.
    const star = body.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (star?.[1]) {
      names.add(star[1]);
      continue;
    }
    if (body.startsWith('*')) return null;

    if (/^default\b/.test(body)) {
      names.add('default');
      continue;
    }
    if (/^(?:declare\s|type\s|interface\s)/.test(body)) continue;
    if (/^(?:=|import\s|namespace\s|module\s|as\s)/.test(body)) return null;

    const decl = body.match(
      /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)|^(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
    );
    const declared = decl?.[1] ?? decl?.[2] ?? decl?.[3];
    if (declared) {
      names.add(declared);
      continue;
    }

    const variable = body.match(/^(?:const|let|var)\s+(.*)$/);
    if (variable) {
      const target = (variable[1] ?? '').trim();
      // Destructuring declares names that need a real parser to list.
      if (target.startsWith('{') || target.startsWith('[')) return null;
      const name = target.match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (!name) return null;
      // Several declarators (`export const a = 1, b = 2`, possibly over
      // lines) need a parser to list; serve such a file whole.
      if (hasSecondDeclarator(target)) return null;
      names.add(name);
      continue;
    }
    return null;
  }
  for (const name of names) if (name !== 'default' && !IDENT.test(name)) return null;
  return [...names];
}

/** True for a module a route framework reads export by export. */
export function isRouteModule(names: string[]): boolean {
  return names.includes('default') && names.some((name) => ROUTE_EXPORTS.has(name));
}

/**
 * Whether a declaration line goes on to a second declarator: a comma outside
 * brackets after its initializer starts, or a line that ends in one. Strings
 * are blanked first so a comma inside one does not count.
 */
function hasSecondDeclarator(declaration: string): boolean {
  const text = declaration.replace(/\/\/.*$/, '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, '""');
  let depth = 0;
  let initialized = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '}' || (ch === '>' && text[i - 1] !== '=')) depth = Math.max(0, depth - 1);
    else if (depth === 0 && ch === '=' && text[i + 1] !== '=' && text[i + 1] !== '>' && text[i - 1] !== '=') initialized = true;
    else if (depth === 0 && ch === ',' && initialized) return true;
  }
  return depth === 0 && /,\s*$/.test(text);
}
