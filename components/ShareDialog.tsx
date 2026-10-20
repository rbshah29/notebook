'use client';
import { useState } from 'react';
import { Globe, Copy, Check, ExternalLink, Lock } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import { setShareToken, shareUrl, sharingAvailable, type Note } from '@/lib/notes';

export default function ShareDialog({ note, open, onClose, onShared }: {
  note: Note | null;
  open: boolean;
  onClose: () => void;
  /** Called after the token changed in Supabase. */
  onShared: (id: string, token: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const token = note?.share_token ?? null;
  const url = token ? shareUrl(token) : '';

  async function change(next: string | null) {
    if (!note) return;
    setBusy(true);
    setError(null);
    const { error: err } = await setShareToken(note.id, next);
    setBusy(false);
    if (err) return setError(err.message);
    onShared(note.id, next);
  }

  function copy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  }

  return (
    <Dialog open={open} onClose={onClose} title="Share note" className="share-dialog">
      {!sharingAvailable ? (
        <div className="share-setup">
          <p>Sharing needs a one-time database update.</p>
          <p>Open your Supabase project → SQL Editor, run <code>supabase/sharing-and-images.sql</code>, then reload this page.</p>
        </div>
      ) : (
        <>
          <div className="share-state">
            <span className={`share-icon${token ? ' on' : ''}`}>{token ? <Globe size={18} /> : <Lock size={18} />}</span>
            <div>
              <strong>{token ? 'Anyone with the link can view' : 'Only you can see this note'}</strong>
              <p>{token
                ? 'Read-only. Viewers see the latest saved version, and don’t need an account.'
                : 'Create a read-only link you can send to anyone.'}</p>
            </div>
          </div>
          {token ? (
            <>
              <div className="share-link">
                <input readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
                <button className="btn btn-sm" onClick={copy}>
                  {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
                </button>
              </div>
              <div className="share-actions">
                <a className="btn btn-sm" href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={14} /> Open
                </a>
                <button className="btn btn-sm danger" onClick={() => change(null)} disabled={busy}>
                  Stop sharing
                </button>
              </div>
            </>
          ) : (
            <button className="btn btn-primary btn-block" disabled={busy || !note}
              onClick={() => change(crypto.randomUUID())}>
              <Globe size={15} /> {busy ? 'Creating link…' : 'Create public link'}
            </button>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </>
      )}
    </Dialog>
  );
}
