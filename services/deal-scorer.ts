import { createServiceClient } from '../lib/supabase/service';
import { parseWithAI } from '../lib/openai';
import { sendAlert } from '../lib/ntfy';
import { getCategories, findCategorySync } from '../lib/constants';
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
 * Check if the user has set a manual market value for this product.
 * Manual prices have the highest trust — they reflect local market knowledge.
 */
async function getManualPrice(
  productName: string,
  category: string | null
): Promise<number | null> {
  let query = supabase
    .from('stc_market_prices')
    .select('avg_sold_price')
    .eq('manual_override', true)
    .not('avg_sold_price', 'is', null);

  if (category) {
    query = query.eq('category', category);
  }

  // Try exact product match first
  const { data: exact } = await query.eq('product_name', productName).limit(1);
  if (exact && exact.length > 0) return exact[0].avg_sold_price;

  return null;
}

/**
 * Combine price signals into a weighted market value.
 * Manual price = highest trust, observed = fills gaps.
 */
function computeMarketValue(
  manualPrice: number | null,
  observed: { median: number; count: number } | null
): number | null {
  const hasManual = manualPrice !== null;
  const hasObserved = observed !== null && observed.count >= 3;

  if (hasManual && hasObserved) {
    // Weight manual higher (60/40)
    return Math.round((manualPrice! * 0.6 + observed!.median * 0.4) * 100) / 100;
  }
  if (hasManual) return manualPrice;
  if (hasObserved) return observed!.median;
  return null;
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
      const categories = await getCategories(supabase);
      const productName = await normalizeProduct(listing.title);
      const category = listing.parsed_category ?? findCategorySync(listing.title, categories);

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

      // Get market reference: manual price (highest trust) + observed listings
      const manualPrice = await getManualPrice(productName ?? listing.title, category);
      const market = category ? await getMarketPrice(productName ?? listing.title, category) : null;

      // Compute weighted market value from available signals
      const marketValue = computeMarketValue(manualPrice, market);

      let score: ListingScore;
      let estimatedProfit: number;

      if (marketValue) {
        const discount = ((marketValue - listing.asking_price) / marketValue) * 100;
        estimatedProfit = Math.round((marketValue * 0.95 - listing.asking_price) * 100) / 100;

        if (discount >= 30 && estimatedProfit >= 200) {
          score = 'great';
        } else if (discount >= 15 && estimatedProfit >= 50) {
          score = 'good';
        } else {
          score = 'pass';
        }

        const sources = [];
        if (manualPrice) sources.push(`manual $${manualPrice}`);
        if (market && market.count >= 3) sources.push(`observed $${market.median} (${market.count})`);
        console.log(
          `  [${score}] ${listing.title} — $${listing.asking_price} vs market $${marketValue} (${sources.join(', ')}, ${discount.toFixed(0)}% off)`
        );
      } else {
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
