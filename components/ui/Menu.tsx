'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';

export type MenuItem =
  | {
      label: string;
      onSelect: () => void;
      icon?: React.ReactNode;
      hint?: string;
      danger?: boolean;
      checked?: boolean;
    }
  | { separator: true }
  | { heading: string };

type Props = {
  label: string;
  items: MenuItem[];
  children: React.ReactNode;
  triggerClassName?: string;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  title?: string;
};

/** Accessible dropdown: arrow keys, Home/End, Escape, and click-outside to close. */
export default function Menu({
  label, items, children, triggerClassName = 'icon-btn', align = 'end', side = 'bottom', title,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  }

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button ref={triggerRef} type="button" className={triggerClassName}
        aria-label={label} title={title ?? label} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        {children}
      </button>
      {open && (
        <div ref={menuRef} id={id} role="menu" aria-label={label}
          className={`menu menu-${align} menu-${side}`} onKeyDown={onKeyDown}>
          {items.map((item, i) => {
            if ('separator' in item) return <div key={i} className="menu-sep" role="separator" />;
            if ('heading' in item) return <div key={i} className="menu-heading">{item.heading}</div>;
            const checkable = item.checked !== undefined;
            return (
              <button key={i} type="button" tabIndex={-1}
                role={checkable ? 'menuitemradio' : 'menuitem'}
                aria-checked={checkable ? item.checked : undefined}
                className={`menu-item${item.danger ? ' danger' : ''}`}
                onClick={() => { close(); item.onSelect(); }}>
                {item.icon && <span className="menu-icon">{item.icon}</span>}
                <span className="menu-label">{item.label}</span>
                {item.hint && <kbd className="menu-hint">{item.hint}</kbd>}
                {checkable && <span className="menu-check">{item.checked && <Check size={14} />}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
