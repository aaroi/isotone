/** Auto follows the page at the dock; system follows the OS preference. */
export type IterationTheme = 'auto' | 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';
type Color = { r: number; g: number; b: number; a: number };

/** Computed colors usually use rgb(); let the browser convert other color spaces. */
function parseColor(value: string): Color | null {
  const rgb = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
    const values = parts.map((part, i) =>
      Number.parseFloat(part) * (part.endsWith('%') ? (i === 3 ? 0.01 : 2.55) : 1),
    );
    if (values.length >= 3 && values.every(Number.isFinite))
      return { r: values[0], g: values[1], b: values[2], a: values[3] ?? 1 };
  }
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (!value || !globalThis.CSS?.supports('color', value)) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  } catch {
    return null;
  }
}

function isPanel(node: Node | null): boolean {
  if (!node) return false;
  const element = node instanceof Element ? node : node.parentElement;
  if (element?.closest('[data-iso-iterate]')) return true;
  const root = node.getRootNode();
  return root instanceof ShadowRoot && isPanel(root.host);
}

/** Include open shadow roots without letting our own shadow host affect the sample. */
function paintStack(shadows?: Set<ShadowRoot>): Element[] {
  const x = Math.max(0, window.innerWidth - 44);
  const y = Math.max(0, window.innerHeight - 44);
  const elements = new Set<Element>();
  const visit = (element: Element) => {
    if (elements.has(element) || isPanel(element)) return;
    const shadow = element.shadowRoot;
    if (shadow) {
      shadows?.add(shadow);
      for (const child of shadow.elementsFromPoint?.(x, y) ?? []) {
        // Some browsers include ancestors outside the shadow tree in this result.
        if (child.getRootNode() === shadow) visit(child);
      }
    }
    elements.add(element);
  };
  for (const element of document.elementsFromPoint?.(x, y) ?? []) {
    if (element !== document.body && element !== document.documentElement) visit(element);
  }
  // Body paint covers the viewport even when its layout box is shorter than it.
  if (document.body) visit(document.body);
  visit(document.documentElement);
  return [...elements];
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Resolve actual paint at the dock, compositing transparent backgrounds over the
 * browser canvas. Background images and closed shadow roots cannot be sampled;
 * hosts using those can set an explicit theme or choose system.
 */
export function detectTheme(
  preference: IterationTheme = 'auto',
  shadows?: Set<ShadowRoot>,
): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  if (preference === 'system') return systemTheme();
  if (typeof document === 'undefined') return 'light';
  try {
    let remaining = 1;
    let r = 0, g = 0, b = 0;
    for (const element of paintStack(shadows)) {
      const parsed = parseColor(getComputedStyle(element).backgroundColor);
      if (!parsed || parsed.a <= 0) continue;
      const weight = parsed.a * remaining;
      r += parsed.r * weight;
      g += parsed.g * weight;
      b += parsed.b * weight;
      remaining *= 1 - parsed.a;
      if (remaining < 0.001) break;
    }
    const schemes = getComputedStyle(document.documentElement).colorScheme.split(/\s+/);
    const darkCanvas = schemes.includes('dark') &&
      (!schemes.includes('light') || systemTheme() === 'dark');
    const canvas = darkCanvas ? 0 : 255;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b + canvas * remaining) / 255;
    return luminance > 0.55 ? 'light' : 'dark';
  } catch {
    return 'light';
  }
}

/** Observe only the signals needed by the chosen mode, coalescing page changes per frame. */
export function observeTheme(
  onTheme: (theme: ResolvedTheme) => void,
  preference: IterationTheme = 'auto',
): () => void {
  let current: ResolvedTheme | undefined;
  let frame: number | undefined;
  let disposed = false;
  const shadows = new Set<ShadowRoot>();
  const observer = preference === 'auto' ? new MutationObserver(records => {
    if (records.some(record => !isPanel(record.target))) schedule();
  }) : undefined;
  const observe = () => {
    if (!observer) return;
    observer.disconnect();
    const options = { attributes: true, childList: true, characterData: true, subtree: true };
    observer.observe(document.documentElement, options);
    for (const shadow of shadows) observer.observe(shadow, options);
  };
  const sample = () => {
    frame = undefined;
    if (disposed) return;
    shadows.clear();
    const next = detectTheme(preference, shadows);
    observe();
    if (next !== current) {
      current = next;
      onTheme(next);
    }
  };
  const schedule = () => { frame ??= window.requestAnimationFrame(sample); };
  sample();
  if (preference === 'light' || preference === 'dark') return () => {};

  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', schedule);
  const pageEvent = (event: Event) => {
    if (!isPanel(event.target instanceof Node ? event.target : null)) schedule();
  };
  if (preference === 'auto') {
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', pageEvent, { capture: true, passive: true });
    // Capture non-bubbling stylesheet loads and palette animation completion.
    document.addEventListener('load', pageEvent, true);
    document.addEventListener('transitionend', pageEvent, true);
    document.addEventListener('animationend', pageEvent, true);
  }
  return () => {
    disposed = true;
    observer?.disconnect();
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    media?.removeEventListener('change', schedule);
    window.removeEventListener('resize', schedule);
    document.removeEventListener('scroll', pageEvent, true);
    document.removeEventListener('load', pageEvent, true);
    document.removeEventListener('transitionend', pageEvent, true);
    document.removeEventListener('animationend', pageEvent, true);
  };
}
