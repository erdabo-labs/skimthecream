"use client";

import { useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import type { MarketPrice } from '@/lib/types';

export function PricesClient({ prices: initial }: { prices: MarketPrice[] }) {
  const [prices, setPrices] = useState(initial);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const supabase = createBrowserClient();

  const filtered = search
    ? prices.filter(
        (p) =>
          p.product_name.toLowerCase().includes(search.toLowerCase()) ||
          p.category.toLowerCase().includes(search.toLowerCase())
      )
    : prices;

  // Group by category
  const grouped = filtered.reduce(
    (acc, price) => {
      if (!acc[price.category]) acc[price.category] = [];
      acc[price.category].push(price);
      return acc;
    },
    {} as Record<string, MarketPrice[]>
  );

  async function handleSaveOverride(id: number) {
    const newPrice = parseFloat(editValue);
    if (isNaN(newPrice)) return;

    await supabase
      .from('stc_market_prices')
      .update({
        avg_sold_price: newPrice,
        manual_override: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    setPrices((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, avg_sold_price: newPrice, manual_override: true }
          : p
      )
    );
    setEditingId(null);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return '<1h ago';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Market Prices</h1>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search products..."
        className="w-full bg-zinc-900 rounded-lg px-3 py-2 text-sm border border-zinc-800 focus:border-emerald-500 focus:outline-none"
      />

      {Object.entries(grouped).length > 0 ? (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category}>
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-2">
              {category}
            </h2>
            <div className="space-y-2">
              {items.map((price) => (
                <div
                  key={price.id}
                  className="bg-zinc-900 rounded-lg p-3 border border-zinc-800"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium">{price.product_name}</p>
                      <p className="text-xs text-zinc-500">
                        {price.source} &middot; {price.sample_size} samples &middot;{' '}
                        {timeAgo(price.scraped_at)}
                        {price.manual_override && (
                          <span className="ml-1 text-yellow-500">(manual)</span>
                        )}
                      </p>
                    </div>
                    <p className="text-sm font-medium text-zinc-500">{price.condition}</p>
                  </div>

                  <div className="flex gap-4 mt-2 text-sm">
                    <div>
                      <p className="text-zinc-500 text-xs">Avg</p>
                      {editingId === price.id ? (
                        <div className="flex gap-1 items-center">
                          <input
                            type="number"
                            inputMode="decimal"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-20 bg-zinc-800 rounded px-2 py-0.5 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveOverride(price.id)}
                            className="text-xs text-emerald-400"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs text-zinc-500"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <p
                          className="font-semibold cursor-pointer hover:text-emerald-400"
                          onClick={() => {
                            setEditingId(price.id);
                            setEditValue(String(price.avg_sold_price ?? ''));
                          }}
                        >
                          {price.avg_sold_price ? `$${price.avg_sold_price}` : '—'}
                        </p>
                      )}
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">Low</p>
                      <p className="font-semibold">
                        {price.low_sold_price ? `$${price.low_sold_price}` : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-zinc-500 text-xs">High</p>
                      <p className="font-semibold">
                        {price.high_sold_price ? `$${price.high_sold_price}` : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      ) : (
        <p className="text-zinc-500 text-sm text-center py-8">
          No market prices yet. Run the price scraper to populate data.
        </p>
      )}
    </div>
  );
}
