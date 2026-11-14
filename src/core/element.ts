/**
 * The element descriptor: what the panel records about a pinned element so
 * the agent can find it in code. Framework-free and unit-testable against
 * plain objects as well as a real DOM.
 */
import type { IsotoneElement } from './types';

/** The minimal structural surface the descriptor builder needs from a DOM
 *  node. `children` is `readonly` so both a real `HTMLCollection` and a plain
 *  test array satisfy it; the builder materializes it with `Array.from`. */
export interface NodeLike {
  tagName: string;
  /** The tag as a selector matches it: lower case for HTML, as written for SVG (`linearGradient`). */
  localName?: string;
  id?: string | null;
  parentElement?: NodeLike | null;
  children?: readonly NodeLike[];
  textContent?: string | null;
  /** One-based child position, when the adapter can provide it cheaply. */
  indexInParent?: number;
  /** Whether a selector finds this node and nothing else. Without one, the
   *  path stops at an id or the depth cap, unchecked. */
  isOnlyMatch?(selector: string): boolean;
  /** Segments that name the node by what it is rather than where (a test id;
   *  for the pinned node, a stable attribute), tried in order before its
   *  position. */
  anchors?(): string[];
  /** What else identifies the node, beyond its path. */
  context?(): Partial<IsotoneElement>;
}

/**
 * An id the page generates on each render, which names nothing for long:
 * React's `useId` (`:r1:`, `«r1»`, `_r_1_`, with any `identifierPrefix`) and
 * the libraries built on it.
 */
const GENERATED_ID = /:r[\da-z]{1,5}:|«r[\da-z]{1,5}»|_r_[\da-z]{1,5}_|^(?:radix|headlessui|mui|mantine|react-aria|downshift)-/i;

/**
 * Descriptor of a picked element for locating it in code. Walks up the tree
 * collecting a `#id` the page did not generate, then a unique test id (or,
 * for the pinned element only, a stable attribute), else `tag:nth-child(n)`
 * segments; never a class. The panel finds pins again with `querySelector`,
 * which takes the first match, so with a real DOM the walk goes on past
 * `maxDepth` until the path matches this element alone. Kept framework-free
 * so it is unit-testable.
 */
export function describeIsotoneElement(el: NodeLike, maxDepth = 4): IsotoneElement {
  const parts: string[] = [];
  let node: NodeLike | null | undefined = el;
  let depth = 0;
  const only = el.isOnlyMatch ? (path: string[]) => el.isOnlyMatch?.(path.join(' > ')) === true : null;
  let settled = false;
  while (node && node.tagName !== 'BODY' && (only || depth < maxDepth)) {
    if (node.id && !GENERATED_ID.test(node.id)) {
      // Escape every code point: valid for leading digits, punctuation and
      // framework-generated ids without depending on the host's CSS global.
      const id = Array.from(node.id, (c) => `\\${c.codePointAt(0)?.toString(16)} `).join('');
      const segment = `#${/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(node.id) ? node.id : id}`;
      // A page can repeat an id, and then it identifies nothing.
      if (!only || only([segment, ...parts])) {
        parts.unshift(segment);
        settled = true;
        break;
      }
    }
    // A test id or attribute survives a sibling being added, which a position does not.
    const anchor = only && node.anchors?.().find((segment) => only([segment, ...parts]));
    if (anchor) {
      parts.unshift(anchor);
      settled = true;
      break;
    }
    let part = node.localName ?? node.tagName.toLowerCase();
    const parent: NodeLike | null | undefined = node.parentElement;
    if (parent) {
      const index = node.indexInParent ?? Array.from(parent.children ?? []).indexOf(node) + 1;
      if (index > 0) part += `:nth-child(${index})`;
    }
    parts.unshift(part);
    node = parent;
    depth++;
    // The depth cap still keeps short paths from resting on a single
    // `button:nth-child(1)`, which the next button on the page would take.
    if (only && depth >= maxDepth && only(parts)) {
      settled = true;
      break;
    }
  }
  // A path can reach the body and still match elsewhere when it starts lower
  // down, as `div > button` does. Rooting it leaves one match.
  if (only && !settled && !only(parts)) parts.unshift('body');
  return {
    tag: el.localName ?? el.tagName.toLowerCase(),
    text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    selector: parts.join(' > '),
    ...el.context?.(),
  };
}

const IDENTIFYING_ATTRIBUTES = ['role', 'type', 'name', 'href', 'aria-label', 'title', 'alt', 'placeholder'];

/**
 * What React's dev build knows about who made a node: a fiber, or a server
 * component's info (`{ name, env }`), each with its owner and the stack where
 * its element was created.
 */
interface Made {
  type?: unknown;
  name?: string;
  displayName?: string;
  _debugOwner?: Made | null;
  owner?: Made | null;
  _debugSource?: { fileName?: string; lineNumber?: number } | null;
  _debugStack?: { stack?: string } | string | null;
  debugStack?: { stack?: string } | string | null;
}

interface StackFrame {
  url: string;
  line: number;
  column: number;
  legacy?: true;
}

/** Code that is not the app's: a dependency, or minified code vendored into the app. */
const NOT_APP = /node_modules|\.min\.[cm]?js(?:[?#:]|$)/;

/** Receivers V8 prints before a method that are the runtime's, never a component. */
const BUILT_IN = new Set(['Object', 'Array', 'Module', 'Function', 'Promise', 'Proxy']);

/**
 * The component a stack frame's function name stands for: `Pricing`,
 * `Module.Pricing` and Firefox's `Pricing/<` and `Pricing<` (an anonymous
 * function inside it, or assigned to it) are `Pricing`; a class's
 * `Card.render` is `Card`, and a bare `render` (Firefox, Safari) is `render`,
 * for the caller to name from the fiber. A built-in receiver
 * (`Object.render`) and a lower-case name are nothing.
 */
function frameComponent(raw: string | undefined): string | undefined {
  const name = raw?.replace(/^async\*/, '').replace(/[/<].*$/, '');
  if (!name) return undefined;
  if (name === 'render') return name;
  const parts = name.split('.');
  const method = parts.pop() ?? '';
  const receiver = parts.pop();
  const found = method === 'render' ? receiver : method;
  return found && /^[A-Z]/.test(found) && !BUILT_IN.has(found) ? found : undefined;
}

/**
 * Where a node's element was written, and the component whose code wrote it.
 * React 18 records the place as `_debugSource`. React 19 records a creation
 * stack: its first frame is the call that made the element (`jsxDEV`,
 * `createElement`, `cloneElement`, or the server-component client replaying
 * the server's stack), and its last before React's bottom frame is the
 * function React called to render: the component. The first app frame after
 * the factory is the place. When React called a dependency (a library calling
 * a render prop or a column's `render`, or wrapping the app's component as
 * MobX's `observer` does), `onStack` holds the components the app's frames
 * name, for the caller to check the fiber against.
 */
function callsite(node: Made): { at: StackFrame; name?: string; onStack?: (string | undefined)[] } | undefined {
  const legacy = node._debugSource;
  if (legacy?.fileName) {
    return NOT_APP.test(legacy.fileName)
      ? undefined
      : { at: { url: legacy.fileName, line: legacy.lineNumber ?? 0, column: 0, legacy: true } };
  }
  const stack = node._debugStack ?? node.debugStack;
  const frames: (StackFrame & { name?: string })[] = [];
  for (const text of (typeof stack === 'string' ? stack : stack?.stack)?.split('\n') ?? []) {
    if (/react[_-]stack[_-]bottom[_-]frame/.test(text)) break;
    // A URL, an absolute POSIX path, or a Windows one (`C:\…`, as Node prints a file it loaded).
    const [, url, line, column] = text.match(/(?:\(|@|\bat )((?:[a-z-]+:\/\/\/?|\/|[a-z]:[\\/])\S+?):(\d+):(\d+)\)?\s*$/i) ?? [];
    const name = text.match(/^\s*at\s+(?:async\s+)?(?:new\s+)?([^\s(]+)\s+\(/)?.[1] ?? text.match(/^\s*([^@\s]+)@/)?.[1];
    if (url) frames.push({ url, line: Number(line), column: Number(column), name });
  }
  const app = frames.slice(1).filter((frame) => !NOT_APP.test(frame.url));
  const render = frames.length > 1 ? frames[frames.length - 1] : undefined;
  const at = app[0];
  if (!at) return undefined;
  if (render && !NOT_APP.test(render.url)) return { at, name: frameComponent(render.name) };
  return { at, onStack: app.map((frame) => frameComponent(frame.name)) };
}

/** A fiber's component name, where the stack names no function: React 18, or a bare `render`. */
function typeName(node: Made | null | undefined): string | undefined {
  const type = node?.type as { displayName?: string; name?: string; render?: Made; type?: Made } | string | undefined;
  if (!type || typeof type === 'string') return node?.name;
  const inner = type.render ?? type.type ?? type;
  return type.displayName ?? inner.displayName ?? inner.name;
}

/** Whether a fiber is a class component, whose render Firefox and Safari print as a bare `render`. */
const isClass = (node: Made | null | undefined) =>
  Boolean((node?.type as { prototype?: { isReactComponent?: unknown } } | undefined)?.prototype?.isReactComponent);

/**
 * The components whose code wrote the element, outermost first, and the line
 * that wrote it. For the element and each of its owners (who rendered what,
 * not parents, so layout providers stay out), the component React called to
 * write it names that level, when the app wrote it. Nodes a library made are
 * passed, so an app component a router, a framework, a `Slot` or a list
 * renders is still named. `source` is the first app frame. Absent on other
 * frameworks and production builds, which leaves the fields out.
 */
function reactOwners(el: Element): { names: string[]; at?: StackFrame } {
  const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'));
  let node: Made | null | undefined = key ? (el as unknown as Record<string, Made | null>)[key] : null;
  const names: string[] = [];
  let at: StackFrame | undefined;
  for (let depth = 0; node && depth < 64; depth++) {
    const owner = node._debugOwner ?? node.owner;
    const made = callsite(node);
    if (made) {
      // React's replay of a server component's stack names the server bundle, unless webpack named the module.
      if (!/^(?:about|rsc):(?!.*webpack-internal:)/.test(made.at.url)) at ??= made.at;
      // React 18 names no function, and a bare `render` is a class's: the owner's type names them.
      // A library that wraps the app's component (MobX's `observer`) is named for it, when the
      // app's own frame on the stack is that component; a table's `Cell` calling a column is not.
      const wrapped = made.onStack && typeName(owner);
      const name =
        made.at.legacy || (made.name === 'render' && isClass(owner))
          ? typeName(owner)
          : made.onStack
            ? wrapped && made.onStack.includes(wrapped)
              ? wrapped
              : undefined
            : made.name;
      // Capitalized is a component; anything else is a minified or internal name.
      if (name && /^[A-Z]/.test(name) && !names.includes(name) && names.length < 5) names.unshift(name);
    }
    node = owner;
  }
  return { names, at };
}

function reactContext(el: Element): Pick<IsotoneElement, 'component' | 'source'> {
  const { names, at } = reactOwners(el);
  return located(names, at && frameSource(at));
}

const located = (names: string[], source: string | undefined): Pick<IsotoneElement, 'component' | 'source'> => ({
  ...(names.length ? { component: names } : {}),
  ...(source ? { source } : {}),
});

/** What Vue's dev build keeps on a component instance. */
interface VueInstance {
  type?: { name?: string; __name?: string; __file?: string };
  vnode?: { ctx?: VueInstance | null };
  parent?: VueInstance | null;
}

/**
 * Vue's counterpart of `reactContext`: the components whose templates wrote
 * the element, outermost first, and the innermost one's file (Vue keeps no
 * line). A vnode's `ctx` is the component that rendered it, as a fiber's owner
 * is, so slot content belongs to the template that wrote it. A component
 * without a file of the app's own, such as a library's, is passed.
 */
function vueContext(el: Element): Pick<IsotoneElement, 'component' | 'source'> {
  const node = el as Element & { __vnode?: VueInstance['vnode']; __vueParentComponent?: VueInstance };
  const names: string[] = [];
  let source: string | undefined;
  let instance: VueInstance | null | undefined = node.__vnode?.ctx ?? node.__vueParentComponent;
  for (let depth = 0; instance && depth < 64; depth++) {
    const { name, __name, __file: file } = instance.type ?? {};
    if (file && !NOT_APP.test(file)) {
      source ??= file;
      const named = name ?? __name ?? file.match(/([^/\\]+)\.vue$/)?.[1];
      if (named && !names.includes(named) && names.length < 5) names.unshift(named);
    }
    instance = instance.vnode?.ctx ?? instance.parent;
  }
  return located(names, source);
}

/**
 * A frame's file, with its line only where that is the file's own: React 18's
 * `_debugSource`. A stack's line is the transformed code's until the module's
 * source map says otherwise (`resolveElementSource`), and a bundle chunk
 * (Next's `/_next/static/`) names no file until then.
 */
function frameSource({ url, line, legacy }: StackFrame): string | undefined {
  const path = sourcePath(url);
  if (path.includes('/_next/static/')) {
    // A Turbopack hot update names its module in the query: `?id=%255Bproject%255D/src/…`.
    let id = url.match(/[?&]id=([^&#]+)/)?.[1];
    try {
      id = id && decodeURIComponent(id);
    } catch {
      return undefined;
    }
    return id
      ? sourcePath(id)
          .replace(/^\[project\]\//, '')
          .replace(/\s.*$/, '')
      : undefined;
  }
  return legacy ? `${path}:${line}` : path;
}

/** A served module URL as the source path it stands for. */
function sourcePath(location: string): string {
  let path = location
    .replace(/[?#].*$/, '')
    .replace(/^about:\/\/React\/[^/]*\//, '')
    .replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, '');
  // A Windows path is no URL (`C:` would parse as its scheme): forward slashes, as a module id writes it.
  if (/^[a-z]:[\\/]/i.test(path)) return path.replace(/\\/g, '/');
  try {
    const url = new URL(path);
    path = url.protocol === 'file:' ? url.pathname : url.pathname.replace(/^\/@fs(?=\/)/, '');
  } catch {}
  try {
    path = decodeURIComponent(path);
  } catch {}
  // `file:///C:/…` and Vite's `/@fs/C:/…` leave a slash before the drive.
  return path.replace(/^\/(?=[a-z]:\/)/i, '').replace(/^\.\//, '');
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The original source and line of a generated position, from a source map's VLQ mappings. */
function mapPosition(mappings: string, line: number, column: number): { source: number; line: number } | undefined {
  // Running totals: generated column (reset per line), source index, source line.
  let generated = 0;
  let source = 0;
  let sourceLine = 0;
  let found: { source: number; line: number } | undefined;
  for (const [at, text] of mappings.split(';').entries()) {
    if (at > line) break;
    generated = 0;
    for (const segment of text.split(',')) {
      const values: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = BASE64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = shift = 0;
        }
      }
      if (values.length < 4) continue;
      const [columnDelta, sourceDelta, lineDelta] = values as [number, number, number];
      generated += columnDelta;
      source += sourceDelta;
      sourceLine += lineDelta;
      if (at === line && generated <= column) found = { source, line: sourceLine };
    }
  }
  return found;
}

interface SourceMap {
  sources: string[];
  sourceRoot?: string;
  mappings: string;
  /** An index map's parts (Turbopack's chunks): one map per module, from where it starts in the chunk. */
  sections?: { offset: { line: number; column: number }; map: SourceMap }[];
}

/** A module as the page loaded it: its generated code, and the source map of that code. */
interface Loaded {
  code: string;
  map: SourceMap;
  /** What the map's relative sources are relative to. */
  base: URL;
}

/** `code`'s own source map: the last reference, since a chunk can quote another in its code. */
async function withMap(url: string, code: string): Promise<Loaded | undefined> {
  const reference = [...code.matchAll(/[#@] sourceMappingURL=([^\s'"\\]+)/g)].pop()?.[1];
  if (!reference) return undefined;
  // Sources in an inline map are relative to the module itself.
  if (reference.startsWith('data:')) {
    const json = new TextDecoder().decode(Uint8Array.from(atob(reference.slice(reference.indexOf(',') + 1)), (c) => c.charCodeAt(0)));
    return { code, map: JSON.parse(json), base: new URL(url) };
  }
  const base = new URL(reference, url);
  // Only the server that sent the module is asked for its map.
  return base.origin === new URL(url).origin ? { code, map: await (await fetch(base)).json(), base } : undefined;
}

/** Served modules by URL, with their maps, so unchanged code is not mapped twice. */
const served = new Map<string, Loaded>();

/** Every URL the page downloaded, with the size of its first download, kept past Resource Timing's 250-entry buffer. */
const downloads = new Map<string, number>();
const record = (entries: PerformanceEntryList, into: Map<string, number>) => {
  for (const entry of entries as PerformanceResourceTiming[]) if (!into.has(entry.name)) into.set(entry.name, entry.decodedBodySize);
  return into;
};
try {
  new PerformanceObserver((list) => record(list.getEntries(), downloads)).observe({ type: 'resource', buffered: true });
} catch {}

/** The page's downloads: those the observer kept, and any still in Resource Timing's buffer. */
const pageDownloads = () => record(globalThis.performance?.getEntriesByType?.('resource') ?? [], new Map(downloads));

/** A module URL without Vite's hot-update stamp, and the stamp (`?t=`). */
function stamped(url: string): [string, number] {
  const parsed = new URL(url);
  const at = Number(parsed.searchParams.get('t') ?? 0);
  parsed.searchParams.delete('t');
  return [parsed.href, at];
}

/** Code without the stamps Vite adds to an importer's imports after a hot update (`./Header.tsx?t=…`). */
const unstamped = (code: string) => code.replace(/\?t=\d+&/g, '?').replace(/\?t=\d+/g, '');

/**
 * A served module as the page loaded it, or nothing once that code may have
 * changed. The browser keeps no copy a page can read (Vite's `Vary: Origin`
 * keeps a module script's cache entry from `fetch`), so the check is the
 * page's own download: the server must send as many bytes, Vite's import
 * stamps aside, and on Vite the page must not have loaded the module again
 * since (a hot update, `?t=`). Next serves a chunk at the URL a hot update
 * keeps, so an edit that keeps the chunk's length (one line number for
 * another) can still give a wrong line.
 */
async function servedModule(url: string): Promise<Loaded | undefined> {
  const loads = pageDownloads();
  const [bare, at] = stamped(url);
  if ([...loads.keys()].some((name) => /^https?:/.test(name) && stamped(name)[0] === bare && stamped(name)[1] > at)) return undefined;
  const loaded = loads.get(url);
  if (!loaded && url.includes('/_next/static/')) return undefined;
  const bytes = await (await fetch(url)).arrayBuffer();
  const code = new TextDecoder().decode(bytes);
  if (loaded && loaded !== bytes.byteLength && loaded !== new TextEncoder().encode(unstamped(code)).length) return undefined;
  const known = served.get(url);
  if (known?.code === code) return known;
  const module = await withMap(url, code);
  if (served.size >= 64) served.clear();
  if (module) served.set(url, module);
  return module;
}

/** Webpack's `require` for each `webpackChunk*` global, handed to a runtime callback of a chunk pushed there. */
const webpackRequires = new Map<string, { m?: Record<string, unknown> }>();

/**
 * Every version of a webpack module the page may have run: the factory a hot
 * update installed (`require.m`), and the one its chunk delivered. Each holds
 * the module's code and inline map as a JSON string passed to `eval`.
 */
function webpackModules(url: string): Promise<Loaded | undefined>[] {
  const id = url.slice('webpack-internal:///'.length);
  const scope = globalThis as unknown as Record<string, ({ push?: (chunk: unknown) => void } & unknown[]) | undefined>;
  for (const key of Object.keys(scope).filter((name) => name.startsWith('webpackChunk'))) {
    const chunks = scope[key];
    // Webpack runs a runtime callback only for a chunk it has not seen, so the id is new each time.
    if (!webpackRequires.has(key))
      chunks?.push?.([
        [`isotone-${Date.now()}-${Math.random()}`],
        {},
        (require: { m?: Record<string, unknown> }) => webpackRequires.set(key, require),
      ]);
    const current = webpackRequires.get(key)?.m?.[id];
    // Another runtime on the page holds other modules.
    if (!current) continue;
    const delivered = Array.from(chunks ?? [], (chunk) => (chunk as [unknown, Record<string, unknown>?])[1]?.[id]);
    return [...new Set([current, ...delivered])].flatMap((factory) => {
      const literal = factory ? String(factory).match(/eval\((?:__webpack_require__\.ts\()?("(?:[^"\\]+|\\.)*")/)?.[1] : undefined;
      try {
        return literal ? [withMap(url, JSON.parse(literal))] : [];
      } catch {
        return [];
      }
    });
  }
  return [];
}

/** A JSX factory, as the transformed code calls it. */
const FACTORY = '(?:_?jsx(?:s|DEV)?\\w*|createElement|cloneElement)';
/** V8 places a direct call (`_jsxDEV(…)`, Vite) at the callee… */
const CALLEE = new RegExp(`^${FACTORY}\\s*\\(`);
/** …and a wrapped one (`(0, m["jsxDEV"])(…)`, webpack and Turbopack) at its arguments. */
const WRAPPED = new RegExp(`${FACTORY}["'\\]]*\\)$`);

/**
 * The file and line `frame` was written at, through `module`'s map, when the
 * frame is a JSX call in `module`'s code: a frame from another version of the
 * module (a fiber Fast Refresh kept, a chunk rebuilt since) usually lands
 * elsewhere.
 */
function mapFrame(frame: StackFrame, module: Loaded): string | undefined {
  let [line, column] = [frame.line - 1, frame.column - 1];
  const text = module.code.split('\n')[line] ?? '';
  const [before, at] = [text.slice(0, column), text.slice(column)];
  if (column > text.length || !(CALLEE.test(at) || (WRAPPED.test(before) && at.startsWith('(')))) return undefined;
  const section = module.map.sections?.filter(({ offset: o }) => o.line < line || (o.line === line && o.column <= column)).pop();
  const map = section?.map ?? module.map;
  if (section) [line, column] = [line - section.offset.line, line === section.offset.line ? column - section.offset.column : column];
  const position = mapPosition(map.mappings, line, column);
  const file = position && map.sources[position.source];
  if (!position || !file) return undefined;
  // An absolute path is made relative to the app by the notes endpoint.
  return `${sourcePath(file.startsWith('/') ? file : new URL((map.sourceRoot ?? '') + file, module.base).href)}:${position.line + 1}`;
}

/**
 * The pinned element's JSX callsite in its original file, on React 19 hosts:
 * the module's source map turns the stack's transformed line into the line
 * the agent will open, and a bundle chunk into the file it came from, while
 * the server still sends the code the page loaded. Webpack keeps the versions
 * of a module the page may have run; the line is given only when every
 * version where the frame is a JSX call agrees on it, and the file alone when
 * they agree only on that. Resolves to undefined when there is nothing better
 * than what `describeIsotoneElement` already recorded.
 */
export async function resolveElementSource(el: Element): Promise<string | undefined> {
  const frame = reactOwners(el).at;
  // A Turbopack hot update runs the module from the whole chunk (`?id=`), at lines its map does not describe.
  if (!frame || frame.legacy || /\/_next\/static\/.*[?&]id=/.test(frame.url)) return undefined;
  try {
    const versions = /^https?:/.test(frame.url)
      ? [await servedModule(frame.url)]
      : frame.url.startsWith('webpack-internal:///')
        ? await Promise.all(webpackModules(frame.url).map((module) => module.catch(() => undefined)))
        : [];
    const lines = new Set(versions.map((module) => module && mapFrame(frame, module)).filter((line): line is string => Boolean(line)));
    // Versions that agree on the file only give the file.
    const files = new Set([...lines].map((line) => line.replace(/:\d+$/, '')));
    return lines.size === 1 ? [...lines][0] : files.size === 1 ? [...files][0] : undefined;
  } catch {
    return undefined;
  }
}

/** Text as one short line, for a label. */
const oneLine = (text: string | null | undefined) => (text ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);

/** Everything about a pinned element that says which one it is, for the agent
 *  reading the note later and without the page open. */
function elementContext(el: Element): Partial<IsotoneElement> {
  const attributes: Record<string, string> = {};
  for (const name of IDENTIFYING_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value) attributes[name] = value;
  }
  for (const { name, value } of Array.from(el.attributes)
    .filter((a) => a.name.startsWith('data-'))
    .slice(0, 6)) {
    if (value) attributes[name] = value;
  }
  const className = el.getAttribute('class');
  if (className) attributes.class = className;

  const within: string[] = [];
  let near: string | undefined;
  const ownText = renderedText(el).trim();
  for (let up = el.parentElement; up && up.tagName !== 'BODY'; up = up.parentElement) {
    if (!ownText && !near) {
      const text = renderedText(up).trim().replace(/\s+/g, ' ');
      if (text) near = text.slice(0, 80);
    }
    if (within.length === 4) continue;
    const tag = up.localName;
    // A label the page names explicitly comes first: the elements it points at, then its own text.
    const labelledBy = (up.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => (id ? (up.getRootNode() as Document | ShadowRoot).getElementById?.(id)?.textContent : ''))
      .join(' ');
    const label = oneLine(labelledBy) || oneLine(up.getAttribute('aria-label'));
    const test = up.getAttribute('data-testid');
    const heading = ownHeading(up, el);
    if (label) within.unshift(`<${tag}> labelled "${label}"`);
    else if (test) within.unshift(`<${tag} data-testid="${test}">`);
    else if (heading) within.unshift(`<${tag}> headed "${oneLine(heading.textContent)}"`);
  }
  const box = el.getBoundingClientRect();
  const view = el.ownerDocument?.defaultView;
  // Only what is painted has a look worth recording.
  const styles = box.width || box.height ? styleDigest(el, Boolean(ownText)) : undefined;
  return {
    ...(Object.keys(attributes).length ? { attributes } : {}),
    ...reactContext(el),
    ...vueContext(el),
    ...(within.length ? { within } : {}),
    ...(near ? { near } : {}),
    ...(box.width || box.height
      ? {
          rect: {
            x: Math.round(box.left + (view?.scrollX ?? 0)),
            y: Math.round(box.top + (view?.scrollY ?? 0)),
            w: Math.round(box.width),
            h: Math.round(box.height),
          },
        }
      : {}),
    ...(styles ? { styles } : {}),
  };
}

const HEADING = 'h1,h2,h3,h4,h5,h6';

/**
 * The heading that titles `up` itself, above the branch holding `el`: its last
 * heading child there, else the first heading in a `header` or `hgroup` child
 * there. Nothing else counts, so a card or column beside the element never
 * lends its heading; a missing label misleads nobody.
 */
function ownHeading(up: Element, el: Element): Element | null {
  let heading: Element | null = null;
  let header: Element | null = null;
  for (const child of Array.from(up.children)) {
    if (child === el || child.contains(el)) break;
    if (child.matches(HEADING)) heading = child;
    else if (child.matches('header,hgroup')) header ??= child.querySelector(HEADING);
  }
  return heading ?? header;
}

/** `rgb(17, 17, 17)` as `#111111`, the form a stylesheet is searched for; anything else as it is. */
function hexColor(value: string): string {
  return value.replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g, (match, r, g, b, a) => {
    const hex = [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    if (a === undefined || Number(a) === 1) return `#${hex}`;
    return Number(a) === 0 ? 'transparent' : match;
  });
}

/** Four sides as the shortest CSS shorthand, or nothing when all are zero. */
function sides(style: CSSStyleDeclaration, name: (side: string) => string): string | undefined {
  const [top, right, bottom, left] = ['top', 'right', 'bottom', 'left'].map((side) => style.getPropertyValue(name(side)) || '0px') as [
    string,
    string,
    string,
    string,
  ];
  if ([top, right, bottom, left].every((v) => v === '0px')) return undefined;
  if (right === left) return top === bottom ? (top === right ? top : `${top} ${right}`) : `${top} ${right} ${bottom}`;
  return `${top} ${right} ${bottom} ${left}`;
}

/** Longest style value kept; a long gradient or font stack is cut, never the whole digest. */
const MAX_STYLE_VALUE = 120;

/**
 * How the element looks now, as the handful of computed styles a reviewer's
 * "bigger", "too tight" or "wrong colour" is about. Values that say nothing
 * (no padding, no shadow, static position) are left out, so the digest stays
 * a few short lines and "from what" is never a guess.
 */
function styleDigest(el: Element, hasText: boolean): Record<string, string> | undefined {
  let style: CSSStyleDeclaration | undefined;
  try {
    style = el.ownerDocument?.defaultView?.getComputedStyle(el);
  } catch {}
  if (!style) return undefined;
  const get = (name: string) => style.getPropertyValue(name).trim();
  const out: Record<string, string> = {};
  const add = (name: string, value: string | undefined, skip: readonly string[] = []) => {
    if (value && !skip.includes(value)) out[name] = hexColor(value).slice(0, MAX_STYLE_VALUE);
  };
  const display = get('display');
  add('display', display, ['block', 'inline']);
  if (display.includes('flex')) {
    add('flex-direction', get('flex-direction'), ['row']);
    add('flex-wrap', get('flex-wrap'), ['nowrap']);
  }
  if (display.includes('grid')) add('grid-template-columns', get('grid-template-columns'), ['none']);
  if (display.includes('flex') || display.includes('grid')) {
    add('justify-content', get('justify-content'), ['normal', 'flex-start', 'start']);
    add('align-items', get('align-items'), ['normal', 'stretch']);
    add('gap', get('gap'), ['normal', '0px', 'normal normal', '0px 0px']);
  }
  add('position', get('position'), ['static']);
  add('z-index', get('z-index'), ['auto']);
  add(
    'padding',
    sides(style, (side) => `padding-${side}`),
  );
  add(
    'margin',
    sides(style, (side) => `margin-${side}`),
  );
  if (hasText) {
    add('font-size', get('font-size'));
    add('font-weight', get('font-weight'));
    add('line-height', get('line-height'));
    // The first family is the one in use, or meant to be.
    add(
      'font-family',
      get('font-family')
        .split(',')[0]
        ?.trim()
        .replace(/^["']|["']$/g, ''),
    );
    add('color', get('color'));
    add('text-align', get('text-align'), ['start', 'left', '-webkit-auto']);
    add('letter-spacing', get('letter-spacing'), ['normal', '0px']);
    add('text-transform', get('text-transform'), ['none']);
  }
  add('background-color', get('background-color'), ['rgba(0, 0, 0, 0)', 'transparent']);
  add('background-image', get('background-image'), ['none']);
  const borders = ['top', 'right', 'bottom', 'left'].map((side) =>
    get(`border-${side}-style`) === 'none' || get(`border-${side}-width`) === '0px'
      ? ''
      : `${get(`border-${side}-width`)} ${get(`border-${side}-style`)} ${get(`border-${side}-color`)}`,
  );
  if (borders.every((b) => b === borders[0])) add('border', borders[0]);
  else for (const [at, side] of ['top', 'right', 'bottom', 'left'].entries()) add(`border-${side}`, borders[at]);
  add('border-radius', get('border-radius'), ['0px', '0']);
  add('box-shadow', get('box-shadow'), ['none']);
  add('opacity', get('opacity'), ['1']);
  add('overflow', get('overflow'), ['visible']);
  return Object.keys(out).length ? out : undefined;
}

/** Lazy DOM views: describing one element never walks unrelated subtrees. */
/**
 * The element's text as a reader sees it. `textContent` runs block children
 * together ("Active projects12+2 this month"), so prefer the browser's
 * `innerText`, and without one (jsdom, detached nodes) put a space around
 * every child that is not inline.
 */
function renderedText(el: Element): string {
  const inner = (el as HTMLElement).innerText;
  if (typeof inner === 'string' && el.isConnected) return inner;
  const view = el.ownerDocument?.defaultView;
  const walk = (node: Node): string => {
    if (node.nodeType === 3) return node.nodeValue ?? '';
    if (node.nodeType !== 1) return '';
    const text = Array.from(node.childNodes, walk).join('');
    const display = view?.getComputedStyle(node as Element).display ?? '';
    return node === el || display.startsWith('inline') ? text : ` ${text} `;
  };
  return walk(el);
}

/** Test ids, which also anchor an ancestor. */
const TEST_IDS = ['data-testid', 'data-test-id', 'data-test', 'data-cy'];

/** Attributes that say what an element is whatever its state: not `aria-label` or `title` ("Open menu"). */
const STABLE_ATTRIBUTES = ['name', 'for', 'href', 'alt', 'placeholder'];

/**
 * `n`'s selector segments that do not depend on its position: a test id, and
 * for the pinned element itself a stable attribute. Never a class: state,
 * Tailwind utilities, a style fix and a variant all change classes, and the
 * pin would move to another element or to none.
 */
function anchors(n: Element, pinned: boolean): string[] {
  const attribute = (name: string) => {
    const value = n.getAttribute(name);
    // An id that `for` or a `#fragment` points at changes with each render when the page generated it.
    const generated = value && (name === 'for' || name === 'href') && GENERATED_ID.test(value.slice(value.indexOf('#') + 1));
    return value && !generated && value.length <= 80 && !/["\\\n]/.test(value) ? [`${n.localName}[${name}="${value}"]`] : [];
  };
  return [...TEST_IDS, ...(pinned ? STABLE_ATTRIBUTES : [])].flatMap(attribute);
}

export function elementAsNode(el: Element): NodeLike {
  const cache = new WeakMap<Element, NodeLike>();
  const view = (n: Element | null | undefined): NodeLike | null => {
    if (!n) return null;
    const cached = cache.get(n);
    if (cached) return cached;
    const created: NodeLike = {
      tagName: n.tagName,
      localName: n.localName,
      id: n.id || null,
      get textContent() {
        return renderedText(n);
      },
      get parentElement() {
        return view(n.parentElement);
      },
      get children() {
        return Array.from(n.children, (child) => view(child) as NodeLike);
      },
      get indexInParent() {
        let index = 1;
        for (let sibling = n.previousElementSibling; sibling; sibling = sibling.previousElementSibling) index++;
        return index;
      },
      anchors: () => anchors(n, n === el),
    };
    cache.set(n, created);
    return created;
  };
  const root = view(el);
  if (root === null) {
    throw new Error('unreachable: a real element always maps to a view');
  }
  root.isOnlyMatch = (selector) => {
    try {
      const found = el.ownerDocument.querySelectorAll(selector);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  };
  root.context = () => elementContext(el);
  return root;
}
