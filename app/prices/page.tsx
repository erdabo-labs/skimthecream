import { createServerClient } from '@/lib/supabase/server';
import { PricesClient } from './prices-client';

export const dynamic = 'force-dynamic';

export default async function PricesPage() {
  const supabase = createServerClient();

  const { data: prices } = await supabase
    .from('stc_market_prices')
    .select('*')
    .order('category', { ascending: true })
    .order('product_name', { ascending: true });

  return <PricesClient prices={prices ?? []} />;
}
