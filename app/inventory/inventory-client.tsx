"use client";

import { useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import type { InventoryItem, InventoryStatus } from '@/lib/types';

function daysHeld(purchaseDate: string | null): number | null {
  if (!purchaseDate) return null;
  return Math.floor((Date.now() - new Date(purchaseDate).getTime()) / (1000 * 60 * 60 * 24));
}

function daysColor(days: number | null): string {
  if (days === null) return 'text-zinc-400';
  if (days < 7) return 'text-emerald-400';
  if (days < 14) return 'text-yellow-400';
  return 'text-red-400';
}

export function InventoryClient({ items: initial }: { items: InventoryItem[] }) {
  const [items, setItems] = useState(initial);
  const [tab, setTab] = useState<InventoryStatus | 'all'>('all');
  const [sellModal, setSellModal] = useState<number | null>(null);
  const [soldPrice, setSoldPrice] = useState('');
  const [soldPlatform, setSoldPlatform] = useState('');
  const [fees, setFees] = useState('');

  const supabase = createBrowserClient();

  const filtered = tab === 'all' ? items : items.filter((i) => i.status === tab);

  async function handleMarkSold(id: number) {
    const item = items.find((i) => i.id === id);
    if (!item) return;

    const soldPriceNum = parseFloat(soldPrice);
    const feesNum = parseFloat(fees) || 0;
    const profit = soldPriceNum - (item.purchase_price ?? 0) - feesNum;

    await supabase
      .from('stc_inventory')
      .update({
        sold_price: soldPriceNum,
        sold_date: new Date().toISOString().split('T')[0],
        sold_platform: soldPlatform,
        fees: feesNum,
        profit,
        status: 'sold',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, sold_price: soldPriceNum, profit, status: 'sold' as const }
          : i
      )
    );

    setSellModal(null);
    setSoldPrice('');
    setSoldPlatform('');
    setFees('');
  }

  async function handleMarkListed(id: number) {
    await supabase
      .from('stc_inventory')
      .update({ status: 'listed', updated_at: new Date().toISOString() })
      .eq('id', id);

    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: 'listed' as const } : i))
    );
  }

  const tabs: { value: InventoryStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'in_stock', label: 'In Stock' },
    { value: 'listed', label: 'Listed' },
    { value: 'sold', label: 'Sold' },
  ];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Inventory</h1>

      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
        {tabs.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`flex-1 text-xs py-2 rounded-md transition-colors ${
              tab === t.value ? 'bg-zinc-700 text-white' : 'text-zinc-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((item) => {
            const days = daysHeld(item.purchase_date);
            return (
              <div
                key={item.id}
                className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-2"
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0">
                    <h3 className="font-medium text-sm truncate">{item.product_name}</h3>
                    <p className="text-xs text-zinc-500">
                      {item.purchase_source ?? 'Unknown source'} &middot;{' '}
                      {item.purchase_date ?? 'No date'}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      item.status === 'sold'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : item.status === 'listed'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-zinc-700/50 text-zinc-400'
                    }`}
                  >
                    {item.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>

                <div className="flex gap-4 text-sm">
                  <div>
                    <p className="text-zinc-500 text-xs">Paid</p>
                    <p className="font-semibold">
                      {item.purchase_price ? `$${item.purchase_price}` : '—'}
                    </p>
                  </div>
                  {item.status === 'sold' && (
                    <>
                      <div>
                        <p className="text-zinc-500 text-xs">Sold</p>
                        <p className="font-semibold">${item.sold_price}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500 text-xs">Profit</p>
                        <p
                          className={`font-semibold ${
                            (item.profit ?? 0) > 0
                              ? 'text-emerald-400'
                              : 'text-red-400'
                          }`}
                        >
                          ${item.profit}
                        </p>
                      </div>
                    </>
                  )}
                  {item.status !== 'sold' && days !== null && (
                    <div>
                      <p className="text-zinc-500 text-xs">Held</p>
                      <p className={`font-semibold ${daysColor(days)}`}>
                        {days}d
                      </p>
                    </div>
                  )}
                </div>

                {item.status === 'in_stock' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleMarkListed(item.id)}
                      className="flex-1 text-xs py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
                    >
                      Mark Listed
                    </button>
                    <a
                      href={`/sell/${item.id}`}
                      className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-center"
                    >
                      Generate Listing
                    </a>
                  </div>
                )}

                {(item.status === 'in_stock' || item.status === 'listed') && (
                  <button
                    onClick={() => setSellModal(item.id)}
                    className="w-full text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
                  >
                    Mark as Sold
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-zinc-500 text-sm text-center py-8">
          No inventory items in this category.
        </p>
      )}

      {/* Sell modal */}
      {sellModal !== null && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
          <div className="bg-zinc-900 rounded-t-2xl w-full max-w-lg p-6 space-y-4 pb-[env(safe-area-inset-bottom)]">
            <h2 className="text-lg font-bold">Mark as Sold</h2>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Sold Price</label>
              <input
                type="number"
                inputMode="decimal"
                value={soldPrice}
                onChange={(e) => setSoldPrice(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Platform</label>
              <input
                type="text"
                value={soldPlatform}
                onChange={(e) => setSoldPlatform(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder="Facebook, KSL, eBay..."
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Fees</label>
              <input
                type="number"
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder="0.00"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setSellModal(null)}
                className="flex-1 text-sm py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleMarkSold(sellModal)}
                disabled={!soldPrice}
                className="flex-1 text-sm py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
