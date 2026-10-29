import { loginUrlFor } from './loginRedirect';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('accessToken');
}

function forceLogin() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.href = loginUrlFor(`${window.location.pathname}${window.location.search}`);
}

// The backend's access token is short-lived (JWT_ACCESS_EXPIRES_IN, 15m by
// default) while its refresh token lasts days (JWT_REFRESH_EXPIRES_IN). Without
// spending the refresh token, every session died at the access token's expiry -
// an auto-logout that ignored both NEXT_PUBLIC_SESSION_TIMEOUT and whether the
// user was actually active. Shared across concurrent 401s so a page firing
// several requests at once refreshes once instead of racing.
let refreshInFlight: Promise<string | null> | null = null;

function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return Promise.resolve(null);

  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// /auth/login and /auth/refresh answer 401 to mean "these credentials are
// wrong", not "your session expired" - retrying or bouncing to /login there
// would just reload the login page and wipe the error the user needs to see.
function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
}

/**
 * fetch + bearer token, with a one-shot refresh-and-retry on 401. Only when the
 * refresh itself fails (refresh token missing/expired/rejected) is the session
 * cleared and the user sent back to login.
 */
async function authedFetch(path: string, init: RequestInit = {}, baseHeaders: Record<string, string> = {}): Promise<Response> {
  const send = (token: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...baseHeaders,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });

  const res = await send(getToken());
  if (res.status !== 401 || isAuthEndpoint(path)) return res;

  const newToken = await refreshAccessToken();
  if (!newToken) {
    forceLogin();
    return res;
  }

  const retried = await send(newToken);
  if (retried.status === 401) forceLogin();
  return retried;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, options, { 'Content-Type': 'application/json' });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message || 'Request failed');
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) => request<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Several files under one multipart field (default "files"), for endpoints taking FilesInterceptor.
// `extra` adds more multipart parts: `files` = other file fields, `fields` = plain text fields.
export async function uploadFiles<T = unknown>(
  path: string,
  files: File[],
  fieldName = 'files',
  extra?: { files?: Record<string, File[]>; fields?: Record<string, string>; method?: 'POST' | 'PATCH' },
): Promise<T> {
  const form = new FormData();
  for (const file of files) form.append(fieldName, file);
  for (const [name, list] of Object.entries(extra?.files ?? {})) for (const file of list) form.append(name, file);
  for (const [name, value] of Object.entries(extra?.fields ?? {})) form.append(name, value);
  const res = await authedFetch(path, { method: extra?.method ?? 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message || 'Upload failed');
  }
  return res.json();
}

export async function uploadFile(path: string, file: File, extraQuery = '', fields?: Record<string, string>): Promise<unknown> {
  const form = new FormData();
  form.append('file', file);
  if (fields) {
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
  }
  // No Content-Type header - the browser sets it with the multipart boundary.
  const res = await authedFetch(`${path}${extraQuery}`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || 'Upload failed');
  }
  return res.json();
}

/** POSTs multipart form fields plus an optional `file`, and returns the JSON response. */
export async function postForm<T>(path: string, fields: Record<string, string>, file?: File | null): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append('file', file);
  const res = await authedFetch(path, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new ApiError(res.status, message || 'Request failed');
  }
  return res.json();
}

/**
 * Fetches a file from an authenticated endpoint and triggers a browser download.
 * Pass `upload` to POST a file (multipart field `file`) and download the response instead.
 */
export async function downloadFile(path: string, fallbackFileName: string, upload?: File | null): Promise<void> {
  let init: RequestInit = {};
  if (upload) {
    const form = new FormData();
    form.append('file', upload);
    init = { method: 'POST', body: form };
  }
  const res = await authedFetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || 'Download failed');
  }

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const fileName = match?.[1] || fallbackFileName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking right after click() can cut a larger file's download short (an unreadable
  // PDF/xlsx) - give the browser time to start reading the blob first.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Fetches a file from an authenticated endpoint and returns a blob: URL for
 * viewing (e.g. in an <img> or a new tab) rather than forcing a download.
 * Caller owns the URL and should URL.revokeObjectURL it when no longer needed.
 */
export async function fetchAuthedBlobUrl(path: string): Promise<string> {
  const res = await authedFetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, body.message || 'Failed to load file');
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
