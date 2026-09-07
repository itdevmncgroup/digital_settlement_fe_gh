'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDate } from '@/lib/date';

interface DatePickerProps {
  /** ISO yyyy-mm-dd, or '' for empty. */
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  placeholder?: string;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseIso(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

// Custom dd-mm-yyyy date picker: a native <input type="date"> renders its
// display format from the OS/browser locale (can't be forced to dd-mm-yyyy
// cross-browser), so this owns both display and the popover calendar itself.
// The value/onChange contract stays ISO yyyy-mm-dd, same as the native input
// it replaces, so callers (date filters, forms) don't need to change.
export default function DatePicker({ value, onChange, required, disabled, style, placeholder }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const parsed = parseIso(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(parsed?.y ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed?.m ?? today.getMonth());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const p = parseIso(value);
    setViewYear(p?.y ?? today.getFullYear());
    setViewMonth(p?.m ?? today.getMonth());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(startWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

  const goMonth = (delta: number) => {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  const yearOptions = Array.from({ length: 21 }, (_, i) => today.getFullYear() - 15 + i);

  return (
    <div ref={rootRef} style={{ position: 'relative', width: style?.width ?? '100%', ...style }}>
      <button
        type="button"
        disabled={disabled}
        aria-required={required}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '9px 11px',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 13,
          fontFamily: 'inherit',
          background: 'var(--input-bg)',
          color: value ? 'var(--text)' : 'var(--muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {value ? formatDate(value) : placeholder ?? 'dd-mm-yyyy'}
      </button>

      {open && (
        <div
          className="datepicker-pop"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="datepicker-nav">
            <button type="button" className="datepicker-nav-btn" onClick={() => goMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <div className="datepicker-nav-selects">
              <select value={viewMonth} onChange={(e) => setViewMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i}>{name}</option>
                ))}
              </select>
              <select value={viewYear} onChange={(e) => setViewYear(Number(e.target.value))}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button type="button" className="datepicker-nav-btn" onClick={() => goMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="datepicker-grid">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w} className="datepicker-weekday">{w}</div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`blank-${i}`} />;
              const iso = toIso(viewYear, viewMonth, day);
              const isSelected = iso === value;
              const isToday = iso === toIso(today.getFullYear(), today.getMonth(), today.getDate());
              return (
                <button
                  key={iso}
                  type="button"
                  className={`datepicker-day${isSelected ? ' selected' : ''}${isToday ? ' today' : ''}`}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="datepicker-footer">
            <button
              type="button"
              className="datepicker-nav-btn"
              onClick={() => {
                const t = new Date();
                onChange(toIso(t.getFullYear(), t.getMonth(), t.getDate()));
                setOpen(false);
              }}
            >
              Today
            </button>
            {value && (
              <button
                type="button"
                className="datepicker-nav-btn"
                onClick={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
