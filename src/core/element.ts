/**
 * The element descriptor: what the panel records about a pinned element so
 * the agent can find it in code. Framework-free and unit-testable against
 * plain objects as well as a real DOM.
 */
import type { IterationElement } from './types';

/** The minimal structural surface the descriptor builder needs from a DOM
 *  node. `children` is `readonly` so both a real `HTMLCollection` and a plain
 *  test array satisfy it; the builder materializes it with `Array.from`. */
export interface NodeLike {
  tagName: string;
  id?: string | null;
  parentElement?: NodeLike | null;
  children?: readonly NodeLike[];
  textContent?: string | null;
  /** One-based child position, when the adapter can provide it cheaply. */
  indexInParent?: number;
  /** Whether a selector finds this node and nothing else. Without one, the
   *  path stops at an id or the depth cap, unchecked. */
  isOnlyMatch?(selector: string): boolean;
  /** What else identifies the node, beyond its path. */
  context?(): Partial<IterationElement>;
}

/**
 * Descriptor of a picked element for locating it in code. Walks up the tree
 * collecting `#id` (preferred) or `tag:nth-child(n)` segments. The panel finds
 * pins again with `querySelector`, which takes the first match, so with a real
 * DOM the walk goes on past `maxDepth` until the path matches this element
 * alone. Kept framework-free so it is unit-testable.
 */
export function describeIterationElement(el: NodeLike, maxDepth = 4): IterationElement {
  const parts: string[] = [];
  let node: NodeLike | null | undefined = el;
  let depth = 0;
  const only = el.isOnlyMatch ? (path: string[]) => el.isOnlyMatch?.(path.join(' > ')) === true : null;
  let settled = false;
  while (node && node.tagName !== 'BODY' && (only || depth < maxDepth)) {
    if (node.id) {
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
    let part = node.tagName.toLowerCase();
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
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    selector: parts.join(' > '),
    ...el.context?.(),
  };
}

const IDENTIFYING_ATTRIBUTES = ['role', 'type', 'name', 'href', 'aria-label', 'title', 'alt', 'placeholder'];

/** Names from React's dev-mode bookkeeping on the DOM node. Absent on other
 *  frameworks and production builds, which simply leaves the fields out. */
function reactContext(el: Element): Pick<IterationElement, 'component' | 'source'> {
  type Fiber = {
    type?: unknown;
    return?: Fiber | null;
    _debugSource?: { fileName?: string; lineNumber?: number };
    _debugStack?: { stack?: string } | string | null;
  };
  type Named = { displayName?: string; name?: string; render?: Named; type?: Named };
  const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'));
  let fiber: Fiber | null | undefined = key ? (el as unknown as Record<string, Fiber | null>)[key] : null;
  const names: string[] = [];
  let source: string | undefined;
  while (fiber && names.length < 5) {
    if (!source && fiber._debugSource?.fileName) {
      source = `${fiber._debugSource.fileName}:${fiber._debugSource.lineNumber ?? 0}`;
    }
    source ??= stackSource(fiber._debugStack);
    const type = fiber.type as Named | string | null | undefined;
    const named = type && typeof type !== 'string' ? (type.render ?? type.type ?? type) : null;
    const name = named?.displayName ?? named?.name;
    // Capitalized is a component; anything else is a minified or internal name.
    if (name && /^[A-Z]/.test(name) && names[0] !== name) names.unshift(name);
    fiber = fiber.return;
  }
  return { ...(names.length ? { component: names } : {}), ...(source ? { source } : {}) };
}

interface StackFrame {
  url: string;
  line: number;
  column: number;
}

/**
 * React 19 dropped `_debugSource`; its `_debugStack` is an Error created where
 * the JSX ran. The first frame outside React's own runtime is that callsite, in
 * the module the dev server served: Vite, Next and webpack name the source file
 * with a query or loader prefix, at the transformed line.
 */
function stackFrame(stack: { stack?: string } | string | null | undefined): StackFrame | undefined {
  const text = typeof stack === 'string' ? stack : stack?.stack;
  for (const line of text?.split('\n').slice(1) ?? []) {
    const match = line.match(/(?:\(|@|\bat )((?:[a-z-]+:\/\/\/?|\/)\S+?):(\d+):(\d+)\)?\s*$/i);
    if (!match || /react[-_]jsx|react-dom|react\.development|\/react\/|jsx-dev-runtime|jsx-runtime/i.test(match[1])) continue;
    return { url: match[1], line: Number(match[2]), column: Number(match[3]) };
  }
  return undefined;
}

/** A served module URL as the source path it stands for. */
function sourcePath(location: string): string {
  let path = location.replace(/[?#].*$/, '').replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, '');
  try {
    const url = new URL(path);
    path = url.protocol === 'file:' ? url.pathname : url.pathname.replace(/^\/@fs(?=\/)/, '');
  } catch {}
  try {
    path = decodeURIComponent(path);
  } catch {}
  return path.replace(/^\.\//, '');
}

const stackSource = (stack: Parameters<typeof stackFrame>[0]) => {
  const frame = stackFrame(stack);
  return frame && `${sourcePath(frame.url)}:${frame.line}`;
};

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The original source and line of a generated position, from a source map's VLQ mappings. */
function mapPosition(mappings: string, line: number, column: number): { source: number; line: number } | undefined {
  const lines = mappings.split(';');
  const state = [0, 0, 0, 0];
  let found: { source: number; line: number } | undefined;
  for (let at = 0; at <= line && at < lines.length; at++) {
    state[0] = 0;
    for (const segment of lines[at].split(',')) {
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
      for (let i = 0; i < 4; i++) state[i] += values[i];
      if (at === line && state[0] <= column) found = { source: state[1], line: state[2] };
    }
  }
  return found;
}

/**
 * The pinned element's JSX callsite in its original file, on React 19 hosts:
 * the served module's source map turns the stack's transformed line into the
 * line the agent will open. Resolves to undefined when there is nothing better
 * than what `describeIterationElement` already recorded.
 */
export async function resolveElementSource(el: Element): Promise<string | undefined> {
  type Fiber = { return?: Fiber | null; _debugSource?: unknown; _debugStack?: Parameters<typeof stackFrame>[0] };
  const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'));
  let fiber: Fiber | null | undefined = key ? (el as unknown as Record<string, Fiber | null>)[key] : null;
  let frame: StackFrame | undefined;
  for (; fiber && !frame; fiber = fiber.return) {
    if (fiber._debugSource) return undefined;
    frame = stackFrame(fiber._debugStack);
  }
  if (!frame || !/^https?:/.test(frame.url)) return undefined;
  try {
    const code = await (await fetch(frame.url)).text();
    const reference = code.match(/\/\/[#@] sourceMappingURL=(\S+)\s*$/)?.[1];
    if (!reference) return undefined;
    const inline = reference.startsWith('data:');
    // Sources in an inline map are relative to the module itself.
    const mapUrl = inline ? new URL(frame.url) : new URL(reference, frame.url);
    const map: { sources: string[]; sourceRoot?: string; mappings: string } = inline
      ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(reference.slice(reference.indexOf(',') + 1)), (c) => c.charCodeAt(0))))
      : await (await fetch(mapUrl)).json();
    const position = mapPosition(map.mappings, frame.line - 1, frame.column - 1);
    const file = position && map.sources[position.source];
    if (!position || !file) return undefined;
    const path = file.startsWith('/') ? file : new URL((map.sourceRoot ?? '') + file, mapUrl).href;
    return `${sourcePath(path)}:${position.line + 1}`;
  } catch {
    return undefined;
  }
}

/** Everything about a pinned element that says which one it is, for the agent
 *  reading the note later and without the page open. */
function elementContext(el: Element): Partial<IterationElement> {
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
    const tag = up.tagName.toLowerCase();
    const label = up.getAttribute('aria-label');
    const test = up.getAttribute('data-testid');
    // Only a heading above the element titles it; a later one names the next section.
    let heading: Element | null = null;
    try {
      heading =
        Array.from(up.querySelectorAll(':scope > :is(h1,h2,h3,h4,h5,h6), :scope > * > :is(h1,h2,h3,h4,h5,h6)'))
          .filter((candidate) => candidate.compareDocumentPosition(el) & 4)
          .pop() ?? null;
    } catch {}
    if (label) within.unshift(`<${tag}> labelled "${label}"`);
    else if (test) within.unshift(`<${tag} data-testid="${test}">`);
    else if (heading && heading !== el)
      within.unshift(`<${tag}> headed "${(heading.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)}"`);
  }
  const box = el.getBoundingClientRect();
  const view = el.ownerDocument?.defaultView;
  return {
    ...(Object.keys(attributes).length ? { attributes } : {}),
    ...reactContext(el),
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
  };
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

export function elementAsNode(el: Element): NodeLike {
  const cache = new WeakMap<Element, NodeLike>();
  const view = (n: Element | null | undefined): NodeLike | null => {
    if (!n) return null;
    const cached = cache.get(n);
    if (cached) return cached;
    const created: NodeLike = {
      tagName: n.tagName,
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
