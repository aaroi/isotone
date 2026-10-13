import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createVariantsSource, IterationPanel, type IterationTheme, type VariantAxis,
} from '../../src/react/index';

const params = new URLSearchParams(location.search);
const capture = params.get('capture');
const screenshot = capture === 'light' || capture === 'dark';
const review = params.get('review') === '1';
// README image scenes: `focus` (feedback panel), `both` (variants and feedback), `pin` (select mode).
const scene = screenshot ? params.get('scene') ?? 'focus' : null;
const page = params.get('route') ?? '/';
const stress = !screenshot && params.get('stress') === '1';
const session = screenshot ? capture : stress ? 'stress' : 'interactive';
const endpoint = `/demo-notes/${session}`;
/** A small line drawing of the overview cards in a layout, used as a thumbnail. */
function layoutThumb(columns: number): string {
  const rows = Math.ceil(3 / columns);
  // Drawn in the upper right, clear of the label the panel puts bottom left.
  const w = (64 - (columns - 1) * 5) / columns;
  const h = (30 - (rows - 1) * 4) / rows;
  const cards = Array.from({ length: 3 }, (_, i) =>
    `<rect x="${44 + (i % columns) * (w + 5)}" y="${9 + Math.floor(i / columns) * (h + 4)}" width="${w}" height="${h}" rx="2.5" fill="none" stroke="#8b8e99" stroke-width="1.5"/>`).join('');
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 64">${cards}</svg>`)}`;
}
const axes: VariantAxis[] = [
  { id: 'layout', label: 'Card layout', defaultOption: 'row', options: [
    { id: 'row', label: 'Row', image: layoutThumb(3) }, { id: 'grid', label: 'Grid', image: layoutThumb(2) },
    { id: 'list', label: 'List', image: layoutThumb(1) },
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
    panel.current?.render(<IterationPanel route={page} theme={theme} updateEndpoint={screenshot ? undefined : params.has('update-preview') ? '/demo-update' : '/api/iteration/update'}
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
      <a href="/" className="brand">Isotone <span>{stress ? 'stress test · 500 selectors / 500 notes' : 'live demo'}</span></a>
      <div className="theme-controls">
        <fieldset><legend>Page</legend>{(['light', 'dark'] as const).map(theme =>
          <button key={theme} type="button" aria-pressed={pageTheme === theme} onClick={() => setPageTheme(theme)}>{theme}</button>)}</fieldset>
        <label>Panel <select value={panelTheme} onChange={event => setPanelTheme(event.target.value as IterationTheme)}>
          {(['auto', 'system', 'light', 'dark'] as const).map(theme => <option key={theme}>{theme}</option>)}
        </select></label>
        <fieldset><legend>Page</legend>{[['/', 'Overview'], ['/pricing', 'Pricing'], ['/settings', 'Settings']].map(([route, name]) =>
          <a key={route} className="demo-page" aria-current={page === route ? 'page' : undefined} href={route === '/' ? '/' : `/?route=${route}`}>{name}</a>)}</fieldset>
        <fieldset><legend>Agent</legend>
          <button type="button" onClick={() => void fetch(`/demo-agent?action=start&route=${encodeURIComponent(page)}`, { method: 'POST' })}>Starts a note</button>
          <button type="button" onClick={() => void fetch(`/demo-agent?action=finish&route=${encodeURIComponent(page)}`, { method: 'POST' })}>Finishes it</button>
          <button type="button" onClick={() => void fetch('/demo-agent?action=reset', { method: 'POST' })}>Reset notes</button></fieldset>
        <a href="/preview.html">Screenshot view ↗</a>
        <a href={stress ? '/' : '/?stress=1'}>{stress ? 'Normal demo' : 'Stress test'}</a>
      </div>
    </header>}
    <main className="workspace">
      <aside className="sidebar"><div className="workspace-mark">◈</div><span className="nav-current">Overview</span><span>Projects</span><span>Activity</span><span>Settings</span></aside>
      <div className="workspace-content">
        <div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>{page === '/pricing' ? 'Pricing' : page === '/settings' ? 'Settings' : 'Overview'}</h1></div><NewProjectMenu /></div>
        <p className="page-description">A little more clarity. A little less busywork.</p>
        <section id="overview-cards" className="overview-cards" aria-label="Overview cards">
          {[['Active projects', '12', '+2 this month'], ['Tasks complete', '248', 'Looking good'], ['Team members', '8', 'All connected']].map(([label, value, detail]) =>
            <article key={label}><p>{label}</p>{' '}<strong>{value}</strong>{' '}<small>{detail}</small></article>)}
        </section>
        <div className="section-heading"><h2>Recent projects</h2><span>View all</span></div>
        <section className="projects" aria-label="Recent projects">
          {[['Website refresh', 'Design', 'In progress'], ['Mobile experience', 'Product', 'In review'], ['Component library', 'Engineering', 'Ready']].map(([title, team, status], index) =>
            <article key={title}><span className={`project-icon project-icon-${index}`}>↗</span><div><strong>{title}</strong><small>{team}</small></div><span className="status">{status}</span></article>)}
        </section>
        {!screenshot && <p className="demo-hint">Try the page links and the Agent buttons above: the panel lists this page's notes, shows other pages as chips, and follows the agent without a reload. Open the diamond in the corner to leave feedback or try a variant. Demo notes are isolated and reset when the server restarts. To test select mode against a dropdown, open New project, press the pin in the feedback composer, then Shift-click a menu item to reach it without pinning.</p>}
      </div>
    </main>
    <Panel theme={panelTheme} />
  </>;
}

const mount = document.getElementById('demo');
if (mount) createRoot(mount).render(<Demo />);
