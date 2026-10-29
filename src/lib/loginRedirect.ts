// Deep links (e.g. the "Open Settlement" buttons in approval emails) must survive the login screen:
// whoever is sent to /login remembers where they were heading in ?next=, and login returns them there.

const LOGGED_OUT_KEY = 'loggedOut';

// An explicit logout should land on the plain login screen, not bring the next login back to the page left.
export function markLoggedOut() {
  try {
    sessionStorage.setItem(LOGGED_OUT_KEY, '1');
  } catch {
    /* storage blocked - next= is then just kept */
  }
}

export function clearLoggedOutMark() {
  try {
    sessionStorage.removeItem(LOGGED_OUT_KEY);
  } catch {
    /* ignore */
  }
}

// '/login' (+ ?next=<path>) for a visitor who is not signed in. `path` includes the query string.
export function loginUrlFor(path: string): string {
  try {
    if (sessionStorage.getItem(LOGGED_OUT_KEY)) return '/login';
  } catch {
    /* ignore */
  }
  if (!path || path === '/' || path.startsWith('/login')) return '/login';
  return `/login?next=${encodeURIComponent(path)}`;
}

// Only same-site relative paths are followed, so ?next= can't be used as an open redirect.
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) return null;
  return raw;
}
