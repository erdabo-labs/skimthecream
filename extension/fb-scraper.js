// Content script for Facebook Marketplace pages
// Extracts listing cards and sends them to the background worker

(function () {
  const SEEN_KEY = 'stc_seen_fb';

  function extractListings() {
    const listings = [];
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');

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

        // Clean the URL
        const cleanUrl = `https://www.facebook.com/marketplace/item/${itemId}/`;

        // Grab extra text from the card as description snippet
        const allText = lines.filter(l =>
          l !== title &&
          !l.match(/^\$/) &&
          !l.match(/^(Listed|Just listed|mile|km|·|\d+ mi|See more|Marketplace)/i)
        ).join(' ').slice(0, 300);

        listings.push({
          source: 'facebook',
          source_id: sourceId,
          title,
          price,
          url: cleanUrl,
          snippet: allText || null,
        });

        // Mark as seen
        seen[sourceId] = Date.now();
      } catch (err) {
        console.error('[STC] Error parsing FB listing:', err);
      }
    }

    // Clean old entries (older than 7 days)
    const week = 7 * 24 * 60 * 60 * 1000;
    for (const [key, timestamp] of Object.entries(seen)) {
      if (Date.now() - timestamp > week) delete seen[key];
    }
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));

    return listings;
  }

  // Wait for dynamic content to load, then scrape
  function run() {
    const listings = extractListings();
    if (listings.length > 0) {
      console.log(`[STC] Found ${listings.length} new FB listings`);
      chrome.runtime.sendMessage(
        { type: 'LISTINGS_FOUND', listings },
        (response) => {
          if (response) {
            console.log(`[STC] Ingested: ${response.inserted}, skipped: ${response.skipped}`);
          }
        }
      );
    } else {
      console.log('[STC] No new FB listings');
    }
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
