import { showOverflowTitle } from './tooltips';
import { useEffect, useId, useRef, useState } from 'react';
import type { UpdateInfo } from '../core/update';
import { Icon } from './icons';

/** Read the local adapter's cached result; the browser never contacts npm. */
export function UpdateNotice({ endpoint, active }: { endpoint?: string; active: boolean }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
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
  }, [endpoint, active]);
  useEffect(() => {
    if (open) { setCopied(false); (command.current ?? closeButton.current)?.focus(); }
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  async function copy() {
    if (!info?.upgrade) return;
    try { await navigator.clipboard.writeText(info.upgrade.command); setCopied(true); }
    catch { command.current?.focus(); command.current?.select(); }
  }
  if (!active || !info) return null;
  return <div className="iso-iter-update">
    <button ref={trigger} type="button" className="iso-iter-update-trigger"
      aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      Update {info.latestVersion}
    </button>
    {open && <div id={id} role="dialog" aria-label="Update iso-iterate" className="iso-iter-update-dialog"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="iso-iter-menu-title"><strong>Update available</strong>
        <button ref={closeButton} type="button" className="iso-iter-icon" aria-label="Close update instructions" title="Close update instructions" onClick={close}><Icon name="close" /></button>
      </div>
      <p>{info.currentVersion} → {info.latestVersion}</p>
      {info.upgrade ? <>
        <p>Run in <span className="iso-iter-update-path" onPointerOver={showOverflowTitle}>{info.upgrade.cwd}</span></p>
        <input ref={command} aria-label="Upgrade command" readOnly value={info.upgrade.command} onFocus={event => event.currentTarget.select()} />
        <div className="iso-iter-update-actions"><button type="button" className="iso-iter-secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy command'}</button><span role="status">{copied ? 'Ready to paste in your terminal' : ''}</span></div>
        <p>Restart the dev server after upgrading.</p>
      </> : <p>{info.message ?? 'Run iso-iterate check-update in the app directory for upgrade instructions.'}</p>}
    </div>}
  </div>;
}

export const UPDATE_NOTICE_CSS = `
.iso-iter-update { position: absolute; z-index: 5; bottom: 10px; right: calc(var(--iso-rail-length) + 10px); pointer-events: auto; }
.iso-iter-root[data-tools='1'] .iso-iter-update { right: calc(var(--iso-rail-size) + 10px); }
.iso-iter-update-trigger { white-space: nowrap; color: var(--iso-muted); font-size: 10px; padding: 4px 6px; border-radius: 5px; background: var(--iso-bg); box-shadow: 0 0 0 1px var(--iso-line); }
.iso-iter-update-dialog { position: absolute; right: calc(0px - var(--iso-rail-length) - 10px); bottom: 40px; width: var(--iso-dock-width); max-height: calc(100dvh - 100px); overflow: auto; padding: var(--iso-space); display: grid; gap: 8px; border-radius: 8px; background: var(--iso-bg); box-shadow: var(--iso-popup-shadow); font-size: 11px; }
.iso-iter-root[data-tools='1'] .iso-iter-update-dialog { right: calc(0px - var(--iso-rail-size) - 10px); }
.iso-iter-update-dialog .iso-iter-menu-title { padding: 0; background: none; }
.iso-iter-update-dialog > p { color: var(--iso-muted); }
.iso-iter-update-path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iso-iter-root .iso-iter-update-dialog input { width: 100%; padding: 8px; border-radius: 5px; background: var(--iso-well); box-shadow: var(--iso-well-shadow); font-size: 11px; }
.iso-iter-update-actions { display: flex; align-items: center; gap: 8px; }
.iso-iter-update-actions [role='status'] { color: var(--iso-muted); font-size: 10px; }
@media (hover: hover) and (pointer: fine) { .iso-iter-update-trigger:hover { color: var(--iso-fg); } }
`;
