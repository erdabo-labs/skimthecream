import { createServerClient } from '@/lib/supabase/server';
import { ProductDetailClient } from './product-detail-client';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: product } = await supabase
    .from('stc_products')
    .select('*')
    .eq('id', parseInt(id))
    .single();

  if (!product) notFound();

  const { data: listings } = await supabase
    .from('stc_listings')
    .select('id, title, asking_price, source, listing_url, parsed_storage, parsed_condition, raw_email_snippet, score, estimated_profit, status, feedback, created_at, first_seen_at, gone_at, days_active')
    .eq('product_id', parseInt(id))
    .order('created_at', { ascending: false });

  return (
    <ProductDetailClient
      product={product}
      listings={listings ?? []}
    />
  );
}
