import { showOverflowTitle } from '../tooltips';
import { useEffect, useId, useRef, useState } from 'react';
import { type UpdateInfo, updatePrompt } from '../../core/update';
import { Icon } from '../icons';

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
}

/** A quiet line, and a small dialog that hands the upgrade to the user's agent. */
export function UpdateNotice({ endpoint, active, route = '/', requested = false, onRequested }: UpdateNoticeProps) {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
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
        const next = (await response.json()) as UpdateInfo;
        if (controller.signal.aborted) return;
        if (next.status === 'checking' && !retried) retry = setTimeout(() => void read(true), 5500);
        if (next.status === 'available' && typeof next.latestVersion === 'string') setInfo(next);
      } catch {
        /* Updates never interrupt local review work. */
      }
    }
    void read();
    return () => {
      controller.abort();
      clearTimeout(retry);
      clearTimeout(deadline);
    };
  }, [endpoint, active]);
  useEffect(() => {
    if (requested) setAsked(false);
  }, [requested]);
  useEffect(() => {
    if (!open) return;
    setStatus('');
    setShowCommand(false);
    (primary.current ?? closeButton.current)?.focus();
  }, [open]);
  useEffect(() => {
    if (showCommand) command.current?.focus();
  }, [showCommand]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function ask() {
    if (!endpoint || busy) return;
    setBusy(true);
    setStatus('');
    try {
      // Only the page goes along: the server writes the versions and command.
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ route }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setAsked(true);
      onRequested?.();
      requestAnimationFrame(() => done.current?.focus());
    } catch {
      setStatus('Could not ask. Copy the prompt instead.');
    } finally {
      setBusy(false);
    }
  }
  async function copyPrompt() {
    if (!info?.upgrade || !info.latestVersion) return;
    const text = updatePrompt({ from: info.currentVersion, to: info.latestVersion, ...info.upgrade });
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Prompt copied');
    } catch {
      setShowCommand(true);
      setStatus('Could not copy. The command is below.');
    }
  }
  if (!active || !info) return null;
  const pending = requested || asked;
  const canAsk = Boolean(onRequested && info.upgrade);
  return (
    <div className="isotone-update">
      <button
        ref={trigger}
        type="button"
        className="isotone-update-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {pending ? 'Update requested' : `Isotone ${info.latestVersion} is available`}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Update Isotone"
          className="isotone-update-dialog"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="isotone-menu-title">
            <strong className="isotone-update-versions">
              {info.currentVersion} → {info.latestVersion}
            </strong>
            <button ref={closeButton} type="button" className="isotone-icon" aria-label="Close update" title="Close update" onClick={close}>
              <Icon name="close" />
            </button>
          </div>
          {info.upgrade ? (
            <>
              {canAsk &&
                (pending ? (
                  <p ref={done} tabIndex={-1} className="isotone-update-requested">
                    Update requested · in Feedback
                  </p>
                ) : (
                  <button
                    ref={primary}
                    type="button"
                    className="isotone-save isotone-update-ask"
                    disabled={busy}
                    onClick={() => void ask()}
                  >
                    Ask agent to update
                  </button>
                ))}
              <div className="isotone-update-actions">
                <button ref={canAsk ? undefined : primary} type="button" className="isotone-update-quiet" onClick={() => void copyPrompt()}>
                  Copy prompt
                </button>
                <button
                  type="button"
                  className="isotone-update-quiet"
                  aria-expanded={showCommand}
                  onClick={() => setShowCommand((value) => !value)}
                >
                  Command
                </button>
                <span role="status">{status}</span>
              </div>
              {showCommand && (
                <div className="isotone-update-command">
                  <input
                    ref={command}
                    aria-label="Upgrade command"
                    readOnly
                    value={info.upgrade.command}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                  <span className="isotone-update-path" onPointerOver={showOverflowTitle}>
                    in {info.upgrade.cwd}
                  </span>
                </div>
              )}
            </>
          ) : (
            <p>{info.message ?? 'Run isotone check-update in the app directory for upgrade instructions.'}</p>
          )}
        </div>
      )}
    </div>
  );
}
