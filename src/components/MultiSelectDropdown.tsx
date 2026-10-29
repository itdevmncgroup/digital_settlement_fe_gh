'use client';

import { useEffect, useRef, useState } from 'react';

interface Option {
  id: string;
  name: string;
}

// Combobox with multiple selection: a field showing what is picked that opens a checkbox list. The app has no UI
// kit, so this follows the plain-div + CSS-var convention of the other shared components.
export default function MultiSelectDropdown({
  options,
  selectedIds,
  onChange,
  placeholder = 'Select...',
  disabled,
}: {
  options: Option[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = options.filter((o) => selectedIds.includes(o.id));
  const label =
    selected.length === 0 ? placeholder : selected.length <= 2 ? selected.map((o) => o.name).join(', ') : `${selected.length} selected`;
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
  const allSelected = options.length > 0 && selected.length === options.length;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={selected.map((o) => o.name).join(', ')}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          textAlign: 'left',
          background: 'var(--input-bg, var(--surface))',
          color: selected.length === 0 ? 'var(--muted)' : 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          font: 'inherit',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--muted)' }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          style={{
            position: 'absolute',
            zIndex: 30,
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            minWidth: 200,
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-md)',
            padding: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 6px 6px', fontSize: 12 }}>
            <button
              type="button"
              className="btn"
              style={{ padding: '2px 8px' }}
              onClick={() => onChange(allSelected ? [] : options.map((o) => o.id))}
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
            <span style={{ color: 'var(--muted)', alignSelf: 'center' }}>{selected.length} selected</span>
          </div>
          {options.map((o) => (
            <label
              key={o.id}
              role="option"
              aria-selected={selectedIds.includes(o.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', fontWeight: 'normal', cursor: 'pointer', borderRadius: 4 }}
            >
              <input type="checkbox" style={{ width: 'auto' }} checked={selectedIds.includes(o.id)} onChange={() => toggle(o.id)} />
              {o.name}
            </label>
          ))}
          {options.length === 0 && <div style={{ padding: 8, color: 'var(--muted)' }}>No options</div>}
        </div>
      )}
    </div>
  );
}
