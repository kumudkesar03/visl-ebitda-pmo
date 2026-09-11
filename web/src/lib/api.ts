/**
 * Thin fetch wrapper.
 *
 * Two behaviours worth noting:
 *  - a 401 anywhere sends the browser to the sign-in page, so an expired
 *    session never leaves a half-rendered screen behind;
 *  - the server's own error message is surfaced verbatim. Those messages are
 *    written to be read by the person who hit the wall ("Approval for IOK
 *    rests with IOB under the current policy"), and replacing them with a
 *    generic failure would throw away the only useful part.
 */

export class ApiError extends Error {
  status: number;
  detail?: string;
  payload: any;
  constructor(status: number, message: string, payload?: any) {
    super(message);
    this.status = status;
    this.payload = payload;
    this.detail = payload?.detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired.');
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body?.error || `Request failed (${res.status})`, body);
  return body as T;
}

export const api = {
  get:   <T>(p: string) => request<T>(p),
  post:  <T>(p: string, body?: unknown) => request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(p: string, body: unknown) => request<T>(p, { method: 'PATCH', body: JSON.stringify(body) }),
  put:   <T>(p: string, body: unknown) => request<T>(p, { method: 'PUT', body: JSON.stringify(body) }),
  del:   <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};

export function qs(params: Record<string, string | number | undefined | null>) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return q ? `?${q}` : '';
}
