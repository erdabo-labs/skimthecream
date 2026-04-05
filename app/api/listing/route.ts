import { NextRequest, NextResponse } from 'next/server';
import { generateWithAI } from '@/lib/openai';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const { inventoryId, platform } = await req.json();

  const supabase = createServerClient();

  const { data: item } = await supabase
    .from('stc_inventory')
    .select('*, stc_listings(*)')
    .eq('id', inventoryId)
    .single();

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }

  const systemPrompt = `You are an expert at writing compelling marketplace listings that sell quickly.
Write a listing optimized for ${platform === 'facebook' ? 'Facebook Marketplace' : 'KSL Classifieds'}.

Guidelines:
- Lead with the most appealing feature or deal aspect
- Include key specs naturally
- ${platform === 'facebook' ? 'Use casual tone, emoji sparingly, short paragraphs' : 'Professional but friendly, structured with clear sections'}
- Mention condition honestly
- End with a call to action
- ${platform === 'facebook' ? 'Keep under 500 characters for best engagement' : 'Include a brief spec list'}
- Price should feel like a deal — reference what they sell for online`;

  const userPrompt = `Create a ${platform} listing for:
Product: ${item.product_name}
Purchase price: $${item.purchase_price}
Original listing title: ${item.stc_listings?.title ?? item.product_name}
Condition: ${item.stc_listings?.parsed_condition ?? 'Good'}`;

  const content = await generateWithAI(systemPrompt, userPrompt);

  return NextResponse.json({ content, platform });
}
