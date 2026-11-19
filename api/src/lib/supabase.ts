import { createClient } from '@supabase/supabase-js';
import { env } from '../env';

export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const filesBucket = () => supabase.storage.from(env.FILES_BUCKET);

export function logoUrl(path?: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(env.LOGOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function safeFileName(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(-100) || 'file';
}

/** Short-lived signed link to a private file. */
export async function signedFileUrl(path: string, seconds = 60) {
  const { data, error } = await filesBucket().createSignedUrl(path, seconds);
  if (error || !data) return null;
  return data.signedUrl;
}
