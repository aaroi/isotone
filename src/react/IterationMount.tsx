import { createRoot } from 'react-dom/client';

import { createIterationStore, type RouteGateOptions } from '../core/index';
import {
  createOverlayVariantsSource,
  knobDelta,
  OVERLAY_DEFAULT_OPTION,
  type VariantsSource,
  VARIANTS_ENDPOINT,
} from '../core/variants';
import { IterationPanel } from './IterationPanel';
import { ensurePanelStyles } from './styles';

export interface MountIterationOptions {
  /** The notes endpoint the dev plugin serves (or a framework preset). Omit
   *  it and the panel has no Notes tab: a production host that only wants
   *  variants passes a source and nothing else. */
  endpoint?: string;
  /**
   * Variants for the panel. A `VariantsSource` is rendered as-is; `'overlay'`
   * builds the overlay adapter against the Vite plugin's same-origin
   * endpoint. With neither this nor `endpoint`, nothing mounts.
   */
  variants?: VariantsSource | 'overlay';
  /** Which tab a tabbed panel opens on until the reviewer picks one. */
  defaultTab?: 'variants' | 'notes';
  /** Optional localStorage namespace for multi-app origins. */
  key?: string;
  /** Route visibility rule; default hides auth/error pages. */
  rule?: RouteGateOptions;
  /** Override the auto-detected pathname (sub-apps). Default: pathname. */
  getRoute?: () => string;
  /** Host context attached to each new note as its opaque payload — see
   *  IterationPanelProps.getPayload. */
  getPayload?: () => unknown;
}

/**
 * Run a `createRoot` call and undo what it leaves on `document`.
 *
 * react-dom dedupes its delegated listeners with a private marker property on
 * the container. A root on any non-document container (our shadow root) also
 * stamps that marker on the container's owner document, because the one
 * event that has to live on the document, `selectionchange`, is deduped
 * against it. The same check then short-circuits a root created *on* the
 * document: a host that runs `hydrateRoot(document, …)` after our root exists
 * (React Router 7's default entry.client, React 19's whole-document pattern)
 * finds the marker already set and attaches none of its click, key or pointer
 * listeners. Every React handler in the host is dead, and unmounting our root
 * cannot bring them back. Seen with react-dom 19.2; the code is unchanged
 * since 18.
 *
 * Whether our root wins that race depends on module load order, which we do
 * not control, so instead the document is put back exactly as we found it.
 * The marker's name carries a per-instance random suffix, hence a diff of the
 * document's own keys around the call rather than a hard-coded name. Our own
 * `selectionchange` listener stays attached to the document and serves a
 * later document-level host root too; a later element-level host attaches a
 * second one, which React's select plugin already dedupes by selection.
 */
function withDocumentUntouched<T>(create: () => T): T {
  const before = new Set(Object.getOwnPropertyNames(document));
  const result = create();
  for (const key of Object.getOwnPropertyNames(document)) {
    if (!before.has(key)) Reflect.deleteProperty(document, key);
  }
  return result;
}

/**
 * Self-mount the Iteration panel into a shadow root on `document.body`,
 * outside any app tree, tracking `window.location.pathname` so it needs no
 * router integration.
 *
 * The shadow root is what makes this safe to drop into an app nobody vetted:
 * the host's resets, its `button` and `textarea` rules, its stacking and its
 * global handlers stop at the boundary, so the panel looks the same in every
 * app. Inherited properties and custom properties still cross, which is
 * deliberate — the panel reads `--font-sans` and `--foreground` from the host
 * so it matches the surrounding theme.
 *
 * The host element carries `data-iso-iterate`, and that is load-bearing:
 * `document.elementFromPoint` retargets to the host for anything inside a
 * shadow root, so the element picker's self-exclusion matches on it.
 */
export function mountIteration(opts: MountIterationOptions): () => void {
  const getRoute = opts.getRoute ?? (() => window.location.pathname);
  const variants =
    opts.variants === 'overlay'
      ? overlaySourceWithSave(getRoute, opts.endpoint, opts.key)
      : opts.variants;
  // Nothing to show: no notes to write and no variants to pick. A production
  // host that forgot its source gets no empty launcher in the corner.
  if (!opts.endpoint && !variants) return () => {};
  // A variants-only host whose source has no axes on this page and no way to
  // get some later (no `refresh`) would mount an empty shadow root on every
  // such page. A hosted preview site is exactly that on axis-less
  // experiments, so skip the mount rather than leave a hollow host div.
  if (
    !opts.endpoint &&
    variants &&
    variants.getAxes().length === 0 &&
    typeof (variants as { refresh?: unknown }).refresh !== 'function'
  ) {
    return () => {};
  }

  const host = document.createElement('div');
  host.setAttribute('data-iso-iterate', 'root');
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  // Eagerly, so the panel never paints one frame unstyled.
  ensurePanelStyles(shadow);
  const root = withDocumentUntouched(() => createRoot(shadow));

  function render() {
    root.render(
      <IterationPanel
        route={getRoute()}
        store={{ endpoint: opts.endpoint, key: opts.key }}
        rule={opts.rule}
        getPayload={opts.getPayload}
        variants={variants}
        defaultTab={opts.defaultTab}
      />,
    );
  }

  const listeners: (() => void)[] = [];
  // Called from popstate/history wrappers that a router may invoke from
  // inside its own commit (Next dev does this on navigation). Keep every
  // `root.render` off that path — a render scheduled mid-commit fires React
  // 19 dev's "useInsertionEffect must not schedule updates", so coalesze to
  // one pending frame and flush once the host has settled.
  let disposed = false;
  let pending = false;
  const notify = () => {
    if (pending || disposed) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      if (!disposed) render();
    }, 0);
  };

  // Deferred, not synchronous — the host may call mountIteration from an
  // effect (a React host mounts it from one), and a synchronous secondary root
  // render fires React 19 dev's "useInsertionEffect must not schedule
  // updates" because it commits while the host's own commit is in flight.
  // One macrotask later the host has settled; the panel simply mounts a
  // frame later, which is invisible because the host element starts empty.
  setTimeout(() => {
    if (disposed) return;
    render();
    window.addEventListener('popstate', notify);
    listeners.push(() => window.removeEventListener('popstate', notify));
    for (const evt of ['pushState', 'replaceState'] as const) {
      const orig = window.history[evt].bind(window.history);
      window.history[evt] = ((...a: Parameters<History['pushState']>) => {
        const r = orig(...a);
        notify();
        return r;
      }) as typeof orig;
      listeners.push(() => {
        window.history[evt] = orig as never;
      });
    }
  }, 0);

  return () => {
    disposed = true;
    for (const off of listeners) off();
    // Deferred, not synchronous: a React host calls this from an effect
    // cleanup, and unmounting our root while the host's render is in flight
    // is a race React 19 rejects ("Attempted to synchronously unmount a root
    // while React was already rendering"). One macrotask later the host's
    // commit is done; nothing observable changes for a vanilla host.
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  };
}

/**
 * The overlay adapter's source, with "Save as defaults" wired to the notes
 * file. Landing an overlay variant means copying files over the real ones,
 * which is the agent's move (`variant promote`), so the button does what the
 * host with its own axes does: it files one `[set-defaults]` note naming the reviewer's picks
 * across every selector on the route, and the agent promotes those. The
 * other variants are untouched; only an explicit ask removes a variant.
 * Without a notes endpoint there is nobody to file to, and the row stays
 * hidden.
 */
function overlaySourceWithSave(
  getRoute: () => string,
  endpoint: string | undefined,
  key: string | undefined,
): VariantsSource {
  const source = createOverlayVariantsSource({ endpoint: VARIANTS_ENDPOINT, getRoute });
  if (!endpoint) return source;
  const notes = createIterationStore({ endpoint, key });
  source.saveDefaults = async (selections) => {
    // In axis order, so the note reads top to bottom like the panel did.
    const picked = source
      .getAxes()
      // Knobs are numbers, not alternatives; they ride in their own clause below.
      .filter((axis) => axis.kind === undefined || axis.kind === 'select')
      .flatMap((axis) => {
        const id = selections[axis.id];
        if (!id || id === OVERLAY_DEFAULT_OPTION) return [];
        const variant = source.list?.variants.find((v) => v.id === id);
        const label = variant?.label ?? id;
        // The group names the element and the variant names the alternative;
        // a lone variant whose group is named after it needs no prefix.
        const named = axis.label === label ? label : `${axis.label}: ${label}`;
        return [{ id, named, element: variant?.element ?? null }];
      });
    // Knobs the reviewer moved off their defaults ride in the same note, as
    // the value the panel showed, so the agent can write the number in.
    const moved = knobDelta(source.knobs.axes, source.knobs.values);
    // Only the decision, nothing about the other variants: they stay until
    // the reviewer says otherwise, in their own words.
    const parts: string[] = [];
    if (picked.length) {
      parts.push(`Make the default: ${picked.map((p) => `"${p.named}" (${p.id})`).join('; ')}.`);
    }
    if (moved.length) {
      parts.push(`Knobs: ${moved.map((m) => `${m.axis.label} ${m.shown} (${m.axis.id})`).join('; ')}.`);
    }
    const feedback = parts.length
      ? `[set-defaults] ${parts.join(' ')}`
      : '[set-defaults] The current defaults stay on this route.';
    await notes.saveNote(
      getRoute(),
      feedback,
      picked[0]?.element ?? null,
      null,
      {
        variants: picked.length ? picked.map((p) => p.id).join(', ') : OVERLAY_DEFAULT_OPTION,
        ...(moved.length
          ? { knobs: moved.map((m) => `${m.axis.id}:${m.value}`).join(', ') }
          : {}),
      },
      { w: window.innerWidth, h: window.innerHeight },
    );
  };
  return source;
}
