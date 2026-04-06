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

  // Get product intel if available
  const { data: intel } = await supabase
    .from('stc_product_intel')
    .select('notes, difficulty, price_floor, price_ceiling')
    .eq('product_name', listing.parsed_product ?? '')
    .limit(1);

  const productNotes = intel?.[0]?.notes ?? '';
  const maxBuy = intel?.[0]?.price_floor ?? '';
  const worthPrice = intel?.[0]?.price_ceiling ?? avgPrice;

  const systemPrompt = `You are a negotiation coach helping buy "${listing.title}" on ${listing.source === 'facebook' ? 'Facebook Marketplace' : 'KSL Classifieds'}.

Key facts:
- Asking price: $${listing.asking_price}
- What it's actually worth locally: $${worthPrice}
- Market range observed: $${lowPrice} - $${highPrice}
${maxBuy ? `- Maximum I should pay: $${maxBuy}` : ''}
${productNotes ? `- Product notes: ${productNotes}` : ''}

How to help me:
- When I ask for an opening message, write something I can COPY AND PASTE directly to the seller
- When I paste what the seller said (like "seller said: ..."), give me a reply to send back
- Keep suggested messages SHORT and casual — this is Facebook/KSL, not a business email
- Be friendly but firm. Don't be weird or overly formal.
- Use cash and quick pickup as leverage
- If the price is already good, tell me to just go get it
- Walk-away if above market value
- Opening offer: 60-70% of asking, or just below my max buy price
- Factor in condition, battery health, storage, or other details I mention

IMPORTANT: When suggesting messages to send, format them in a quotation block so they're easy to copy. Keep them 1-3 sentences max.`;


  const stream = await chatWithAI(systemPrompt, messages);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}
