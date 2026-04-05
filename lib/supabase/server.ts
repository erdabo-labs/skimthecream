import { createClient } from '@supabase/supabase-js';

function stripQuotes(s: string | undefined): string | undefined {
  return s?.replace(/^["']|["']$/g, '');
}

export function createServerClient() {
  const url = stripQuotes(process.env.SUPABASE_URL) ?? stripQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = stripQuotes(process.env.SUPABASE_ANON_KEY) ?? stripQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!url || !key) {
    throw new Error(
      'Missing Supabase env vars. Set SUPABASE_URL + SUPABASE_ANON_KEY (or NEXT_PUBLIC_ variants).'
    );
  }

  return createClient(url, key);
}
