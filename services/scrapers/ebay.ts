import * as cheerio from 'cheerio';

export interface ScrapedPrice {
  product_name: string;
  condition: string;
  avg_sold_price: number | null;
  low_sold_price: number | null;
  high_sold_price: number | null;
  sample_size: number;
}

// eBay sold listings searches
const EBAY_SEARCHES: Record<string, string> = {
  'Celestron NexStar 8SE': 'Celestron+NexStar+8SE',
  'Celestron NexStar 6SE': 'Celestron+NexStar+6SE',
  'Bambu Lab P1S': 'Bambu+Lab+P1S',
  'Bambu Lab X1C': 'Bambu+Lab+X1C',
  'Bambu Lab A1 Mini': 'Bambu+Lab+A1+Mini',
  'iPad Pro 11 M2': 'iPad+Pro+11+M2',
  'MacBook Pro 14 M3': 'MacBook+Pro+14+M3',
};

export async function scrapeEbay(): Promise<ScrapedPrice[]> {
  const results: ScrapedPrice[] = [];

  for (const [productName, query] of Object.entries(EBAY_SEARCHES)) {
    try {
      // eBay sold listings URL
      const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1&_sop=13`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
      });

      if (!res.ok) {
        console.error(`eBay ${productName}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      const prices: number[] = [];

      $('.s-item__price').each((_, el) => {
        const text = $(el).text();
        const match = text.match(/\$[\d,]+\.?\d*/);
        if (match) {
          const price = parseFloat(match[0].replace(/[$,]/g, ''));
          if (price > 0 && price < 10000) {
            prices.push(price);
          }
        }
      });

      if (prices.length > 0) {
        results.push({
          product_name: productName,
          condition: 'good',
          avg_sold_price:
            Math.round(
              (prices.reduce((a, b) => a + b, 0) / prices.length) * 100
            ) / 100,
          low_sold_price: Math.min(...prices),
          high_sold_price: Math.max(...prices),
          sample_size: prices.length,
        });
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      console.error(`eBay scrape error for ${productName}:`, err);
    }
  }

  return results;
}
