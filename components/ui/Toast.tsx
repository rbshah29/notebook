'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, X } from 'lucide-react';

type ToastInput = {
  message: string;
  tone?: 'default' | 'success' | 'error';
  action?: { label: string; onClick: () => void };
  duration?: number;
};
type ToastItem = ToastInput & { id: number };

const ToastContext = createContext<(t: ToastInput) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = ++nextId.current;
    // Keep at most three on screen; the newest wins.
    setToasts((all) => [...all.slice(-2), { ...input, id }]);
    setTimeout(() => dismiss(id), input.duration ?? 4000);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone ?? 'default'}`}
            role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.tone === 'error' && <CircleAlert size={16} className="toast-icon" />}
            {t.tone === 'success' && <CircleCheck size={16} className="toast-icon" />}
            <span className="toast-msg">{t.message}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button className="toast-close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
