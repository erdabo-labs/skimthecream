"use client";

import { useState } from 'react';
import { DealCard } from '@/components/deal-card';
import { StatCard } from '@/components/stat-card';
import { createBrowserClient } from '@/lib/supabase/client';
import type { Listing, ListingScore } from '@/lib/types';

type DealListing = Pick<Listing, 'id' | 'title' | 'asking_price' | 'estimated_profit' | 'score' | 'source' | 'listing_url' | 'status' | 'created_at' | 'parsed_product' | 'parsed_category' | 'price_source' | 'feedback'>;

interface Props {
  active: DealListing[];
  hot: DealListing[];
  recent: DealListing[];
  stats: {
    dealsToday: number;
    activeConvos: number;
    inStock: number;
    monthProfit: number;
  };
}

export function HomeClient({ active: initialActive, hot: initialHot, recent: initialRecent, stats }: Props) {
  const [active, setActive] = useState(initialActive);
  const [hot, setHot] = useState(initialHot);
  const [recent, setRecent] = useState(initialRecent);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<'all' | ListingScore>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'facebook' | 'ksl'>('all');
  const [search, setSearch] = useState('');

  const supabase = createBrowserClient();

  // Search filter — applies across all sections
  function matchesSearch(listing: DealListing): boolean {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      listing.title.toLowerCase().includes(q) ||
      (listing.parsed_product?.toLowerCase().includes(q) ?? false)
    );
  }

  // Combine all listings for mutation handlers
  function removeFromAll(id: number) {
    setActive((prev) => prev.filter((l) => l.id !== id));
    setHot((prev) => prev.filter((l) => l.id !== id));
    setRecent((prev) => prev.filter((l) => l.id !== id));
  }

  function updateInAll(id: number, updates: Partial<DealListing>) {
    const updater = (prev: DealListing[]) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l));
    setActive(updater);
    setHot(updater);
    setRecent(updater);
  }

  async function handleDismiss(id: number) {
    await supabase.from('stc_listings').update({ status: 'dismissed' }).eq('id', id);
    removeFromAll(id);
  }

  async function handleStatusChange(id: number, status: string) {
    await supabase.from('stc_listings').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    updateInAll(id, { status: status as any });
    // Move to active if contacting
    if (status === 'contacted') {
      const listing = [...hot, ...recent].find((l) => l.id === id);
      if (listing) {
        setActive((prev) => [{ ...listing, status: 'contacted' as any }, ...prev]);
      }
    }
  }

  async function handlePurchase(id: number) {
    const listing = [...active, ...hot, ...recent].find((l) => l.id === id);
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
    removeFromAll(id);
  }

  async function handleSetValue(id: number, productName: string, category: string | null, value: number) {
    await supabase.from('stc_market_prices').upsert({
      category: category ?? 'uncategorized',
      product_name: productName,
      condition: 'mixed',
      avg_sold_price: value,
      source: 'manual',
      manual_override: true,
      sample_size: 1,
      scraped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'category,product_name' });

    const askingPrice = [...active, ...hot, ...recent].find(l => l.id === id)?.asking_price ?? 0;
    const discount = ((value - askingPrice) / value) * 100;
    const estimatedProfit = Math.round((value * 0.95 - askingPrice) * 100) / 100;
    let score: 'great' | 'good' | 'pass' = 'pass';
    if (discount >= 30 && estimatedProfit >= 200) score = 'great';
    else if (discount >= 15 && estimatedProfit >= 50) score = 'good';

    await supabase.from('stc_listings').update({ score, estimated_profit: estimatedProfit, updated_at: new Date().toISOString() }).eq('id', id);
    updateInAll(id, { score, estimated_profit: estimatedProfit });
  }

  async function handleFeedback(id: number, feedback: string, note?: string) {
    await supabase.from('stc_listings').update({ feedback, feedback_note: note ?? null, updated_at: new Date().toISOString() }).eq('id', id);
    updateInAll(id, { feedback });
    if (['scam', 'wrong_product', 'accessory'].includes(feedback)) {
      await supabase.from('stc_listings').update({ status: 'dismissed' }).eq('id', id);
      removeFromAll(id);
    }
  }

  // Filter recent listings
  const filteredRecent = recent.filter((l) => {
    if (!matchesSearch(l)) return false;
    if (scoreFilter !== 'all' && l.score !== scoreFilter) return false;
    if (sourceFilter !== 'all' && l.source !== sourceFilter) return false;
    return true;
  });

  const visibleRecent = showAllRecent ? filteredRecent : filteredRecent.slice(0, 10);

  const cardProps = { onDismiss: handleDismiss, onPurchase: handlePurchase, onStatusChange: handleStatusChange, onSetValue: handleSetValue, onFeedback: handleFeedback };

  const filteredActive = active.filter(matchesSearch);
  const filteredHot = hot.filter(matchesSearch);

  return (
    <div className="p-4 space-y-6">
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search listings..."
        className="w-full bg-zinc-900 rounded-lg px-3 py-2 text-sm border border-zinc-800 focus:border-emerald-500 focus:outline-none placeholder-zinc-600"
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard label="Today" value={stats.dealsToday} />
        <StatCard label="Active" value={stats.activeConvos} accent={stats.activeConvos > 0} />
        <StatCard label="Stock" value={stats.inStock} />
        <StatCard label="Month" value={`$${stats.monthProfit.toFixed(0)}`} accent={stats.monthProfit > 0} />
      </div>

      {/* Active conversations */}
      {filteredActive.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-2">
            Active Conversations ({filteredActive.length})
          </h2>
          <div className="space-y-2">
            {filteredActive.map((listing) => (
              <DealCard key={listing.id} listing={listing} {...cardProps} />
            ))}
          </div>
        </section>
      )}

      {/* Hot deals */}
      {filteredHot.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-2">
            Hot Deals ({filteredHot.length})
          </h2>
          <div className="space-y-2">
            {filteredHot.map((listing) => (
              <DealCard key={listing.id} listing={listing} {...cardProps} />
            ))}
          </div>
        </section>
      )}

      {/* All recent */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          All Listings
        </h2>

        {/* Filters */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2">
          {(['all', 'great', 'good', 'pass'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setScoreFilter(s)}
              className={`text-[10px] px-2.5 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                scoreFilter === s ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/80 text-zinc-500'
              }`}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          <div className="w-px bg-zinc-800 mx-0.5" />
          {(['all', 'facebook', 'ksl'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`text-[10px] px-2.5 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                sourceFilter === s ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/80 text-zinc-500'
              }`}
            >
              {s === 'all' ? 'All Sources' : s === 'facebook' ? 'FB' : 'KSL'}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {visibleRecent.map((listing) => (
            <DealCard key={listing.id} listing={listing} compact {...cardProps} />
          ))}
        </div>

        {filteredRecent.length > 10 && !showAllRecent && (
          <button
            onClick={() => setShowAllRecent(true)}
            className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-3 transition-colors"
          >
            Show {filteredRecent.length - 10} more
          </button>
        )}

        {filteredRecent.length === 0 && (
          <p className="text-zinc-600 text-xs text-center py-6">
            No listings matching filters
          </p>
        )}
      </section>
    </div>
  );
}
