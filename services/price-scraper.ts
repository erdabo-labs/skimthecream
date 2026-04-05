import { scrapeSwappa } from './scrapers/swappa';
import { scrapeEbay } from './scrapers/ebay';
import { createServiceClient } from '../lib/supabase/service';
import { findCategory } from '../lib/constants';

const supabase = createServiceClient();

async function run(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Price scraper starting...`);

  // Run scrapers
  const [swappaResults, ebayResults] = await Promise.all([
    scrapeSwappa().catch((err) => {
      console.error('Swappa scraper failed:', err);
      return [];
    }),
    scrapeEbay().catch((err) => {
      console.error('eBay scraper failed:', err);
      return [];
    }),
  ]);

  console.log(
    `Scraped ${swappaResults.length} Swappa prices, ${ebayResults.length} eBay prices`
  );

  // Upsert Swappa results
  for (const result of swappaResults) {
    const category = findCategory(result.product_name) ?? 'unknown';
    const { error } = await supabase.from('stc_market_prices').upsert(
      {
        category,
        product_name: result.product_name,
        condition: result.condition,
        avg_sold_price: result.avg_sold_price,
        low_sold_price: result.low_sold_price,
        high_sold_price: result.high_sold_price,
        source: 'swappa',
        sample_size: result.sample_size,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: 'category,product_name' }
    );

    if (error) {
      console.error(`Upsert error (Swappa ${result.product_name}):`, error.message);
    }
  }

  // Upsert eBay results
  for (const result of ebayResults) {
    const category = findCategory(result.product_name) ?? 'unknown';
    const { error } = await supabase.from('stc_market_prices').upsert(
      {
        category,
        product_name: result.product_name,
        condition: result.condition,
        avg_sold_price: result.avg_sold_price,
        low_sold_price: result.low_sold_price,
        high_sold_price: result.high_sold_price,
        source: 'ebay',
        sample_size: result.sample_size,
        scraped_at: new Date().toISOString(),
      },
      { onConflict: 'category,product_name' }
    );

    if (error) {
      console.error(`Upsert error (eBay ${result.product_name}):`, error.message);
    }
  }

  console.log('Price scraper complete');
}

run().catch(console.error);
