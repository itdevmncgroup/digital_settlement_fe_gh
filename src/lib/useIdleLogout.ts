'use client';

import { useEffect, useRef } from 'react';

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;

// NEXT_PUBLIC_SESSION_TIMEOUT is in minutes; 0 (or unset/invalid) disables
// auto-logout entirely - no listeners/timer are registered in that case.
function getTimeoutMs(): number | null {
  const raw = process.env.NEXT_PUBLIC_SESSION_TIMEOUT;
  const minutes = Number(raw);
  if (!raw || !Number.isFinite(minutes) || minutes <= 0) return null;
  return minutes * 60 * 1000;
}

/**
 * Calls `onTimeout` after NEXT_PUBLIC_SESSION_TIMEOUT minutes with no mouse/
 * keyboard/touch/scroll activity. `onTimeout` is read via a ref so it can be
 * a fresh closure every render without re-registering the activity listeners
 * (which would otherwise reset the idle timer on every unrelated re-render).
 */
export function useIdleLogout(enabled: boolean, onTimeout: () => void) {
  const timeoutMs = getTimeoutMs();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!enabled || timeoutMs === null) return;

    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onTimeoutRef.current(), timeoutMs);
    };

    reset();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [enabled, timeoutMs]);
}
