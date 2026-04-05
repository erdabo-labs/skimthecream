import * as cheerio from 'cheerio';

export interface ScrapedPrice {
  product_name: string;
  condition: string;
  avg_sold_price: number | null;
  low_sold_price: number | null;
  high_sold_price: number | null;
  sample_size: number;
}

// Swappa pricing pages for Apple products
const SWAPPA_PRODUCTS: Record<string, string> = {
  'iPad Pro 11 M2': 'https://swappa.com/guide/apple-ipad-pro-11-4th-gen/prices',
  'iPad Pro 12.9 M2': 'https://swappa.com/guide/apple-ipad-pro-12-9-6th-gen/prices',
  'MacBook Pro 14 M3': 'https://swappa.com/guide/apple-macbook-pro-14-m3/prices',
  'MacBook Air 13 M3': 'https://swappa.com/guide/apple-macbook-air-13-m3/prices',
};

export async function scrapeSwappa(): Promise<ScrapedPrice[]> {
  const results: ScrapedPrice[] = [];

  for (const [productName, url] of Object.entries(SWAPPA_PRODUCTS)) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      });

      if (!res.ok) {
        console.error(`Swappa ${productName}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      // Swappa shows price ranges by condition
      const conditions = ['mint', 'good', 'fair'];

      for (const condition of conditions) {
        const priceText = $(`.price-${condition}, [data-condition="${condition}"]`)
          .first()
          .text();

        const prices = priceText.match(/\$[\d,]+/g);
        if (prices && prices.length > 0) {
          const parsedPrices = prices.map((p) =>
            parseFloat(p.replace(/[$,]/g, ''))
          );

          results.push({
            product_name: productName,
            condition,
            avg_sold_price:
              parsedPrices.reduce((a, b) => a + b, 0) / parsedPrices.length,
            low_sold_price: Math.min(...parsedPrices),
            high_sold_price: Math.max(...parsedPrices),
            sample_size: parsedPrices.length,
          });
        }
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.error(`Swappa scrape error for ${productName}:`, err);
    }
  }

  return results;
}
