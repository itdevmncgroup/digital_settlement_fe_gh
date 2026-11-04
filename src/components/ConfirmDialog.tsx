'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button/icon as a destructive action (delete/reject/...). */
  danger?: boolean;
  /** Notice-only dialog: a single OK button, no Cancel (see useAlert). */
  hideCancel?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
type AlertFn = (options: { title: string; message?: ReactNode; confirmLabel?: string }) => Promise<void>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/**
 * Promise-based replacement for `window.confirm` that matches the app's own
 * design language instead of the browser's native dialog. Mount once (see
 * layout.tsx), then anywhere below it: `const confirm = useConfirm(); if
 * (await confirm({ title: '...', danger: true })) { ... }`.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const close = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
  };

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="dialog-backdrop" onClick={() => close(false)}>
          <div className="dialog-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <div className={`dialog-icon ${pending.danger || pending.hideCancel ? 'dialog-icon-danger' : 'dialog-icon-info'}`}>{pending.danger || pending.hideCancel ? '!' : '?'}</div>
            <h3 id="confirm-title" className="dialog-title">
              {pending.title}
            </h3>
            {pending.message && <p className="dialog-message">{pending.message}</p>}
            <div className="dialog-actions">
              {!pending.hideCancel && (
                <button type="button" className="btn" onClick={() => close(false)}>
                  {pending.cancelLabel ?? 'Cancel'}
                </button>
              )}
              <button
                ref={confirmBtnRef}
                type="button"
                className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? (pending.danger ? 'Delete' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

/**
 * Popup that just tells the user something (an error they must notice, unlike a toast that fades):
 * `const alert = useAlert(); await alert({ title: 'OCR scan failed', message: err.message })`.
 */
export function useAlert(): AlertFn {
  const confirm = useConfirm();
  return useCallback<AlertFn>(
    async ({ title, message, confirmLabel }) => {
      await confirm({ title, message, confirmLabel: confirmLabel ?? 'OK', hideCancel: true });
    },
    [confirm],
  );
}
