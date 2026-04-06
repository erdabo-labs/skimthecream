import { createServiceClient } from '../lib/supabase/service';

/**
 * Listing Monitor — runs overnight to check if listings are still live.
 *
 * For each active listing (status: new, contacted), fetches the listing URL
 * and checks if it's still available. If gone (404, redirected, removed),
 * marks it with gone_at and calculates days_active.
 *
 * This builds time-to-sell intelligence over time:
 * - Fast sellers (1-2 days) = high demand, price accordingly
 * - Slow sellers (7+ days) = room to negotiate
 * - Category avg_days_to_sell gets smarter with real data
 */

const supabase = createServiceClient();

// Rate limit: don't hammer the sites
const DELAY_MS = 2000;
const BATCH_SIZE = 50;

interface ListingToCheck {
  id: number;
  source: string;
  listing_url: string | null;
  first_seen_at: string | null;
  created_at: string;
  parsed_product: string | null;
  parsed_category: string | null;
}

/**
 * Check if a Facebook Marketplace listing is still live.
 * Returns true if the listing appears to still be active.
 */
async function checkFBListing(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });

    if (!res.ok) return false;

    const html = await res.text();

    // Facebook shows specific signals when a listing is gone
    const goneSignals = [
      'This listing is no longer available',
      'This item is sold',
      'Listing not found',
      'content is no longer available',
      'This content isn\'t available',
      'been removed',
    ];

    const htmlLower = html.toLowerCase();
    for (const signal of goneSignals) {
      if (htmlLower.includes(signal.toLowerCase())) return false;
    }

    // If we got a valid page with og:title, it's probably still up
    if (html.includes('og:title')) return true;

    // If page is very short or just a redirect shell, probably gone
    if (html.length < 5000) return false;

    return true;
  } catch {
    // Network error — don't mark as gone, could be temporary
    return true;
  }
}

/**
 * Check if a KSL Classifieds listing is still live.
 */
async function checkKSLListing(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    });

    // KSL returns 404 or redirects for removed listings
    if (res.status === 404) return false;
    if (!res.ok) return false;

    const html = await res.text();

    const goneSignals = [
      'listing has been removed',
      'no longer available',
      'listing not found',
      'has been sold',
      'item sold',
    ];

    const htmlLower = html.toLowerCase();
    for (const signal of goneSignals) {
      if (htmlLower.includes(signal)) return false;
    }

    return true;
  } catch {
    return true; // Don't mark as gone on network error
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Update category avg_days_to_sell based on observed data.
 */
async function updateCategoryStats(): Promise<void> {
  // Get categories
  const { data: categories } = await supabase
    .from('stc_categories')
    .select('id, slug, name');

  if (!categories) return;

  for (const cat of categories) {
    // Calculate average days_active for gone listings in this category
    const { data: goneLlistings } = await supabase
      .from('stc_listings')
      .select('days_active')
      .eq('parsed_category', cat.slug)
      .not('gone_at', 'is', null)
      .not('days_active', 'is', null)
      .gt('days_active', 0);

    if (goneLlistings && goneLlistings.length >= 3) {
      const days = goneLlistings.map(l => l.days_active as number).sort((a, b) => a - b);
      const mid = Math.floor(days.length / 2);
      const median = days.length % 2 === 0 ? (days[mid - 1] + days[mid]) / 2 : days[mid];

      await supabase
        .from('stc_categories')
        .update({ avg_days_to_sell: Math.round(median) })
        .eq('id', cat.id);

      console.log(`  Category "${cat.name}": median ${Math.round(median)} days (${goneLlistings.length} samples)`);
    }
  }
}

/**
 * Update per-product market intelligence with time-to-sell data.
 */
async function updateProductIntel(): Promise<void> {
  // Find products with enough gone listings to compute stats
  const { data: products } = await supabase
    .from('stc_listings')
    .select('parsed_product, days_active')
    .not('gone_at', 'is', null)
    .not('days_active', 'is', null)
    .not('parsed_product', 'is', null)
    .gt('days_active', 0);

  if (!products) return;

  // Group by product
  const byProduct: Record<string, number[]> = {};
  for (const p of products) {
    const name = p.parsed_product as string;
    if (!byProduct[name]) byProduct[name] = [];
    byProduct[name].push(p.days_active as number);
  }

  // Update product intel for products with 3+ data points
  for (const [productName, days] of Object.entries(byProduct)) {
    if (days.length < 3) continue;

    days.sort((a, b) => a - b);
    const mid = Math.floor(days.length / 2);
    const median = days.length % 2 === 0 ? (days[mid - 1] + days[mid]) / 2 : days[mid];

    // Infer difficulty from time to sell
    let difficulty: 'easy' | 'moderate' | 'hard';
    if (median <= 3) difficulty = 'easy';
    else if (median <= 7) difficulty = 'moderate';
    else difficulty = 'hard';

    // Upsert into product_intel — only update difficulty if not manually set
    const { data: existing } = await supabase
      .from('stc_product_intel')
      .select('id, difficulty')
      .eq('product_name', productName)
      .limit(1);

    if (existing && existing.length > 0) {
      // Only update if difficulty was auto-set (not manually overridden)
      // We'll use a simple heuristic: update if notes don't mention manual
      await supabase
        .from('stc_product_intel')
        .update({
          difficulty,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing[0].id)
        .is('notes', null); // Only auto-update if no manual notes
    }
  }
}

async function monitorListings(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Listing monitor starting...`);

  // Get active listings that haven't been marked as gone
  const { data: listings, error } = await supabase
    .from('stc_listings')
    .select('id, source, listing_url, first_seen_at, created_at, parsed_product, parsed_category')
    .in('status', ['new', 'contacted'])
    .is('gone_at', null)
    .not('listing_url', 'is', null)
    .order('last_seen_at', { ascending: true, nullsFirst: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('Error fetching listings:', error.message);
    return;
  }

  if (!listings || listings.length === 0) {
    console.log('No listings to check');
    await updateCategoryStats();
    return;
  }

  console.log(`Checking ${listings.length} listings...`);

  let stillLive = 0;
  let gone = 0;
  let errors = 0;

  for (const listing of listings as ListingToCheck[]) {
    if (!listing.listing_url) continue;

    try {
      const isLive = listing.source === 'facebook'
        ? await checkFBListing(listing.listing_url)
        : await checkKSLListing(listing.listing_url);

      const now = new Date().toISOString();

      if (isLive) {
        // Still live — update last_seen_at
        await supabase
          .from('stc_listings')
          .update({
            last_seen_at: now,
            first_seen_at: listing.first_seen_at || listing.created_at,
          })
          .eq('id', listing.id);
        stillLive++;
      } else {
        // Gone — calculate days active
        const firstSeen = new Date(listing.first_seen_at || listing.created_at);
        const daysActive = Math.max(1, Math.round((Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)));

        await supabase
          .from('stc_listings')
          .update({
            gone_at: now,
            days_active: daysActive,
            last_seen_at: now,
            first_seen_at: listing.first_seen_at || listing.created_at,
          })
          .eq('id', listing.id);

        console.log(`  [gone] ${listing.parsed_product || 'unknown'} — ${daysActive} days active`);
        gone++;
      }

      // Rate limit between checks
      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`  Error checking listing ${listing.id}:`, err);
      errors++;
    }
  }

  console.log(`Results: ${stillLive} live, ${gone} gone, ${errors} errors`);

  // Update category and product stats with new data
  await updateCategoryStats();
  await updateProductIntel();

  console.log(`[${new Date().toISOString()}] Monitor complete`);
}

monitorListings().catch(console.error);
