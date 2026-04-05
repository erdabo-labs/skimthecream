import { createClient } from '@supabase/supabase-js';

function stripQuotes(s: string | undefined): string | undefined {
  return s?.replace(/^["']|["']$/g, '');
}

export function createBrowserClient() {
  const url = stripQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? stripQuotes(process.env.SUPABASE_URL);
  const key = stripQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? stripQuotes(process.env.SUPABASE_ANON_KEY);

  if (!url || !key) {
    throw new Error('Missing Supabase env vars.');
  }

  return createClient(url, key);
}
