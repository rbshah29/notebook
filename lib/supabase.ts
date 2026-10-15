import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key);

function createSupabaseClient(url: string, key: string) {
  return createClient(url, key);
}

let client: ReturnType<typeof createSupabaseClient> | undefined;

export function getSupabase() {
  if (!url || !key) {
    throw new Error('Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return client ??= createSupabaseClient(url, key);
}
