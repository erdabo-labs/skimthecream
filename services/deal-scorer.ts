import { createServiceClient } from '../lib/supabase/service';
import { parseWithAI } from '../lib/openai';
import { sendAlert } from '../lib/ntfy';
import { getCategories, findCategorySync } from '../lib/constants';
import type { Listing, ListingScore } from '../lib/types';

const supabase = createServiceClient();

interface ProductAnalysis {
  baseModel: string;       // e.g. "Mac Studio M2 Max 2023"
  storage: string | null;  // e.g. "512GB"
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'parts' | 'unknown';
  conditionNotes: string | null;  // e.g. "minor scratch on lid, battery 87%"
  year: number | null;     // e.g. 2023
  processor: string | null; // e.g. "M2 Max", "A16 Bionic"
  isAccessory: boolean;
  isDamaged: boolean;
  isRental: boolean;
  isWanted: boolean;
  isIrrelevant: boolean;   // cars, furniture, clothes, etc.
  skipReason: string | null;
  matchedCategory: string | null; // which watched category this belongs to, if any
}

/**
 * Use AI to do a deep analysis of a listing using ALL available context.
 * One call: relevance check + normalization + condition + specs.
 */
async function analyzeProduct(
  title: string,
  description: string | null,
  categoryNames: string[]
): Promise<ProductAnalysis | null> {
  const descContext = description
    ? `\nDescription: "${description.slice(0, 800)}"`
    : '';

  const prompt = `Analyze this marketplace listing. Use ALL available context (title AND description) to build a complete picture.

WATCHED CATEGORIES (only score listings that fit one of these):
${categoryNames.map(c => `- ${c}`).join('\n')}

EXTRACTION RULES:
- baseModel: Brand + model + tier + generation/year if known. NO storage. NO accessories.
  - "Mac Studio M2 Max 2023", "iPhone 13 Pro Max", "MacBook Air 13 M3 2024"
  - "Bambu Lab X1C", "Celestron NexStar 8SE"
  - If the title says "MacBook Pro" but description says "2019 i7", the baseModel is "MacBook Pro 15 2019 i7"
  - ALWAYS include tier: Mini, Pro, Pro Max, Plus, e, Air, Ultra, SE etc.
  - NEVER include storage in baseModel
- storage: "128GB", "512GB", "1TB", etc. null if not mentioned anywhere.
- condition: Assess from ALL signals in title AND description:
  - "new": sealed, BNIB, unopened, brand new
  - "like_new": mint, excellent, barely used, open box, few months old
  - "good": normal used, works great, no major issues mentioned
  - "fair": scratches, dents, cosmetic damage, older battery, signs of wear
  - "poor": significant damage, cracked screen/back but functional
  - "parts": for parts, broken, doesn't turn on, water damage, repair
  - "unknown": not enough info to judge
- conditionNotes: Specific condition details from the listing. e.g. "screen cracked", "battery 82%", "minor scratches on back", "comes with box". null if nothing specific mentioned.
- year: Production year or generation year. null if can't determine.
- processor: CPU/chip. "M1", "M2 Pro", "M3 Max", "A17 Pro", "i7-10700". null if not mentioned.
- isAccessory: TRUE for cases, covers, chargers, cables, adapters, mounts, bands, filament, nozzles, build plates, PEI plates, screen protectors. FALSE for main products even if bundled with accessories.
- isDamaged: TRUE if "for parts", "broken", "doesn't work", "cracked screen", "water damage", "as-is". Note: cosmetic scratches alone = NOT damaged (that's condition:fair).
- isRental: TRUE for "rent", "rental", "per day", "hourly"
- isWanted: TRUE for "ISO", "WTB", "looking for", "wanted", "in search of"
- isIrrelevant: TRUE if the listing does NOT fit ANY of the watched categories above. Cars, furniture, clothing, toys, non-tech items = irrelevant. Be strict: a "DJI drone" is irrelevant unless drones are a watched category.
- skipReason: Brief reason if any flag is true. For irrelevant: "not in watched categories: [what it is]"
- matchedCategory: Which watched category this listing belongs to. null if irrelevant.

Title: "${title}"${descContext}

Return JSON only: {"baseModel":"...","storage":null,"condition":"unknown","conditionNotes":null,"year":null,"processor":null,"isAccessory":false,"isDamaged":false,"isRental":false,"isWanted":false,"isIrrelevant":false,"skipReason":null,"matchedCategory":null}`;

  try {
    const result = await parseWithAI(prompt);
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!parsed.baseModel || parsed.baseModel === 'unknown') return null;
    return {
      baseModel: parsed.baseModel,
      storage: parsed.storage || null,
      condition: parsed.condition || 'unknown',
      conditionNotes: parsed.conditionNotes || null,
      year: parsed.year || null,
      processor: parsed.processor || null,
      isAccessory: parsed.isAccessory ?? false,
      isDamaged: parsed.isDamaged ?? false,
      isRental: parsed.isRental ?? false,
      isWanted: parsed.isWanted ?? false,
      isIrrelevant: parsed.isIrrelevant ?? false,
      skipReason: parsed.skipReason || null,
      matchedCategory: parsed.matchedCategory || null,
    };
  } catch {
    return null;
  }
}

/**
 * Condition multiplier — how much the condition affects resale value.
 * A "fair" iPhone is worth less than a "like new" one.
 */
function conditionMultiplier(condition: string): number {
  switch (condition) {
    case 'new': return 1.05;      // Can sometimes sell above market
    case 'like_new': return 1.0;  // Full market value
    case 'good': return 0.90;     // Slight discount
    case 'fair': return 0.75;     // Noticeable discount
    case 'poor': return 0.55;     // Heavy discount
    case 'parts': return 0.25;    // Parts value only
    default: return 0.85;         // Unknown = assume good-ish
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
 * Now includes condition context for better estimates.
 */
async function estimateValueWithAI(
  productName: string,
  condition: string,
  conditionNotes: string | null
): Promise<number | null> {
  const conditionContext = conditionNotes
    ? `\nCondition: ${condition} — ${conditionNotes}`
    : `\nCondition: ${condition}`;

  const prompt = `What is a fair used price for "${productName}" on Facebook Marketplace or local classifieds in the US?
${conditionContext}

Consider:
- Local pickup, cash transaction
- Current market (not retail, not eBay shipped prices — local used is typically 50-70% of retail)
- Factor in the condition: ${condition === 'new' ? 'sealed/new should be near retail' : condition === 'fair' ? 'fair condition = lower price' : 'used/good condition'}

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

  const { data: exact } = await query.eq('product_name', productName).limit(1);
  if (exact && exact.length > 0) return exact[0].avg_sold_price;

  return null;
}

/**
 * Combine price signals into a weighted market value.
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
    return Math.round((observed!.median * 0.7 + aiEstimate! * 0.3) * 100) / 100;
  }
  if (hasObserved) return observed!.median;
  if (hasAI) return aiEstimate;
  return null;
}

/**
 * Look at previous listings for the SAME normalized product
 * and compute the median asking price as our market reference.
 */
async function getMarketPrice(
  productName: string,
  category: string | null
): Promise<{ median: number; count: number } | null> {
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

  if (category) {
    const { data: categoryListings } = await supabase
      .from('stc_listings')
      .select('parsed_product, asking_price')
      .eq('parsed_category', category)
      .not('asking_price', 'is', null)
      .not('parsed_product', 'is', null)
      .gt('asking_price', 0);

    if (categoryListings && categoryListings.length >= 3) {
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
 */
async function findSimilarProducts(target: string, candidates: string[]): Promise<string[]> {
  const preFiltered = candidates.filter(c => {
    const targetLower = target.toLowerCase();
    const candidateLower = c.toLowerCase();
    if (targetLower === candidateLower) return true;
    const targetHasProMax = targetLower.includes('pro max');
    const candidateHasProMax = candidateLower.includes('pro max');
    if (targetHasProMax !== candidateHasProMax) return false;
    const targetHasMini = targetLower.includes('mini');
    const candidateHasMini = candidateLower.includes('mini');
    if (targetHasMini !== candidateHasMini) return false;
    const targetHasPlus = targetLower.includes('plus');
    const candidateHasPlus = candidateLower.includes('plus');
    if (targetHasPlus !== candidateHasPlus) return false;
    if (!targetHasProMax && !candidateHasProMax) {
      const targetHasPro = targetLower.includes(' pro');
      const candidateHasPro = candidateLower.includes(' pro');
      if (targetHasPro !== candidateHasPro) return false;
    }
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
 */
async function updateMarketPrices(
  productName: string,
  category: string,
  askingPrice: number
): Promise<void> {
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

  // Load watched categories for relevance checking
  const categories = await getCategories(supabase);
  const categoryNames = categories.map(c => `${c.name} (keywords: ${c.keywords.join(', ')})`);

  for (const listing of listings as Listing[]) {
    try {
      // Deep analysis: relevance + normalization + condition + specs
      const analysis = await analyzeProduct(listing.title, listing.raw_email_snippet, categoryNames);

      if (!analysis) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] AI couldn't analyze: ${listing.title}`);
        continue;
      }

      // Determine category: AI-matched > keyword match > null
      const category = analysis.matchedCategory
        ? categories.find(c => c.name.toLowerCase() === analysis.matchedCategory!.toLowerCase())?.slug ?? findCategorySync(listing.title, categories)
        : listing.parsed_category ?? findCategorySync(listing.title, categories);

      // Update parsed fields with full analysis
      await supabase
        .from('stc_listings')
        .update({
          parsed_product: analysis.baseModel,
          parsed_storage: analysis.storage,
          parsed_category: category,
          parsed_condition: analysis.condition !== 'unknown' ? analysis.condition : null,
        })
        .eq('id', listing.id);

      // Gate 1: Irrelevant listings — auto-dismiss
      if (analysis.isIrrelevant) {
        await supabase
          .from('stc_listings')
          .update({
            score: 'pass',
            estimated_profit: 0,
            feedback: 'irrelevant',
            feedback_note: analysis.skipReason,
            status: 'dismissed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', listing.id);
        console.log(`  [dismissed] ${analysis.skipReason}: ${listing.title}`);
        continue;
      }

      // Gate 2: Accessories, damaged, rentals, wanted posts — auto-pass
      if (analysis.isAccessory || analysis.isDamaged || analysis.isRental || analysis.isWanted) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [skip] ${analysis.skipReason ?? 'flagged'}: ${listing.title}`);
        continue;
      }

      // Gate 3: "Parts" condition — auto-pass (even if not flagged as isDamaged)
      if (analysis.condition === 'parts') {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [skip] for parts: ${listing.title}`);
        continue;
      }

      // Record this listing's price for future reference
      if (listing.asking_price && category && analysis.baseModel) {
        await updateMarketPrices(analysis.baseModel, category, listing.asking_price);
      }

      // No asking price = can't score
      if (!listing.asking_price) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] No price: ${listing.title}`);
        continue;
      }

      // Get product intel (user context) if available
      const intel = analysis.baseModel ? await getProductIntel(analysis.baseModel) : null;

      // Get market reference
      const manualPrice = intel?.price_ceiling ?? await getManualPrice(analysis.baseModel ?? listing.title, category);
      const market = await getMarketPrice(analysis.baseModel ?? listing.title, category);

      // AI fallback estimate — now condition-aware
      let aiEstimate: number | null = null;
      if (!manualPrice && (!market || market.count < 2) && analysis.baseModel) {
        aiEstimate = await estimateValueWithAI(analysis.baseModel, analysis.condition, analysis.conditionNotes);
        if (aiEstimate) {
          console.log(`    AI estimate for ${analysis.baseModel} (${analysis.condition}): $${aiEstimate}`);
        }
      }

      // Compute base market value from available signals
      const baseMarketValue = computeMarketValue(manualPrice, market, aiEstimate);

      // Apply condition adjustment — a "fair" item is worth less than "like new"
      // Only apply when we have market data (AI estimates already factor condition)
      const condMult = (manualPrice || (market && market.count >= 2))
        ? conditionMultiplier(analysis.condition)
        : 1.0; // AI estimate already accounts for condition

      const marketValue = baseMarketValue ? Math.round(baseMarketValue * condMult) : null;

      // Apply price floor check
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
        if (analysis.condition !== 'unknown') sources.push(`cond:${analysis.condition}`);
        if (condMult !== 1.0) sources.push(`×${condMult}`);
        if (intel?.difficulty) sources.push(intel.difficulty);
        console.log(
          `  [${score}] ${listing.title} — $${listing.asking_price} vs $${marketValue} (${sources.join(', ')}, ${discount.toFixed(0)}% off, profit $${estimatedProfit})`
        );
      } else {
        score = 'pass';
        estimatedProfit = 0;
        console.log(
          `  [pass] No market data (${market?.count ?? 0} observed): ${listing.title} — $${listing.asking_price}`
        );
      }

      // Build price source description
      const priceSources = [];
      if (intel?.price_ceiling) priceSources.push(`Your value: $${intel.price_ceiling}`);
      if (manualPrice && !intel?.price_ceiling) priceSources.push(`Manual: $${manualPrice}`);
      if (market && market.count >= 2) priceSources.push(`${market.count} observed, median $${market.median}`);
      if (aiEstimate) priceSources.push(`AI estimate: $${aiEstimate}`);
      if (analysis.condition !== 'unknown') priceSources.push(`Condition: ${analysis.condition}`);
      if (analysis.conditionNotes) priceSources.push(analysis.conditionNotes);
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

      // Alert only for great deals
      if (score === 'great' && !listing.alert_sent) {
        const condLabel = analysis.condition !== 'unknown' ? ` [${analysis.condition}]` : '';
        await sendAlert(
          `${score.toUpperCase()}: $${estimatedProfit} potential profit`,
          `${listing.title}${condLabel}\nAsking: $${listing.asking_price}${marketValue ? `\nMarket: $${marketValue}` : ''}${analysis.conditionNotes ? `\n${analysis.conditionNotes}` : ''}`,
          5,
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
