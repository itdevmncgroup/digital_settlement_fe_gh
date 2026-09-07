'use client';

import { InputHTMLAttributes } from 'react';

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Plain numeric string, e.g. "1000000" (or "1000000.50" with allowDecimals) - never contains thousand separators. */
  value: string;
  /** Receives the plain numeric string on every keystroke. */
  onChange: (value: string) => void;
  /** Allow up to 2 decimal places (e.g. Expense Amount). Disables the live
   * thousand-separator display below - matching cursor position while typing
   * a decimal point against a reformatted "1.000.000,50" isn't worth the
   * complexity, so this mode is a plain sanitized passthrough instead. */
  allowDecimals?: boolean;
}

function formatId(digits: string): string {
  if (!digits) return '';
  return new Intl.NumberFormat('id-ID').format(Number(digits));
}

// At most one '.' and 2 digits after it.
function sanitizeDecimal(raw: string): string {
  let cleaned = raw.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
    const [intPart, decPart] = cleaned.split('.');
    cleaned = `${intPart}.${decPart.slice(0, 2)}`;
  }
  return cleaned;
}

// Live Indonesian thousand-separator formatting (1.000.000) for whole-number
// amount fields. The displayed value is always the formatted string; the
// value handed back via onChange is always the plain digit string, so
// callers can keep doing Number(form.amount) unchanged.
export default function NumberInput({ value, onChange, allowDecimals, ...rest }: NumberInputProps) {
  if (allowDecimals) {
    return (
      <input {...rest} type="text" inputMode="decimal" value={value} onChange={(e) => onChange(sanitizeDecimal(e.target.value))} />
    );
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      value={formatId(value)}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
    />
  );
}
