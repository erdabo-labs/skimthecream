import { createClient } from '@supabase/supabase-js';

export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Ensure these are set in Vercel env vars and redeploy.'
    );
  }

  return createClient(url, key);
}
