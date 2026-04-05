import { NextRequest } from 'next/server';
import { chatWithAI } from '@/lib/openai';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const { listingId, messages } = await req.json();

  const supabase = createServerClient();

  // Fetch listing + market data
  const { data: listing } = await supabase
    .from('stc_listings')
    .select('*, stc_market_prices(*)')
    .eq('id', listingId)
    .single();

  if (!listing) {
    return new Response('Listing not found', { status: 404 });
  }

  const marketPrice = listing.stc_market_prices;
  const avgPrice = marketPrice?.avg_sold_price ?? 'unknown';
  const lowPrice = marketPrice?.low_sold_price ?? 'unknown';
  const highPrice = marketPrice?.high_sold_price ?? 'unknown';

  const systemPrompt = `You are a negotiation coach helping buy "${listing.title}" at the best price.

Key facts:
- Asking price: $${listing.asking_price}
- Market average (sold): $${avgPrice}
- Market range: $${lowPrice} - $${highPrice}
- Source: ${listing.source}

Strategy guidelines:
- Suggest opening offer at 60-70% of asking price
- Be polite but firm — reference market data
- If they counter, suggest meeting at market value minus 10%
- Walk-away price: anything above market average is overpaying
- Suggest cash pickup for leverage
- Keep messages brief and ready to copy/paste to the seller

Respond as a helpful coach. Suggest actual message text the buyer can send.`;

  const stream = await chatWithAI(systemPrompt, messages);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}
