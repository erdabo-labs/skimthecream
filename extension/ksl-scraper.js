// Content script for KSL Classifieds pages
// Extracts listing cards, fetches descriptions, and sends them to the background worker

(function () {
  const SEEN_KEY = 'stc_seen_ksl';
  const DESC_FETCH_DELAY = 1500;

  function getSeen() {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
  }

  function markSeen(sourceIds) {
    const seen = getSeen();
    const now = Date.now();
    for (const id of sourceIds) {
      seen[id] = now;
    }
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
   * Fetch description from a KSL listing detail page.
   * Content script has same-origin access to ksl.com.
   */
  async function fetchDescription(url) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;

      const html = await res.text();

      const ogMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
        || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="og:description"/i);
      if (ogMatch && ogMatch[1] && ogMatch[1].length > 10) {
        return decodeHTMLEntities(ogMatch[1]).slice(0, 1000);
      }

      const descMatch = html.match(/<meta\s+(?:property|name)="description"\s+content="([^"]*?)"/i)
        || html.match(/<meta\s+content="([^"]*?)"\s+(?:property|name)="description"/i);
      if (descMatch && descMatch[1] && descMatch[1].length > 10) {
        return decodeHTMLEntities(descMatch[1]).slice(0, 1000);
      }

      return null;
    } catch (err) {
      console.log(`[STC] Failed to fetch KSL description:`, err.message);
      return null;
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function extractListings() {
    const listings = [];
    const seen = getSeen();

    const cards = document.querySelectorAll(
      'a[href*="/listing/"], .listing-item, [class*="Listing"]'
    );

    for (const card of cards) {
      try {
        const link = card.tagName === 'A' ? card : card.querySelector('a[href*="/listing/"]');
        if (!link) continue;

        const href = link.href;
        const idMatch = href.match(/\/listing\/(\d+)/);
        if (!idMatch) continue;

        const listingId = idMatch[1];
        const sourceId = `ksl_${listingId}`;

        if (seen[sourceId]) continue;

        const textContent = card.innerText || '';
        const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);

        let price = null;
        let title = null;

        for (const line of lines) {
          if (!price) {
            const priceMatch = line.match(/\$[\d,]+(?:\.\d{2})?/);
            if (priceMatch) {
              price = parseFloat(priceMatch[0].replace(/[$,]/g, ''));
              continue;
            }
          }
          if (!title && line.length > 3 && line.length < 200) {
            if (line.match(/^\$|^(Posted|ago|mi\b|miles|favorite)/i)) continue;
            title = line;
          }
        }

        if (!title) continue;

        const cleanUrl = href.split('?')[0];

        listings.push({
          source: 'ksl',
          source_id: sourceId,
          title,
          price,
          url: cleanUrl,
        });
      } catch (err) {
        console.error('[STC] Error parsing KSL listing:', err);
      }
    }

    return listings;
  }

  async function run() {
    const listings = extractListings();
    if (listings.length === 0) {
      console.log('[STC] No new KSL listings');
      return;
    }

    console.log(`[STC] Found ${listings.length} new KSL listings, fetching descriptions...`);

    // Fetch descriptions from detail pages
    for (let i = 0; i < listings.length; i++) {
      const listing = listings[i];
      if (listing.url) {
        const desc = await fetchDescription(listing.url);
        listing.snippet = desc;
        if (desc) {
          console.log(`[STC] Got description for ${listing.title.slice(0, 40)}: ${desc.slice(0, 80)}...`);
        }
      }
      if (i < listings.length - 1) {
        await sleep(DESC_FETCH_DELAY);
      }
    }

    chrome.runtime.sendMessage(
      { type: 'LISTINGS_FOUND', listings },
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

  setTimeout(run, 2000);

  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(run, 2000);
  });
})();
