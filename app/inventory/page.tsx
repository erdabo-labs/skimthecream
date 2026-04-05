import { createServerClient } from '@/lib/supabase/server';
import { InventoryClient } from './inventory-client';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const supabase = createServerClient();

  const { data: items } = await supabase
    .from('stc_inventory')
    .select('*')
    .order('created_at', { ascending: false });

  return <InventoryClient items={items ?? []} />;
}
