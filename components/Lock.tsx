'use client';
import { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { isPin } from '@/lib/locks';

/** Four masked digits. Calls onComplete as soon as the fourth digit is typed. */
function PinInput({ value, onChange, onComplete, label, autoFocus, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  label: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (!disabled && autoFocus) ref.current?.focus(); }, [disabled, autoFocus]);

  return (
    <div className="pin-field" onClick={() => ref.current?.focus()}>
      <input ref={ref} className="pin-input" type="password" inputMode="numeric" autoComplete="off"
        maxLength={4} aria-label={label} value={value} disabled={disabled}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 4);
          onChange(v);
          if (v.length === 4) onComplete?.(v);
        }} />
      <div className="pin-cells" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`pin-cell${i < value.length ? ' filled' : ''}${i === value.length ? ' current' : ''}`} />
        ))}
      </div>
    </div>
  );
}

/**
 * PIN prompt. "set" asks twice and confirms they match; "verify" submits on the fourth digit.
 * onSubmit resolves to an error message to show, or null when done (the caller closes it).
 */
export function PinDialog({ open, mode, title, description, submitLabel, danger, onSubmit, onClose }: {
  open: boolean;
  mode: 'set' | 'verify';
  title: string;
  description: React.ReactNode;
  submitLabel: string;
  danger?: boolean;
  onSubmit: (pin: string) => Promise<string | null>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} className="pin-dialog">
      <PinForm mode={mode} description={description} submitLabel={submitLabel} danger={danger} onSubmit={onSubmit} />
    </Dialog>
  );
}

function PinForm({ mode, description, submitLabel, danger, onSubmit }: {
  mode: 'set' | 'verify';
  description: React.ReactNode;
  submitLabel: string;
  danger?: boolean;
  onSubmit: (pin: string) => Promise<string | null>;
}) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(p = pin, c = confirm) {
    if (busy || !isPin(p)) return;
    if (mode === 'set' && p !== c) {
      setError('The PINs don’t match.');
      setConfirm('');
      return;
    }
    setBusy(true);
    setError(null);
    const message = await onSubmit(p);
    setBusy(false);
    if (message) {
      setError(message);
      setPin('');
      setConfirm('');
    }
  }

  return (
    <form className="pin-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="pin-desc">{description}</div>
      <label className="pin-label">
        <span>{mode === 'set' ? 'New PIN' : 'PIN'}</span>
        <PinInput label={mode === 'set' ? 'New PIN' : 'PIN'} value={pin} onChange={setPin} autoFocus disabled={busy}
          onComplete={mode === 'verify' ? (v) => submit(v) : undefined} />
      </label>
      {mode === 'set' && (
        <label className="pin-label">
          <span>Confirm PIN</span>
          <PinInput label="Confirm PIN" value={confirm} onChange={setConfirm} disabled={busy || pin.length < 4}
            autoFocus={pin.length === 4} onComplete={(v) => submit(pin, v)} />
        </label>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className={`btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}`}
        disabled={busy || !isPin(pin) || (mode === 'set' && !isPin(confirm))}>
        {busy ? 'Checking…' : submitLabel}
      </button>
    </form>
  );
}

/** Shown in place of the editor until the note's PIN is entered. */
export function LockScreen({ title, leading, actions, onUnlock }: {
  title: string;
  leading: React.ReactNode;
  actions?: React.ReactNode;
  onUnlock: (pin: string) => Promise<string | null>;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(p: string) {
    setBusy(true);
    setError(null);
    const message = await onUnlock(p);
    setBusy(false);
    if (message) {
      setError(message);
      setPin('');
    }
  }

  return (
    <div className="note">
      <header className="note-bar">
        <div className="note-bar-start">{leading}</div>
        <div className="note-bar-end">{actions}</div>
      </header>
      <form className="lock-screen" onSubmit={(e) => { e.preventDefault(); if (isPin(pin)) submit(pin); }}>
        <div className="empty-icon"><Lock size={26} strokeWidth={1.5} /></div>
        <h1>{title.trim() || 'Untitled'}</h1>
        <p>This note is locked. Enter its PIN to open it.</p>
        <PinInput label="PIN" value={pin} onChange={setPin} onComplete={submit} autoFocus disabled={busy} />
        <p className={`lock-error${error ? '' : ' empty'}`} role="alert">{error ?? (busy ? 'Checking…' : '')}</p>
      </form>
    </div>
  );
}
