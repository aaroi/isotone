import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createVariantsSource, IterationPanel, type IterationTheme, type VariantAxis,
} from '../../src/react/index';

const params = new URLSearchParams(location.search);
// The public demo is a static build: no dev server, so notes live in this
// browser and the Agent buttons edit them here instead of on disk.
const hosted = import.meta.env.MODE === 'hosted';
const HOSTED_KEY = 'isotone-hosted-demo';
const capture = params.get('capture');
const screenshot = capture === 'light' || capture === 'dark';
const review = params.get('review') === '1';
// README image scenes: `focus` (feedback panel), `both` (variants and feedback), `pin` (select mode).
const scene = screenshot ? params.get('scene') ?? 'focus' : null;
const page = params.get('route') ?? '/';
const stress = !screenshot && !hosted && params.get('stress') === '1';
const session = screenshot ? capture : hosted ? 'hosted' : stress ? 'stress' : 'interactive';
const endpoint = `/demo-notes/${session}`;
/** A miniature of the overview cards in one layout, used as a thumbnail. Cards are
 *  [x, y, w, h] in a 150 × 72 box; the drawing stays centred above the label the
 *  panel puts bottom left. */
function layoutThumb(cards: [number, number, number, number][]): string {
  const shapes = cards.map(([x, y, w, h]) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#8b8e99" fill-opacity=".14" stroke="#8b8e99" stroke-opacity=".7"/>` +
    `<rect x="${x + 4}" y="${y + 4}" width="${Math.min(14, w - 8)}" height="2.5" rx="1.25" fill="#8b8e99"/>`).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 72">${shapes}</svg>`)}`;
}
const axes: VariantAxis[] = [
  { id: 'layout', label: 'Card layout', defaultOption: 'row', options: [
    { id: 'row', label: 'Row', image: layoutThumb([[33, 12, 26, 32], [62, 12, 26, 32], [91, 12, 26, 32]]) },
    { id: 'feature', label: 'Feature', image: layoutThumb([[33, 9, 84, 18], [33, 30, 41, 15], [76, 30, 41, 15]]) },
    { id: 'sidebar', label: 'Sidebar', image: layoutThumb([[33, 9, 41, 36], [76, 9, 41, 16.5], [76, 28.5, 41, 16.5]]) },
    { id: 'list', label: 'List', image: layoutThumb([[33, 9, 84, 10], [33, 22, 84, 10], [33, 35, 84, 10]]) },
  ] },
  { id: 'spacing', label: 'Spacing', defaultOption: 'compact', options: [
    { id: 'compact', label: 'Compact' }, { id: 'comfy', label: 'Comfy' }, { id: 'spacious', label: 'Spacious' },
  ] },
  { id: 'accent', label: 'Accent colour', kind: 'color', defaultColor: '#6687ff', swatches: [
    { id: 'blue', label: 'Blue', value: '#6687ff' }, { id: 'green', label: 'Green', value: '#63b990' },
    { id: 'amber', label: 'Amber', value: '#dfae5e' }, { id: 'rose', label: 'Rose', value: '#dd7f9a' },
    { id: 'violet', label: 'Violet', value: '#a18be0' },
  ] },
];
axes.push({ id: 'card-radius', label: 'Card radius', kind: 'range', min: 0, max: 24, step: 1, defaultValue: 11, unit: 'px' });
if (!screenshot) axes.push(
  { id: 'card-padding', label: 'Card padding', kind: 'range', min: 8, max: 32, step: 2, defaultValue: 18, unit: 'px' },
);
if (stress) {
  const startingAxes = axes.length;
  for (let index = startingAxes; index < 500; index++) axes.push({
    id: `decision-${index}`, label: index === startingAxes ? `Long label ${'without any room to wrap '.repeat(40)}` : `Decision ${index + 1}`,
    defaultOption: 'option-0',
    options: Array.from({ length: index % 25 === 0 ? 50 : 4 }, (_, option) => ({
      id: `option-${option}`,
      label: option === 3 ? `Alternative ${'withaverylongunbrokenlabel'.repeat(8)}` : `Option ${option + 1}`,
    })),
  });
}
const source = createVariantsSource({
  axes, selections: { spacing: 'comfy' },
  onChange(selections) {
    document.documentElement.dataset.spacing = selections.spacing;
    document.documentElement.dataset.layout = selections.layout;
    document.documentElement.style.setProperty('--accent', selections.accent);
    for (const id of ['card-radius', 'card-padding']) {
      if (selections[id] !== undefined) document.documentElement.style.setProperty(`--${id}`, `${selections[id]}px`);
      else document.documentElement.style.removeProperty(`--${id}`);
    }
  },
  async saveDefaults(selections) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: '/', feedback: '[set-defaults] Use the current design settings.', payload: { playground: selections } }),
    });
    if (!response.ok) throw new Error('Could not save defaults.');
  },
});

type DemoNote = Record<string, unknown> & {
  id: string; route: string; feedback: string; done: boolean; doneAt: string | null; createdAt: string; workingAt?: string;
};
function readHostedNotes(): DemoNote[] {
  try { return JSON.parse(localStorage.getItem(HOSTED_KEY) ?? '[]') as DemoNote[]; } catch { return []; }
}
function writeHostedNotes(notes: DemoNote[]) {
  try { localStorage.setItem(HOSTED_KEY, JSON.stringify(notes)); } catch { /* Private mode: the demo runs, notes just don't stick. */ }
}
function seedHostedNotes() {
  const seed: [string, string, string][] = [
    ['/', 'Give the cards a little more room.', 'Overview cards'],
    ['/', 'Shorten this to "Active".', 'Active projects'],
    ['/pricing', 'The plan names are too similar.', 'Plans'],
    ['/settings', 'Group the notification options.', 'Notifications'],
  ];
  writeHostedNotes(seed.map(([route, feedback, text], index) => ({
    id: `seed-${index}`, route, feedback, element: { tag: 'section', text, selector: '#overview-cards' },
    done: false, doneAt: null, createdAt: new Date(Date.now() - (seed.length - index) * 60_000).toISOString(),
  })));
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
      try { raw = localStorage.getItem(HOSTED_KEY) ?? ''; } catch { /* Empty. */ }
      let hash = 0;
      for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
      const rev = `${raw.length}.${(hash >>> 0).toString(36)}`;
      const polled = query.has('rev');
      if (polled && query.get('rev') === rev) return reply(200, { rev, unchanged: true });
      const route = query.get('route');
      const rows = (query.get('all') && query.get('all') !== '0' ? notes : route ? notes.filter((n) => n.route === route) : notes.filter((n) => !n.done))
        .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return reply(200, polled ? { rev, notes: rows } : rows);
    }
    if (method === 'DELETE') {
      writeHostedNotes(notes.filter((n) => n.id !== query.get('id')));
      return reply(200, { ok: true });
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Partial<DemoNote> & { elements?: unknown[]; element?: unknown };
    const feedback = String(body.feedback ?? '').trim();
    if (!body.route || !feedback) return reply(400, { error: 'route and feedback are required' });
    const fields = Object.fromEntries(['element', 'elements', 'variant', 'variantAction', 'payload', 'viewport']
      .filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
    // Like the server, a new "save as defaults" replaces the open one on its page.
    const defaults = feedback.startsWith('[set-defaults]') && !notes.some((n) => n.id === body.id)
      ? notes.find((n) => !n.done && n.route === body.route && n.feedback.startsWith('[set-defaults]')) : undefined;
    const existing = notes.find((n) => n.id === (defaults?.id ?? body.id));
    if (existing) {
      Object.assign(existing, fields, { feedback }, defaults ? { createdAt: new Date().toISOString() } : {});
      writeHostedNotes(notes);
      return reply(200, { id: existing.id });
    }
    const id = typeof body.id === 'string' ? body.id : crypto.randomUUID();
    writeHostedNotes([...notes, { ...fields, id, route: body.route, feedback, element: body.element ?? null, done: false, doneAt: null, createdAt: new Date().toISOString() }]);
    return reply(201, { id });
  };
}
if (hosted && !screenshot) {
  try { if (localStorage.getItem(HOSTED_KEY) === null) seedHostedNotes(); } catch { /* No storage. */ }
  serveNotesInPage(endpoint);
}
/** The hosted stand-in for an agent running `isotone --working` and `--done`. */
function hostedAgent(action: 'start' | 'finish' | 'reset') {
  if (action === 'reset') { seedHostedNotes(); return; }
  const notes = readHostedNotes();
  const open = notes.filter((n) => !n.done && n.route === page);
  const target = action === 'start' ? open.find((n) => !n.workingAt) : open.find((n) => n.workingAt);
  if (!target) return;
  if (action === 'start') target.workingAt = new Date().toISOString();
  else { target.done = true; target.doneAt = new Date().toISOString(); delete target.workingAt; }
  writeHostedNotes(notes);
}
function agent(action: 'start' | 'finish' | 'reset') {
  if (hosted) hostedAgent(action);
  else void fetch(`/demo-agent?action=${action}&route=${encodeURIComponent(page)}`, { method: 'POST' });
}

function savedTheme<T extends string>(key: string, choices: readonly T[], fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return choices.find(choice => choice === saved) ?? fallback;
  } catch { return fallback; }
}

function Panel({ theme }: { theme: IterationTheme }) {
  const host = useRef<HTMLDivElement>(null);
  const panel = useRef<ReturnType<typeof createRoot> | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const shadow = host.current.attachShadow({ mode: 'open' });
    if (screenshot) {
      const style = document.createElement('style');
      // Select mode draws fixed outlines and a hint, which a scaled root would displace.
      style.textContent = `${scene === 'pin' ? '' : '.isotone-root { transform: scale(1.1); transform-origin: bottom right; right: 22px; bottom: 22px; }'} .isotone-textarea { caret-color: transparent; }`;
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
    panel.current?.render(<IterationPanel route={page} theme={theme} updateEndpoint={screenshot || hosted ? undefined : params.has('update-preview') ? '/demo-update' : '/api/iteration/update'}
      store={{ endpoint, key: `isotone-public-demo-${session}` }}
      variants={source} defaultTab="variants" shortcut={screenshot ? false : undefined} />);
  }, [theme]);
  useEffect(() => {
    if (!screenshot && !review) return;
    // Wait for the secondary root, then open the feedback panel alone.
    let frame = 0;
    const open = () => {
      const shadow = host.current?.shadowRoot;
      const launcher = shadow?.querySelector<HTMLButtonElement>('.isotone-fab');
      if (!launcher) { frame = requestAnimationFrame(open); return; }
      // The existing keyboard path makes both CSS and measured motion immediate.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft' }));
      launcher.click();
      frame = requestAnimationFrame(() => {
        const feedback = shadow?.querySelector<HTMLButtonElement>('[aria-label="Feedback"]');
        const variants = shadow?.querySelector<HTMLButtonElement>('[aria-label="Variants"]');
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
  shadow?.querySelector<HTMLButtonElement>('[aria-label="Select elements"]')?.click();
  const first = document.querySelector<HTMLElement>('#overview-cards article');
  // Give select mode a moment to attach its listeners before the scripted pointer acts.
  setTimeout(() => {
    const r = first?.getBoundingClientRect();
    if (r) first?.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, composed: true, detail: 1 }));
    const textarea = shadow?.querySelector<HTMLTextAreaElement>('textarea');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (textarea && setValue) {
      setValue.call(textarea, 'Give this card more room');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, 300);
}

/** A host dropdown that closes on any outside press, like most UI libraries. */
function NewProjectMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
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
  return <div className="new-project-wrap" ref={wrap}>
    <button className="new-project" type="button" aria-expanded={open} onClick={() => setOpen(v => !v)}>New project</button>
    {open && <div className="demo-menu" role="menu">
      {['Blank project', 'From template', 'Import from file'].map(item => <button key={item} type="button" role="menuitem" onClick={() => setOpen(false)}>{item}</button>)}
    </div>}
  </div>;
}

function Demo() {
  const [pageTheme, setPageTheme] = useState<'light' | 'dark'>(() => screenshot ? capture : savedTheme('iso-demo-page', ['light', 'dark'], 'dark'));
  const [panelTheme, setPanelTheme] = useState<IterationTheme>(() => screenshot ? 'auto' : savedTheme('iso-demo-panel', ['auto', 'system', 'light', 'dark'], 'auto'));
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
    } catch { /* Theme controls still work without storage. */ }
  }, [pageTheme, panelTheme]);
  return <>
    {!screenshot && <header className="demo-controls">
      <a href={hosted ? 'https://github.com/aaroi/isotone' : '/'} className="brand">Isotone <span>{stress ? 'stress test · 500 selectors / 500 notes' : 'live demo'}</span></a>
      <div className="theme-controls">
        <fieldset><legend>Page</legend>{(['light', 'dark'] as const).map(theme =>
          <button key={theme} type="button" aria-pressed={pageTheme === theme} onClick={() => setPageTheme(theme)}>{theme}</button>)}</fieldset>
        <label>Panel <select value={panelTheme} onChange={event => setPanelTheme(event.target.value as IterationTheme)}>
          {(['auto', 'system', 'light', 'dark'] as const).map(theme => <option key={theme}>{theme}</option>)}
        </select></label>
        <fieldset><legend>Page</legend>{[['/', 'Overview'], ['/pricing', 'Pricing'], ['/settings', 'Settings']].map(([route, name]) =>
          <a key={route} className="demo-page" aria-current={page === route ? 'page' : undefined} href={route === '/' ? '/' : `/?route=${route}`}>{name}</a>)}</fieldset>
        <fieldset><legend>Agent</legend>
          <button type="button" onClick={() => agent('start')}>Starts a note</button>
          <button type="button" onClick={() => agent('finish')}>Finishes it</button>
          <button type="button" onClick={() => agent('reset')}>Reset notes</button></fieldset>
        {hosted
          ? <a href="https://github.com/aaroi/isotone">GitHub ↗</a>
          : <><a href="/preview.html">Screenshot view ↗</a>
            <a href={stress ? '/' : '/?stress=1'}>{stress ? 'Normal demo' : 'Stress test'}</a></>}
      </div>
    </header>}
    <main className="workspace">
      <aside className="sidebar"><div className="workspace-mark">◈</div><span className="nav-current">Overview</span><span>Projects</span><span>Activity</span><span>Settings</span></aside>
      <div className="workspace-content">
        <div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>{page === '/pricing' ? 'Pricing' : page === '/settings' ? 'Settings' : 'Overview'}</h1></div><NewProjectMenu /></div>
        <p className="page-description">A little more clarity. A little less busywork.</p>
        <section id="overview-cards" className="overview-cards" aria-label="Overview cards">
          {[['Active projects', '12', '+2 this month'], ['Tasks complete', '248', 'Looking good'], ['Team members', '8', 'All connected']].map(([label, value, detail]) =>
            <article key={label}><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>)}
        </section>
        <div className="section-heading"><h2>Recent projects</h2><span>View all</span></div>
        <section className="projects" aria-label="Recent projects">
          {[['Website refresh', 'Design', 'In progress'], ['Mobile experience', 'Product', 'In review'], ['Component library', 'Engineering', 'Ready']].map(([title, team, status], index) =>
            <article key={title}><span className={`project-icon project-icon-${index}`}>↗</span><div><strong>{title}</strong><small>{team}</small></div><span className="status">{status}</span></article>)}
        </section>
        {hosted && <p className="demo-hint">This page is a stand-in for your app. Open the panel with the diamond in the corner, or ⌘/Ctrl + Shift + . Switch the card layout, spacing and colour in Variants. In Feedback, press the crosshair, click a card and write what you'd change. The Agent buttons up top do what your coding agent would do with <code>npx isotone --working</code> and <code>--done</code>. In a real project the notes go to a JSON file your agent reads. Here they stay in this browser.</p>}
        {!screenshot && !hosted && <p className="demo-hint">Try the page links and the Agent buttons above: the panel lists this page's notes, shows other pages as chips, and follows the agent without a reload. Open the diamond in the corner to leave feedback or try a variant. Demo notes are isolated and reset when the server restarts. To test select mode against a dropdown, open New project, press the pin in the feedback composer, then Shift-click a menu item to reach it without pinning.</p>}
      </div>
    </main>
    <Panel theme={panelTheme} />
  </>;
}

const mount = document.getElementById('demo');
if (mount) createRoot(mount).render(<Demo />);
