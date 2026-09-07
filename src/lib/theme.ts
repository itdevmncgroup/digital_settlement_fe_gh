export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';
const DEFAULT_THEME: Theme = 'dark';

// Inlined into <head> (see layout.tsx) so the theme attribute is set before
// first paint - avoids a flash of the wrong theme on load.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem('${STORAGE_KEY}') || '${DEFAULT_THEME}';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`;

export function getTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  return (document.documentElement.getAttribute('data-theme') as Theme) || DEFAULT_THEME;
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}
