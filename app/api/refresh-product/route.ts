import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { generateWithAI } from '@/lib/openai';

export async function POST(req: NextRequest) {
  const { productId } = await req.json();
  if (!productId) return NextResponse.json({ error: 'Missing productId' }, { status: 400 });

  const supabase = createServerClient();

  const { data: product } = await supabase
    .from('stc_products')
    .select('*')
    .eq('id', productId)
    .single();

  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  // Pull listing price stats
  const { data: pricedListings } = await supabase
    .from('stc_listings')
    .select('asking_price')
    .eq('product_id', productId)
    .not('asking_price', 'is', null)
    .gt('asking_price', 0);

  const prices = (pricedListings ?? []).map(l => l.asking_price as number);
  if (prices.length === 0) {
    return NextResponse.json({ error: 'No priced listings' }, { status: 400 });
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const low = sorted[0];
  const high = sorted[sorted.length - 1];

  // Pull sell-speed data
  const { data: goneListings } = await supabase
    .from('stc_listings')
    .select('days_active')
    .eq('product_id', productId)
    .not('gone_at', 'is', null)
    .not('days_active', 'is', null)
    .gt('days_active', 0);

  const daysValues = (goneListings ?? []).map(l => l.days_active as number);
  let avgDaysToSell: number | null = null;
  let sellVelocity: string | null = null;
  if (daysValues.length >= 2) {
    const dSorted = [...daysValues].sort((a, b) => a - b);
    const dMid = Math.floor(dSorted.length / 2);
    avgDaysToSell = Math.round((dSorted.length % 2 === 0 ? (dSorted[dMid - 1] + dSorted[dMid]) / 2 : dSorted[dMid]) * 10) / 10;
    sellVelocity = avgDaysToSell <= 3 ? 'fast' : avgDaysToSell <= 7 ? 'moderate' : 'slow';
  }

  // AI market research
  const velocityCtx = avgDaysToSell ? `Average time on market: ${avgDaysToSell} days.` : 'No sell-through data yet.';
  const prompt = `You are a local marketplace flipping expert. Given observed data for "${product.canonical_name}" from Facebook Marketplace and KSL Classifieds in Utah:

- ${prices.length} listings observed
- Price range: $${low} — $${high}
- Median asking price: $${median}
- Average asking price: $${avg}
- ${velocityCtx}

Based on this LOCAL data and your knowledge of current used market values:

1. What is the fair market value for this product in good condition? (what most sellers actually get — remember asking price is usually 10-20% above sale price)
2. What is the maximum I should pay to flip this profitably? (account for ~10% selling fees, time, risk, need at least 20% margin)

Return JSON only: {"marketValue": <number>, "buyBelow": <number>}`;

  let aiMarketValue: number | null = null;
  let targetBuyPrice: number;

  try {
    const result = await generateWithAI(
      'You are a marketplace pricing analyst. Return only valid JSON.',
      prompt
    );
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (parsed.marketValue > 0 && parsed.buyBelow > 0) {
      aiMarketValue = Math.round(parsed.marketValue);
      targetBuyPrice = Math.round(parsed.buyBelow);
    } else {
      targetBuyPrice = Math.round(median * 0.60);
    }
  } catch {
    targetBuyPrice = Math.round(median * 0.60);
  }

  // Pull inventory sales data
  const { data: soldItems } = await supabase
    .from('stc_inventory')
    .select('profit')
    .eq('product_id', productId)
    .eq('status', 'sold')
    .not('profit', 'is', null);

  const profits = (soldItems ?? []).map(s => s.profit as number);
  const timesSold = profits.length;
  const avgProfit = profits.length > 0 ? Math.round(profits.reduce((a, b) => a + b, 0) / profits.length) : null;

  // Compute confidence
  let confidence = 'low';
  if (prices.length >= 10 && timesSold > 0) confidence = 'very_high';
  else if (prices.length >= 10) confidence = 'high';
  else if (prices.length >= 5) confidence = 'medium';

  // Compute ease rating
  let easeRating: string | null = null;
  if (sellVelocity === 'fast' && timesSold >= 3) easeRating = 'easy';
  else if (sellVelocity === 'slow' || (prices.length >= 10 && timesSold === 0)) easeRating = 'hard';
  else if (sellVelocity || timesSold > 0) easeRating = 'moderate';

  const update = {
    target_buy_price: targetBuyPrice,
    ai_market_value: aiMarketValue,
    avg_asking_price: avg,
    median_asking_price: median,
    low_price: low,
    high_price: high,
    listing_count: prices.length,
    avg_days_to_sell: avgDaysToSell,
    sell_velocity: sellVelocity,
    avg_profit: avgProfit,
    times_sold: timesSold,
    ease_rating: easeRating,
    confidence,
    last_refreshed: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await supabase.from('stc_products').update(update).eq('id', productId);

  return NextResponse.json({ ...product, ...update });
}
