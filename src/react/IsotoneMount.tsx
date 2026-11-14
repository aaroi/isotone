import { createRoot } from 'react-dom/client';

import { createIsotoneStore } from '../core/notes-client';
import {
  axisSection,
  createOverlayVariantsSource,
  knobDelta,
  OVERLAY_DEFAULT_OPTION,
  type VariantSelections,
  type VariantsSource,
  VARIANTS_ENDPOINT,
  visibleAxes,
} from '../core/variants';
import { combineSources } from '../core/variants/combine';
import { IsotonePanel } from './IsotonePanel';
import { ensurePanelStyles } from './styles/panel';
import type { MountIsotoneOptions } from '../core/types';

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
 * Self-mount the Isotone panel into a shadow root on `document.body`,
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
 * The host element carries `data-isotone`, and that is load-bearing:
 * `document.elementFromPoint` retargets to the host for anything inside a
 * shadow root, so the element picker's self-exclusion matches on it.
 *
 * The host is created at runtime by `mountIsotone` (never part of any HTML
 * React hydrates) and is watched by a MutationObserver: if a whole-document
 * render — a React Router hydration failure made worse by an extension, for
 * instance — replaces `<body>` and drops the host, it is re-appended to the
 * new body, shadow root and all, instead of a fresh mount losing panel state.
 */
/** `isotone serve` cannot swap files, so its empty list asks for knobs. */
const KNOBS_EMPTY_TEXT =
  'No knobs on this page yet. Ask your agent to add knobs for this page to .isotone/knobs.json and they will appear here.';

/** The notes path of an Isotone server (the Vite plugin, `isotone serve`), which serves knobs beside it. */
const ISOTONE_NOTES = /\/api\/isotone\/notes\/?$/;

export function mountIsotone(opts: MountIsotoneOptions): () => void {
  const getRoute = opts.getRoute ?? (() => window.location.pathname);
  const app = typeof opts.variants === 'object' && opts.variants !== null ? opts.variants : undefined;
  // Knobs and file variants come from the Isotone server, beside a host's own
  // selectors too: the server that answers notes serves them next door.
  const overlayEndpoint = app
    ? (opts.variantsEndpoint ??
      (opts.endpoint && ISOTONE_NOTES.test(opts.endpoint) ? opts.endpoint.replace(ISOTONE_NOTES, VARIANTS_ENDPOINT) : undefined))
    : opts.variants
      ? (opts.variantsEndpoint ?? VARIANTS_ENDPOINT)
      : undefined;
  // A knob whose id the host's own selectors have would style the page under the host's control: left out.
  const takenIds = app ? () => app.getAxes().map((axis) => axis.id) : undefined;
  const overlay = overlayEndpoint ? createOverlayVariantsSource({ endpoint: overlayEndpoint, getRoute, takenIds }) : null;
  // A wrapper this mount owns, so Make default can be added without changing the host's source.
  const combined =
    app && overlay ? combineSources([app, overlay]) : app && opts.endpoint && !app.saveDefaults ? combineSources([app]) : null;
  const variants: VariantsSource | undefined = combined ?? app ?? overlay ?? undefined;
  if (opts.endpoint && variants && variants !== app)
    variants.saveDefaults = defaultsNote(variants, app, overlay, getRoute, opts.endpoint, opts.key);
  // Nothing to show: no notes to write and no variants to pick. A production
  // host that forgot its source gets no empty launcher in the corner.
  if (!opts.endpoint && !variants) return () => {};
  // A variants-only host whose source has no axes on this page and no way to
  // get some later (no `refresh`) would mount an empty shadow root on every
  // such page. A hosted preview site is exactly that on axis-less
  // experiments, so skip the mount rather than leave a hollow host div.
  if (!opts.endpoint && variants && variants.getAxes().length === 0 && typeof (variants as { refresh?: unknown }).refresh !== 'function') {
    return () => {};
  }

  // A host whose selectors arrive later (loaded, or per route) may take a knob's id after the knobs applied.
  const offTaken = app && overlay ? app.subscribe(() => overlay.takenChanged()) : null;

  const host = document.createElement('div');
  host.setAttribute('data-isotone', 'root');
  const attachHost = () => {
    if (!host.isConnected) document.body.appendChild(host);
    return host;
  };
  attachHost();
  const shadow = host.attachShadow({ mode: 'open' });
  // Eagerly, so the panel never paints one frame unstyled.
  ensurePanelStyles(shadow);
  const root = withDocumentUntouched(() => createRoot(shadow));

  // Re-attach the host if a full-document render evicts it from body. In a
  // whole-document React Router app an extension-triggered hydration failure
  // makes React replace `document.body` wholesale; our host (appended at
  // runtime, never part of what React rendered) falls away with the old body.
  // Re-appending the SAME element restores the panel with its shadow root and
  // state intact — no second render, no duplication. The observer is on
  // `<html>` so a bare `body.replaceChildren()` also counts as a change; body
  // alone catches appendChild-of-a-new-body but not replaceChildren.
  const guard = new MutationObserver(() => {
    if (disposed) return;
    if (!host.isConnected) attachHost();
  });
  guard.observe(document.documentElement, { childList: true, subtree: true });

  function render() {
    root.render(
      <IsotonePanel
        route={getRoute()}
        store={{ endpoint: opts.endpoint, key: opts.key }}
        rule={opts.rule}
        getPayload={opts.getPayload}
        variants={variants}
        variantsEmptyText={opts.variants === 'knobs' ? KNOBS_EMPTY_TEXT : undefined}
        defaultTab={opts.defaultTab}
        shortcut={opts.shortcut}
        compareShortcut={opts.compareShortcut}
        updateEndpoint={opts.updateEndpoint}
        theme={opts.theme}
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
      if (disposed) return;
      // Knobs live on <html>, outside the panel: move them to the new route's set.
      overlay?.routeChanged();
      render();
    }, 0);
  };

  // Deferred, not synchronous — the host may call mountIsotone from an
  // effect (a React host mounts it from one), and a synchronous secondary root
  // render fires React 19 dev's "useInsertionEffect must not schedule
  // updates" because it commits while the host's own commit is in flight.
  // One macrotask later the host has settled; the panel simply mounts a
  // frame later, which is invisible because the host element starts empty.
  setTimeout(() => {
    if (disposed) return;
    render();
    // The panel loads knobs as it opens, or at once when it has nothing to show. Beside a host's
    // selectors it has, so load them here: stored knob values apply from the first paint.
    if (app && overlay) void overlay.refresh().catch(() => {});
    window.addEventListener('popstate', notify);
    listeners.push(() => window.removeEventListener('popstate', notify));
    for (const evt of ['pushState', 'replaceState'] as const) {
      const orig = window.history[evt];
      const wrapper = function (this: History, ...a: Parameters<History['pushState']>) {
        const r = orig.apply(this, a);
        notify();
        return r;
      };
      window.history[evt] = wrapper;
      // A router or devtool that wrapped history after us keeps its wrapper:
      // ours stays in its chain and goes quiet once disposed.
      listeners.push(() => {
        if (window.history[evt] === wrapper) window.history[evt] = orig;
      });
    }
  }, 0);

  return () => {
    disposed = true;
    offTaken?.();
    for (const off of listeners) off();
    // The host's source outlives this mount: leave it with none of this panel's listeners.
    combined?.dispose();
    overlay?.dispose();
    guard.disconnect();
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
 * "Make default", as one `[set-defaults]` note naming the reviewer's picks
 * across every selector on the route, for the agent to land. Landing an
 * overlay variant means copying files over the real ones (`variant promote`),
 * a knob's value is written into the source, and a pick in the host's own
 * selectors is a change to the host's code. A host source's own
 * `saveDefaults` runs first with its picks; the note names them anyway, since
 * a route keeps one open `[set-defaults]` request and this one replaces any
 * the host filed. The other variants are untouched; only an explicit ask
 * removes a variant.
 */
function defaultsNote(
  source: VariantsSource,
  host: VariantsSource | undefined,
  overlay: ReturnType<typeof createOverlayVariantsSource> | null,
  getRoute: () => string,
  endpoint: string,
  key: string | undefined,
): (selections: VariantSelections) => Promise<void> {
  const notes = createIsotoneStore({ endpoint, key });
  return async (selections) => {
    const hostIds = new Set(host?.getAxes().map((axis) => axis.id));
    if (host?.saveDefaults) {
      await host.saveDefaults(Object.fromEntries(Object.entries(selections).filter(([id]) => hostIds.has(id))));
    }
    const knobs = overlay?.knobs ?? { axes: [], values: {} };
    // In axis order, so the note reads top to bottom like the panel did.
    const shown = visibleAxes(source.getAxes(), selections);
    const picked = shown
      // Knobs and the host's selectors ride in their own clauses below.
      .filter((axis) => (axis.kind === undefined || axis.kind === 'select') && !hostIds.has(axis.id) && !knobs.axes.includes(axis))
      .flatMap((axis) => {
        const id = selections[axis.id];
        if (!id || id === OVERLAY_DEFAULT_OPTION) return [];
        const variant = overlay?.list?.variants.find((v) => v.id === id);
        const label = variant?.label ?? id;
        // The group names the element and the variant names the alternative;
        // a lone variant whose group is named after it needs no prefix.
        // A section the selector sits in leads the name, as the panel groups it.
        const selector = axisSection(axis).fullLabel;
        const named = selector === label || axis.label === label ? label : `${selector}: ${label}`;
        return [{ id, named, element: variant?.element ?? null }];
      });
    // The host's selectors the reviewer moved, named as the panel showed them.
    const app = knobDelta(
      shown.filter((axis) => hostIds.has(axis.id)),
      selections,
    );
    // Knobs the reviewer moved off their defaults ride in the same note, as
    // the value the panel showed, so the agent can write the number in. Only
    // shown ones: a knob behind a host selector of its id was never in the panel.
    const moved = knobDelta(
      knobs.axes.filter((knob) => shown.includes(knob)),
      knobs.values,
    );
    // Only the decision, nothing about the other variants: they stay until
    // the reviewer says otherwise, in their own words.
    const parts: string[] = [];
    if (app.length) {
      parts.push(`App selectors: ${app.map((m) => `${axisSection(m.axis).fullLabel} → ${m.shown} (${m.axis.id})`).join('; ')}.`);
    }
    if (picked.length) {
      parts.push(`Make the default: ${picked.map((p) => `"${p.named}" (${p.id})`).join('; ')}.`);
    }
    if (moved.length) {
      parts.push(`Knobs: ${moved.map((m) => `${axisSection(m.axis).fullLabel} ${m.shown} (${m.axis.id})`).join('; ')}.`);
    }
    const feedback = parts.length ? `[set-defaults] ${parts.join(' ')}` : '[set-defaults] The current defaults stay on this route.';
    const pairs = (list: { axis: { id: string }; value: string }[]) => list.map((m) => `${m.axis.id}:${m.value}`).join(', ');
    await notes.saveNote(
      getRoute(),
      feedback,
      picked[0]?.element ?? null,
      null,
      {
        ...(overlay ? { variants: picked.length ? picked.map((p) => p.id).join(', ') : OVERLAY_DEFAULT_OPTION } : {}),
        ...(app.length ? { selectors: pairs(app) } : {}),
        ...(moved.length ? { knobs: pairs(moved) } : {}),
      },
      { w: window.innerWidth, h: window.innerHeight },
    );
  };
}
