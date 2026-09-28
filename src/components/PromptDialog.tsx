'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';

export interface PromptOptions {
  title: string;
  /** Label shown above the textarea, e.g. "Reject reason". */
  label?: string;
  placeholder?: string;
  /** Submit stays disabled until the trimmed value reaches this length. Default 3. */
  minLength?: number;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Resolves to the trimmed value, or null if cancelled. */
type PromptFn = (options: PromptOptions) => Promise<string | null>;

const PromptContext = createContext<PromptFn | undefined>(undefined);

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void;
}

/**
 * Promise-based replacement for `window.prompt` (used app-wide for reject
 * reasons) that matches the app's own design instead of the browser's native
 * prompt dialog. Mount once (see layout.tsx), then:
 *   const prompt = usePrompt();
 *   const reason = await prompt({ title: 'Reject reason', danger: true });
 *   if (!reason) return;
 */
export function PromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const prompt = useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      setValue('');
      setPending({ ...options, resolve });
    });
  }, []);

  const close = (result: string | null) => {
    pending?.resolve(result);
    setPending(null);
  };

  const minLength = pending?.minLength ?? 3;
  const trimmed = value.trim();
  const canSubmit = trimmed.length >= minLength;

  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !trimmed) close(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {pending && (
        <div className="dialog-backdrop" onClick={() => !trimmed && close(null)}>
          <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="prompt-title" onClick={(e) => e.stopPropagation()}>
            <div className={`dialog-icon ${pending.danger ? 'dialog-icon-danger' : 'dialog-icon-info'}`}>{pending.danger ? '!' : '?'}</div>
            <h3 id="prompt-title" className="dialog-title">
              {pending.title}
            </h3>
            {pending.label && <label style={{ display: 'block', marginBottom: 4 }}>{pending.label}</label>}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={pending.placeholder}
              rows={3}
              style={{ width: '100%' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) close(trimmed);
              }}
            />
            <div className="dialog-hint">Minimum {minLength} characters</div>
            <div className="dialog-actions" style={{ marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => close(null)}>
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <button
                type="button"
                className={`btn ${pending.danger ? 'btn-danger' : 'btn-primary'}`}
                disabled={!canSubmit}
                onClick={() => close(trimmed)}
              >
                {pending.confirmLabel ?? 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PromptContext.Provider>
  );
}

export function usePrompt(): PromptFn {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error('usePrompt must be used within PromptProvider');
  return ctx;
}
