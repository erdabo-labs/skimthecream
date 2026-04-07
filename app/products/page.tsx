import { createServerClient } from '@/lib/supabase/server';
import { ProductsClient } from './products-client';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const supabase = createServerClient();

  const [pendingRes, activeRes, inactiveRes, rulesRes] = await Promise.all([
    supabase
      .from('stc_products')
      .select('*')
      .eq('status', 'pending')
      .order('listing_count', { ascending: false }),
    supabase
      .from('stc_products')
      .select('*')
      .eq('status', 'active')
      .order('canonical_name'),
    supabase
      .from('stc_products')
      .select('*')
      .eq('status', 'inactive')
      .order('canonical_name'),
    supabase
      .from('stc_brand_rules')
      .select('*')
      .order('brand'),
  ]);

  return (
    <ProductsClient
      pending={pendingRes.data ?? []}
      active={activeRes.data ?? []}
      inactive={inactiveRes.data ?? []}
      brandRules={rulesRes.data ?? []}
    />
  );
}
