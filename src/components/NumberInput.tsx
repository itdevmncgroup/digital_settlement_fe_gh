'use client';

import { InputHTMLAttributes } from 'react';

interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  /** Plain numeric string, e.g. "1000000" (or "1000000.50" with allowDecimals) - never contains thousand separators. */
  value: string;
  /** Receives the plain numeric string on every keystroke. */
  onChange: (value: string) => void;
  /** Allow up to 2 decimal places (e.g. Expense Amount). Displayed as
   * "1.000.000,50" (',' = decimal mark); onChange still gets "1000000.50". */
  allowDecimals?: boolean;
}

function formatId(digits: string): string {
  if (!digits) return '';
  return new Intl.NumberFormat('id-ID').format(Number(digits));
}

// Plain value "1000000.5" -> display "1.000.000,5" (id-ID: '.' thousands, ',' decimal).
// A trailing '.' in the plain value (user just typed the decimal comma) is kept.
function formatIdDecimal(plain: string): string {
  if (!plain) return '';
  const [intPart, decPart] = plain.split('.');
  const intDisplay = intPart ? new Intl.NumberFormat('id-ID').format(Number(intPart)) : '0';
  return plain.includes('.') ? `${intDisplay},${decPart ?? ''}` : intDisplay;
}

// Display string -> plain value: '.' is a thousand separator (dropped), ','
// is the decimal mark. At most one decimal mark and 2 digits after it.
function parseIdDecimal(raw: string): string {
  const cleaned = raw.replace(/\./g, '').replace(/[^0-9,]/g, '');
  const firstComma = cleaned.indexOf(',');
  if (firstComma === -1) return cleaned;
  const intPart = cleaned.slice(0, firstComma);
  const decPart = cleaned.slice(firstComma + 1).replace(/,/g, '').slice(0, 2);
  return `${intPart}.${decPart}`;
}

// Live Indonesian thousand-separator formatting (1.000.000) for amount
// fields. The displayed value is always the formatted string; the value
// handed back via onChange is always the plain numeric string (digits, and
// '.' decimal with allowDecimals), so callers can keep doing
// Number(form.amount) unchanged.
export default function NumberInput({ value, onChange, allowDecimals, ...rest }: NumberInputProps) {
  if (allowDecimals) {
    return (
      <input
        {...rest}
        type="text"
        inputMode="decimal"
        value={formatIdDecimal(value)}
        onChange={(e) => onChange(parseIdDecimal(e.target.value))}
      />
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
