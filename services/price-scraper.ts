import { createServiceClient } from '../lib/supabase/service';

/**
 * Price aggregator — computes market prices from observed listing data.
 * Runs daily to recalculate averages as more listings come in.
 *
 * No external scraping — all data comes from listings we've already ingested.
 */

const supabase = createServiceClient();

async function aggregatePrices(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Aggregating market prices from observed listings...`);

  // Get all listings with parsed products and prices
  const { data: listings } = await supabase
    .from('stc_listings')
    .select('parsed_product, parsed_category, asking_price')
    .not('parsed_product', 'is', null)
    .not('asking_price', 'is', null)
    .gt('asking_price', 0);

  if (!listings || listings.length === 0) {
    console.log('No listings with product data to aggregate');
    return;
  }

  // Group by product
  const groups: Record<string, { category: string; prices: number[] }> = {};

  for (const l of listings) {
    const key = l.parsed_product as string;
    if (!groups[key]) {
      groups[key] = { category: l.parsed_category ?? 'unknown', prices: [] };
    }
    groups[key].prices.push(l.asking_price as number);
  }

  let updated = 0;

  for (const [productName, { category, prices }] of Object.entries(groups)) {
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    await supabase.from('stc_market_prices').upsert(
      {
        category,
        product_name: productName,
        condition: 'mixed',
        avg_sold_price: Math.round(avg * 100) / 100,
        low_sold_price: prices[0],
        high_sold_price: prices[prices.length - 1],
        source: 'observed',
        sample_size: prices.length,
        scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'category,product_name' }
    );

    updated++;
    console.log(
      `  ${productName}: $${prices[0]}-$${prices[prices.length - 1]} avg $${avg.toFixed(0)} (${prices.length} listings)`
    );
  }

  console.log(`Aggregated ${updated} products from ${listings.length} listings`);
}

aggregatePrices().catch(console.error);
