import { createServiceClient } from '../lib/supabase/service';
import { parseWithAI } from '../lib/openai';
import { sendAlert } from '../lib/ntfy';
import { findCategory } from '../lib/constants';
import type { Listing, ListingScore } from '../lib/types';

const supabase = createServiceClient();

/**
 * Use AI to extract a normalized product name from a listing title.
 * e.g. "2017 MacBook Air 13" W/Box Charger" → "MacBook Air 2017 13"
 */
async function normalizeProduct(title: string): Promise<string | null> {
  const prompt = `Extract the core product from this listing title. Remove seller fluff, accessories mentioned, and condition words. Return ONLY the normalized product name (brand + model + key spec like size/gen/year). If it's not a recognizable product, return "unknown".

Title: "${title}"`;

  try {
    const result = await parseWithAI(prompt);
    const normalized = result.trim().replace(/^"/, '').replace(/"$/, '');
    return normalized === 'unknown' ? null : normalized;
  } catch {
    return null;
  }
}

/**
 * Look at all previous listings we've seen for similar products
 * and compute the median asking price as our market reference.
 */
async function getMarketPrice(
  productName: string,
  category: string | null
): Promise<{ median: number; count: number } | null> {
  // Query all listings with asking prices in the same category
  let query = supabase
    .from('stc_listings')
    .select('asking_price')
    .not('asking_price', 'is', null)
    .gt('asking_price', 0);

  if (category) {
    query = query.eq('parsed_category', category);
  }

  const { data } = await query;

  if (!data || data.length < 2) return null;

  // Use AI to find which of these are the same product
  // For now, just use category median — as we collect more data this gets better
  const prices = data
    .map((d) => d.asking_price as number)
    .sort((a, b) => a - b);

  const mid = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];

  return { median, count: prices.length };
}

/**
 * Update market_prices table with observed data from our listings.
 * This builds our price intelligence over time.
 */
async function updateMarketPrices(
  productName: string,
  category: string,
  askingPrice: number
): Promise<void> {
  // Check if we already track this product
  const { data: existing } = await supabase
    .from('stc_market_prices')
    .select('id, avg_sold_price, low_sold_price, high_sold_price, sample_size')
    .eq('category', category)
    .eq('product_name', productName)
    .eq('source', 'observed')
    .limit(1);

  if (existing && existing.length > 0) {
    const row = existing[0];
    const n = row.sample_size + 1;
    const newAvg =
      ((row.avg_sold_price ?? 0) * row.sample_size + askingPrice) / n;

    await supabase
      .from('stc_market_prices')
      .update({
        avg_sold_price: Math.round(newAvg * 100) / 100,
        low_sold_price: Math.min(row.low_sold_price ?? askingPrice, askingPrice),
        high_sold_price: Math.max(row.high_sold_price ?? askingPrice, askingPrice),
        sample_size: n,
        scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  } else {
    await supabase.from('stc_market_prices').insert({
      category,
      product_name: productName,
      condition: 'mixed',
      avg_sold_price: askingPrice,
      low_sold_price: askingPrice,
      high_sold_price: askingPrice,
      source: 'observed',
      sample_size: 1,
      scraped_at: new Date().toISOString(),
    });
  }
}

async function scoreUnscored(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Scoring unscored listings...`);

  const { data: listings, error } = await supabase
    .from('stc_listings')
    .select('*')
    .is('score', null)
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) {
    console.error('Error fetching listings:', error.message);
    return;
  }

  if (!listings || listings.length === 0) {
    return;
  }

  console.log(`Found ${listings.length} unscored listings`);

  for (const listing of listings as Listing[]) {
    try {
      // Normalize the product name
      const productName = await normalizeProduct(listing.title);
      const category = listing.parsed_category ?? findCategory(listing.title);

      // Record this listing's price for future reference
      if (listing.asking_price && category && productName) {
        await updateMarketPrices(productName, category, listing.asking_price);
      }

      // Update parsed fields
      await supabase
        .from('stc_listings')
        .update({
          parsed_product: productName,
          parsed_category: category,
        })
        .eq('id', listing.id);

      // If no asking price, can't score
      if (!listing.asking_price) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] No price: ${listing.title}`);
        continue;
      }

      // Get market reference from observed listings
      const market = category ? await getMarketPrice(productName ?? listing.title, category) : null;

      let score: ListingScore;
      let estimatedProfit: number;

      if (market && market.count >= 3) {
        // We have enough data to compare
        const discount = ((market.median - listing.asking_price) / market.median) * 100;
        estimatedProfit = Math.round((market.median * 0.95 - listing.asking_price) * 100) / 100;

        if (discount >= 30 && estimatedProfit >= 200) {
          score = 'great';
        } else if (discount >= 15 && estimatedProfit >= 50) {
          score = 'good';
        } else {
          score = 'pass';
        }

        console.log(
          `  [${score}] ${listing.title} — $${listing.asking_price} vs median $${market.median} (${market.count} observed, ${discount.toFixed(0)}% off)`
        );
      } else {
        // Not enough data yet — mark as unscored pass, will improve over time
        score = 'pass';
        estimatedProfit = 0;
        console.log(
          `  [pass] Not enough market data yet (${market?.count ?? 0} observed): ${listing.title} — $${listing.asking_price}`
        );
      }

      await supabase
        .from('stc_listings')
        .update({
          score,
          estimated_profit: estimatedProfit,
          updated_at: new Date().toISOString(),
        })
        .eq('id', listing.id);

      // Alert for good/great deals
      if ((score === 'good' || score === 'great') && !listing.alert_sent) {
        const priority = score === 'great' ? 5 : 4;

        await sendAlert(
          `${score.toUpperCase()}: $${estimatedProfit} potential profit`,
          `${listing.title}\nAsking: $${listing.asking_price}${market ? `\nMedian: $${market.median} (${market.count} listings seen)` : ''}`,
          priority,
          listing.listing_url ?? undefined
        );

        await supabase
          .from('stc_listings')
          .update({ alert_sent: true })
          .eq('id', listing.id);
      }
    } catch (err) {
      console.error(`Error scoring listing ${listing.id}:`, err);
    }
  }
}

scoreUnscored().catch(console.error);
