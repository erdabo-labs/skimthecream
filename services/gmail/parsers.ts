import { parseWithAI } from '../../lib/openai';

export interface ParsedListing {
  source: string;
  source_id: string;
  title: string;
  asking_price: number | null;
  listing_url: string | null;
  raw_email_snippet: string;
}

export function parseFacebookAlert(subject: string, body: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  // Facebook Marketplace alerts typically contain multiple listings
  // Pattern: title, price, location, link
  const pricePattern = /\$[\d,]+/g;
  const urlPattern = /https:\/\/www\.facebook\.com\/marketplace\/item\/(\d+)/g;

  const urls = [...body.matchAll(urlPattern)];

  for (const urlMatch of urls) {
    const url = urlMatch[0];
    const sourceId = urlMatch[1];

    // Extract context around the URL
    const idx = body.indexOf(url);
    const snippet = body.slice(Math.max(0, idx - 200), idx + 100);

    // Try to find price near the URL
    const nearbyPrices = snippet.match(pricePattern);
    const price = nearbyPrices
      ? parseFloat(nearbyPrices[0].replace(/[$,]/g, ''))
      : null;

    // Try to extract title from snippet
    const lines = snippet.split('\n').filter((l) => l.trim().length > 0);
    const title = lines[0]?.trim() || subject;

    listings.push({
      source: 'facebook',
      source_id: `fb_${sourceId}`,
      title,
      asking_price: price,
      listing_url: url,
      raw_email_snippet: snippet.slice(0, 500),
    });
  }

  return listings;
}

export function parseKSLAlert(subject: string, body: string): ParsedListing[] {
  const listings: ParsedListing[] = [];

  // KSL Classifieds alert format
  const urlPattern = /https:\/\/(?:www\.)?ksl\.com\/listing\/(\d+)/g;
  const pricePattern = /\$[\d,]+/g;

  const urls = [...body.matchAll(urlPattern)];

  for (const urlMatch of urls) {
    const url = urlMatch[0];
    const sourceId = urlMatch[1];

    const idx = body.indexOf(url);
    const snippet = body.slice(Math.max(0, idx - 200), idx + 100);

    const nearbyPrices = snippet.match(pricePattern);
    const price = nearbyPrices
      ? parseFloat(nearbyPrices[0].replace(/[$,]/g, ''))
      : null;

    const lines = snippet.split('\n').filter((l) => l.trim().length > 0);
    const title = lines[0]?.trim() || subject;

    listings.push({
      source: 'ksl',
      source_id: `ksl_${sourceId}`,
      title,
      asking_price: price,
      listing_url: url,
      raw_email_snippet: snippet.slice(0, 500),
    });
  }

  return listings;
}

export async function parseWithFallback(
  subject: string,
  body: string,
  source: 'facebook' | 'ksl'
): Promise<ParsedListing[]> {
  // Try regex first
  const regexResults =
    source === 'facebook'
      ? parseFacebookAlert(subject, body)
      : parseKSLAlert(subject, body);

  if (regexResults.length > 0) return regexResults;

  // Fallback to AI parsing
  const prompt = `Extract product listings from this ${source} email alert. Return JSON array with objects containing: title, asking_price (number or null), listing_url, source_id.

Subject: ${subject}

Body (first 2000 chars):
${body.slice(0, 2000)}

Return ONLY valid JSON array, no markdown.`;

  try {
    const result = await parseWithAI(prompt);
    const parsed = JSON.parse(result);

    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: Record<string, unknown>, i: number) => ({
      source,
      source_id: `${source}_ai_${Date.now()}_${i}`,
      title: String(item.title ?? subject),
      asking_price: typeof item.asking_price === 'number' ? item.asking_price : null,
      listing_url: typeof item.listing_url === 'string' ? item.listing_url : null,
      raw_email_snippet: body.slice(0, 500),
    }));
  } catch {
    console.error('AI parsing failed, skipping email');
    return [];
  }
}
