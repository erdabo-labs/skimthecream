import { createServerClient } from '@/lib/supabase/server';
import { HomeClient } from './home-client';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = createServerClient();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [activeRes, hotRes, recentRes, statsDeals, statsInventory, statsProfit] = await Promise.all([
    // Active conversations (contacted)
    supabase
      .from('stc_listings')
      .select('id, title, asking_price, estimated_profit, score, source, listing_url, status, created_at, parsed_product, parsed_category, price_source, feedback, product_id, raw_email_snippet')
      .eq('status', 'contacted')
      .order('updated_at', { ascending: false })
      .limit(10),
    // Hot deals (great + good, status new)
    supabase
      .from('stc_listings')
      .select('id, title, asking_price, estimated_profit, score, source, listing_url, status, created_at, parsed_product, parsed_category, price_source, feedback, product_id, raw_email_snippet')
      .eq('status', 'new')
      .in('score', ['great', 'good'])
      .order('estimated_profit', { ascending: false })
      .limit(20),
    // All new listings (pass + unscored — hot deals are separate)
    supabase
      .from('stc_listings')
      .select('id, title, asking_price, estimated_profit, score, source, listing_url, status, created_at, parsed_product, parsed_category, price_source, feedback, product_id, raw_email_snippet')
      .eq('status', 'new')
      .or('score.eq.pass,score.is.null')
      .order('created_at', { ascending: false })
      .limit(100),
    // Stats: deals in last 24h
    supabase
      .from('stc_listings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterday),
    // Stats: inventory in stock
    supabase
      .from('stc_inventory')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'in_stock'),
    // Stats: profit this month
    supabase
      .from('stc_inventory')
      .select('profit')
      .eq('status', 'sold')
      .gte('sold_date', monthAgo.split('T')[0])
      .not('profit', 'is', null),
  ]);

  const monthProfit = statsProfit.data?.reduce((sum, i) => sum + (i.profit ?? 0), 0) ?? 0;
  const activeCount = activeRes.data?.length ?? 0;

  return (
    <HomeClient
      active={activeRes.data ?? []}
      hot={hotRes.data ?? []}
      recent={recentRes.data ?? []}
      stats={{
        dealsToday: statsDeals.count ?? 0,
        activeConvos: activeCount,
        inStock: statsInventory.count ?? 0,
        monthProfit,
      }}
    />
  );
}
