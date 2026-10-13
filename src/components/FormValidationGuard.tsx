'use client';

import { useEffect } from 'react';
import { useToast } from './ToastProvider';

type Validatable = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isValidatable(el: EventTarget | null): el is Validatable {
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

// Best-effort human label for a form field, tried in the same order a sighted
// user would read it: an associated <label>, then the usual fallbacks.
function getFieldLabel(el: Validatable): string {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const wrappingLabel = el.closest('label');
  if (wrappingLabel?.textContent?.trim()) return wrappingLabel.textContent.trim();
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();
  if ('placeholder' in el && el.placeholder?.trim()) return el.placeholder.trim();
  if (el.name?.trim()) return el.name.trim();
  return 'This field';
}

function clearInvalid(el: Validatable) {
  el.classList.remove('field-invalid');
  el.removeEventListener('input', el._fvgClearHandler as EventListener);
  el.removeEventListener('change', el._fvgClearHandler as EventListener);
}

declare global {
  interface Element {
    _fvgClearHandler?: () => void;
  }
}

/**
 * App-wide replacement for the browser's native "please fill out this field"
 * validation bubble - captured once here instead of touching every form.
 *
 * The native `invalid` event does not bubble, but capture-phase listeners on
 * `document` still see it during the capture pass, so a single listener here
 * catches every `required`/`type=email`/... failure from every <form> in the
 * app. Mount once (see layout.tsx).
 */
export default function FormValidationGuard() {
  const toast = useToast();

  useEffect(() => {
    // A submit attempt fires one native `invalid` event per failing field,
    // all synchronously in the same tick - batched per <form> so a single
    // toast summarizes the whole attempt instead of one per field.
    const pendingByForm = new Map<HTMLFormElement, Validatable[]>();

    const flush = (form: HTMLFormElement) => {
      const fields = pendingByForm.get(form);
      pendingByForm.delete(form);
      if (!fields || fields.length === 0) return;

      const message = fields.length === 1 ? `Please fill in the "${getFieldLabel(fields[0])}" field before continuing.` : 'Please fill in the following fields.';
      toast.error(message);
      fields[0].focus();
    };

    const onInvalid = (e: Event) => {
      const target = e.target;
      if (!isValidatable(target)) return;
      const form = target.form;
      if (!form) return;

      // Suppress the native bubble/tooltip - the toast + highlight below replace it.
      e.preventDefault();

      target.classList.add('field-invalid');
      const clear = () => clearInvalid(target);
      target._fvgClearHandler = clear;
      target.addEventListener('input', clear, { once: true });
      target.addEventListener('change', clear, { once: true });

      const existing = pendingByForm.get(form);
      if (existing) {
        existing.push(target);
      } else {
        pendingByForm.set(form, [target]);
        // All `invalid` events for one submit attempt fire synchronously -
        // a macrotask delay guarantees every one of them has already landed
        // in `pendingByForm` before this runs.
        setTimeout(() => flush(form), 0);
      }
    };

    document.addEventListener('invalid', onInvalid, true);
    return () => document.removeEventListener('invalid', onInvalid, true);
  }, [toast]);

  return null;
}
