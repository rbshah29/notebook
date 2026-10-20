'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/** Modal built on <dialog>: focus trapping, Escape and backdrop click to close. */
export default function Dialog({ open, onClose, title, className = '', hideHeader = false, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  className?: string;
  hideHeader?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} className={`dialog ${className}`} aria-labelledby={hideHeader ? undefined : id}
      aria-label={hideHeader ? title : undefined} onClose={onClose}
      // A click on the backdrop lands on the <dialog> element itself.
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      {open && (
        <div className="dialog-body">
          {!hideHeader && (
            <header className="dialog-head">
              <h2 id={id}>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
            </header>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}
