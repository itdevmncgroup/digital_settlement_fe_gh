export type ViewMode = 'mobile' | 'desktop';

export const VIEW_STORAGE_KEY = 'viewMode';

// Phone/tablet browsers -> mobile view; anything else -> desktop. UA sniffing
// plus a coarse-pointer narrow-screen check (iPadOS reports a desktop UA).
export function detectDefaultView(): ViewMode {
  if (typeof window === 'undefined') return 'desktop';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
  const narrowTouch = window.matchMedia('(max-width: 900px) and (pointer: coarse)').matches;
  return uaMobile || narrowTouch ? 'mobile' : 'desktop';
}

// The user's saved choice wins; otherwise fall back to the device default.
export function resolveViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'mobile' || stored === 'desktop') return stored;
  } catch {
    /* storage blocked - use device default */
  }
  return detectDefaultView();
}
