import { showOverflowTitle } from './tooltips';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { type UpdateInfo, updatePrompt } from '../core/update';
import { Icon } from './icons';

export interface UpdateNoticeProps {
  /** The local adapter's update endpoint; the browser never contacts npm. */
  endpoint?: string;
  active: boolean;
  /** The page, kept on the update note as context. */
  route?: string;
  /** An open update note already exists. */
  requested?: boolean;
  /** Offered only where notes are kept: called once the server filed the note. */
  onRequested?: () => void;
  /** Controlled by the panel, so only one notice dialog is open at a time. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** A quiet line, and a small dialog that hands the upgrade to the user's agent. */
export function UpdateNotice({ endpoint, active, route = '/', requested = false, onRequested, open: controlled, onOpenChange }: UpdateNoticeProps) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlled ?? ownOpen;
  const changeOpen = useRef(onOpenChange);
  changeOpen.current = onOpenChange;
  const setOpen = useCallback((next: boolean) => {
    setOwnOpen(next);
    changeOpen.current?.(next);
  }, []);
  const [showCommand, setShowCommand] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // Shown until the note reaches the panel's list; deleting it brings the button back.
  const [asked, setAsked] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const done = useRef<HTMLParagraphElement>(null);
  const command = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    setOpen(false);
    setInfo(null);
    if (!endpoint || !active) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => controller.abort(), 12_000);
    async function read(retried = false) {
      try {
        const response = await fetch(endpoint as string, { signal: controller.signal });
        if (!response.ok) return;
        const next = await response.json() as UpdateInfo;
        if (controller.signal.aborted) return;
        if (next.status === 'checking' && !retried) retry = setTimeout(() => void read(true), 5500);
        if (next.status === 'available' && typeof next.latestVersion === 'string') setInfo(next);
      } catch { /* Updates never interrupt local review work. */ }
    }
    void read();
    return () => { controller.abort(); clearTimeout(retry); clearTimeout(deadline); };
  }, [endpoint, active, setOpen]);
  useEffect(() => { if (requested) setAsked(false); }, [requested]);
  useEffect(() => {
    if (!open) return;
    setStatus('');
    setShowCommand(false);
    (primary.current ?? closeButton.current)?.focus();
  }, [open]);
  useEffect(() => { if (showCommand) command.current?.focus(); }, [showCommand]);
  function close() { setOpen(false); trigger.current?.focus(); }
  async function ask() {
    if (!endpoint || busy) return;
    setBusy(true);
    setStatus('');
    try {
      // Only the page goes along: the server writes the versions and command.
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setAsked(true);
      onRequested?.();
      requestAnimationFrame(() => done.current?.focus());
    } catch { setStatus('Could not ask. Copy the prompt instead.'); }
    finally { setBusy(false); }
  }
  async function copyPrompt() {
    if (!info?.upgrade || !info.latestVersion) return;
    const text = updatePrompt({ from: info.currentVersion, to: info.latestVersion, ...info.upgrade });
    try { await navigator.clipboard.writeText(text); setStatus('Prompt copied'); }
    catch {
      setShowCommand(true);
      setStatus('Could not copy. The command is below.');
    }
  }
  if (!active || !info) return null;
  const pending = requested || asked;
  const canAsk = Boolean(onRequested && info.upgrade);
  return <div className="isotone-update">
    <button ref={trigger} type="button" className="isotone-update-trigger"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {pending ? 'Update requested' : `Isotone ${info.latestVersion} is available`}
    </button>
    {open && <div id={id} role="dialog" aria-label="Update Isotone" className="isotone-update-dialog"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="isotone-menu-title">
        <strong className="isotone-update-versions">{info.currentVersion} → {info.latestVersion}</strong>
        <button ref={closeButton} type="button" className="isotone-icon" aria-label="Close update" title="Close update" onClick={close}><Icon name="close" /></button>
      </div>
      {info.upgrade ? <>
        {canAsk && (pending
          ? <p ref={done} tabIndex={-1} className="isotone-update-requested">Update requested · in Feedback</p>
          : <button ref={primary} type="button" className="isotone-save isotone-update-ask" disabled={busy} onClick={() => void ask()}>Ask agent to update</button>)}
        <div className="isotone-update-actions">
          <button ref={canAsk ? undefined : primary} type="button" className="isotone-update-quiet" onClick={() => void copyPrompt()}>Copy prompt</button>
          <button type="button" className="isotone-update-quiet" aria-expanded={showCommand} onClick={() => setShowCommand(value => !value)}>Command</button>
          <span role="status">{status}</span>
        </div>
        {showCommand && <div className="isotone-update-command">
          <input ref={command} aria-label="Upgrade command" readOnly value={info.upgrade.command} onFocus={event => event.currentTarget.select()} />
          <span className="isotone-update-path" onPointerOver={showOverflowTitle}>in {info.upgrade.cwd}</span>
        </div>}
      </> : <p>{info.message ?? 'Run isotone check-update in the app directory for upgrade instructions.'}</p>}
    </div>}
  </div>;
}

export const UPDATE_NOTICE_CSS = `
.isotone-notices { position: absolute; z-index: 5; bottom: 10px; right: calc(var(--iso-rail-length) + 10px); display: flex; flex-direction: row-reverse; flex-wrap: wrap-reverse; align-items: center; justify-content: flex-start; gap: 6px; width: max-content; max-width: calc(100vw - var(--iso-rail-length) - 36px); pointer-events: none; }
.isotone-root[data-tools='1'] .isotone-notices { right: calc(var(--iso-rail-size) + 10px); max-width: calc(100vw - var(--iso-rail-size) - 36px); }
.isotone-notices > * { pointer-events: auto; }
.isotone-update-trigger { white-space: nowrap; color: var(--iso-muted); font-size: 10px; padding: 4px 6px; border-radius: 5px; background: var(--iso-bg); box-shadow: 0 0 0 1px var(--iso-line); }
.isotone-update-dialog { position: absolute; right: calc(0px - var(--iso-rail-length) - 10px); bottom: 40px; width: min(var(--iso-dock-width), 260px); max-width: calc(100vw - 32px); max-height: calc(100dvh - 100px); overflow: auto; padding: 10px var(--iso-space) var(--iso-space); display: grid; gap: 8px; border-radius: 8px; background: var(--iso-bg); box-shadow: var(--iso-popup-shadow); font-size: 11px; }
.isotone-root[data-tools='1'] .isotone-update-dialog { right: calc(0px - var(--iso-rail-size) - 10px); }
.isotone-update-dialog .isotone-menu-title { padding: 0; background: none; }
.isotone-update-versions { font-variant-numeric: tabular-nums; }
.isotone-update-dialog > p { color: var(--iso-muted); }
.isotone-root .isotone-update-ask { min-height: 28px; padding: 4px 10px; font-weight: 500; }
.isotone-update-requested { min-height: 28px; display: flex; align-items: center; outline-offset: 2px; }
.isotone-update-actions { display: flex; align-items: center; gap: 2px; margin: -4px 0 -4px -6px; }
.isotone-root .isotone-update-quiet { padding: 4px 6px; border-radius: 5px; color: var(--iso-muted); font-size: 11px; background: none; box-shadow: none; }
.isotone-update-quiet[aria-expanded='true'] { color: var(--iso-fg); }
.isotone-update-actions [role='status'] { min-width: 0; margin-left: auto; color: var(--iso-muted); font-size: 10px; text-align: right; }
.isotone-update-command { display: grid; gap: 4px; min-width: 0; }
.isotone-update-path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--iso-muted); font-size: 10px; }
.isotone-root .isotone-update-dialog input { width: 100%; padding: 6px 8px; border-radius: 5px; background: var(--iso-well); box-shadow: var(--iso-well-shadow); font-size: 11px; }
@media (pointer: coarse) { .isotone-root .isotone-update-quiet { padding: 9px 6px; } .isotone-update-actions { margin: -9px 0 -9px -6px; } }
@media (hover: hover) and (pointer: fine) { .isotone-update-trigger:hover, .isotone-root .isotone-update-quiet:hover { color: var(--iso-fg); } }
`;
