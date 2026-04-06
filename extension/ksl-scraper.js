// Content script for KSL Classifieds pages
// Extracts listing cards and sends them to the background worker

(function () {
  const SEEN_KEY = 'stc_seen_ksl';

  function extractListings() {
    const listings = [];
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');

    // KSL listing cards — look for listing links
    const cards = document.querySelectorAll(
      'a[href*="/listing/"], .listing-item, [class*="Listing"]'
    );

    for (const card of cards) {
      try {
        // Find the link
        const link = card.tagName === 'A' ? card : card.querySelector('a[href*="/listing/"]');
        if (!link) continue;

        const href = link.href;
        const idMatch = href.match(/\/listing\/(\d+)/);
        if (!idMatch) continue;

        const listingId = idMatch[1];
        const sourceId = `ksl_${listingId}`;

        if (seen[sourceId]) continue;

        // Extract from card text
        const textContent = card.innerText || '';
        const lines = textContent.split('\n').map(l => l.trim()).filter(Boolean);

        let price = null;
        let title = null;

        for (const line of lines) {
          // Price
          if (!price) {
            const priceMatch = line.match(/\$[\d,]+(?:\.\d{2})?/);
            if (priceMatch) {
              price = parseFloat(priceMatch[0].replace(/[$,]/g, ''));
              continue;
            }
          }
          // Title
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

        seen[sourceId] = Date.now();
      } catch (err) {
        console.error('[STC] Error parsing KSL listing:', err);
      }
    }

    // Clean old entries
    const week = 7 * 24 * 60 * 60 * 1000;
    for (const [key, timestamp] of Object.entries(seen)) {
      if (Date.now() - timestamp > week) delete seen[key];
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));

    return listings;
  }

  function run() {
    const listings = extractListings();
    if (listings.length > 0) {
      console.log(`[STC] Found ${listings.length} new KSL listings`);
      chrome.runtime.sendMessage(
        { type: 'LISTINGS_FOUND', listings },
        (response) => {
          if (response) {
            console.log(`[STC] Ingested: ${response.inserted}, skipped: ${response.skipped}`);
          }
        }
      );
    } else {
      console.log('[STC] No new KSL listings');
    }
  }

  setTimeout(run, 2000);

  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(run, 2000);
  });
})();
