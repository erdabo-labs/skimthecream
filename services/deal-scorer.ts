import { createServiceClient } from '../lib/supabase/service';
import { scoreDeal } from '../lib/scoring';
import { parseWithAI } from '../lib/openai';
import { sendAlert } from '../lib/ntfy';
import type { Listing } from '../lib/types';

const supabase = createServiceClient();

async function isRelevantProduct(title: string): Promise<boolean> {
  const prompt = `Is this a relevant electronics product listing (tablet, laptop, telescope, 3D printer)?
Or is it an accessory, case, screen protector, cable, or other low-value item?

Title: "${title}"

Reply with ONLY "relevant" or "irrelevant".`;

  try {
    const result = await parseWithAI(prompt);
    return result.trim().toLowerCase() === 'relevant';
  } catch {
    // If AI fails, assume relevant to avoid missing deals
    return true;
  }
}

async function findMatchingMarketPrice(
  listing: Listing
): Promise<{ id: number; avg_sold_price: number } | null> {
  // Try exact category + product match
  if (listing.parsed_category && listing.parsed_product) {
    const { data } = await supabase
      .from('stc_market_prices')
      .select('id, avg_sold_price')
      .eq('category', listing.parsed_category)
      .ilike('product_name', `%${listing.parsed_product}%`)
      .order('scraped_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0 && data[0].avg_sold_price) {
      return { id: data[0].id, avg_sold_price: data[0].avg_sold_price };
    }
  }

  // Fuzzy match via AI
  const { data: allPrices } = await supabase
    .from('stc_market_prices')
    .select('id, product_name, avg_sold_price')
    .not('avg_sold_price', 'is', null);

  if (!allPrices || allPrices.length === 0) return null;

  const productList = allPrices
    .map((p) => `${p.id}: ${p.product_name}`)
    .join('\n');

  const prompt = `Which product best matches this listing? Return ONLY the ID number, or "none".

Listing: "${listing.title}"

Products:
${productList}`;

  try {
    const result = await parseWithAI(prompt);
    const matchId = parseInt(result.trim());
    if (isNaN(matchId)) return null;

    const match = allPrices.find((p) => p.id === matchId);
    if (match && match.avg_sold_price) {
      return { id: match.id, avg_sold_price: match.avg_sold_price };
    }
  } catch {
    // Ignore AI errors
  }

  return null;
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
      // First pass: check if it's a relevant product
      const relevant = await isRelevantProduct(listing.title);

      if (!relevant) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] Irrelevant: ${listing.title}`);
        continue;
      }

      // Find matching market price
      const marketMatch = await findMatchingMarketPrice(listing);

      if (!marketMatch || !listing.asking_price) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] No price data: ${listing.title}`);
        continue;
      }

      // Score the deal
      const ageHours =
        (Date.now() - new Date(listing.created_at).getTime()) / (1000 * 60 * 60);

      const result = scoreDeal({
        askingPrice: listing.asking_price,
        avgMarketValue: marketMatch.avg_sold_price,
        category: listing.parsed_category,
        listingAgeHours: ageHours,
      });

      await supabase
        .from('stc_listings')
        .update({
          score: result.score,
          estimated_profit: result.estimatedProfit,
          market_price_id: marketMatch.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', listing.id);

      console.log(
        `  [${result.score}] ${listing.title} — $${listing.asking_price} → profit $${result.estimatedProfit}`
      );

      // Send notification for good/great deals
      if ((result.score === 'good' || result.score === 'great') && !listing.alert_sent) {
        const priority = result.score === 'great' ? 5 : 4;
        const emoji = result.score === 'great' ? '🔥' : '💰';

        await sendAlert(
          `${emoji} ${result.score.toUpperCase()}: $${result.estimatedProfit} profit`,
          `${listing.title}\nAsking: $${listing.asking_price}\nMarket: $${marketMatch.avg_sold_price}`,
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

// Run once (launchd handles scheduling)
scoreUnscored().catch(console.error);
