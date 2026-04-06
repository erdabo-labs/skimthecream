import { createServiceClient } from '../lib/supabase/service';
import { parseWithAI } from '../lib/openai';
import { sendAlert } from '../lib/ntfy';
import { getCategories, findCategorySync } from '../lib/constants';
import type { Listing, ListingScore } from '../lib/types';

const supabase = createServiceClient();

interface NormalizedProduct {
  baseModel: string;       // e.g. "iPhone 13 Pro" — NO storage
  storage: string | null;  // e.g. "128GB" or null
  isAccessory: boolean;    // case, charger, band, adapter, etc.
  isDamaged: boolean;      // cracked screen, for parts, broken
  isRental: boolean;       // "for rent", "rental", etc.
  isWanted: boolean;       // "ISO", "looking for", "wanted"
  skipReason: string | null;
}

/**
 * Use AI to analyze a listing title — normalize product AND detect red flags.
 * One AI call does normalization + accessory/damage/rental detection.
 */
async function normalizeProduct(title: string, description?: string | null): Promise<NormalizedProduct | null> {
  const descContext = description
    ? `\nDescription: "${description.slice(0, 500)}"`
    : '';

  const prompt = `Analyze this marketplace listing. Extract the product AND classify it.
Use BOTH the title and description (if provided) to identify the exact product model and specs.

RULES:
- baseModel: The core product. Brand + model + tier. NO storage, NO accessories, NO condition.
  - Phones: "iPhone 13 Pro Max", "iPhone 16e"
  - Laptops: "MacBook Air 13 2017", "MacBook Pro 14 2023 M3"
  - Tablets: "iPad Pro 12.9 5th Gen"
  - ALWAYS include tier: Mini, Pro, Pro Max, Plus, e, Air, Ultra etc.
  - NEVER include storage in baseModel
- storage: Capacity like "128GB", "256GB". null if not mentioned.
- isAccessory: TRUE if the listing is for an ACCESSORY, not the main product:
  - Cases, covers, screen protectors, bands, straps, chargers, keyboards, pencils,
    adapters, mounts, stands, docks, cables, headstraps, carrying cases, plates,
    filament, nozzles, PEI plates, build plates, encoder rentals
  - "Magic Keyboard for iPad" = accessory. "iPad Pro with Magic Keyboard" = NOT accessory (main product bundled)
  - "Apple Vision Pro case" = accessory. "Apple Vision Pro" = NOT accessory
  - "Bambu PEI plate" = accessory. "Bambu Lab X1C" = NOT accessory
- isDamaged: TRUE if listing mentions damage, "for parts", "repair", "cracked screen", "cracked back", "broken", "doesn't work", "as-is"
- isRental: TRUE if "rent", "rental", "for rent", "hourly", "per day"
- isWanted: TRUE if "ISO", "in search of", "looking for", "wanted", "WTB"
- skipReason: Brief reason if any flag is true, otherwise null

Title: "${title}"${descContext}

Return JSON only: {"baseModel":"...","storage":null,"isAccessory":false,"isDamaged":false,"isRental":false,"isWanted":false,"skipReason":null}`;

  try {
    const result = await parseWithAI(prompt);
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!parsed.baseModel || parsed.baseModel === 'unknown') return null;
    return {
      baseModel: parsed.baseModel,
      storage: parsed.storage || null,
      isAccessory: parsed.isAccessory ?? false,
      isDamaged: parsed.isDamaged ?? false,
      isRental: parsed.isRental ?? false,
      isWanted: parsed.isWanted ?? false,
      skipReason: parsed.skipReason || null,
    };
  } catch {
    return null;
  }
}

/**
 * Get user-provided product intelligence (notes, difficulty, price bounds, etc.)
 */
async function getProductIntel(productName: string): Promise<{
  notes: string | null;
  difficulty: 'easy' | 'moderate' | 'hard' | null;
  price_floor: number | null;
  price_ceiling: number | null;
  storage_matters: boolean;
  battery_matters: boolean;
  tags: string[];
} | null> {
  const { data } = await supabase
    .from('stc_product_intel')
    .select('notes, difficulty, price_floor, price_ceiling, storage_matters, battery_matters, tags')
    .eq('product_name', productName)
    .limit(1);

  if (data && data.length > 0) return data[0];
  return null;
}

/**
 * Ask AI to estimate the used local market value for a product.
 * Used as a fallback when no observed data or manual price exists.
 */
async function estimateValueWithAI(productName: string): Promise<number | null> {
  const prompt = `What is a fair used price for "${productName}" on Facebook Marketplace or local classifieds in the US?

Consider:
- Used/good condition (not new, not broken)
- Local pickup, cash transaction
- Current market (not retail, not eBay shipped prices — local used is typically 50-70% of retail)

Return ONLY a single number (the dollar amount, no $ sign). If you can't estimate, return 0.`;

  try {
    const result = await parseWithAI(prompt);
    const price = parseFloat(result.trim().replace(/[$,]/g, ''));
    if (isNaN(price) || price <= 0) return null;
    return Math.round(price);
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
 * Manual > observed > AI estimate. Weighted when multiple signals exist.
 */
function computeMarketValue(
  manualPrice: number | null,
  observed: { median: number; count: number } | null,
  aiEstimate: number | null = null
): number | null {
  const hasManual = manualPrice !== null;
  const hasObserved = observed !== null && observed.count >= 2;
  const hasAI = aiEstimate !== null;

  if (hasManual && hasObserved) {
    return Math.round((manualPrice! * 0.6 + observed!.median * 0.4) * 100) / 100;
  }
  if (hasManual) return manualPrice;
  if (hasObserved && hasAI) {
    // Observed data + AI: trust observed more (70/30)
    return Math.round((observed!.median * 0.7 + aiEstimate! * 0.3) * 100) / 100;
  }
  if (hasObserved) return observed!.median;
  if (hasAI) return aiEstimate;
  return null;
}

/**
 * Look at previous listings for the SAME normalized product
 * and compute the median asking price as our market reference.
 * Falls back to category-wide median only if product-level data is thin.
 */
async function getMarketPrice(
  productName: string,
  category: string | null
): Promise<{ median: number; count: number } | null> {
  // First try: exact product match from market_prices table
  const { data: productPrices } = await supabase
    .from('stc_market_prices')
    .select('avg_sold_price, sample_size')
    .eq('product_name', productName)
    .eq('source', 'observed')
    .not('avg_sold_price', 'is', null)
    .limit(1);

  if (productPrices && productPrices.length > 0 && productPrices[0].sample_size >= 2) {
    return { median: productPrices[0].avg_sold_price, count: productPrices[0].sample_size };
  }

  // Second try: match listings with the same parsed_product
  const { data: exactListings } = await supabase
    .from('stc_listings')
    .select('asking_price')
    .eq('parsed_product', productName)
    .not('asking_price', 'is', null)
    .gt('asking_price', 0);

  if (exactListings && exactListings.length >= 2) {
    const prices = exactListings.map((d) => d.asking_price as number).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
    return { median, count: prices.length };
  }

  // Third try: use AI to find similar products in the same category
  // by querying listings and asking the AI which are comparable
  if (category) {
    const { data: categoryListings } = await supabase
      .from('stc_listings')
      .select('parsed_product, asking_price')
      .eq('parsed_category', category)
      .not('asking_price', 'is', null)
      .not('parsed_product', 'is', null)
      .gt('asking_price', 0);

    if (categoryListings && categoryListings.length >= 3) {
      // Ask AI which products are comparable
      const uniqueProducts = [...new Set(categoryListings.map(l => l.parsed_product))];
      if (uniqueProducts.length > 1) {
        try {
          const similarProducts = await findSimilarProducts(productName, uniqueProducts as string[]);
          if (similarProducts.length > 0) {
            const prices = categoryListings
              .filter(l => similarProducts.includes(l.parsed_product as string))
              .map(l => l.asking_price as number)
              .sort((a, b) => a - b);

            if (prices.length >= 2) {
              const mid = Math.floor(prices.length / 2);
              const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
              return { median, count: prices.length };
            }
          }
        } catch {
          // AI comparison failed, skip
        }
      }
    }
  }

  return null;
}

/**
 * Ask AI which products from our database are comparable to the target product.
 * e.g. "iPhone 13 Pro 128GB" is comparable to "iPhone 13 Pro 256GB" but NOT to "iPhone 13 Mini 128GB"
 */
async function findSimilarProducts(target: string, candidates: string[]): Promise<string[]> {
  // First pass: quick string-based filtering to avoid wasting AI calls
  // Only consider candidates that share the base model
  const preFiltered = candidates.filter(c => {
    const targetLower = target.toLowerCase();
    const candidateLower = c.toLowerCase();
    // Must not be the same string
    if (targetLower === candidateLower) return true;
    // Quick reject: if one says "pro max" and the other doesn't, they're different
    const targetHasProMax = targetLower.includes('pro max');
    const candidateHasProMax = candidateLower.includes('pro max');
    if (targetHasProMax !== candidateHasProMax) return false;
    // Quick reject: if one says "mini" and the other doesn't
    const targetHasMini = targetLower.includes('mini');
    const candidateHasMini = candidateLower.includes('mini');
    if (targetHasMini !== candidateHasMini) return false;
    // Quick reject: if one says "plus" and the other doesn't
    const targetHasPlus = targetLower.includes('plus');
    const candidateHasPlus = candidateLower.includes('plus');
    if (targetHasPlus !== candidateHasPlus) return false;
    // Quick reject: "pro" vs non-"pro" (but only if not already pro max)
    if (!targetHasProMax && !candidateHasProMax) {
      const targetHasPro = targetLower.includes(' pro');
      const candidateHasPro = candidateLower.includes(' pro');
      if (targetHasPro !== candidateHasPro) return false;
    }
    // Quick reject: "air" vs non-"air"
    const targetHasAir = targetLower.includes('air');
    const candidateHasAir = candidateLower.includes('air');
    if (targetHasAir !== candidateHasAir) return false;
    return true;
  });

  if (preFiltered.length === 0) return [];
  if (preFiltered.length === 1 && preFiltered[0].toLowerCase() === target.toLowerCase()) return preFiltered;

  const prompt = `Given a target product, identify which candidates are the EXACT SAME product model. Only storage size differences are acceptable.

CRITICAL RULES — these are DIFFERENT products, NEVER group them:
- "iPhone 13 Pro" ≠ "iPhone 13 Pro Max" (Pro Max is a bigger, more expensive phone)
- "iPhone 13 Pro" ≠ "iPhone 13" (base model vs Pro)
- "iPhone 13" ≠ "iPhone 13 Mini" (different size)
- "iPhone 15 Pro" ≠ "iPhone 16 Pro" (different generation)
- "MacBook Pro" ≠ "MacBook Air" (different product line)
- "iPad Pro 12.9" ≠ "iPad Pro 11" (different screen size)

SAME product (OK to group):
- "iPhone 13 Pro 128GB" ≈ "iPhone 13 Pro 256GB" (only storage differs)
- "MacBook Air 13 2020" ≈ "MacBook Air 13 2020 M1" (same model, spec clarification)

Target: "${target}"
Candidates: ${JSON.stringify(preFiltered)}

Return ONLY a JSON array of matching candidate strings. Empty array [] if none match.`;

  try {
    const result = await parseWithAI(prompt);
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
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
      // Normalize the product name + detect red flags (use description if available)
      const categories = await getCategories(supabase);
      const normalized = await normalizeProduct(listing.title, listing.raw_email_snippet);
      const productName = normalized?.baseModel ?? null;
      const storage = normalized?.storage ?? null;
      const category = listing.parsed_category ?? findCategorySync(listing.title, categories);

      // Update parsed fields
      await supabase
        .from('stc_listings')
        .update({
          parsed_product: productName,
          parsed_storage: storage,
          parsed_category: category,
        })
        .eq('id', listing.id);

      // Auto-pass on accessories, damaged, rentals, wanted posts
      if (normalized && (normalized.isAccessory || normalized.isDamaged || normalized.isRental || normalized.isWanted)) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [skip] ${normalized.skipReason ?? 'flagged'}: ${listing.title}`);
        continue;
      }

      // Record this listing's price for future reference (by base model, skip accessories)
      if (listing.asking_price && category && productName) {
        await updateMarketPrices(productName, category, listing.asking_price);
      }

      // If no asking price, can't score
      if (!listing.asking_price) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] No price: ${listing.title}`);
        continue;
      }

      // Get product intel (user context) if available
      const intel = productName ? await getProductIntel(productName) : null;

      // Get market reference: user ceiling > manual price > observed > AI estimate
      const manualPrice = intel?.price_ceiling ?? await getManualPrice(productName ?? listing.title, category);
      const market = await getMarketPrice(productName ?? listing.title, category);

      // If no manual or observed data, ask AI to estimate
      let aiEstimate: number | null = null;
      if (!manualPrice && (!market || market.count < 2) && productName) {
        aiEstimate = await estimateValueWithAI(productName);
        if (aiEstimate) {
          console.log(`    AI estimate for ${productName}: $${aiEstimate}`);
        }
      }

      // Compute weighted market value from available signals
      const marketValue = computeMarketValue(manualPrice, market, aiEstimate);

      // Apply price floor check — user says "don't buy above this"
      if (intel?.price_floor && listing.asking_price > intel.price_floor) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] Above price floor $${intel.price_floor}: ${listing.title} — $${listing.asking_price}`);
        continue;
      }

      let score: ListingScore;
      let estimatedProfit: number;

      if (marketValue) {
        const discount = ((marketValue - listing.asking_price) / marketValue) * 100;
        // Factor in difficulty: hard-to-sell items need bigger margins
        const sellFactor = intel?.difficulty === 'hard' ? 0.85 : intel?.difficulty === 'moderate' ? 0.90 : 0.95;
        estimatedProfit = Math.round((marketValue * sellFactor - listing.asking_price) * 100) / 100;

        if (discount >= 30 && estimatedProfit >= 200) {
          score = 'great';
        } else if (discount >= 15 && estimatedProfit >= 50) {
          score = 'good';
        } else {
          score = 'pass';
        }

        const sources = [];
        if (intel?.price_ceiling) sources.push(`ceiling $${intel.price_ceiling}`);
        if (manualPrice && !intel?.price_ceiling) sources.push(`manual $${manualPrice}`);
        if (market && market.count >= 2) sources.push(`observed $${market.median} (${market.count})`);
        if (aiEstimate) sources.push(`AI $${aiEstimate}`);
        if (intel?.difficulty) sources.push(intel.difficulty);
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

      // Build price source description
      const priceSources = [];
      if (intel?.price_ceiling) priceSources.push(`Your value: $${intel.price_ceiling}`);
      if (manualPrice && !intel?.price_ceiling) priceSources.push(`Manual: $${manualPrice}`);
      if (market && market.count >= 2) priceSources.push(`${market.count} observed, median $${market.median}`);
      if (aiEstimate) priceSources.push(`AI estimate: $${aiEstimate}`);
      const priceSource = priceSources.length > 0 ? priceSources.join(' · ') : null;

      await supabase
        .from('stc_listings')
        .update({
          score,
          estimated_profit: estimatedProfit,
          price_source: priceSource,
          updated_at: new Date().toISOString(),
        })
        .eq('id', listing.id);

      // Alert only for great deals (good deals are too noisy)
      if (score === 'great' && !listing.alert_sent) {
        const priority = 5;

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
