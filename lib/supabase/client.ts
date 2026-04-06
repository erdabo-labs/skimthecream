import { createClient } from '@supabase/supabase-js';

function cleanEnvVar(s: string | undefined): string | undefined {
  return s?.replace(/^["']|["']$/g, '').trim();
}

export function createBrowserClient() {
  const url = cleanEnvVar(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? cleanEnvVar(process.env.SUPABASE_URL);
  const key = cleanEnvVar(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? cleanEnvVar(process.env.SUPABASE_ANON_KEY);

  if (!url || !key) {
    throw new Error('Missing Supabase env vars.');
  }

  return createClient(url, key);
}
