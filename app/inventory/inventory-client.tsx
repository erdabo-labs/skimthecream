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
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addDate, setAddDate] = useState(new Date().toISOString().split('T')[0]);
  const [addSource, setAddSource] = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addTargetPrice, setAddTargetPrice] = useState('');
  const [aiEstimate, setAiEstimate] = useState<{ quickSale: number; fairValue: number; patientPrice: number; notes: string } | null>(null);
  const [estimating, setEstimating] = useState(false);

  const supabase = createBrowserClient();

  const filtered = tab === 'all' ? items : items.filter((i) => i.status === tab);

  async function handleEstimateValue() {
    if (!addName) return;
    setEstimating(true);
    try {
      const res = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: addName,
          purchasePrice: addPrice || null,
          details: addNotes || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiEstimate(data);
      }
    } catch {
      // silently fail
    }
    setEstimating(false);
  }

  async function handleAddItem() {
    if (!addName) return;

    const { data, error } = await supabase
      .from('stc_inventory')
      .insert({
        product_name: addName,
        purchase_price: addPrice ? parseFloat(addPrice) : null,
        purchase_date: addDate || null,
        purchase_source: addSource || 'manual',
        notes: addNotes || null,
        target_sell_price: addTargetPrice ? parseFloat(addTargetPrice) : null,
        ai_estimated_value: aiEstimate?.fairValue ?? null,
        status: 'in_stock' as const,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to add:', error.message);
      return;
    }

    setItems((prev) => [data, ...prev]);
    setShowAddForm(false);
    setAddName('');
    setAddPrice('');
    setAddDate(new Date().toISOString().split('T')[0]);
    setAddSource('');
    setAddNotes('');
    setAddTargetPrice('');
    setAiEstimate(null);
  }

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
          ? { ...i, sold_price: soldPriceNum, sold_date: new Date().toISOString().split('T')[0], sold_platform: soldPlatform, fees: feesNum, profit, status: 'sold' as const }
          : i
      )
    );

    setSellModal(null);
    setSoldPrice('');
    setSoldPlatform('');
    setFees('');
  }

  async function handleRemove(id: number) {
    const item = items.find((i) => i.id === id);
    await supabase.from('stc_inventory').delete().eq('id', id);
    if (item?.listing_id) {
      await supabase.from('stc_listings').update({ status: 'new' }).eq('id', item.listing_id);
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
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

  const totalInvested = items.filter(i => i.status !== 'sold').reduce((sum, i) => sum + (i.purchase_price ?? 0), 0);
  const totalProfit = items.filter(i => i.status === 'sold').reduce((sum, i) => sum + (i.profit ?? 0), 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Inventory</h1>
        <button
          onClick={() => setShowAddForm(true)}
          className="text-sm px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
        >
          + Add Item
        </button>
      </div>

      {/* Summary */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-zinc-900/80 rounded-xl p-3 border border-zinc-800/50">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Items</p>
            <p className="text-xl font-bold">{items.filter(i => i.status !== 'sold').length}</p>
          </div>
          <div className="bg-zinc-900/80 rounded-xl p-3 border border-zinc-800/50">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Invested</p>
            <p className="text-xl font-bold">${totalInvested.toFixed(0)}</p>
          </div>
          <div className="bg-zinc-900/80 rounded-xl p-3 border border-zinc-800/50">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Profit</p>
            <p className={`text-xl font-bold ${totalProfit > 0 ? 'text-emerald-400' : totalProfit < 0 ? 'text-red-400' : ''}`}>
              ${totalProfit.toFixed(0)}
            </p>
          </div>
        </div>
      )}

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

                <div className="flex gap-4 text-sm flex-wrap">
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
                          {(item.profit ?? 0) >= 0 ? '+' : ''}${item.profit}
                        </p>
                      </div>
                    </>
                  )}
                  {item.status !== 'sold' && item.target_sell_price && (
                    <div>
                      <p className="text-zinc-500 text-xs">Target</p>
                      <p className="font-semibold text-blue-400">${item.target_sell_price}</p>
                    </div>
                  )}
                  {item.status !== 'sold' && item.ai_estimated_value && !item.target_sell_price && (
                    <div>
                      <p className="text-zinc-500 text-xs">AI Est.</p>
                      <p className="font-semibold text-zinc-300">${item.ai_estimated_value}</p>
                    </div>
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

                {item.notes && (
                  <p className="text-xs text-zinc-500 italic">{item.notes}</p>
                )}

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
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSellModal(item.id)}
                      className="flex-1 text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
                    >
                      Mark as Sold
                    </button>
                    <button
                      onClick={() => handleRemove(item.id)}
                      className="text-xs py-2 px-3 rounded-lg bg-zinc-800 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-zinc-500 text-sm text-center py-8">
          No inventory items{tab !== 'all' ? ' in this category' : ''}.
        </p>
      )}

      {/* Add Item Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto overscroll-none">
          <div className="w-full max-w-lg mx-auto p-4 pb-8 space-y-4">
            <h2 className="text-lg font-bold">Add Inventory Item</h2>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">What is it?</label>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder="Canon EF 70-200mm f/2.8L, Utility Trailer 5x8..."
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Purchase Price</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={addPrice}
                  onChange={(e) => setAddPrice(e.target.value)}
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Purchase Date</label>
                <input
                  type="date"
                  value={addDate}
                  onChange={(e) => setAddDate(e.target.value)}
                  className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Where did you buy it?</label>
              <div className="flex gap-2 flex-wrap">
                {['Facebook', 'KSL', 'eBay', 'Craigslist', 'Retail', 'Other'].map((src) => (
                  <button
                    key={src}
                    onClick={() => setAddSource(src.toLowerCase())}
                    className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                      addSource === src.toLowerCase()
                        ? 'bg-zinc-100 text-zinc-900 font-medium'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {src}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Details / Notes (helps AI estimate)</label>
              <input
                type="text"
                value={addNotes}
                onChange={(e) => setAddNotes(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder="2023 model, good condition, includes accessories..."
              />
            </div>

            {/* AI Estimate */}
            <div className="space-y-2">
              <button
                onClick={handleEstimateValue}
                disabled={!addName || estimating}
                className="w-full text-xs py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {estimating ? 'Estimating...' : 'Get AI Price Estimate'}
              </button>

              {aiEstimate && (
                <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50 space-y-2">
                  <div className="flex gap-3 text-sm">
                    <div className="flex-1 text-center">
                      <p className="text-[10px] text-zinc-500 uppercase">Quick Sale</p>
                      <p className="font-bold text-amber-400">${aiEstimate.quickSale}</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-[10px] text-zinc-500 uppercase">Fair Value</p>
                      <p className="font-bold text-emerald-400">${aiEstimate.fairValue}</p>
                    </div>
                    <div className="flex-1 text-center">
                      <p className="text-[10px] text-zinc-500 uppercase">Patient</p>
                      <p className="font-bold text-blue-400">${aiEstimate.patientPrice}</p>
                    </div>
                  </div>
                  {aiEstimate.notes && (
                    <p className="text-[11px] text-zinc-400 leading-tight">{aiEstimate.notes}</p>
                  )}
                  {addPrice && (
                    <p className="text-[11px] text-zinc-500">
                      Potential profit: <span className={`font-medium ${aiEstimate.fairValue - parseFloat(addPrice) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {aiEstimate.fairValue - parseFloat(addPrice) >= 0 ? '+' : ''}${(aiEstimate.fairValue - parseFloat(addPrice)).toFixed(0)}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Your target sell price (optional)</label>
              <input
                type="number"
                inputMode="decimal"
                value={addTargetPrice}
                onChange={(e) => setAddTargetPrice(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder={aiEstimate ? `AI suggests $${aiEstimate.fairValue}` : 'What do you hope to sell it for?'}
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 text-sm py-2.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddItem}
                disabled={!addName}
                className="flex-1 text-sm py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add to Inventory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {sellModal !== null && (
        <div className="fixed inset-0 z-50 bg-zinc-950 overflow-y-auto overscroll-none">
          <div className="w-full max-w-lg mx-auto p-4 pb-8 space-y-4">
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
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Platform</label>
              <div className="flex gap-2 flex-wrap">
                {['Facebook', 'KSL', 'eBay', 'Craigslist', 'Other'].map((src) => (
                  <button
                    key={src}
                    onClick={() => setSoldPlatform(src.toLowerCase())}
                    className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                      soldPlatform === src.toLowerCase()
                        ? 'bg-zinc-100 text-zinc-900 font-medium'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {src}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1">Fees (shipping, platform fees, etc.)</label>
              <input
                type="number"
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder="0.00"
              />
            </div>

            <div className="flex gap-2 pt-2">
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
