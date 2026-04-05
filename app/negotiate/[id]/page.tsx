import { createServerClient } from '@/lib/supabase/server';
import { NegotiateClient } from './negotiate-client';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function NegotiatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerClient();

  const { data: listing } = await supabase
    .from('stc_listings')
    .select('id, title, asking_price, estimated_profit, score, source, listing_url')
    .eq('id', id)
    .single();

  if (!listing) notFound();

  // Get or create negotiation
  let { data: negotiation } = await supabase
    .from('stc_negotiations')
    .select('*')
    .eq('listing_id', listing.id)
    .eq('status', 'active')
    .single();

  if (!negotiation) {
    const { data: created } = await supabase
      .from('stc_negotiations')
      .insert({ listing_id: listing.id, messages: [], status: 'active' })
      .select()
      .single();
    negotiation = created;
  }

  return (
    <NegotiateClient
      listing={listing}
      negotiationId={negotiation?.id}
      initialMessages={negotiation?.messages ?? []}
    />
  );
}
