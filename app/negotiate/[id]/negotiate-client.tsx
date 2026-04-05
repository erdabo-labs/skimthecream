"use client";

import { ChatInterface } from '@/components/chat-interface';
import { createBrowserClient } from '@/lib/supabase/client';
import type { Listing, NegotiationMessage } from '@/lib/types';
import Link from 'next/link';

interface Props {
  listing: Pick<Listing, 'id' | 'title' | 'asking_price' | 'estimated_profit' | 'score' | 'source' | 'listing_url'>;
  negotiationId: number | undefined;
  initialMessages: NegotiationMessage[];
}

export function NegotiateClient({ listing, negotiationId, initialMessages }: Props) {
  const supabase = createBrowserClient();

  async function handleMessagesChange(messages: { role: string; content: string }[]) {
    if (!negotiationId) return;

    const timestamped = messages.map((m) => ({
      ...m,
      timestamp: new Date().toISOString(),
    }));

    await supabase
      .from('stc_negotiations')
      .update({ messages: timestamped, updated_at: new Date().toISOString() })
      .eq('id', negotiationId);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-950">
        <div className="flex justify-between items-start">
          <div className="min-w-0">
            <Link href="/deals" className="text-xs text-zinc-500 hover:text-zinc-300">
              &larr; Back to Deals
            </Link>
            <h1 className="text-lg font-bold truncate mt-1">{listing.title}</h1>
            <p className="text-xs text-zinc-500">
              Asking ${listing.asking_price} &middot; Est. profit $
              {listing.estimated_profit}
            </p>
          </div>
          {listing.listing_url && (
            <a
              href={listing.listing_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-blue-400 hover:bg-zinc-700 transition-colors shrink-0"
            >
              View Listing
            </a>
          )}
        </div>
      </div>

      {/* Chat */}
      <ChatInterface
        listingId={listing.id}
        initialMessages={initialMessages}
        onMessagesChange={handleMessagesChange}
      />
    </div>
  );
}
