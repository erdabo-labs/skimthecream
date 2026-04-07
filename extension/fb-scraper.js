// Content script for Facebook Marketplace pages
// Extracts listing cards, fetches descriptions, and sends them to the background worker

(function () {
  const SEEN_KEY = 'stc_seen_fb';
  const DESC_FETCH_DELAY = 1500; // ms between detail page fetches to avoid rate limits

  function getSeen() {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  }

  function markSeen(sourceIds) {
    const seen = getSeen();
    const now = Date.now();
    for (const id of sourceIds) {
      seen[id] = now;
    }
    // Clean old entries (older than 7 days)
    const week = 7 * 24 * 60 * 60 * 1000;
    for (const [key, timestamp] of Object.entries(seen)) {
      if (now - timestamp > week) delete seen[key];
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  }

  function decodeHTMLEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
  }

  /**
   * Fetch description from a FB listing detail page.
   * Runs in content script context so it has the user's FB cookies.
   */
  async function fetchDescription(itemId) {
    try {
      const url = `https://www.facebook.com/marketplace/item/${itemId}/`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;

      const html = await res.text();

      // Try og:description (most reliable, contains seller's description)
      const ogMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
        || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="og:description"/i);
      if (ogMatch && ogMatch[1] && ogMatch[1].length > 10) {
        return decodeHTMLEntities(ogMatch[1]).slice(0, 3000);
      }

      // Fallback: description meta tag
      const descMatch = html.match(/<meta\s+(?:property|name)="description"\s+content="([^"]*?)"/i)
        || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="description"/i);
      if (descMatch && descMatch[1] && descMatch[1].length > 10) {
        return decodeHTMLEntities(descMatch[1]).slice(0, 3000);
      }

      return null;
    } catch (err) {
      console.log(`[STC] Failed to fetch description for ${itemId}:`, err.message);
      return null;
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function extractListings() {
    const listings = [];
    const seen = getSeen();

    // Facebook Marketplace listing cards — they use <a> tags with /marketplace/item/ URLs
    const links = document.querySelectorAll('a[href*="/marketplace/item/"]');

    for (const link of links) {
      try {
        const href = link.href;
        const itemMatch = href.match(/\/marketplace\/item\/(\d+)/);
        if (!itemMatch) continue;

        const itemId = itemMatch[1];
        const sourceId = `fb_${itemId}`;

        // Skip if already seen
        if (seen[sourceId]) continue;

        // Find the listing card container (walk up to find the card)
        const card = link.closest('[class]') || link;

        // Extract text content from the card
        const textContent = card.innerText || '';
        const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);

        // Facebook typically shows: price, title, location, distance
        let price = null;
        let title = null;

        for (const line of lines) {
          // Price detection: starts with $ or contains dollar amount
          if (!price) {
            const priceMatch = line.match(/^\$[\d,]+(?:\.\d{2})?$/);
            if (priceMatch) {
              price = parseFloat(line.replace(/[$,]/g, ''));
              continue;
            }
          }
          // Title: first non-price, non-location, non-generic line
          if (!title && !line.match(/^\$/) && line.length > 3 && line.length < 200) {
            // Skip common non-title patterns
            if (line.match(/^(Listed|Just listed|mile|km|Free|·|\d+ mi|New listing|See more|Marketplace)/i)) continue;
            // Skip lines that are just numbers or very short generic text
            if (line.match(/^\d+$/) || line.length < 5) continue;
            title = line;
          }
        }

        if (!title) continue;

        const cleanUrl = `https://www.facebook.com/marketplace/item/${itemId}/`;

        listings.push({
          source: 'facebook',
          source_id: sourceId,
          itemId,
          title,
          price,
          url: cleanUrl,
        });
      } catch (err) {
        console.error('[STC] Error parsing FB listing:', err);
      }
    }

    return listings;
  }

  // Fetch descriptions and send to background worker
  async function run() {
    const listings = extractListings();
    if (listings.length === 0) {
      console.log('[STC] No new FB listings');
      return;
    }

    console.log(`[STC] Found ${listings.length} new FB listings, fetching descriptions...`);

    // Fetch descriptions from detail pages (with rate limiting)
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      const desc = await fetchDescription(listing.itemId);
      listing.snippet = desc;
      if (desc) {
        console.log(`[STC] Got description for ${listing.title.slice(0, 40)}: ${desc.slice(0, 80)}...`);
      }
      // Rate limit between fetches (skip delay on last item)
      if (i < listings.length - 1) {
        await sleep(DESC_FETCH_DELAY);
      }
    }

    // Clean up itemId before sending (not needed by background)
    const toSend = listings.map(({ itemId, ...rest }) => rest);

    chrome.runtime.sendMessage(
      { type: 'LISTINGS_FOUND', listings: toSend },
      (response) => {
        if (response && response.inserted > 0) {
          const ingestedIds = response.ingestedIds || listings.map(l => l.source_id);
          markSeen(ingestedIds);
          console.log(`[STC] Ingested: ${response.inserted}, skipped: ${response.skipped}`);
        } else if (response) {
          console.log(`[STC] Skipped all ${response.skipped}`);
        }
      }
    );
  }

  // Initial run after page settles
  setTimeout(run, 3000);

  // Also watch for dynamic content loads (infinite scroll)
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(run, 2000);
  });
})();
