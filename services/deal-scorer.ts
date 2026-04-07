import { createServiceClient } from '../lib/supabase/service';
import { parseWithAI } from '../lib/openai';
import { sendAlert } from '../lib/ntfy';
import { getCategories, findCategorySync } from '../lib/constants';
import type { Listing, ListingScore } from '../lib/types';

const supabase = createServiceClient();

/**
 * Fetch description from a listing URL.
 * The scorer runs on the local MacBook so it has full network access.
 */
async function fetchDescription(url: string, source: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try og:description first
    const ogMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="og:description"/i);
    if (ogMatch?.[1] && ogMatch[1].length > 10) {
      return ogMatch[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
        .slice(0, 1000);
    }

    // Fallback: description meta
    const descMatch = html.match(/<meta\s+(?:property|name)="description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="description"/i);
    if (descMatch?.[1] && descMatch[1].length > 10) {
      return descMatch[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
        .slice(0, 1000);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Load known products we've seen before so AI can match against real data.
 */
async function getKnownProducts(): Promise<string[]> {
  const { data } = await supabase
    .from('stc_market_prices')
    .select('product_name')
    .not('product_name', 'is', null)
    .order('sample_size', { ascending: false })
    .limit(100);

  if (!data) return [];
  return [...new Set(data.map(d => d.product_name))];
}

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
  categoryNames: string[],
  knownProducts: string[]
): Promise<ProductAnalysis | null> {
  const descContext = description
    ? `\nDescription: "${description.slice(0, 800)}"`
    : '';

  const knownContext = knownProducts.length > 0
    ? `\n\nKNOWN PRODUCTS IN OUR DATABASE (match to these when possible):\n${knownProducts.slice(0, 50).join(', ')}`
    : '';

  const prompt = `You are analyzing a marketplace listing to decide if it's worth buying to flip for profit.

STEP 1 — WHAT IS ACTUALLY BEING SOLD?
Read the title and description carefully. Answer: what specific item(s) is the seller offering?
- "Bambu P1S & X1C complete assembly and nozzles" → selling nozzles and hotend assemblies (parts), NOT printers
- "iPhone 15 Pro 256GB" → selling an iPhone 15 Pro
- "MacBook Pro with charger and case" → selling a MacBook Pro (charger/case are bundled extras)
- "Canon EF 70-200mm lens hood" → selling a lens hood (accessory), NOT a lens
- "iPad Pro Magic Keyboard" → selling a keyboard (accessory), NOT an iPad
- The description often clarifies what's actually for sale — READ IT

STEP 2 — Does it match any of these WATCHED CATEGORIES?
${categoryNames.map(c => `- ${c}`).join('\n')}
If the item being sold doesn't fit any category, it's irrelevant (cars, furniture, drones, clothes, etc.)

STEP 3 — Only if it's a relevant MAIN PRODUCT (not an accessory/part), extract details:
- baseModel: Brand + model + tier + generation. NO storage. "MacBook Pro 14 M3 2023", "iPhone 15 Pro Max", "Bambu Lab X1C"
  - Use description to fill in gaps: title "MacBook Pro" + description "2019 i7" = "MacBook Pro 15 2019 i7"
- storage: "128GB", "512GB", etc. null if not mentioned
- condition: new/like_new/good/fair/poor/parts/unknown — use ALL signals from title AND description
- conditionNotes: specific details like "battery 82%", "scratch on back". null if none
- year: production year. null if unknown
- processor: "M1", "M3 Max", "A17 Pro", "i7-10700". null if not mentioned

CLASSIFICATION:
- isAccessory: TRUE if selling parts, accessories, add-ons, consumables — NOT a complete main product
- isDamaged: TRUE if "for parts", "broken", "doesn't work", "water damage"
- isRental: TRUE if "for rent", "rental", "per day"
- isWanted: TRUE if "ISO", "WTB", "looking for", "wanted"
- isIrrelevant: TRUE if doesn't match any watched category
- skipReason: why it was flagged, null if none
- matchedCategory: which watched category, null if irrelevant

Title: "${title}"${descContext}${knownContext}

IMPORTANT:
- If the description mentions cracked, broken, shattered, damaged, dents, water damage, or "for parts" — isDamaged MUST be true
- If the title is vague (e.g. "Just listed", single word, no product name) and there's no description — set baseModel to "unknown"
- If you can match to a known product from our database, use that exact name as baseModel
- condition should reflect the WORST signal from title OR description. "Great condition" in title but "cracked glass" in description = "poor"

Return JSON only: {"whatIsBeingSold":"<1-line plain English>","baseModel":"...","storage":null,"condition":"unknown","conditionNotes":null,"year":null,"processor":null,"isAccessory":false,"isDamaged":false,"isRental":false,"isWanted":false,"isIrrelevant":false,"skipReason":null,"matchedCategory":null}`;

  try {
    const result = await parseWithAI(prompt);
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);
    if (parsed.whatIsBeingSold) {
      console.log(`    AI sees: "${parsed.whatIsBeingSold}"`);
    }
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

  // Load watched categories and known products
  const categories = await getCategories(supabase);
  const categoryNames = categories.map(c => `${c.name} (keywords: ${c.keywords.join(', ')})`);
  const knownProducts = await getKnownProducts();
  console.log(`Loaded ${knownProducts.length} known products for matching`);

  for (const listing of listings as Listing[]) {
    try {
      // Skip obviously garbage titles
      const titleLower = listing.title.toLowerCase().trim();
      if (titleLower === 'just listed' || titleLower.length < 4) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, status: 'dismissed', feedback: 'irrelevant', feedback_note: 'no product info in title', updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [dismissed] garbage title: "${listing.title}"`);
        continue;
      }

      // Fetch description if we don't have one
      let description = listing.raw_email_snippet;
      if (!description && listing.listing_url) {
        description = await fetchDescription(listing.listing_url, listing.source);
        if (description) {
          await supabase
            .from('stc_listings')
            .update({ raw_email_snippet: description })
            .eq('id', listing.id);
          console.log(`  [fetched desc] ${listing.title.slice(0, 40)}: ${description.slice(0, 80)}...`);
        }
      }

      // Deep analysis: relevance + normalization + condition + specs
      const analysis = await analyzeProduct(listing.title, description, categoryNames, knownProducts);

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

      // Determine pricing confidence
      const hasHardData = !!manualPrice || (market && market.count >= 2);
      const aiOnly = !hasHardData && !!aiEstimate;

      if (marketValue) {
        const discount = ((marketValue - listing.asking_price) / marketValue) * 100;
        const sellFactor = intel?.difficulty === 'hard' ? 0.85 : intel?.difficulty === 'moderate' ? 0.90 : 0.95;
        estimatedProfit = Math.round((marketValue * sellFactor - listing.asking_price) * 100) / 100;

        if (aiOnly) {
          // AI-only pricing: be skeptical. Never "great", higher bar for "good"
          if (discount >= 35 && estimatedProfit >= 150) {
            score = 'good'; // Cap at good — AI estimates can be way off
          } else {
            score = 'pass';
          }
        } else if (discount >= 30 && estimatedProfit >= 200) {
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
        if (aiOnly) sources.push('AI-ONLY⚠️');
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
