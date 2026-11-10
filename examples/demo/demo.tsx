import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Gem, Moon, Play, Plus, Search, Sun } from 'lucide-react';
import { createVariantsSource, IsotonePanel, type IsotoneTheme, type VariantAxis } from '../../src/react/index';
import { Tour, tourSeen } from './tour';

const params = new URLSearchParams(location.search);
// The public demo is a static build: no dev server, so notes live in this
// browser and the Agent buttons edit them here instead of on disk.
const hosted = import.meta.env.MODE === 'hosted';
const HOSTED_KEY = 'isotone-hosted-demo-v2';
const capture = params.get('capture');
const screenshot = capture === 'light' || capture === 'dark';
const review = params.get('review') === '1';
// README image scenes: `focus` (feedback panel), `both` (variants and feedback), `pin` (select mode).
const scene = screenshot ? (params.get('scene') ?? 'focus') : null;
const page = params.get('route') ?? '/';
const stress = !screenshot && !hosted && params.get('stress') === '1';
const session = screenshot ? capture : hosted ? 'hosted' : stress ? 'stress' : 'interactive';
const endpoint = `/demo-notes/${session}`;
/** A miniature of the overview cards in one layout, used as a thumbnail. Cards are
 *  [x, y, w, h] in a 150 × 72 box; the drawing stays centred above the label the
 *  panel puts bottom left. */
function layoutThumb(cards: [number, number, number, number][]): string {
  const shapes = cards
    .map(
      ([x, y, w, h]) =>
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#8b8e99" fill-opacity=".14" stroke="#8b8e99" stroke-opacity=".7"/>` +
        `<rect x="${x + 4}" y="${y + 4}" width="${Math.min(14, w - 8)}" height="2.5" rx="1.25" fill="#8b8e99"/>`,
    )
    .join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 72">${shapes}</svg>`)}`;
}
/** Selectors sit in sections named by a label prefix ("Cards > Layout"). The README
 *  capture keeps its two plain selectors for a compact composition. */
const named = (section: string, label: string, plain: string) => (screenshot ? plain : `${section} > ${label}`);
const axes: VariantAxis[] = [
  {
    id: 'layout',
    label: named('Cards', 'Layout', 'Card layout'),
    defaultOption: 'row',
    options: [
      {
        id: 'row',
        label: 'Row',
        image: layoutThumb([
          [33, 12, 26, 32],
          [62, 12, 26, 32],
          [91, 12, 26, 32],
        ]),
      },
      {
        id: 'feature',
        label: 'Feature',
        image: layoutThumb([
          [33, 9, 84, 18],
          [33, 30, 41, 15],
          [76, 30, 41, 15],
        ]),
      },
      {
        id: 'sidebar',
        label: 'Sidebar',
        image: layoutThumb([
          [33, 9, 41, 36],
          [76, 9, 41, 16.5],
          [76, 28.5, 41, 16.5],
        ]),
      },
      {
        id: 'list',
        label: 'List',
        image: layoutThumb([
          [33, 9, 84, 10],
          [33, 22, 84, 10],
          [33, 35, 84, 10],
        ]),
      },
    ],
  },
  {
    id: 'spacing',
    label: named('Cards', 'Spacing', 'Spacing'),
    defaultOption: 'compact',
    options: [
      { id: 'compact', label: 'Compact' },
      { id: 'comfy', label: 'Comfy' },
      { id: 'spacious', label: 'Spacious' },
    ],
  },
  {
    id: 'accent',
    label: named('Theme', 'Accent colour', 'Accent colour'),
    kind: 'color',
    defaultColor: '#6687ff',
    swatches: [
      { id: 'blue', label: 'Blue', value: '#6687ff' },
      { id: 'green', label: 'Green', value: '#63b990' },
      { id: 'amber', label: 'Amber', value: '#dfae5e' },
      { id: 'rose', label: 'Rose', value: '#dd7f9a' },
      { id: 'violet', label: 'Violet', value: '#a18be0' },
    ],
  },
];
axes.push({
  id: 'card-radius',
  label: named('Cards', 'Corner radius', 'Card radius'),
  kind: 'range',
  min: 0,
  max: 24,
  step: 1,
  defaultValue: 11,
  unit: 'px',
});
if (!screenshot)
  axes.push({ id: 'card-padding', label: 'Cards > Padding', kind: 'range', min: 8, max: 32, step: 2, defaultValue: 18, unit: 'px' });
if (stress) {
  const startingAxes = axes.length;
  // Sections of a dozen, one written as an explicit `section` with a long name;
  // the long label stays unsectioned, so it sits above every section.
  for (let index = startingAxes; index < 500; index++) {
    const area = Math.floor((index - startingAxes - 1) / 12);
    axes.push({
      id: `decision-${index}`,
      ...(index === startingAxes
        ? { label: `Long label ${'without any room to wrap '.repeat(40)}` }
        : area === 1
          ? { label: `Decision ${index + 1}`, section: `Section with a long name ${'that keeps on going '.repeat(12)}` }
          : { label: `Area ${area + 1} > Decision ${index + 1}` }),
      defaultOption: 'option-0',
      options: Array.from({ length: index % 25 === 0 ? 50 : 4 }, (_, option) => ({
        id: `option-${option}`,
        label: option === 3 ? `Alternative ${'withaverylongunbrokenlabel'.repeat(8)}` : `Option ${option + 1}`,
      })),
    });
  }
}
// Dev only: `?data=worst` adds segmented selectors with every option count and label shape we have seen in projects.
const worst = !screenshot && !hosted && params.get('data') === 'worst';
if (worst) {
  const choice = (id: string, label: string, labels: string[], defaultIndex = 0) =>
    axes.push({
      id: `worst-${id}`,
      label: `Worst case > ${label}`,
      defaultOption: `o${defaultIndex}`,
      options: labels.map((option, index) => ({ id: `o${index}`, label: option })),
    });
  choice('one', 'One option', ['Default']);
  choice('two-long', 'Two long options', ['Follows the cursor and stays pinned', 'Pinned to the top-left corner']);
  choice('three', 'Legend position', ['Default', 'Below the labels', 'Above the labels']);
  choice('three-short', 'Chart settings', ['Default', 'Icon menus', 'Icon toggles']);
  choice('four', 'Running list', ['Default', 'Follows, pins, by kind', 'Follows the cursor', 'Follows and pins']);
  choice('five-short', 'Size', ['XS', 'S', 'M', 'L', 'XL'], 2);
  choice('five-mixed', 'Gridlines', ['Off', 'Dots', 'Dashed lines', 'Solid gridlines', 'Alternating bands'], 3);
  choice('seven', 'Week starts on', ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  choice('twelve', 'Month', ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], 10);
  choice('compound', 'Settings label', ['Standard', 'Benachrichtigungseinstellungen']);
  choice('translated', 'Privacy copy', ['Défaut', 'Paramètres de confidentialité et de sécurité avancés', 'Court'], 1);
  choice('scripts', 'Script', ['日本語', 'العربية', 'Ελληνικά', 'Tiếng Việt'], 2);
  choice('emoji', 'Mood', ['🔥 Hot', '❄️ Cold', '🌤️ Mild', '🌧️ Wet', '🌪️ Wild', '🌈 After']);
  choice('six-long', 'Empty state', [
    'Illustration',
    'Illustration and a call to action',
    'Text only',
    'Text and link',
    'Skeleton rows',
    'Nothing',
  ]);
}
const source = createVariantsSource({
  axes,
  selections: { spacing: 'comfy' },
  // Hold to compare. onChange applies every call; it stores nothing, so a preview (change.preview) needs no
  // special case here. An app that keeps picks in its URL or storage skips that step when change.preview is true.
  compare: true,
  onChange(selections) {
    document.documentElement.dataset.spacing = selections.spacing;
    document.documentElement.dataset.layout = selections.layout;
    document.documentElement.style.setProperty('--accent', selections.accent ?? null);
    for (const id of ['card-radius', 'card-padding']) {
      if (selections[id] !== undefined) document.documentElement.style.setProperty(`--${id}`, `${selections[id]}px`);
      else document.documentElement.style.removeProperty(`--${id}`);
    }
  },
  async saveDefaults(selections) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        route: '/',
        feedback: '[set-defaults] Use the current design settings.',
        payload: { playground: selections },
      }),
    });
    if (!response.ok) throw new Error('Could not save defaults.');
  },
});

type DemoNote = Record<string, unknown> & {
  id: string;
  route: string;
  feedback: string;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
  workingAt?: string;
};
function readHostedNotes(): DemoNote[] {
  try {
    return JSON.parse(localStorage.getItem(HOSTED_KEY) ?? '[]') as DemoNote[];
  } catch {
    return [];
  }
}
function writeHostedNotes(notes: DemoNote[]) {
  try {
    localStorage.setItem(HOSTED_KEY, JSON.stringify(notes));
  } catch {
    /* Private mode: the demo runs, notes just don't stick. */
  }
}
function seedHostedNotes() {
  const seed: [string, string, string][] = [
    ['/', 'Give the cards a little more room.', 'Overview cards'],
    ['/', 'Shorten this to "Active".', 'Active projects'],
  ];
  writeHostedNotes(
    seed.map(([route, feedback, text], index) => ({
      id: `seed-${index}`,
      route,
      feedback,
      element: { tag: 'section', text, selector: '#overview-cards' },
      done: false,
      doneAt: null,
      createdAt: new Date(Date.now() - (seed.length - index) * 60_000).toISOString(),
    })),
  );
}
/**
 * The notes endpoint, answered inside the page for the static hosted build.
 * It follows the dev server's contract closely enough for the real panel code
 * to run unchanged, polling included, with localStorage standing in for the file.
 */
function serveNotesInPage(path: string) {
  const network = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.pathname !== path) return network(input, init);
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const query = url.searchParams;
    const method = (init?.method ?? 'GET').toUpperCase();
    const notes = readHostedNotes();
    if (method === 'GET') {
      let raw = '';
      try {
        raw = localStorage.getItem(HOSTED_KEY) ?? '';
      } catch {
        /* Empty. */
      }
      let hash = 0;
      for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
      const rev = `${raw.length}.${(hash >>> 0).toString(36)}`;
      const polled = query.has('rev');
      if (polled && query.get('rev') === rev) return reply(200, { rev, unchanged: true });
      const route = query.get('route');
      const rows = (
        query.get('all') && query.get('all') !== '0' ? notes : route ? notes.filter((n) => n.route === route) : notes.filter((n) => !n.done)
      ).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return reply(200, polled ? { rev, notes: rows } : rows);
    }
    if (method === 'DELETE') {
      writeHostedNotes(notes.filter((n) => n.id !== query.get('id')));
      return reply(200, { ok: true });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Partial<DemoNote> & { elements?: unknown[]; element?: unknown };
    const feedback = String(body.feedback ?? '').trim();
    if (!body.route || !feedback) return reply(400, { error: 'route and feedback are required' });
    const fields = Object.fromEntries(
      ['element', 'elements', 'variant', 'variantAction', 'payload', 'viewport']
        .filter((key) => body[key] !== undefined)
        .map((key) => [key, body[key]]),
    );
    // Like the server, a new "save as defaults" replaces the open one on its page.
    const defaults =
      feedback.startsWith('[set-defaults]') && !notes.some((n) => n.id === body.id)
        ? notes.find((n) => !n.done && n.route === body.route && n.feedback.startsWith('[set-defaults]'))
        : undefined;
    const existing = notes.find((n) => n.id === (defaults?.id ?? body.id));
    if (existing) {
      Object.assign(existing, fields, { feedback }, defaults ? { createdAt: new Date().toISOString() } : {});
      writeHostedNotes(notes);
      return reply(200, { id: existing.id });
    }
    const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
    writeHostedNotes([
      ...notes,
      {
        ...fields,
        id,
        route: body.route,
        feedback,
        element: body.element ?? null,
        done: false,
        doneAt: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    return reply(201, { id });
  };
}
/** `?update-preview=1`: a fictional release. The demo never contacts npm. */
const updatePreview = !screenshot && params.has('update-preview');
const updateEndpoint = `/demo-update/${session}`;
const DEMO_UPDATE = {
  currentVersion: '1.1.3',
  latestVersion: '1.2.0',
  status: 'available',
  upgrade: { manager: 'pnpm', command: 'pnpm add -D --exact isotone@1.2.0', cwd: '/workspace/example-app' },
} as const;
/**
 * The update endpoint for the hosted build. Like the dev server, it builds the
 * update note itself and keeps at most one open.
 */
function serveUpdateInPage(path: string) {
  const network = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.pathname !== path) return network(input, init);
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if ((init?.method ?? 'GET').toUpperCase() === 'GET') return reply(200, DEMO_UPDATE);
    const notes = readHostedNotes();
    const open = notes.find((n) => !n.done && n.update);
    if (open) return reply(200, { id: open.id, created: false });
    const { currentVersion: from, latestVersion: to, upgrade } = DEMO_UPDATE;
    const route = String((JSON.parse(String(init?.body ?? '{}')) as { route?: unknown }).route ?? '/');
    const id = crypto.randomUUID();
    writeHostedNotes([
      ...notes,
      {
        id,
        route,
        feedback: `Update Isotone ${from} → ${to}`,
        element: null,
        done: false,
        doneAt: null,
        createdAt: new Date().toISOString(),
        update: { from, to, command: upgrade.command, cwd: upgrade.cwd, manager: upgrade.manager },
      },
    ]);
    return reply(201, { id, created: true });
  };
}
if (hosted && !screenshot) {
  try {
    if (localStorage.getItem(HOSTED_KEY) === null) seedHostedNotes();
  } catch {
    /* No storage. */
  }
  serveNotesInPage(endpoint);
  if (updatePreview) serveUpdateInPage(updateEndpoint);
}
/**
 * A pretend coding agent. A moment after a note is sent it marks it as being
 * worked on, like `isotone --working`, and a few seconds later closes it, like
 * `--done`. The tour listens to the same events.
 */
function runPretendAgent() {
  void clearStaleWorking();
  const network = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await network(input, init);
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    // An update request is a note too: the agent picks it up the same way.
    if (![endpoint, updateEndpoint].includes(url.pathname) || (init?.method ?? 'GET').toUpperCase() !== 'POST' || response.status !== 201)
      return response;
    const { id } = (await response.clone().json()) as { id: string };
    const feedback =
      url.pathname === updateEndpoint
        ? '[update]'
        : String((JSON.parse(String(init?.body ?? '{}')) as { feedback?: string }).feedback ?? '');
    window.dispatchEvent(new CustomEvent('demo:note', { detail: { id, action: feedback.startsWith('[') } }));
    setTimeout(() => void agentStep(id, 'working'), 1600);
    setTimeout(() => void agentStep(id, 'done'), 6400);
    return response;
  };
}
/**
 * The pretend agent lives in this page, so a note it was working on when the
 * page last closed will never be finished. On load, nothing is in progress.
 */
async function clearStaleWorking() {
  if (hosted) {
    const notes = readHostedNotes();
    if (notes.some((note) => note.workingAt)) writeHostedNotes(notes.map(({ workingAt: _stale, ...note }) => note));
    return;
  }
  await fetch(`/demo-agent?action=reset&session=${session}`, { method: 'POST' });
}
async function agentStep(id: string, state: 'working' | 'done') {
  if (hosted) {
    const notes = readHostedNotes();
    const note = notes.find((n) => n.id === id && !n.done);
    if (!note) return;
    if (state === 'working') note.workingAt = new Date().toISOString();
    else {
      note.done = true;
      note.doneAt = new Date().toISOString();
      delete note.workingAt;
    }
    writeHostedNotes(notes);
  } else {
    await fetch(`/demo-agent?action=${state === 'working' ? 'start' : 'finish'}&id=${encodeURIComponent(id)}`, { method: 'POST' });
  }
  window.dispatchEvent(new CustomEvent('demo:agent', { detail: { id, state } }));
}
if (!screenshot) runPretendAgent();

function savedTheme<T extends string>(key: string, choices: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return choices.find((choice) => choice === saved) ?? fallback;
  } catch {
    return fallback;
  }
}

function Panel({ theme }: { theme: IsotoneTheme }) {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<ReturnType<typeof createRoot> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const shadow = host.current.attachShadow({ mode: 'open' });
    if (screenshot) {
      const style = document.createElement('style');
      // Select mode draws fixed outlines and a hint, which a scaled root would displace.
      // The defaults bar floats over the last selector until the list is scrolled; the still image shows the
      // list as it sits when scrolled clear of the bar.
      style.textContent = `${scene === 'pin' ? '' : '.isotone-root { transform: scale(1.1); transform-origin: bottom right; right: 22px; bottom: 22px; }'} .isotone-textarea { caret-color: transparent; } .isotone-vars[data-saving='true'] > .isotone-vars-body { padding-bottom: calc(var(--iso-save-bar-h) - var(--iso-space)); }`;
      shadow.append(style);
    }
    const target = document.createElement('div');
    shadow.append(target);
    panel.current = createRoot(target);
    return () => {
      const mounted = panel.current;
      panel.current = null;
      queueMicrotask(() => mounted?.unmount());
    };
  }, []);
  useEffect(() => {
    panel.current?.render(
      <IsotonePanel
        route={page}
        theme={theme}
        updateEndpoint={updatePreview ? updateEndpoint : screenshot || hosted ? undefined : '/api/isotone/update'}
        store={{ endpoint, key: `isotone-public-demo-${session}` }}
        variants={source}
        defaultTab="variants"
        shortcut={screenshot ? false : undefined}
      />,
    );
  }, [theme]);
  useEffect(() => {
    if (!screenshot && !review) return;
    // Wait for the secondary root, then open the feedback panel alone.
    let frame = 0;
    const open = () => {
      const shadow = host.current?.shadowRoot;
      const launcher = shadow?.querySelector<HTMLButtonElement>('.isotone-fab');
      if (!launcher) {
        frame = requestAnimationFrame(open);
        return;
      }
      // The existing keyboard path makes both CSS and measured motion immediate.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft' }));
      launcher.click();
      frame = requestAnimationFrame(() => {
        const feedback = shadow?.querySelector<HTMLButtonElement>('.isotone-rail-button[aria-label^="Feedback"]');
        const variants = shadow?.querySelector<HTMLButtonElement>('.isotone-rail-button[aria-label^="Variants"]');
        if (feedback?.getAttribute('aria-expanded') !== 'true') feedback?.click();
        const wantVariants = scene === 'both';
        if ((variants?.getAttribute('aria-expanded') === 'true') !== wantVariants) variants?.click();
        frame = requestAnimationFrame(() => {
          if (scene === 'pin') pinScene(shadow);
          else (shadow?.activeElement as HTMLElement | null)?.blur();
          document.documentElement.dataset.previewReady = 'true';
        });
      });
    };
    frame = requestAnimationFrame(open);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={host} data-isotone="demo" />;
}

/** Select mode mid-flow: one card pinned and a note being typed. */
function pinScene(shadow: ShadowRoot | null | undefined) {
  // A pointer click on Feedback starts select mode by itself, and pressing the button again would end it.
  if (shadow?.querySelector<HTMLElement>('.isotone-root')?.dataset.selecting !== 'true')
    shadow?.querySelector<HTMLButtonElement>('[aria-label="Select elements"]')?.click();
  const first = document.querySelector<HTMLElement>('#overview-cards article');
  // Give select mode a moment to attach its listeners before the scripted pointer acts.
  setTimeout(() => {
    const r = first?.getBoundingClientRect();
    // Aim at the chart, which lets clicks through to the card itself.
    if (r)
      first?.dispatchEvent(
        new MouseEvent('click', { clientX: r.left + r.width / 2, clientY: r.bottom - 20, bubbles: true, composed: true, detail: 1 }),
      );
    // The composer moves next to the card on the next render; type into it there.
    requestAnimationFrame(() => {
      const textarea = shadow?.querySelector<HTMLTextAreaElement>('.isotone-float textarea');
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (textarea && setValue) {
        setValue.call(textarea, 'Give this card more room');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }, 300);
}

/**
 * A host dropdown like most UI libraries make: it opens on pointerdown, closes
 * on any outside press, and has a page-wide `/` shortcut that ignores typing in
 * the page's own fields. Select mode pins it without opening it, and typing `/`
 * in Isotone's composer stays in the composer.
 */
function NewProjectMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== '/' || target.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!event.composedPath().includes(wrap.current as EventTarget)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('mousedown', close);
    };
  }, [open]);
  return (
    <div className="new-project-wrap" ref={wrap}>
      <button
        className="button button-primary new-project"
        type="button"
        aria-expanded={open}
        title="New project ( / )"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          setOpen((v) => !v);
        }}
        // Enter and Space still open it from the keyboard.
        onClick={(event) => {
          if (event.detail === 0) setOpen((v) => !v);
        }}
      >
        <Plus size={14} />
        New project
      </button>
      {open && (
        <div className="demo-menu" role="menu">
          {['Blank project', 'From template', 'Import from file'].map((item) => (
            <button key={item} type="button" role="menuitem" onClick={() => setOpen(false)}>
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GitHubMark() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** A small trend line under a stat; decoration only. */
function Sparkline() {
  const points = [14, 18, 16, 22, 21, 27, 25, 31, 30, 36];
  const path = points.map((y, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * 100} ${40 - y}`).join(' ');
  return (
    <svg className="stat-viz spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${path} L100 40 L0 40 Z`} className="spark-fill" />
      <path d={path} className="spark-line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
function WeekBars() {
  return (
    <div className="stat-viz bars" aria-hidden="true">
      {[42, 58, 50, 71, 64, 88, 76].map((h) => (
        <i key={h} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}
function Faces() {
  return (
    <div className="stat-viz faces" aria-hidden="true">
      {['#e4a37b', '#7aa7e0', '#9fd0a8', '#c99be0', '#e0c27a'].map((c) => (
        <i key={c} style={{ background: c }} />
      ))}
      <i className="faces-more" />
    </div>
  );
}

const projects: [string, string, number, string, string][] = [
  ['Website refresh', 'Design', 0.64, 'Oct 28', 'In progress'],
  ['Mobile experience', 'Product', 0.82, 'Nov 4', 'In review'],
  ['Component library', 'Engineering', 1, 'Oct 16', 'Ready'],
  ['Billing migration', 'Engineering', 0.18, 'Dec 2', 'Planned'],
];

function Demo() {
  const [pageTheme, setPageTheme] = useState<'light' | 'dark'>(() =>
    screenshot ? capture : savedTheme('iso-demo-page', ['light', 'dark'], 'dark'),
  );
  const [panelTheme, setPanelTheme] = useState<IsotoneTheme>(() =>
    screenshot ? 'auto' : savedTheme('iso-demo-panel', ['auto', 'system', 'light', 'dark'], 'auto'),
  );
  // Every first visit starts with the tour. The Tour button brings it back.
  const [touring, setTouring] = useState(() => !screenshot && !review && !stress && (params.get('tour') === '1' || !tourSeen()));
  useEffect(() => {
    document.documentElement.dataset.theme = pageTheme;
    document.documentElement.dataset.capture = String(screenshot);
    if (scene) document.documentElement.dataset.scene = scene;
    document.documentElement.dataset.spacing = source.getSelections().spacing;
    document.documentElement.dataset.layout = source.getSelections().layout;
  }, [pageTheme]);
  useEffect(() => {
    if (screenshot) return;
    try {
      localStorage.setItem('iso-demo-page', pageTheme);
      localStorage.setItem('iso-demo-panel', panelTheme);
    } catch {
      /* Theme controls still work without storage. */
    }
  }, [pageTheme, panelTheme]);
  return (
    <>
      {!screenshot && (
        <header className="demo-bar">
          <a href={hosted ? 'https://github.com/aaroi/isotone' : '/'} className="brand">
            <Gem size={15} strokeWidth={1.75} />
            Isotone
          </a>
          <span className="demo-bar-note">
            <span>{stress ? 'Stress test · 500 selectors and 500 notes' : 'Demo. The page below stands in for your app.'}</span>
          </span>
          <div className="demo-bar-actions">
            {!hosted && (
              <>
                <label className="demo-select">
                  Panel{' '}
                  <select value={panelTheme} onChange={(event) => setPanelTheme(event.target.value as IsotoneTheme)}>
                    {(['auto', 'system', 'light', 'dark'] as const).map((theme) => (
                      <option key={theme}>{theme}</option>
                    ))}
                  </select>
                </label>
                <a className="button button-ghost" href="/preview.html">
                  Screenshot view
                </a>
                <a className="button button-ghost" href={stress ? '/' : '/?stress=1'}>
                  {stress ? 'Normal demo' : 'Stress test'}
                </a>
              </>
            )}
            <button type="button" className="button button-ghost" onClick={() => setTouring(true)} disabled={touring}>
              <Play size={13} />
              Tour
            </button>
            <button
              type="button"
              className="button button-icon"
              aria-label={pageTheme === 'dark' ? 'Light page' : 'Dark page'}
              title={pageTheme === 'dark' ? 'Light page' : 'Dark page'}
              onClick={() => setPageTheme(pageTheme === 'dark' ? 'light' : 'dark')}
            >
              {pageTheme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <a className="button button-icon" href="https://github.com/aaroi/isotone" aria-label="GitHub" title="GitHub">
              <GitHubMark />
            </a>
          </div>
        </header>
      )}
      <div className="app">
        <header className="app-header">
          <span className="app-logo">
            <span className="app-mark">L</span>Lumen
          </span>
          <nav className="app-tabs" aria-label="Lumen">
            {['Overview', 'Projects', 'Reports', 'Team'].map((tab) => (
              <span key={tab} aria-current={tab === 'Overview' ? 'page' : undefined}>
                {tab}
              </span>
            ))}
          </nav>
          <div className="app-header-actions">
            <button type="button" className="button button-icon" aria-label="Search" title="Search">
              <Search size={15} />
            </button>
            <span className="avatar" aria-hidden="true">
              SR
            </span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <h1>Overview</h1>
              <p className="page-description">Week 42 · 4 projects, 2 due this month</p>
            </div>
            <NewProjectMenu />
          </div>
          <section id="overview-cards" className="overview-cards" aria-label="Overview cards">
            {(
              [
                ['Active projects', '12', '+2', 'this month', <Sparkline key="s" />],
                ['Tasks complete', '248', '', 'Looking good', <WeekBars key="b" />],
                ['Team members', '8', '', 'All connected', <Faces key="f" />],
              ] as const
            ).map(([label, value, delta, detail, viz]) => (
              <article key={label}>
                <p>{label}</p>
                <strong>{value}</strong>
                <small>
                  {delta && <b>{delta}</b>}
                  {delta ? ` ${detail}` : detail}
                </small>
                {viz}
              </article>
            ))}
          </section>
          <div className="section-heading">
            <h2>Projects</h2>
            <span>View all</span>
          </div>
          <section className="projects" aria-label="Projects">
            <div className="projects-head" aria-hidden="true">
              <span>Name</span>
              <span>Team</span>
              <span>Progress</span>
              <span>Due</span>
              <span>Status</span>
            </div>
            {projects.map(([title, team, progress, due, status]) => (
              <article key={title}>
                <strong>{title}</strong>
                <small className="project-team">{team}</small>
                <span className="project-progress">
                  <span className="bar">
                    <i style={{ width: `${progress * 100}%` }} />
                  </span>
                  {Math.round(progress * 100)}%
                </span>
                <span className="project-due">{due}</span>
                <span className="status" data-status={status.toLowerCase().replace(' ', '-')}>
                  {status}
                </span>
              </article>
            ))}
          </section>
          {!screenshot && !hosted && (
            <p className="demo-hint">
              Notes sent here go to a temporary file and a pretend agent picks each one up a moment later. New project opens on press and on{' '}
              <kbd>/</kbd>, like many app menus: in select mode a click pins it without opening it, and <kbd>/</kbd> typed in the composer
              stays there. Shift-click to use the page while selecting. Selectors take arrow keys, and Shift+F10 opens an option's actions.
              Hold the key under Escape (<kbd>`</kbd> or <kbd>§</kbd>) to see the page at its defaults.
            </p>
          )}
        </main>
      </div>
      <Panel theme={panelTheme} />
      {touring && <Tour onClose={() => setTouring(false)} subscribeVariants={subscribeVariants} />}
    </>
  );
}
/** Calls back when a selection changes, which is what the tour waits for. */
function subscribeVariants(listener: () => void) {
  let last = JSON.stringify(source.getSelections());
  return source.subscribe(() => {
    const now = JSON.stringify(source.getSelections());
    if (now !== last) {
      last = now;
      listener();
    }
  });
}

const mount = document.getElementById('demo');
if (mount) createRoot(mount).render(<Demo />);

// Dev-only data switch, plain chrome kept out of the panel's corner.
if (!screenshot && !hosted) {
  const bar = document.createElement('div');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Demo data');
  bar.style.cssText =
    'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:10;display:flex;gap:2px;padding:2px;border-radius:8px;background:#e4e4e7;font:12px system-ui,sans-serif;box-shadow:0 1px 2px #0002';
  for (const [value, text] of [
    [null, 'Demo data'],
    ['worst', 'Worst case'],
  ] as const) {
    const link = document.createElement('a');
    const next = new URLSearchParams(location.search);
    if (value) next.set('data', value);
    else next.delete('data');
    link.href = `?${next}`;
    link.textContent = text;
    const on = (params.get('data') ?? null) === value;
    link.style.cssText = `padding:4px 10px;border-radius:6px;color:#18181b;text-decoration:none;${on ? 'background:#fff;box-shadow:0 1px 2px #0002' : 'opacity:.7'}`;
    bar.append(link);
  }
  document.body.append(bar);
}
