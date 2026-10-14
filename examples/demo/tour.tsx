import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, X } from 'lucide-react';

/**
 * A short guided tour for first-time visitors. It never blocks the page: each
 * step highlights what to click, says what it does, and moves on when the
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
function allInPanel(selector: string) {
  return [...(shadow()?.querySelectorAll<HTMLElement>(selector) ?? [])];
}
function readPanel(): PanelState {
  const root = inPanel('.isotone-root');
  if (!root) return closedPanel;
  return {
    open: root.dataset.open === 'true',
    variants: inPanel('.isotone-variants-panel')?.dataset.open === 'true',
    notes: inPanel('.isotone-notes-panel')?.dataset.open === 'true',
    picking: Boolean(inPanel('.isotone-picking')),
    pinned: Boolean(inPanel('.isotone-context .isotone-chip')),
  };
}
const samePanel = (a: PanelState, b: PanelState) =>
  a.open === b.open && a.variants === b.variants && a.notes === b.notes && a.picking === b.picking && a.pinned === b.pinned;

export function tourSeen() {
  try { return localStorage.getItem(TOUR_KEY) !== null; } catch { return false; }
}
function rememberTour() {
  try { localStorage.setItem(TOUR_KEY, 'seen'); } catch { /* The tour just shows again next time. */ }
}

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const touch = matchMedia('(pointer: coarse)').matches;
const press = touch ? 'Tap' : 'Click';

type AgentState = 'waiting' | 'working' | 'done';
/** What to highlight: a key that changes whenever the highlighted things change, and how to find them. */
type Highlight = { key: string; find: () => Element[] };

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

  // The panel's state, polled; cheap, and the panel stays unaware of the tour.
  useEffect(() => {
    const timer = setInterval(() => setPanel(previous => {
      const next = readPanel();
      return samePanel(previous, next) ? previous : next;
    }), 120);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (step === 'open' && panel.open) {
      const timer = setTimeout(() => setStep('variants'), 300);
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
      setStep(current => (current === 'variants' || current === 'pin' ? 'agent' : current));
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
    layout={`${panel.variants}-${panel.notes}`}
    highlight={content.highlight}
    onSkip={close}
    footer={step === 'welcome'
      ? <>
          <TourButton primary onClick={next}>Start</TourButton>
          <TourButton onClick={close}>Skip</TourButton>
        </>
      : step === 'finish'
        ? <>
            <TourButton primary onClick={close}>Done</TourButton>
            <a className="tour-button" href="https://github.com/aaroi/isotone" target="_blank" rel="noreferrer">GitHub</a>
          </>
        : <>
            <TourButton primary={content.ready} onClick={next}>Next</TourButton>
            <button type="button" className="tour-link" onMouseDown={keepFocus} onClick={close}>End tour</button>
          </>}
  >
    <div className="tour-step" key={step}>
      <h2>{content.title}</h2>
      {content.body}
    </div>
  </TourCard>;
}

/**
 * Pressing a tour button must not take focus from the page or the panel:
 * select mode and the composer both listen for Enter where focus already is.
 */
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

function TourButton({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`tour-button${primary ? ' tour-primary' : ''}`} onMouseDown={keepFocus} onClick={onClick}>{children}</button>;
}

function Keys({ keys }: { keys: string[] }) {
  return <span className="tour-keys">{keys.map(key => <kbd key={key}>{key}</kbd>)}</span>;
}

function Status({ done, children }: { done: boolean; children: ReactNode }) {
  return <p className="tour-status" data-done={done}>
    {done ? <Check size={13} strokeWidth={2.25} /> : <span className="tour-pulse" />}
    <span>{children}</span>
  </p>;
}

const one = (selector: string): Highlight => ({ key: selector, find: () => [inPanel(selector)].filter(e => e !== null) });

/** What each step says and highlights, given what the visitor has done so far. */
function stepContent(step: Step, panel: PanelState, switched: boolean, agent: AgentState): {
  title: string; body: ReactNode; highlight: Highlight | null; ready?: boolean;
} {
  // The pill behind the button: it stays visible when hovering swaps the button for the tools.
  const fab = one('.isotone-rail-track');
  switch (step) {
    case 'welcome': return {
      title: 'This is a pretend app',
      body: <p>Isotone is the round button in the bottom-right corner. You add it to your own app while you're building it, so you can compare design variants and leave notes for your coding agent. This takes about a minute.</p>,
      highlight: null,
    };
    case 'open': return {
      title: 'Open Isotone',
      body: <>
        <p>{press} the highlighted button.</p>
        {!touch && <p className="tour-hint">You can also press <Keys keys={[mac ? '⌘' : 'Ctrl', '⇧', '.']} /></p>}
      </>,
      highlight: fab,
    };
    case 'variants':
      if (!panel.variants) return {
        title: 'Try a variant',
        body: <p>{press} the highlighted button to open Variants.</p>,
        highlight: panel.open ? one('[aria-label="Variants"]') : fab,
        ready: switched,
      };
      return {
        title: 'Try a variant',
        body: switched
          ? <>
              <p>The cards on the page changed. In your own app, this switches the real thing.</p>
              <p className="tour-hint">Spacing, colour and the sliders below work the same way.</p>
            </>
          : <p>Say you asked your agent for a few ways to lay out the cards. They show up here. {press} one of the highlighted layouts and watch the page.</p>,
        highlight: switched ? null : {
          key: 'layouts',
          find: () => allInPanel('fieldset[aria-label="Card layout"] .isotone-thumb[aria-pressed="false"]'),
        },
        ready: switched,
      };
    case 'pin':
      if (!panel.notes) return {
        title: 'Leave a note',
        body: <p>Now say something on the page needs fixing. {press} the highlighted button to open Feedback.</p>,
        highlight: panel.open ? one('[aria-label="Feedback"]') : fab,
      };
      if (panel.picking && !panel.pinned) return {
        title: 'Leave a note',
        body: <p>{press} one of the cards on the page.</p>,
        highlight: { key: 'cards', find: () => [document.getElementById('overview-cards')].filter(e => e !== null) },
      };
      if (panel.picking) return {
        title: 'Leave a note',
        body: <p>The card is selected. You can pick more, or press <Keys keys={['esc']} /> when you're done.</p>,
        highlight: null,
      };
      if (panel.pinned) return {
        title: 'Leave a note',
        body: <p>Write what you'd change, like "make this number bigger", and press <Keys keys={['↵']} /> to send it.</p>,
        highlight: one('.isotone-compose'),
      };
      return {
        title: 'Leave a note',
        body: <p>{press} the crosshair to start selecting.</p>,
        highlight: one('[aria-label="Select elements"]'),
      };
    case 'agent': return {
      title: 'Your agent picks it up',
      body: <>
        <p>In your project the note is saved to a file, with the page, the card and what you wrote. Your agent reads it with <code>npx isotone</code>. This demo has a pretend agent.</p>
        {agent === 'waiting' && <Status done={false}>Waiting for the agent</Status>}
        {agent === 'working' && <Status done={false}>The agent is on it. The dot by your note shows that.</Status>}
        {agent === 'done' && <Status done>Done. The agent closed your note.</Status>}
      </>,
      highlight: panel.notes ? one('.isotone-list') : fab,
      ready: agent === 'done',
    };
    case 'finish': return {
      title: 'Try it in your own app',
      body: <>
        <p>Run these in your project. It works with Vite and other dev servers, and none of it ends up in your production build.</p>
        <Install />
      </>,
      highlight: null,
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
/** Where the card sits: its left edge, and its bottom edge's distance from the bottom of the window. */
type Spot = { x: number; bottom: number };

/**
 * The floating card and the rings around what it highlights. Rings follow
 * their targets every frame and fade in fresh when the targets change, so they
 * never slide across the page. The card is placed only when something that
 * should move it happens: a step, a panel opening or closing, its own size, or
 * the window size. Hovering, panel motion and page reflow never move it.
 */
function TourCard({ step, layout, highlight, footer, onSkip, children }: {
  step: Step;
  layout: string;
  highlight: Highlight | null;
  footer: ReactNode;
  onSkip: () => void;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [rings, setRings] = useState<Box[]>([]);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [animate, setAnimate] = useState(false);
  const centred = step === 'welcome' || step === 'finish';
  const find = useRef(highlight?.find);
  find.current = highlight?.find;

  useLayoutEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const boxes = (find.current?.() ?? []).map(ringBox).filter(b => b !== null);
      setRings(previous => sameBoxes(previous, boxes) ? previous : boxes);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  const placedFor = useRef<boolean | null>(null);
  const anchor = useRef<DOMRect | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `layout` changing is what should place the card again.
  useLayoutEffect(() => {
    const node = card.current;
    if (!node) return;
    const place = (measure: boolean) => {
      if (measure) anchor.current = centred ? null : dockArea();
      const next = spotFor(anchor.current, node.offsetWidth, node.offsetHeight);
      setSpot(current => current && current.x === next.x && current.bottom === next.bottom ? current : next);
    };
    // A panel that just opened or closed is still moving; measure it once it has settled.
    const settled = setTimeout(() => place(true), 420);
    // Right away on the first placement and when the card leaves or returns to the centre.
    if (placedFor.current !== centred) { placedFor.current = centred; place(true); }
    // New text changes only the card's height, which never needs a new measurement.
    const resized = new ResizeObserver(() => place(false));
    resized.observe(node);
    const onWindow = () => place(true);
    window.addEventListener('resize', onWindow);
    return () => {
      clearTimeout(settled);
      resized.disconnect();
      window.removeEventListener('resize', onWindow);
    };
  }, [layout, centred]);

  // The first placement is instant; later moves glide.
  useEffect(() => {
    if (!spot || animate) return;
    const frame = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(frame);
  }, [spot, animate]);

  useEffect(() => {
    if (!centred) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onSkip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [centred, onSkip]);

  const index = GUIDED.indexOf(step);
  return <div className="tour" data-isotone data-centred={centred}>
    {centred && <div className="tour-scrim" />}
    {rings.map((ring, i) => <div
      // A new key per highlight, so changed targets fade in rather than slide.
      // biome-ignore lint/suspicious/noArrayIndexKey: the highlight's own key changes with its targets; the index only tells its rings apart.
      key={`${highlight?.key}-${i}`}
      className="tour-ring"
      style={{ transform: `translate(${ring.x}px, ${ring.y}px)`, width: ring.width, height: ring.height, borderRadius: ring.radius }}
    />)}
    <div
      ref={card}
      className="tour-card"
      role="dialog"
      aria-label="Isotone tour"
      data-animate={animate}
      style={spot ? { transform: `translate(${spot.x}px, ${-spot.bottom}px)` } : { visibility: 'hidden' }}
    >
      <div className="tour-top">
        {index >= 0
          ? <span className="tour-progress">
              {GUIDED.map((s, i) => <i key={s} aria-hidden="true" data-state={i < index ? 'done' : i === index ? 'now' : 'next'} />)}
              <span>{index + 1} of {GUIDED.length}</span>
            </span>
          : <span className="tour-eyebrow">{step === 'welcome' ? 'Isotone demo' : 'That’s it'}</span>}
        <button type="button" className="tour-close" aria-label="Close tour" title="Close tour" onMouseDown={keepFocus} onClick={onSkip}><X size={14} /></button>
      </div>
      {children}
      <div className="tour-footer">{footer}</div>
    </div>
  </div>;
}

function ringBox(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const pad = 4;
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 8;
  return {
    x: Math.round(rect.left - pad), y: Math.round(rect.top - pad),
    width: Math.round(rect.width + pad * 2), height: Math.round(rect.height + pad * 2),
    radius: Math.min(radius + pad, (rect.height + pad * 2) / 2),
  };
}
function sameBoxes(a: Box[], b: Box[]) {
  return a.length === b.length && a.every((box, i) => {
    const other = b[i];
    return other !== undefined && box.x === other.x && box.y === other.y && box.width === other.width && box.height === other.height && box.radius === other.radius;
  });
}

/**
 * The corner Isotone uses: its open panels, plus room for the tools as they
 * look when hovering fans them out, so hovering never changes the answer.
 */
function dockArea(): DOMRect | null {
  const root = shadow();
  const corner = root?.querySelector('.isotone-root')?.getBoundingClientRect();
  if (!root || !corner) return null;
  let left = corner.right - 96, top = corner.bottom - 44, right = corner.right, bottom = corner.bottom;
  for (const part of root.querySelectorAll('.isotone-panel[data-open="true"]')) {
    const box = part.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    left = Math.min(left, box.left); top = Math.min(top, box.top);
    right = Math.max(right, box.right); bottom = Math.max(bottom, box.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * Left of the panel with the bottoms lined up, so new text grows the card
 * upwards; along the top on narrow screens; centred without an anchor.
 */
function spotFor(target: DOMRect | null, width: number, height: number): Spot {
  const vw = window.innerWidth, vh = window.innerHeight, margin = 16, gap = 20;
  const clampX = (x: number) => Math.round(Math.min(Math.max(x, margin), vw - width - margin));
  const clampBottom = (bottom: number) => Math.round(Math.min(Math.max(bottom, margin), vh - height - margin));
  if (!target) return { x: clampX((vw - width) / 2), bottom: clampBottom((vh - height) / 2 + vh * 0.04) };
  if (target.left - gap - width >= margin) return { x: Math.round(target.left - gap - width), bottom: clampBottom(vh - target.bottom) };
  return { x: clampX(margin), bottom: clampBottom(vh - height - margin) };
}
