import { createServerClient } from '@/lib/supabase/server';
import { SellClient } from './sell-client';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function SellPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: item } = await supabase
    .from('stc_inventory')
    .select('id, product_name, purchase_price')
    .eq('id', id)
    .single();

  if (!item) notFound();

  return <SellClient item={item} />;
}
