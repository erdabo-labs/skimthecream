import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createServerClient();

  const { error } = await supabase.from('stc_listings').select('id', { count: 'exact', head: true });

  return NextResponse.json({
    status: error ? 'degraded' : 'ok',
    supabase: error ? error.message : 'connected',
    timestamp: new Date().toISOString(),
  });
}
