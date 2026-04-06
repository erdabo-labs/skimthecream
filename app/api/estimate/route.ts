import { NextRequest, NextResponse } from 'next/server';
import { parseWithAI } from '@/lib/openai';

export async function POST(req: NextRequest) {
  const { productName, purchasePrice, details } = await req.json();

  if (!productName) {
    return NextResponse.json({ error: 'Product name required' }, { status: 400 });
  }

  const detailsContext = details ? `\nAdditional details: ${details}` : '';
  const priceContext = purchasePrice ? `\nPaid: $${purchasePrice}` : '';

  const prompt = `You are a resale expert. Estimate the fair local used resale value for this item on Facebook Marketplace / KSL Classifieds / local pickup.

Item: "${productName}"${priceContext}${detailsContext}

Consider:
- Current used market prices for this specific item (local pickup, not shipped/eBay prices)
- Condition: assume good/used unless details say otherwise
- Local market in Utah (Wasatch Front area)
- Quick sale price (sell within 1-2 weeks) vs patient price (might take a month)

Return ONLY valid JSON with no markdown:
{"quickSale": <number>, "fairValue": <number>, "patientPrice": <number>, "notes": "<brief 1-2 sentence market context>"}

quickSale = price to sell within days (aggressive)
fairValue = reasonable asking price for 1-2 week sale
patientPrice = top dollar if you wait for the right buyer`;

  try {
    const result = await parseWithAI(prompt);
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
