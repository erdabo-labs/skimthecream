import { NextRequest, NextResponse } from 'next/server';
import { generateWithAI } from '@/lib/openai';

export async function POST(req: NextRequest) {
  const { productName, purchasePrice, details } = await req.json();

  if (!productName) {
    return NextResponse.json({ error: 'Product name required' }, { status: 400 });
  }

  const detailsContext = details ? `\nDetails provided by the owner: ${details}` : '';
  const priceContext = purchasePrice ? `\nOwner paid: $${purchasePrice}` : '';

  const systemPrompt = `You are an expert resale analyst who helps flippers price items for local marketplace sales (Facebook Marketplace, KSL Classifieds, Craigslist). You have deep knowledge of used market values across all categories — electronics, vehicles, trailers, camera gear, tools, outdoor equipment, etc.

Your estimates should reflect ACTUAL local used market prices in Utah (Wasatch Front area). Be realistic and specific to the exact item described.

IMPORTANT: Do NOT default to low estimates. Research-quality pricing means:
- For vehicles/trailers: check typical private party sale prices, factor in make/model/year/condition
- For camera gear: Canon L-series lenses hold value well, check current used prices on similar local listings
- For electronics: factor in generation, storage, condition
- The purchase price the owner paid is context, NOT an anchor — the resale value could be higher or lower`;

  const userPrompt = `Estimate the resale value for local pickup sale:

Item: "${productName}"${priceContext}${detailsContext}

Give me three price points:
- quickSale: aggressive price to sell within 2-3 days
- fairValue: reasonable asking price, should sell within 1-2 weeks
- patientPrice: top dollar if you wait for the perfect buyer (could take a month)

Also provide a brief note about market context for this specific item.

Return ONLY valid JSON, no markdown:
{"quickSale": <number>, "fairValue": <number>, "patientPrice": <number>, "notes": "<1-2 sentence market context>"}`;

  try {
    const result = await generateWithAI(systemPrompt, userPrompt);
    const cleaned = result.trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(cleaned);

    return NextResponse.json({
      quickSale: parsed.quickSale,
      fairValue: parsed.fairValue,
      patientPrice: parsed.patientPrice,
      notes: parsed.notes,
    });
  } catch {
    return NextResponse.json({ error: 'AI estimation failed' }, { status: 500 });
  }
}
