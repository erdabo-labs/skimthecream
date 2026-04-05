import { createServerClient } from '@/lib/supabase/server';
import { ProductsClient } from './products-client';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const supabase = createServerClient();

  // Get unique products with their listing stats
  const { data: listings } = await supabase
    .from('stc_listings')
    .select('parsed_product, parsed_storage, parsed_category, asking_price, created_at')
    .not('parsed_product', 'is', null)
    .not('asking_price', 'is', null)
    .order('created_at', { ascending: false });

  // Get product intel
  const { data: intel } = await supabase
    .from('stc_product_intel')
    .select('*');

  // Aggregate into product summaries
  const productMap: Record<string, {
    name: string;
    category: string | null;
    listings: number;
    prices: number[];
    storages: string[];
    lastSeen: string;
  }> = {};

  for (const l of listings ?? []) {
    const name = l.parsed_product as string;
    if (!productMap[name]) {
      productMap[name] = {
        name,
        category: l.parsed_category,
        listings: 0,
        prices: [],
        storages: [],
        lastSeen: l.created_at,
      };
    }
    productMap[name].listings++;
    productMap[name].prices.push(l.asking_price as number);
    if (l.parsed_storage && !productMap[name].storages.includes(l.parsed_storage)) {
      productMap[name].storages.push(l.parsed_storage);
    }
  }

  const products = Object.values(productMap).map(p => ({
    ...p,
    lowPrice: Math.min(...p.prices),
    highPrice: Math.max(...p.prices),
    avgPrice: Math.round(p.prices.reduce((a, b) => a + b, 0) / p.prices.length),
  }));

  return <ProductsClient products={products} intel={intel ?? []} />;
}
