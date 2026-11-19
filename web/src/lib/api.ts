import { supabase } from './supabase';

const BASE: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function call<T>(path: string, method: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Request failed', data.code);
  return data as T;
}

/** Agency calls: attach the staff login token. */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return call<T>(path, method, body, token ? { Authorization: `Bearer ${token}` } : {});
}

/** Client calls: attach the magic-link token only. */
export const capi = <T = any>(token: string, path: string, method = 'GET', body?: unknown) =>
  call<T>(`/api/c${path}`, method, body, { 'x-magic-token': token });

/** Upload a file straight to private storage with a short-lived permission from the API. */
export async function uploadViaSignedUrl(
  permission: { path: string; token: string; bucket: string },
  file: File,
) {
  const { error } = await supabase.storage.from(permission.bucket).uploadToSignedUrl(permission.path, permission.token, file);
  if (error) throw new Error(error.message);
}
