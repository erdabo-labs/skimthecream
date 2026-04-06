import { createServerClient } from '@/lib/supabase/server';
import { DealsClient } from './deals-client';

export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const supabase = createServerClient();

  const { data: listings } = await supabase
    .from('stc_listings')
    .select('id, title, asking_price, estimated_profit, score, source, listing_url, status, created_at, parsed_product, parsed_category, price_source, feedback')
    .in('status', ['new', 'contacted'])
    .order('created_at', { ascending: false })
    .limit(100);

  return <DealsClient listings={listings ?? []} />;
}
