// Background service worker — handles API communication, description fetching, and auto-refresh

const DEFAULT_CONFIG = {
  apiUrl: '', // Set in popup
  supabaseUrl: '',
  supabaseAnonKey: '',
  refreshMinutes: 5,
  enabled: true,
};

/**
 * Fetch the description from a Facebook Marketplace listing detail page.
 * Uses the logged-in browser session via fetch (same cookie jar).
 */
async function fetchFBDescription(itemId) {
  try {
    const url = `https://www.facebook.com/marketplace/item/${itemId}/`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) return null;

    const html = await res.text();

    // FB embeds listing data in meta tags and structured data
    // Try og:description first (most reliable)
    const ogMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="og:description"/i);
    if (ogMatch && ogMatch[1] && ogMatch[1].length > 10) {
      return decodeHTMLEntities(ogMatch[1]).slice(0, 1000);
    }

    // Try description meta tag
    const descMatch = html.match(/<meta\s+(?:property|name)="description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="description"/i);
    if (descMatch && descMatch[1] && descMatch[1].length > 10) {
      return decodeHTMLEntities(descMatch[1]).slice(0, 1000);
    }

    return null;
  } catch (err) {
    console.log(`[STC] Failed to fetch FB description for ${itemId}:`, err.message);
    return null;
  }
}

/**
 * Fetch the description from a KSL Classifieds listing detail page.
 */
async function fetchKSLDescription(listingId, url) {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: { 'Accept': 'text/html' },
    });
    if (!res.ok) return null;

    const html = await res.text();

    // KSL puts description in og:description or a description div
    const ogMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="og:description"/i);
    if (ogMatch && ogMatch[1] && ogMatch[1].length > 10) {
      return decodeHTMLEntities(ogMatch[1]).slice(0, 1000);
    }

    // Try to find description in the page body
    const descMatch = html.match(/<meta\s+(?:property|name)="description"\s+content="([^"]*?)"/i)
      || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="description"/i);
    if (descMatch && descMatch[1] && descMatch[1].length > 10) {
      return decodeHTMLEntities(descMatch[1]).slice(0, 1000);
    }

    return null;
  } catch (err) {
    console.log(`[STC] Failed to fetch KSL description for ${listingId}:`, err.message);
    return null;
  }
}

function decodeHTMLEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

// Send listings to Supabase — now with description fetching
async function ingestListings(listings) {
  const config = await chrome.storage.local.get(DEFAULT_CONFIG);
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.log('[STC] No Supabase config, skipping ingest');
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;
  const ingestedIds = [];

  for (const listing of listings) {
    try {
      // Fetch description from the detail page
      let description = listing.snippet || null;

      if (listing.source === 'facebook') {
        const itemId = listing.source_id.replace('fb_', '');
        const fetched = await fetchFBDescription(itemId);
        if (fetched) description = fetched;
      } else if (listing.source === 'ksl' && listing.url) {
        const listingId = listing.source_id.replace('ksl_', '');
        const fetched = await fetchKSLDescription(listingId, listing.url);
        if (fetched) description = fetched;
      }

      const res = await fetch(`${config.supabaseUrl}/rest/v1/stc_listings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': config.supabaseAnonKey,
          'Authorization': `Bearer ${config.supabaseAnonKey}`,
          'Prefer': 'resolution=ignore-duplicates',
        },
        body: JSON.stringify({
          source: listing.source,
          source_id: listing.source_id,
          title: listing.title,
          asking_price: listing.price,
          listing_url: listing.url,
          raw_email_snippet: description,
          first_seen_at: new Date().toISOString(),
          status: 'new',
        }),
      });

      if (res.ok || res.status === 409) {
        inserted++;
        ingestedIds.push(listing.source_id);
      } else {
        const text = await res.text();
        console.log(`[STC] Insert failed: ${res.status} ${text}`);
        skipped++;
      }
    } catch (err) {
      console.error('[STC] Ingest error:', err);
      skipped++;
    }
  }

  // Update stats
  const stats = await chrome.storage.local.get({ totalIngested: 0, lastIngest: null });
  await chrome.storage.local.set({
    totalIngested: stats.totalIngested + inserted,
    lastIngest: new Date().toISOString(),
  });

  console.log(`[STC] Ingested ${inserted}, skipped ${skipped}`);
  return { inserted, skipped, ingestedIds };
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LISTINGS_FOUND') {
    ingestListings(msg.listings).then(sendResponse);
    return true; // async response
  }
  if (msg.type === 'GET_CONFIG') {
    chrome.storage.local.get(DEFAULT_CONFIG).then(sendResponse);
    return true;
  }
});

// Auto-refresh tabs
chrome.alarms.create('refresh-tabs', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'refresh-tabs') return;

  const config = await chrome.storage.local.get(DEFAULT_CONFIG);
  if (!config.enabled) return;

  const tabs = await chrome.tabs.query({
    url: [
      'https://www.facebook.com/marketplace/*',
      'https://www.ksl.com/classifieds/*',
      'https://classifieds.ksl.com/*',
    ],
  });

  for (const tab of tabs) {
    chrome.tabs.reload(tab.id);
  }

  console.log(`[STC] Refreshed ${tabs.length} marketplace tabs`);
});
