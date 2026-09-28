'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
  leaving: boolean;
}

interface ToastOptions {
  /** ms before auto-dismiss. 0 disables auto-dismiss. */
  duration?: number;
}

interface ToastApi {
  show: (type: ToastType, message: string, options?: ToastOptions) => void;
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string, options?: ToastOptions) => void;
  warning: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

// Errors are read (not just glanced at) before they auto-dismiss, so they get
// noticeably longer on screen than a success/info blip.
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3500,
  info: 3500,
  warning: 4500,
  error: 6000,
};

const ICON: Record<ToastType, string> = {
  success: '✓',
  error: '!',
  warning: '!',
  info: 'i',
};

let idSeq = 0;

// A plain module-level pointer (set by the provider on mount) alongside the
// context, so code outside React's tree - src/lib/api.ts's network-layer
// error handling, which can't call a hook - can still surface a toast.
let externalApi: ToastApi | null = null;

export function toast(type: ToastType, message: string, options?: ToastOptions) {
  externalApi?.show(type, message, options);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    // Mark leaving first so the exit animation plays, then remove after it finishes.
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, leaving: true } : it)));
    setTimeout(() => setItems((prev) => prev.filter((it) => it.id !== id)), 200);
  }, []);

  const show = useCallback(
    (type: ToastType, message: string, options?: ToastOptions) => {
      const id = ++idSeq;
      const duration = options?.duration ?? DEFAULT_DURATION[type];
      setItems((prev) => [...prev, { id, type, message, duration, leaving: false }]);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
    },
    [dismiss],
  );

  const api = useRef<ToastApi>({
    show,
    success: (message, options) => show('success', message, options),
    error: (message, options) => show('error', message, options),
    warning: (message, options) => show('warning', message, options),
    info: (message, options) => show('info', message, options),
  });
  api.current.show = show;

  useEffect(() => {
    externalApi = api.current;
    return () => {
      externalApi = null;
      timers.current.forEach(clearTimeout);
    };
  }, []);

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="toast-viewport" role="region" aria-live="polite" aria-label="Notifications">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.type}${item.leaving ? ' toast-leaving' : ''}`} role="status">
            <span className="toast-icon">{ICON[item.type]}</span>
            <div className="toast-body">{item.message}</div>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
              ×
            </button>
            {item.duration > 0 && !item.leaving && (
              <span className="toast-progress" style={{ animationDuration: `${item.duration}ms` }} />
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
