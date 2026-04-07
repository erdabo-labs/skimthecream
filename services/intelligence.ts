import { createServiceClient } from '../lib/supabase/service';
import { generateWithAI } from '../lib/openai';
import type { Product, ProductConfidence, SellVelocity, EaseRating } from '../lib/types';

/**
 * Daily Intelligence Service — refreshes pricing, velocity, and confidence
 * for every active product using observed listing data + AI market research.
 *
 * Runs at 4am daily (after listing-monitor at 3am).
 */

const supabase = createServiceClient();
const DELAY_MS = 1000; // 1s between products to avoid hammering OpenAI

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeMedian(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Ask AI for market value and buy-below price, given real observed data.
 */
async function aiMarketResearch(
  productName: string,
  listingCount: number,
  medianPrice: number,
  lowPrice: number,
  highPrice: number,
  avgDaysToSell: number | null
): Promise<{ marketValue: number; buyBelow: number } | null> {
  const velocityContext = avgDaysToSell
    ? `Average time on market: ${avgDaysToSell.toFixed(1)} days.`
    : 'No sell-through data yet.';

  const prompt = `You are a local marketplace flipping expert. Given observed data for "${productName}" from Facebook Marketplace and KSL Classifieds in Utah:

- ${listingCount} listings observed
- Price range: $${lowPrice} — $${highPrice}
- Median asking price: $${medianPrice}
- ${velocityContext}

Based on this LOCAL data and your knowledge of current used market values:

1. What is the fair market value for this product in good condition? (what most sellers are actually getting)
2. What is the maximum I should pay to flip this profitably? (account for ~10% selling fees, time, risk)

Return JSON only: {"marketValue": <number>, "buyBelow": <number>}
No explanation, just the two numbers.`;

  try {
    const result = await generateWithAI(
      'You are a marketplace pricing analyst. Return only valid JSON.',
      prompt
    );
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (parsed.marketValue > 0 && parsed.buyBelow > 0) {
      return { marketValue: Math.round(parsed.marketValue), buyBelow: Math.round(parsed.buyBelow) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Refresh intelligence for a single product.
 */
async function refreshProduct(product: Product): Promise<void> {
  console.log(`  Processing "${product.canonical_name}"...`);

  // 1. Pull listing price stats
  const { data: pricedListings } = await supabase
    .from('stc_listings')
    .select('asking_price')
    .eq('product_id', product.id)
    .not('asking_price', 'is', null)
    .gt('asking_price', 0);

  const prices = (pricedListings ?? []).map(l => l.asking_price as number);
  const listingCount = prices.length;

  let avgAskingPrice: number | null = null;
  let medianAskingPrice: number | null = null;
  let lowPrice: number | null = null;
  let highPrice: number | null = null;

  if (prices.length > 0) {
    avgAskingPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    medianAskingPrice = Math.round(computeMedian(prices));
    lowPrice = Math.min(...prices);
    highPrice = Math.max(...prices);
  }

  // 2. Pull sell-speed data from gone listings
  const { data: goneListings } = await supabase
    .from('stc_listings')
    .select('days_active')
    .eq('product_id', product.id)
    .not('gone_at', 'is', null)
    .not('days_active', 'is', null)
    .gt('days_active', 0);

  const daysValues = (goneListings ?? []).map(l => l.days_active as number);
  let avgDaysToSell: number | null = null;
  let sellVelocity: SellVelocity | null = null;

  if (daysValues.length >= 2) {
    avgDaysToSell = Math.round(computeMedian(daysValues) * 10) / 10;
    if (avgDaysToSell <= 3) sellVelocity = 'fast';
    else if (avgDaysToSell <= 7) sellVelocity = 'moderate';
    else sellVelocity = 'slow';
  }

  // 3. AI market research (only if we have some observed data)
  let aiMarketValue: number | null = product.ai_market_value;
  let aiTargetPrice: number | null = null;

  if (medianAskingPrice && listingCount >= 3) {
    const research = await aiMarketResearch(
      product.canonical_name,
      listingCount,
      medianAskingPrice,
      lowPrice!,
      highPrice!,
      avgDaysToSell
    );
    if (research) {
      aiMarketValue = research.marketValue;
      aiTargetPrice = research.buyBelow;
      console.log(`    AI: market $${research.marketValue}, buy below $${research.buyBelow}`);
    }
  }

  // 4. Compute target_buy_price (skip if user has manually set one)
  let targetBuyPrice = product.target_buy_price;
  const userSetTarget = product.target_buy_price !== null && product.notes?.includes('[manual target]');

  if (!userSetTarget) {
    if (medianAskingPrice && aiTargetPrice) {
      // Weighted: observed 70% + AI 30%, then buy at 65% of that
      const blended = medianAskingPrice * 0.7 + aiTargetPrice * 0.3;
      targetBuyPrice = Math.round(blended * 0.65);
    } else if (medianAskingPrice) {
      // Observed only: buy at 60% of median
      targetBuyPrice = Math.round(medianAskingPrice * 0.60);
    } else if (aiTargetPrice) {
      // AI only
      targetBuyPrice = aiTargetPrice;
    }
  }

  // 5. Pull inventory sales data
  const { data: soldItems } = await supabase
    .from('stc_inventory')
    .select('profit, sold_price')
    .eq('product_id', product.id)
    .eq('status', 'sold')
    .not('profit', 'is', null);

  const profits = (soldItems ?? []).map(s => s.profit as number);
  const timesSold = profits.length;
  let avgProfit: number | null = null;

  if (profits.length > 0) {
    avgProfit = Math.round(profits.reduce((a, b) => a + b, 0) / profits.length);
  }

  // 6. Compute ease rating
  let easeRating: EaseRating | null = null;
  if (sellVelocity === 'fast' && timesSold >= 3) easeRating = 'easy';
  else if (sellVelocity === 'slow' || (listingCount >= 10 && timesSold === 0)) easeRating = 'hard';
  else if (sellVelocity || timesSold > 0) easeRating = 'moderate';

  // 7. Compute confidence
  let confidence: ProductConfidence = 'low';
  if (listingCount >= 10 && timesSold > 0) {
    confidence = 'very_high';
  } else if (listingCount >= 10 || userSetTarget) {
    confidence = 'high';
  } else if (listingCount >= 5) {
    confidence = 'medium';
  }

  // 8. Update the product
  const update: Record<string, any> = {
    listing_count: listingCount,
    avg_asking_price: avgAskingPrice,
    median_asking_price: medianAskingPrice,
    low_price: lowPrice,
    high_price: highPrice,
    ai_market_value: aiMarketValue,
    avg_days_to_sell: avgDaysToSell,
    sell_velocity: sellVelocity,
    avg_profit: avgProfit,
    times_sold: timesSold,
    ease_rating: easeRating,
    confidence,
    last_refreshed: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Only update target_buy_price if we computed one and user hasn't manually set it
  if (!userSetTarget && targetBuyPrice !== null) {
    update.target_buy_price = targetBuyPrice;
  }

  await supabase
    .from('stc_products')
    .update(update)
    .eq('id', product.id);

  const sources = [];
  if (medianAskingPrice) sources.push(`median $${medianAskingPrice}`);
  if (aiMarketValue) sources.push(`AI $${aiMarketValue}`);
  if (targetBuyPrice) sources.push(`target $${targetBuyPrice}`);
  sources.push(`confidence: ${confidence}`);
  if (sellVelocity) sources.push(sellVelocity);
  if (timesSold > 0) sources.push(`${timesSold} sold, avg $${avgProfit}`);

  console.log(`    ${product.canonical_name}: ${listingCount} listings, ${sources.join(', ')}`);
}

async function refreshIntelligence(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Intelligence refresh starting...`);

  const { data: products, error } = await supabase
    .from('stc_products')
    .select('*')
    .eq('status', 'active')
    .order('last_refreshed', { ascending: true, nullsFirst: true });

  if (error) {
    console.error('Error fetching products:', error.message);
    return;
  }

  if (!products || products.length === 0) {
    console.log('No active products to refresh');
    return;
  }

  console.log(`Refreshing intelligence for ${products.length} active products`);

  for (const product of products as Product[]) {
    try {
      await refreshProduct(product);
      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`  Error refreshing "${product.canonical_name}":`, err);
    }
  }

  console.log(`[${new Date().toISOString()}] Intelligence refresh complete`);
}

refreshIntelligence().catch(console.error);
