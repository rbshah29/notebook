'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SHORTCUTS, keys } from '@/lib/shortcuts';

export default function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="shortcuts-title" onClose={onClose}
      // A click on the backdrop lands on the <dialog> element itself.
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog-body">
        <header className="dialog-head">
          <h2 id="shortcuts-title">Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="shortcut-groups">
          {SHORTCUTS.map((g) => (
            <section key={g.group}>
              <h3>{g.group}</h3>
              <dl>
                {g.items.map(([label, combo]) => (
                  <div key={label} className="shortcut">
                    <dt>{label}</dt>
                    <dd><kbd>{g.group === 'Markdown' ? combo : keys(combo)}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
