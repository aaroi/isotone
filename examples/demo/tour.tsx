import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Copy, X } from 'lucide-react';

/**
 * A short guided tour for first-time visitors. It never blocks the page: each
 * step points at one control, says what to do there, and moves on when the
 * visitor does it. It reads the panel's state from its shadow DOM, so the
 * panel itself knows nothing about the tour.
 */
type Step = 'welcome' | 'open' | 'variants' | 'pin' | 'agent' | 'finish';
const GUIDED: Step[] = ['open', 'variants', 'pin', 'agent'];
const TOUR_KEY = 'isotone-demo-tour';

type PanelState = { open: boolean; variants: boolean; notes: boolean; picking: boolean; pinned: boolean };
const closedPanel: PanelState = { open: false, variants: false, notes: false, picking: false, pinned: false };

function shadow() {
  return document.querySelector('[data-isotone=demo]')?.shadowRoot ?? null;
}
function inPanel(selector: string) {
  return shadow()?.querySelector<HTMLElement>(selector) ?? null;
}
function readPanel(): PanelState {
  const root = inPanel('.isotone-root');
  if (!root) return closedPanel;
  return {
    open: root.dataset.open === 'true',
    variants: inPanel('.isotone-variants-panel')?.dataset.open === 'true',
    notes: inPanel('.isotone-notes-panel')?.dataset.open === 'true',
    picking: Boolean(inPanel('.isotone-hint')),
    pinned: Boolean(inPanel('.isotone-context .isotone-chip')),
  };
}
const samePanel = (a: PanelState, b: PanelState) =>
  a.open === b.open && a.variants === b.variants && a.notes === b.notes && a.picking === b.picking && a.pinned === b.pinned;

export function tourSeen() {
  try { return localStorage.getItem(TOUR_KEY) !== null; } catch { return true; }
}
function rememberTour() {
  try { localStorage.setItem(TOUR_KEY, 'seen'); } catch { /* The tour just shows again next time. */ }
}

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const touch = matchMedia('(pointer: coarse)').matches;

type AgentState = 'waiting' | 'working' | 'done';

export function Tour({ onClose, subscribeVariants }: {
  onClose: () => void;
  subscribeVariants: (listener: () => void) => () => void;
}) {
  const [step, setStep] = useState<Step>('welcome');
  const [panel, setPanel] = useState<PanelState>(closedPanel);
  const [switched, setSwitched] = useState(false);
  const [agent, setAgent] = useState<AgentState>('waiting');
  const note = useRef<string | null>(null);

  const close = useCallback(() => { rememberTour(); onClose(); }, [onClose]);

  // The panel's open state, polled; cheap, and the panel stays unaware of us.
  useEffect(() => {
    const timer = setInterval(() => setPanel(previous => {
      const next = readPanel();
      return samePanel(previous, next) ? previous : next;
    }), 150);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (step === 'open' && panel.open) {
      const timer = setTimeout(() => setStep('variants'), 350);
      return () => clearTimeout(timer);
    }
  }, [step, panel.open]);

  useEffect(() => subscribeVariants(() => setSwitched(true)), [subscribeVariants]);

  useEffect(() => {
    const sent = (event: Event) => {
      const { id, action } = (event as CustomEvent<{ id: string; action: boolean }>).detail;
      if (action) return;
      note.current = id;
      setAgent('waiting');
      setStep(current => (current === 'pin' || current === 'variants' ? 'agent' : current));
    };
    const progress = (event: Event) => {
      const { id, state } = (event as CustomEvent<{ id: string; state: AgentState }>).detail;
      if (id === note.current) setAgent(state);
    };
    window.addEventListener('demo:note', sent);
    window.addEventListener('demo:agent', progress);
    return () => {
      window.removeEventListener('demo:note', sent);
      window.removeEventListener('demo:agent', progress);
    };
  }, []);

  const next = () => {
    const order: Step[] = ['welcome', ...GUIDED, 'finish'];
    const following = order[order.indexOf(step) + 1];
    if (following) setStep(following);
    else close();
  };

  const content = stepContent(step, panel, switched, agent);
  return <TourCard
    step={step}
    target={content.target}
    onSkip={close}
    footer={step === 'welcome'
      ? <>
          <button type="button" className="tour-button tour-primary" onClick={next}>Show me <ArrowRight size={14} /></button>
          <button type="button" className="tour-button" onClick={close}>Skip</button>
        </>
      : step === 'finish'
        ? <>
            <button type="button" className="tour-button tour-primary" onClick={close}>Done</button>
            <a className="tour-button" href="https://github.com/aaroi/isotone" target="_blank" rel="noreferrer">View on GitHub</a>
          </>
        : <>
            <button type="button" className={`tour-button${content.ready ? ' tour-primary' : ''}`} onClick={next}>
              {content.ready ? 'Next' : 'Skip step'}
            </button>
            <button type="button" className="tour-link" onClick={close}>End tour</button>
          </>}
  >
    <div className="tour-step" key={step}>
      <h2>{content.title}</h2>
      {content.body}
    </div>
  </TourCard>;
}

function Keys({ keys }: { keys: string[] }) {
  return <span className="tour-keys">{keys.map(key => <kbd key={key}>{key}</kbd>)}</span>;
}

function Status({ done, children }: { done: boolean; children: ReactNode }) {
  return <p className="tour-status" data-done={done}>
    {done ? <Check size={13} strokeWidth={2.25} /> : <span className="tour-pulse" />}
    {children}
  </p>;
}

/** What each step says, and where it points, given what the visitor has done so far. */
function stepContent(step: Step, panel: PanelState, switched: boolean, agent: AgentState): {
  title: string; body: ReactNode; target: (() => Element | null) | null; ready?: boolean;
} {
  const fab = () => inPanel('.isotone-fab');
  switch (step) {
    case 'welcome': return {
      title: 'This page stands in for your app',
      body: <p>Isotone is the button in the bottom-right corner. In your own project it sits on top of your real pages while you develop. The tour takes about a minute.</p>,
      target: null,
    };
    case 'open': return {
      title: 'Open Isotone',
      body: touch
        ? <p>Tap the button in the corner.</p>
        : <p>Click the button in the corner, or press <Keys keys={[mac ? '⌘' : 'Ctrl', '⇧', '.']} />.</p>,
      target: fab,
    };
    case 'variants': return {
      title: 'Switch between variants',
      body: panel.variants
        ? <>
            <p>Say you asked your agent for a few ways to lay out the cards. They show up here, and picking one changes the page.</p>
            {switched
              ? <Status done>Spacing, colour and the sliders work the same way.</Status>
              : <p className="tour-hint">Try Feature or List.</p>}
          </>
        : <p>Open <b>Variants</b> from the corner.</p>,
      target: panel.variants ? () => inPanel('.isotone-variants-panel') : panel.open ? () => inPanel('[aria-label="Variants"]') : fab,
      ready: switched,
    };
    case 'pin': return {
      title: 'Point at what you mean',
      body: !panel.notes
        ? <p>When something on the page needs to change, open <b>Feedback</b> from the corner.</p>
        : panel.pinned
          ? <p>Write what you'd change and press <Keys keys={['↵']} /> to send it.</p>
          : panel.picking
            ? <p>Click one of the cards at the top to pin it.</p>
            : <p>Press the crosshair, then click one of the cards at the top.</p>,
      target: !panel.notes
        ? panel.open ? () => inPanel('[aria-label="Feedback"]') : fab
        : panel.pinned ? () => inPanel('.isotone-compose')
          : panel.picking ? () => document.getElementById('overview-cards')
            : () => inPanel('[aria-label="Select elements"]'),
    };
    case 'agent': return {
      title: 'Your agent picks it up',
      body: <>
        <p>In your project the note goes to a JSON file with the page, the element and what you wrote. Your agent reads it with <code>npx isotone</code>. A pretend agent stands in for it here.</p>
        {agent === 'waiting' && <Status done={false}>Waiting for the agent</Status>}
        {agent === 'working' && <Status done={false}>Working on it. The dot by your note means the agent has it.</Status>}
        {agent === 'done' && <Status done>Done. The agent closed the note.</Status>}
      </>,
      target: panel.notes ? () => inPanel('.isotone-notes-panel') : fab,
      ready: agent === 'done',
    };
    case 'finish': return {
      title: 'Now try it on your app',
      body: <>
        <p>Install it and run <code>init</code>. It works with Vite or any other dev server, and nothing goes into your production build.</p>
        <Install />
      </>,
      target: null,
    };
  }
}

function Install() {
  const [copied, setCopied] = useState(false);
  const commands = 'npm i -D isotone\nnpx isotone init';
  return <div className="tour-code">
    <pre><span>$</span> npm i -D isotone{'\n'}<span>$</span> npx isotone init</pre>
    <button type="button" aria-label="Copy commands" title="Copy" onClick={() => {
      void navigator.clipboard?.writeText(commands).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      });
    }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
  </div>;
}

type Box = { x: number; y: number; width: number; height: number; radius: number };

/**
 * The floating card and the ring around its target. Both follow the target
 * every frame, since panels open with motion and the page reflows when a
 * variant changes.
 */
function TourCard({ step, target, footer, onSkip, children }: {
  step: Step;
  target: (() => Element | null) | null;
  footer: ReactNode;
  onSkip: () => void;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [ring, setRing] = useState<Box | null>(null);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const placed = useRef(false);
  const centred = target === null;

  useLayoutEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const node = card.current;
      if (!node) return;
      const element = target?.() ?? null;
      const rect = element?.getBoundingClientRect();
      const visible = rect && rect.width > 0 && rect.height > 0;
      const box = visible ? ringBox(element, rect) : null;
      setRing(previous => sameBox(previous, box) ? previous : box);
      const position = place(visible ? clearOfPanel(element, rect) : null, node.offsetWidth, node.offsetHeight);
      setSpot(previous => previous && previous.x === position.x && previous.y === position.y ? previous : position);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [target]);

  useEffect(() => {
    if (spot) requestAnimationFrame(() => { placed.current = true; });
  }, [spot]);

  useEffect(() => {
    if (!centred) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onSkip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [centred, onSkip]);

  const index = GUIDED.indexOf(step);
  return <div className="tour" data-isotone data-centred={centred}>
    {centred && <div className="tour-scrim" />}
    {ring && <div className="tour-ring" style={{ transform: `translate(${ring.x}px, ${ring.y}px)`, width: ring.width, height: ring.height, borderRadius: ring.radius }} />}
    <div
      ref={card}
      className="tour-card"
      role="dialog"
      aria-label="Isotone tour"
      data-placed={placed.current}
      style={spot ? { transform: `translate(${spot.x}px, ${spot.y}px)` } : { visibility: 'hidden' }}
    >
      <div className="tour-top">
        {index >= 0
          ? <span className="tour-progress">
              {GUIDED.map((s, i) => <i key={s} aria-hidden="true" data-state={i < index ? 'done' : i === index ? 'now' : 'next'} />)}
              <span>{index + 1} of {GUIDED.length}</span>
            </span>
          : <span className="tour-eyebrow">{step === 'welcome' ? 'Welcome' : 'All done'}</span>}
        <button type="button" className="tour-close" aria-label="Close tour" title="Close tour" onClick={onSkip}><X size={14} /></button>
      </div>
      {children}
      <div className="tour-footer">{footer}</div>
    </div>
  </div>;
}

function ringBox(element: Element | null, rect: DOMRect): Box {
  const pad = 5;
  const radius = element ? Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 8 : 8;
  return {
    x: Math.round(rect.left - pad), y: Math.round(rect.top - pad),
    width: Math.round(rect.width + pad * 2), height: Math.round(rect.height + pad * 2),
    radius: Math.min(radius + pad, (rect.height + pad * 2) / 2),
  };
}
function sameBox(a: Box | null, b: Box | null) {
  return a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.radius === b.radius);
}

/** For a control inside Isotone, the area to keep clear is the whole open panel, not just the control. */
function clearOfPanel(element: Element | null, rect: DOMRect): DOMRect {
  const root = element?.getRootNode();
  if (!(root instanceof ShadowRoot)) return rect;
  let { left, top, right, bottom } = rect;
  for (const part of root.querySelectorAll('.isotone-panel[data-open="true"], .isotone-fab, .isotone-rail')) {
    const box = part.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    left = Math.min(left, box.left); top = Math.min(top, box.top);
    right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/** Beside the target if there's room, then below, then above; centred when there's no target. */
function place(target: DOMRect | null | undefined, width: number, height: number) {
  const vw = window.innerWidth, vh = window.innerHeight, margin = 16, gap = 18;
  const clampX = (x: number) => Math.round(Math.min(Math.max(x, margin), vw - width - margin));
  const clampY = (y: number) => Math.round(Math.min(Math.max(y, margin), vh - height - margin));
  if (!target) return { x: clampX((vw - width) / 2), y: clampY((vh - height) / 2 - vh * 0.04) };
  // Narrow screens: full width, above the target when it fits there, otherwise at the bottom.
  if (vw < 640) return target.top >= height + margin * 2 ? { x: margin, y: margin } : { x: margin, y: clampY(vh - height - margin) };
  if (target.left - gap - width >= margin) return { x: Math.round(target.left - gap - width), y: clampY(target.bottom - height) };
  if (target.bottom + gap + height <= vh - margin) return { x: clampX(target.left + target.width / 2 - width / 2), y: Math.round(target.bottom + gap) };
  if (target.top - gap - height >= margin) return { x: clampX(target.right - width), y: Math.round(target.top - gap - height) };
  return { x: clampX(target.right + gap), y: clampY(target.top) };
}
