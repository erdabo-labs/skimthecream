import { createClient } from '@supabase/supabase-js';

function cleanEnvVar(s: string | undefined): string | undefined {
  return s?.replace(/^["']|["']$/g, '').trim();
}

export function createServerClient() {
  const url = cleanEnvVar(process.env.SUPABASE_URL) ?? cleanEnvVar(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = cleanEnvVar(process.env.SUPABASE_ANON_KEY) ?? cleanEnvVar(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !key) {
    throw new Error(
      'Missing Supabase env vars. Set SUPABASE_URL + SUPABASE_ANON_KEY (or NEXT_PUBLIC_ variants).'
    );
  }

  return createClient(url, key);
}
