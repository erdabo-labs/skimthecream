import { createServiceClient } from '../lib/supabase/service';

/**
 * Listing Monitor — runs overnight to check if listings are still live.
 *
 * For each active listing (status: new, contacted), fetches the listing URL
 * and checks if it's still available. If gone (404, redirected, removed),
 * marks it with gone_at and calculates days_active.
 *
 * Updates product sell velocity and ease rating from real data.
 */

const supabase = createServiceClient();

const DELAY_MS = 2000;
const BATCH_SIZE = 50;

interface ListingToCheck {
  id: number;
  source: string;
  listing_url: string | null;
  first_seen_at: string | null;
  created_at: string;
  parsed_product: string | null;
  product_id: number | null;
}

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

    if (html.includes('og:title')) return true;
    if (html.length < 5000) return false;

    return true;
  } catch {
    return true; // Don't mark as gone on network error
  }
}

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
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Update product sell velocity and ease rating from observed gone_at data.
 */
async function updateProductStats(): Promise<void> {
  const { data: goneData } = await supabase
    .from('stc_listings')
    .select('product_id, days_active')
    .not('gone_at', 'is', null)
    .not('days_active', 'is', null)
    .not('product_id', 'is', null)
    .gt('days_active', 0);

  if (!goneData) return;

  // Group by product_id
  const byProduct: Record<number, number[]> = {};
  for (const row of goneData) {
    const pid = row.product_id as number;
    if (!byProduct[pid]) byProduct[pid] = [];
    byProduct[pid].push(row.days_active as number);
  }

  for (const [productId, days] of Object.entries(byProduct)) {
    if (days.length < 3) continue;

    days.sort((a, b) => a - b);
    const mid = Math.floor(days.length / 2);
    const median = days.length % 2 === 0 ? (days[mid - 1] + days[mid]) / 2 : days[mid];

    let sellVelocity: 'fast' | 'moderate' | 'slow';
    if (median <= 3) sellVelocity = 'fast';
    else if (median <= 7) sellVelocity = 'moderate';
    else sellVelocity = 'slow';

    let easeRating: 'easy' | 'moderate' | 'hard';
    if (median <= 3) easeRating = 'easy';
    else if (median <= 7) easeRating = 'moderate';
    else easeRating = 'hard';

    await supabase
      .from('stc_products')
      .update({
        avg_days_to_sell: Math.round(median * 10) / 10,
        sell_velocity: sellVelocity,
        ease_rating: easeRating,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parseInt(productId))
      .eq('status', 'active');

    console.log(`  Product #${productId}: median ${median.toFixed(1)} days → ${sellVelocity}`);
  }
}

async function monitorListings(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Listing monitor starting...`);

  const { data: listings, error } = await supabase
    .from('stc_listings')
    .select('id, source, listing_url, first_seen_at, created_at, parsed_product, product_id')
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
    await updateProductStats();
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
        await supabase
          .from('stc_listings')
          .update({
            last_seen_at: now,
            first_seen_at: listing.first_seen_at || listing.created_at,
          })
          .eq('id', listing.id);
        stillLive++;
      } else {
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

      await sleep(DELAY_MS);
    } catch (err) {
      console.error(`  Error checking listing ${listing.id}:`, err);
      errors++;
    }
  }

  console.log(`Results: ${stillLive} live, ${gone} gone, ${errors} errors`);

  await updateProductStats();

  console.log(`[${new Date().toISOString()}] Monitor complete`);
}

monitorListings().catch(console.error);
