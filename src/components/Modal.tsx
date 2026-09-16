'use client';

import { ReactNode, useEffect } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Wider popup for content-heavy previews (e.g. invoice preview). */
  wide?: boolean;
}

// Generic overlay dialog - the app has no UI kit (no MUI/antd/shadcn), so this
// follows the same plain-div + inline-style + CSS-var convention as the rest
// of web-admin (see .card / .btn in globals.css).
export default function Modal({ title, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6, 7, 12, 0.65)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 24,
        animation: 'fade-in-up 0.15s ease both',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          width: '100%',
          maxWidth: wide ? 1100 : 520,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: 0,
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <strong>{title}</strong>
          <button type="button" className="btn" onClick={onClose} aria-label="Close">
            × Close
          </button>
        </div>
        <div style={{ padding: 16, overflowY: 'auto', overflowX: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
