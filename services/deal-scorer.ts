import { createServiceClient } from '../lib/supabase/service';
import { parseWithAI } from '../lib/openai';
import { sendAlert } from '../lib/ntfy';
import type { Listing, ListingScore, Product } from '../lib/types';

const supabase = createServiceClient();

/**
 * Fetch description from a listing URL.
 * The scorer runs on the local MacBook so it has full network access.
 */
async function fetchDescription(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const ogMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="og:description"/i);
    if (ogMatch?.[1] && ogMatch[1].length > 10) {
      return ogMatch[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
        .slice(0, 3000);
    }

    const descMatch = html.match(/<meta\s+(?:property|name)="description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="description"/i);
    if (descMatch?.[1] && descMatch[1].length > 10) {
      return descMatch[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
        .slice(0, 3000);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Condition multiplier — how much the condition affects resale value.
 */
function conditionMultiplier(condition: string): number {
  switch (condition) {
    case 'new': return 1.05;
    case 'like_new': return 1.0;
    case 'good': return 0.90;
    case 'fair': return 0.75;
    case 'poor': return 0.55;
    case 'parts': return 0.25;
    default: return 0.85;
  }
}

/**
 * Storage bonus — extra value for storage above the base config.
 * Products are tracked as base variants, so extra storage = extra profit potential.
 */
function storageBonus(storage: string | null): number {
  if (!storage) return 0;
  const gb = parseInt(storage.replace(/[^\d]/g, ''), 10);
  if (isNaN(gb)) return 0;
  // Base configs are typically 64-256GB depending on product.
  // Anything 512GB+ adds meaningful value.
  if (gb >= 2000) return 0.20; // 2TB+
  if (gb >= 1000) return 0.15; // 1TB
  if (gb >= 512) return 0.10;  // 512GB
  if (gb >= 256) return 0.05;  // 256GB (slight bump for non-base)
  return 0;
}

interface ProductAnalysis {
  reasoning: string;
  canonicalName: string;
  brand: string | null;
  modelLine: string | null;
  year: number | null;
  storage: string | null;
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'parts' | 'unknown';
  conditionNotes: string | null;
  isAccessory: boolean;
  isDamaged: boolean;
  isRental: boolean;
  isWanted: boolean;
  isIrrelevant: boolean;
  isTooOld: boolean;
  skipReason: string | null;
}

/**
 * Smart AI product analysis. Reasons through what's being sold,
 * resolves ambiguity, and normalizes to a base product variant.
 */
async function analyzeProduct(
  title: string,
  description: string | null,
  knownProducts: string[]
): Promise<ProductAnalysis | null> {
  const descContext = description
    ? `\nSeller's Description: "${description.slice(0, 800)}"`
    : '';

  const knownContext = knownProducts.length > 0
    ? `\n\nPRODUCTS ALREADY IN OUR DATABASE (use these exact names when the listing matches):\n${knownProducts.join('\n')}`
    : '';

  const currentYear = new Date().getFullYear();
  const prompt = `You are a product identification expert analyzing marketplace listings for a resale business. Your job is to identify the SPECIFIC product being sold — not a generic category.

STEP 1 — READ EVERYTHING
The title is often vague or wrong. The DESCRIPTION is where the real details are. Read both carefully.
- "Mac Mini" in the title but "Late 2014 Mac mini, Intel i5, 8GB RAM" in description → this is a "Mac Mini Late 2014 i5", NOT just "Mac Mini"
- "iPad Pro" in the title but "M4 chip, 2025" in description → this is an "iPad Pro M4 11-inch" or "iPad Pro M4 13-inch"
- Multiple items in one listing? Pick the PRIMARY item being sold, or set isIrrelevant if it's a bundle that can't be normalized to one product.

STEP 2 — IDENTIFY THE SPECIFIC PRODUCT
You MUST determine the generation, year, or chip. A product without a generation is USELESS for pricing.

GOOD canonical names (specific, priceable):
- "Mac Mini M2 2023"
- "Mac Mini Late 2014 i5"
- "MacBook Pro 14-inch M3 Pro"
- "iPhone 15 Pro Max"
- "iPad Pro M4 11-inch"
- "Bambu Lab X1C"
- "iMac M1 24-inch 2021"

BAD canonical names (too generic, NEVER use these):
- "Apple Mac Mini" ← WHICH Mac Mini? There are 10+ generations
- "MacBook Pro" ← WHICH ONE?
- "iPhone" ← useless
- "iPad Pro" ← need the chip/year/size

How to determine generation:
- Check description for: year, chip (M1/M2/M3/M4, Intel i5/i7/i9, A-series), model number
- Check title for year mentions, chip names
- "Late 2014", "2018", "M2", "i7-10700" — these all identify the generation
- If NEITHER title NOR description gives ANY generation info, set canonicalName to "unknown"

STEP 3 — AGE CHECK
Current year: ${currentYear}. If the product is from ${currentYear - 5} or older (5+ years), set isTooOld to true.
Examples: A 2018 MacBook in ${currentYear} = ${currentYear - 2018} years old = too old. A 2022 iPad = ${currentYear - 2022} years old = fine.
Intel Macs without a year: if it has Intel i5/i7 and no year mentioned, it's almost certainly 5+ years old → isTooOld: true.

STEP 4 — EXTRACT DETAILS
Format: Brand + Product Line + Tier/Size + Generation/Chip + Year (if known and not redundant with chip)
- storage: "128GB", "256GB", "512GB", "1TB" etc. NEVER in canonicalName
- year: the production year as a number (e.g. 2024). null if truly unknown
- condition: new/like_new/good/fair/poor/parts/unknown — use the WORST signal from title AND description
- conditionNotes: specific details like "battery 82%", "scratch on back". null if none

CLASSIFICATION FLAGS:
- isAccessory: TRUE if selling parts, accessories, cases, cables, adapters — NOT a complete main product
- isDamaged: TRUE if broken, cracked, water damage, "for parts", doesn't work
- isRental: TRUE if "for rent", "rental", "per day"
- isWanted: TRUE if "ISO", "WTB", "looking for", "wanted"
- isIrrelevant: TRUE if not electronics/tech (cars, furniture, clothes, toys, etc.)
- isTooOld: TRUE if the product is 5+ years old based on year/generation
- skipReason: why it was flagged, null if clean listing

Title: "${title}"${descContext}${knownContext}

Return JSON only:
{"reasoning":"<2-3 sentences>","canonicalName":"...","brand":"...","modelLine":"...","year":null,"storage":null,"condition":"unknown","conditionNotes":null,"isAccessory":false,"isDamaged":false,"isRental":false,"isWanted":false,"isIrrelevant":false,"isTooOld":false,"skipReason":null}

CRITICAL RULES:
- NEVER return a generic name like "Apple Mac Mini" or "MacBook Pro" — you MUST include the generation/chip/year
- If you can't determine the generation from title+description, set canonicalName to "unknown"
- NEVER include storage in canonicalName
- Description OVERRIDES title when they conflict
- "Great condition" in title but "cracked screen" in description = isDamaged:true, condition:"poor"
- Multiple items at different prices = set isIrrelevant:true, skipReason:"multiple items in one listing"`;

  try {
    const result = await parseWithAI(prompt);
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);

    if (parsed.reasoning) {
      console.log(`    AI reasoning: "${parsed.reasoning}"`);
    }

    if (!parsed.canonicalName || parsed.canonicalName === 'unknown') return null;

    return {
      reasoning: parsed.reasoning || '',
      canonicalName: parsed.canonicalName,
      brand: parsed.brand || null,
      modelLine: parsed.modelLine || null,
      year: parsed.year || null,
      storage: parsed.storage || null,
      condition: parsed.condition || 'unknown',
      conditionNotes: parsed.conditionNotes || null,
      isAccessory: parsed.isAccessory ?? false,
      isDamaged: parsed.isDamaged ?? false,
      isRental: parsed.isRental ?? false,
      isWanted: parsed.isWanted ?? false,
      isIrrelevant: parsed.isIrrelevant ?? false,
      isTooOld: parsed.isTooOld ?? false,
      skipReason: parsed.skipReason || null,
    };
  } catch {
    return null;
  }
}

/**
 * Find an existing product by canonical name, or create a new one in 'pending' status.
 */
async function findOrCreateProduct(
  canonicalName: string,
  brand: string | null,
  modelLine: string | null,
  autoApprove: boolean = false
): Promise<Product> {
  // Try exact match (case-insensitive)
  const { data: existing } = await supabase
    .from('stc_products')
    .select('*')
    .ilike('canonical_name', canonicalName)
    .limit(1);

  if (existing && existing.length > 0) {
    // Increment listing count
    await supabase
      .from('stc_products')
      .update({ listing_count: (existing[0].listing_count || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', existing[0].id);

    return existing[0] as Product;
  }

  // Create new product — auto-approve if brand rule says so
  const initialStatus = autoApprove ? 'active' : 'pending';
  const { data: created, error } = await supabase
    .from('stc_products')
    .insert({
      canonical_name: canonicalName,
      brand,
      model_line: modelLine,
      status: initialStatus,
      first_seen_at: new Date().toISOString(),
      listing_count: 1,
      confidence: 'low',
    })
    .select('*')
    .single();

  if (error) {
    // Race condition: another scorer run created it
    const { data: retry } = await supabase
      .from('stc_products')
      .select('*')
      .ilike('canonical_name', canonicalName)
      .limit(1);

    if (retry && retry.length > 0) return retry[0] as Product;
    throw error;
  }

  console.log(`  [new product] "${canonicalName}" — ${initialStatus}${autoApprove ? ' (auto-approved)' : ''}`);
  return created as Product;
}

/**
 * Load all known product canonical names for AI context.
 */
async function getKnownProductNames(): Promise<string[]> {
  const { data } = await supabase
    .from('stc_products')
    .select('canonical_name')
    .order('listing_count', { ascending: false })
    .limit(200);

  if (!data) return [];
  return data.map(d => d.canonical_name);
}

/**
 * Load brand rules for age filtering and auto-approve.
 */
interface BrandRule {
  brand: string;
  max_age_years: number | null;
  auto_approve: boolean;
}

async function getBrandRules(): Promise<Record<string, BrandRule>> {
  const { data } = await supabase
    .from('stc_brand_rules')
    .select('brand, max_age_years, auto_approve');

  if (!data) return {};
  const rules: Record<string, BrandRule> = {};
  for (const r of data) {
    rules[r.brand.toLowerCase()] = r;
  }
  return rules;
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

  const knownProducts = await getKnownProductNames();
  const brandRules = await getBrandRules();
  console.log(`Loaded ${knownProducts.length} known products, ${Object.keys(brandRules).length} brand rules`);

  for (const listing of listings as Listing[]) {
    try {
      // Skip garbage titles
      const titleLower = listing.title.toLowerCase().trim();
      if (titleLower === 'just listed' || titleLower.length < 4) {
        await supabase
          .from('stc_listings')
          .update({
            score: 'pass',
            estimated_profit: 0,
            status: 'dismissed',
            feedback: 'irrelevant',
            feedback_note: 'no product info in title',
            updated_at: new Date().toISOString(),
          })
          .eq('id', listing.id);
        console.log(`  [dismissed] garbage title: "${listing.title}"`);
        continue;
      }

      // Fetch description if we don't have one
      let description = listing.raw_email_snippet;
      if (!description && listing.listing_url) {
        description = await fetchDescription(listing.listing_url);
        if (description) {
          await supabase
            .from('stc_listings')
            .update({ raw_email_snippet: description })
            .eq('id', listing.id);
          console.log(`  [fetched desc] ${listing.title.slice(0, 40)}: ${description.slice(0, 80)}...`);
        }
      }

      // AI analysis: reason through what's being sold, normalize product
      const analysis = await analyzeProduct(listing.title, description, knownProducts);

      if (!analysis) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] AI couldn't analyze: ${listing.title}`);
        continue;
      }

      // Update parsed fields from AI analysis
      await supabase
        .from('stc_listings')
        .update({
          parsed_product: analysis.canonicalName,
          parsed_storage: analysis.storage,
          parsed_condition: analysis.condition !== 'unknown' ? analysis.condition : null,
        })
        .eq('id', listing.id);

      // Gate 1: Irrelevant listings
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

      // Gate 2: Too old — check brand rules for max_age_years
      const currentYear = new Date().getFullYear();
      const brandKey = (analysis.brand ?? '').toLowerCase();
      const rule = brandRules[brandKey];
      const maxAge = rule?.max_age_years;

      let isTooOld = false;
      if (maxAge !== null && maxAge !== undefined) {
        // Brand has an age limit — check deterministically
        isTooOld = analysis.isTooOld
          || (analysis.year !== null && analysis.year <= currentYear - maxAge)
          || (!analysis.year && /\b(intel\s+i[357]|intel\s+core\s+i[357]|i[357]-[0-9]{4})\b/i.test(analysis.canonicalName + ' ' + (listing.title ?? '')))
          || (!analysis.year && new RegExp(`\\b(${Array.from({ length: maxAge + 5 }, (_, i) => currentYear - maxAge - i).join('|')})\\b`).test(analysis.canonicalName));
      }

      if (isTooOld) {
        await supabase
          .from('stc_listings')
          .update({
            score: 'pass',
            estimated_profit: 0,
            feedback: 'irrelevant',
            feedback_note: `too old${analysis.year ? ` (${analysis.year})` : ''}`,
            status: 'dismissed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', listing.id);
        console.log(`  [dismissed] too old${analysis.year ? ` (${analysis.year})` : ''}: ${listing.title}`);
        continue;
      }

      // Gate 3: Accessories, damaged, rentals, wanted, parts-condition
      if (analysis.isAccessory || analysis.isDamaged || analysis.isRental || analysis.isWanted || analysis.condition === 'parts') {
        await supabase
          .from('stc_listings')
          .update({
            score: 'pass',
            estimated_profit: 0,
            feedback_note: analysis.skipReason ?? (analysis.isAccessory ? 'accessory' : analysis.isDamaged ? 'damaged' : analysis.isRental ? 'rental' : analysis.isWanted ? 'wanted post' : 'parts condition'),
            updated_at: new Date().toISOString(),
          })
          .eq('id', listing.id);
        console.log(`  [skip] ${analysis.skipReason ?? 'flagged'}: ${listing.title}`);
        continue;
      }

      // Find or create the product
      const autoApprove = rule?.auto_approve ?? false;
      const product = await findOrCreateProduct(analysis.canonicalName, analysis.brand, analysis.modelLine, autoApprove);

      // Link listing to product
      await supabase
        .from('stc_listings')
        .update({ product_id: product.id })
        .eq('id', listing.id);

      // Gate 3: Inactive product — auto-dismiss
      if (product.status === 'inactive') {
        await supabase
          .from('stc_listings')
          .update({
            score: 'pass',
            estimated_profit: 0,
            status: 'dismissed',
            feedback: 'irrelevant',
            feedback_note: 'inactive product',
            updated_at: new Date().toISOString(),
          })
          .eq('id', listing.id);
        console.log(`  [dismissed] inactive product "${product.canonical_name}": ${listing.title}`);
        continue;
      }

      // Gate 4: Pending product — wait for approval
      if (product.status === 'pending') {
        console.log(`  [pending] awaiting approval for "${product.canonical_name}": ${listing.title}`);
        continue; // Leave score null, listing waits
      }

      // Active product — score it
      if (!listing.asking_price) {
        await supabase
          .from('stc_listings')
          .update({ score: 'pass', estimated_profit: 0, updated_at: new Date().toISOString() })
          .eq('id', listing.id);
        console.log(`  [pass] No price: ${listing.title}`);
        continue;
      }

      // No target_buy_price yet — compute initial pricing inline
      if (!product.target_buy_price) {
        console.log(`  [pricing] computing initial target for "${product.canonical_name}"...`);

        // Pull all listings for this product
        const { data: allPriced } = await supabase
          .from('stc_listings')
          .select('asking_price')
          .eq('product_id', product.id)
          .not('asking_price', 'is', null)
          .gt('asking_price', 0);

        const prices = (allPriced ?? []).map(l => l.asking_price as number);

        if (prices.length === 0) {
          console.log(`  [waiting] no priced listings for "${product.canonical_name}": ${listing.title}`);
          continue;
        }

        const sorted = [...prices].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        const low = sorted[0];
        const high = sorted[sorted.length - 1];

        // Ask AI for a real market value and buy-below price
        let quickTarget: number;
        let aiValue: number | null = null;
        try {
          const aiPrompt = `You are a local marketplace flipping expert. What should I pay MAX to flip "${product.canonical_name}" profitably?

Observed local listings: ${prices.length} seen, range $${low}-$${high}, median asking $${median}.
This is Facebook Marketplace / KSL Classifieds in Utah — local cash pickup.

Consider:
- Sellers often list high, actual sale is 10-20% below asking
- I need at least 20% margin after fees to make it worth my time
- Factor in typical demand and how fast these sell locally

Return JSON only: {"marketValue":<fair_market_number>,"buyBelow":<max_I_should_pay>}`;

          const result = await parseWithAI(aiPrompt);
          const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
          const parsed = JSON.parse(cleaned);
          if (parsed.buyBelow > 0) {
            quickTarget = Math.round(parsed.buyBelow);
            aiValue = parsed.marketValue > 0 ? Math.round(parsed.marketValue) : null;
            console.log(`    AI pricing: market $${aiValue}, buy below $${quickTarget}`);
          } else {
            quickTarget = Math.round(median * 0.60);
          }
        } catch {
          // AI failed, fall back to 60% of median
          quickTarget = Math.round(median * 0.60);
          console.log(`    AI pricing failed, fallback: $${quickTarget}`);
        }

        await supabase.from('stc_products').update({
          target_buy_price: quickTarget,
          ai_market_value: aiValue,
          median_asking_price: median,
          low_price: low,
          high_price: high,
          listing_count: prices.length,
          updated_at: new Date().toISOString(),
        }).eq('id', product.id);
        product.target_buy_price = quickTarget;
        console.log(`    Initial target: $${quickTarget} (${prices.length} listings, median $${median})`);
      }

      // Compute adjusted market value
      const condMult = conditionMultiplier(analysis.condition);
      const storageMult = 1 + storageBonus(analysis.storage);
      const adjustedValue = product.target_buy_price * condMult * storageMult;

      // Compute profit and score
      const estimatedProfit = Math.round((adjustedValue - listing.asking_price) * 100) / 100;
      const discount = ((adjustedValue - listing.asking_price) / adjustedValue) * 100;

      let score: ListingScore;
      if (discount >= 30 && estimatedProfit >= 200) {
        score = 'great';
      } else if (discount >= 15 && estimatedProfit >= 50) {
        score = 'good';
      } else {
        score = 'pass';
      }

      // Build price source description
      const priceSources = [];
      priceSources.push(`Target: $${product.target_buy_price}`);
      if (analysis.condition !== 'unknown') priceSources.push(`Condition: ${analysis.condition}`);
      if (analysis.conditionNotes) priceSources.push(analysis.conditionNotes);
      if (analysis.storage) priceSources.push(`Storage: ${analysis.storage}`);
      priceSources.push(`Confidence: ${product.confidence}`);
      const priceSource = priceSources.join(' · ');

      console.log(
        `  [${score}] ${listing.title} — $${listing.asking_price} vs $${Math.round(adjustedValue)} (${priceSource}, ${discount.toFixed(0)}% off, profit $${estimatedProfit})`
      );

      await supabase
        .from('stc_listings')
        .update({
          score,
          estimated_profit: estimatedProfit,
          price_source: priceSource,
          updated_at: new Date().toISOString(),
        })
        .eq('id', listing.id);

      // Alert only for great deals with high confidence
      const alertEligible = (product.confidence === 'high' || product.confidence === 'very_high');
      if (score === 'great' && alertEligible && !listing.alert_sent) {
        const condLabel = analysis.condition !== 'unknown' ? ` [${analysis.condition}]` : '';
        await sendAlert(
          `${score.toUpperCase()}: $${estimatedProfit} potential profit`,
          `${listing.title}${condLabel}\nAsking: $${listing.asking_price}\nTarget: $${product.target_buy_price}${analysis.conditionNotes ? `\n${analysis.conditionNotes}` : ''}`,
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
