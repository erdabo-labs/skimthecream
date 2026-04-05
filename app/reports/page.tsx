import { createServerClient } from '@/lib/supabase/server';
import { ReportsClient } from './reports-client';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const supabase = createServerClient();

  const { data: soldItems } = await supabase
    .from('stc_inventory')
    .select('*')
    .eq('status', 'sold')
    .order('sold_date', { ascending: true });

  return <ReportsClient soldItems={soldItems ?? []} />;
}
