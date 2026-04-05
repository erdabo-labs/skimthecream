"use client";

import { useState } from 'react';
import { DealCard } from '@/components/deal-card';
import { createBrowserClient } from '@/lib/supabase/client';
import type { Listing, ListingScore } from '@/lib/types';

type DealListing = Pick<Listing, 'id' | 'title' | 'asking_price' | 'estimated_profit' | 'score' | 'source' | 'listing_url' | 'status' | 'created_at'>;

export function DealsClient({ listings: initial }: { listings: DealListing[] }) {
  const [listings, setListings] = useState(initial);
  const [filter, setFilter] = useState<'all' | ListingScore>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'facebook' | 'ksl'>('all');

  const supabase = createBrowserClient();

  const filtered = listings.filter((l) => {
    if (filter !== 'all' && l.score !== filter) return false;
    if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
    return true;
  });

  async function handleDismiss(id: number) {
    await supabase.from('stc_listings').update({ status: 'dismissed' }).eq('id', id);
    setListings((prev) => prev.filter((l) => l.id !== id));
  }

  async function handlePurchase(id: number) {
    const listing = listings.find((l) => l.id === id);
    if (!listing) return;

    await supabase.from('stc_listings').update({ status: 'purchased' }).eq('id', id);
    await supabase.from('stc_inventory').insert({
      listing_id: id,
      product_name: listing.title,
      purchase_price: listing.asking_price,
      purchase_date: new Date().toISOString().split('T')[0],
      purchase_source: listing.source,
      status: 'in_stock',
    });

    setListings((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Deals</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(['all', 'great', 'good', 'pass'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              filter === s
                ? 'bg-zinc-100 text-zinc-900'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <div className="w-px bg-zinc-700 mx-1" />
        {(['all', 'facebook', 'ksl'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSourceFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
              sourceFilter === s
                ? 'bg-zinc-100 text-zinc-900'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {s === 'all' ? 'All Sources' : s === 'facebook' ? 'Facebook' : 'KSL'}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((listing) => (
            <DealCard
              key={listing.id}
              listing={listing}
              onDismiss={handleDismiss}
              onPurchase={handlePurchase}
            />
          ))}
        </div>
      ) : (
        <p className="text-zinc-500 text-sm text-center py-8">
          No deals matching your filters.
        </p>
      )}
    </div>
  );
}
