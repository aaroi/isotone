import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BLAST, type BlastState, blastPrompt, timeLeft } from '../core/blast';
import { Icon } from './icons';

export interface BlastNoticeProps {
  /** The local adapter's session endpoint ({@link BLAST.endpoint}). */
  endpoint?: string;
  /** The panel is open: the line shows and the session is polled. */
  active: boolean;
  /** Notes an agent is working on right now, from the panel's own list. */
  working?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** How often an open panel reads the session. */
const POLL_MS = 5_000;
const DURATIONS = [15, 30, 45, 60] as const;

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * A quiet line next to the pill. During a live session it reads "Blast · 32 min
 * left" and offers Extend and Stop; otherwise it offers Start Blast, which
 * copies a prompt for the user's agent. Isotone cannot start an agent.
 */
export function BlastNotice({ endpoint, active, working = 0, open: controlled, onOpenChange }: BlastNoticeProps) {
  const [session, setSession] = useState<BlastState | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Server time minus ours, so the countdown follows the server's clock.
  const [skew, setSkew] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ?? ownOpen;
  const changeOpen = useRef(onOpenChange);
  changeOpen.current = onOpenChange;
  const setOpen = useCallback((next: boolean) => { setOwnOpen(next); changeOpen.current?.(next); }, []);
  const [minutes, setMinutes] = useState<number>(45);
  const [status, setStatus] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  // Stopped from here: the line says so until the dialog closes.
  const [stopped, setStopped] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const stoppedLine = useRef<HTMLParagraphElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const accept = useCallback((next: BlastState | null) => {
    setSession(next);
    if (next) setSkew(Date.parse(next.now) - Date.now());
    setNow(Date.now());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!endpoint || !active) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const response = await fetch(endpoint as string, { signal: controller.signal, cache: 'no-store' });
        if (response.ok) accept(((await response.json()) as { session?: BlastState | null }).session ?? null);
      } catch { /* The session line never interrupts review work. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void read(), POLL_MS);
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [endpoint, active, accept]);

  // The minutes tick between polls.
  useEffect(() => {
    if (!active || !session?.live) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [active, session?.live]);

  const live = Boolean(session?.live) && !stopped;
  useEffect(() => {
    if (!open) { setStopped(false); return; }
    setStatus('');
    setShowPrompt(false);
    primary.current?.focus();
  }, [open]);
  useEffect(() => { if (showPrompt) promptField.current?.select(); }, [showPrompt]);
  useEffect(() => { if (!active) setOpen(false); }, [active, setOpen]);

  function close() { setOpen(false); trigger.current?.focus(); }

  async function change(action: 'extend' | 'stop') {
    if (!endpoint || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(String(response.status));
      accept(((await response.json()) as { session?: BlastState | null }).session ?? null);
      if (action === 'stop') {
        setStopped(true);
        requestAnimationFrame(() => stoppedLine.current?.focus());
      } else setStatus('Extended 15 min');
    } catch {
      setStatus(action === 'stop' ? 'Could not stop. Run npx isotone blast --stop.' : 'Could not extend.');
    } finally { setBusy(false); }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(blastPrompt(minutes));
      setStatus('Prompt copied');
    } catch {
      setShowPrompt(true);
      setStatus('Could not copy. Select the prompt below.');
    }
  }

  if (!endpoint || !active || !loaded) return null;
  const left = session ? Date.parse(session.endsAt) - (now + skew) : 0;
  const label = stopped ? `${BLAST.name} stopped` : live ? `${BLAST.name} · ${timeLeft(left)}` : `Start ${BLAST.name}`;
  const agent = working > 0 ? `Working on ${working === 1 ? 'a note' : `${working} notes`}`
    : session?.waiting ? 'Waiting for notes' : 'Between batches';
  return <div className="isotone-blast">
    <button ref={trigger} type="button" className="isotone-update-trigger isotone-blast-trigger"
      data-live={live || stopped} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {(live || stopped) && <span className="isotone-blast-dot" data-working={live && working > 0} aria-hidden="true" />}
      {label}
    </button>
    {open && <div id={id} role="dialog" aria-label={BLAST.name} className="isotone-update-dialog isotone-blast-dialog"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="isotone-menu-title">
        <strong>{BLAST.name}</strong>
        <button type="button" className="isotone-icon" aria-label={`Close ${BLAST.name}`} title={`Close ${BLAST.name}`} onClick={close}><Icon name="close" /></button>
      </div>
      {stopped ? <p ref={stoppedLine} tabIndex={-1} className="isotone-update-requested">Stopped · your agent ends at its next check</p>
        : live && session ? <>
          <p className="isotone-blast-time">Ends {clockTime(session.endsAt)} · {timeLeft(left)}</p>
          <p className="isotone-blast-agent">{agent}</p>
          <button ref={primary} type="button" className="isotone-save isotone-update-ask" disabled={busy} onClick={() => void change('extend')}>Extend 15 min</button>
          <div className="isotone-update-actions">
            <button type="button" className="isotone-update-quiet" disabled={busy} onClick={() => void change('stop')}>Stop</button>
            <span role="status">{status}</span>
          </div>
        </> : <>
          <p>Your agent keeps acting on new notes for a set time.</p>
          <fieldset className="isotone-segs" aria-label="Duration">
            {DURATIONS.map((value) => (
              <button key={value} type="button" className="isotone-seg" aria-pressed={minutes === value}
                onClick={() => setMinutes(value)}>{value === 60 ? '1 h' : `${value} min`}</button>
            ))}
          </fieldset>
          <button ref={primary} type="button" className="isotone-save isotone-update-ask" onClick={() => void copyPrompt()}>Copy prompt</button>
          <p className="isotone-blast-hint" role="status">{status || "Paste it into your agent. Isotone can't start one."}</p>
          {showPrompt && <textarea ref={promptField} className="isotone-blast-prompt" aria-label="Agent prompt" readOnly rows={5} value={blastPrompt(minutes)} />}
        </>}
    </div>}
  </div>;
}

export const BLAST_NOTICE_CSS = `
.isotone-blast-trigger { display: inline-flex; align-items: center; gap: 5px; }
.isotone-blast-dot { width: 6px; height: 6px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--iso-muted); }
.isotone-blast-dot[data-working='true'] { background: var(--iso-focus); box-shadow: none; }
.isotone-blast-trigger[data-live='true'] { color: var(--iso-fg); }
.isotone-blast-time { font-variant-numeric: tabular-nums; }
.isotone-blast-dialog > p.isotone-blast-time { color: var(--iso-fg); }
.isotone-blast-dialog .isotone-segs { margin: 0; border: 0; min-width: 0; }
.isotone-blast-dialog .isotone-seg { flex-basis: 40px; padding: 4px 4px; font-size: 11px; }
.isotone-blast-dialog > p.isotone-blast-hint { font-size: 10px; }
.isotone-root .isotone-blast-prompt { width: 100%; padding: 6px 8px; border-radius: 5px; background: var(--iso-well); box-shadow: var(--iso-well-shadow); font-size: 11px; resize: none; }
`;
