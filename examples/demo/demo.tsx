import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createVariantsSource, IterationPanel, type IterationTheme, type VariantAxis,
} from '../../src/react/index';

const params = new URLSearchParams(location.search);
const capture = params.get('capture');
const screenshot = capture === 'light' || capture === 'dark';
const review = params.get('review') === '1';
const stress = !screenshot && params.get('stress') === '1';
const session = screenshot ? capture : stress ? 'stress' : 'interactive';
const endpoint = `/demo-notes/${session}`;
const axes: VariantAxis[] = [
  { id: 'spacing', label: 'Spacing', defaultOption: 'compact', options: [
    { id: 'compact', label: 'Compact' }, { id: 'comfy', label: 'Comfy' }, { id: 'spacious', label: 'Spacious' },
  ] },
  { id: 'accent', label: 'Accent colour', kind: 'color', defaultColor: '#6687ff', swatches: [
    { id: 'blue', label: 'Blue', value: '#6687ff' }, { id: 'green', label: 'Green', value: '#63b990' },
    { id: 'amber', label: 'Amber', value: '#dfae5e' }, { id: 'rose', label: 'Rose', value: '#dd7f9a' },
    { id: 'violet', label: 'Violet', value: '#a18be0' },
  ] },
];
if (!screenshot) axes.push(
  { id: 'card-radius', label: 'Card radius', kind: 'range', min: 0, max: 24, step: 1, defaultValue: 11, unit: 'px' },
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
      style.textContent = '.iso-iter-root { transform: scale(1.1); transform-origin: bottom right; right: 22px; bottom: 22px; } .iso-iter-textarea { caret-color: transparent; }';
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
    panel.current?.render(<IterationPanel route="/" theme={theme} updateEndpoint={screenshot ? undefined : params.has('update-preview') ? '/demo-update' : '/api/iteration/update'}
      store={{ endpoint, key: `iso-iterate-public-demo-${session}` }}
      variants={source} defaultTab="variants" shortcut={screenshot ? false : undefined} />);
  }, [theme]);
  useEffect(() => {
    if (!screenshot && !review) return;
    // Wait for the secondary root, then open the two real product surfaces.
    let frame = 0;
    const open = () => {
      const shadow = host.current?.shadowRoot;
      const launcher = shadow?.querySelector<HTMLButtonElement>('.iso-iter-fab');
      if (!launcher) { frame = requestAnimationFrame(open); return; }
      // The existing keyboard path makes both CSS and measured motion immediate.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft' }));
      launcher.click();
      frame = requestAnimationFrame(() => {
        const feedback = shadow?.querySelector<HTMLButtonElement>('[aria-label="Feedback"]');
        const variants = shadow?.querySelector<HTMLButtonElement>('[aria-label="Variants"]');
        if (feedback?.getAttribute('aria-expanded') !== 'true') feedback?.click();
        if (screenshot && variants?.getAttribute('aria-expanded') !== 'true') variants?.click();
        if (!screenshot && variants?.getAttribute('aria-expanded') === 'true') variants?.click();
        frame = requestAnimationFrame(() => {
          (shadow?.activeElement as HTMLElement | null)?.blur();
          document.documentElement.dataset.previewReady = 'true';
        });
      });
    };
    frame = requestAnimationFrame(open);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div ref={host} data-iso-iterate="demo" />;
}

function Demo() {
  const [pageTheme, setPageTheme] = useState<'light' | 'dark'>(() => screenshot ? capture : savedTheme('iso-demo-page', ['light', 'dark'], 'dark'));
  const [panelTheme, setPanelTheme] = useState<IterationTheme>(() => screenshot ? 'auto' : savedTheme('iso-demo-panel', ['auto', 'system', 'light', 'dark'], 'auto'));
  useEffect(() => {
    document.documentElement.dataset.theme = pageTheme;
    document.documentElement.dataset.capture = String(screenshot);
    document.documentElement.dataset.spacing = source.getSelections().spacing;
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
      <a href="/" className="brand">iso-iterate <span>{stress ? 'stress test · 500 selectors / 500 notes' : 'live demo'}</span></a>
      <div className="theme-controls">
        <fieldset><legend>Page</legend>{(['light', 'dark'] as const).map(theme =>
          <button key={theme} type="button" aria-pressed={pageTheme === theme} onClick={() => setPageTheme(theme)}>{theme}</button>)}</fieldset>
        <label>Panel <select value={panelTheme} onChange={event => setPanelTheme(event.target.value as IterationTheme)}>
          {(['auto', 'system', 'light', 'dark'] as const).map(theme => <option key={theme}>{theme}</option>)}
        </select></label>
        <a href="/preview.html">Screenshot view ↗</a>
        <a href={stress ? '/' : '/?stress=1'}>{stress ? 'Normal demo' : 'Stress test'}</a>
      </div>
    </header>}
    <main className="workspace">
      <aside className="sidebar"><div className="workspace-mark">◈</div><span className="nav-current">Overview</span><span>Projects</span><span>Activity</span><span>Settings</span></aside>
      <div className="workspace-content">
        <div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>Overview</h1></div><button className="new-project" type="button">New project</button></div>
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
        {!screenshot && <p className="demo-hint">Open the diamond in the corner to leave feedback or try a variant. Demo notes are isolated and reset when the server restarts.</p>}
      </div>
    </main>
    <Panel theme={panelTheme} />
  </>;
}

const mount = document.getElementById('demo');
if (mount) createRoot(mount).render(<Demo />);
