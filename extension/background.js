// Background service worker — handles API communication and auto-refresh

const DEFAULT_CONFIG = {
  apiUrl: '', // Set in popup
  supabaseUrl: '',
  supabaseAnonKey: '',
  refreshMinutes: 5,
  enabled: true,
};

// Send listings to Supabase
async function ingestListings(listings) {
  const config = await chrome.storage.local.get(DEFAULT_CONFIG);
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    console.log('[STC] No Supabase config, skipping ingest');
    return { inserted: 0, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;

  for (const listing of listings) {
    try {
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
          raw_email_snippet: listing.snippet || null,
          status: 'new',
        }),
      });

      if (res.ok || res.status === 409) {
        inserted++;
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
  return { inserted, skipped };
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
