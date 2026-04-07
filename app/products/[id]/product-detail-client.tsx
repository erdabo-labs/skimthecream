"use client";

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase/client';
import { cleanDescription } from '@/lib/utils';
import type { Product } from '@/lib/types';

interface ListingRow {
  id: number;
  title: string;
  asking_price: number | null;
  source: string;
  listing_url: string | null;
  parsed_storage: string | null;
  parsed_condition: string | null;
  raw_email_snippet: string | null;
  score: string | null;
  estimated_profit: number | null;
  status: string;
  feedback: string | null;
  created_at: string;
  first_seen_at: string | null;
  gone_at: string | null;
  days_active: number | null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return '<1h ago';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ProductDetailClient({
  product: initialProduct,
  listings: initialListings,
}: {
  product: Product;
  listings: ListingRow[];
}) {
  const [product, setProduct] = useState(initialProduct);
  const [listings, setListings] = useState(initialListings);
  const [expandedListing, setExpandedListing] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editForm, setEditForm] = useState({
    target_buy_price: product.target_buy_price?.toString() ?? '',
    notes: product.notes ?? '',
  });

  const supabase = createBrowserClient();

  // Stats computed from listings
  const priced = listings.filter(l => l.asking_price && l.asking_price > 0);
  const prices = priced.map(l => l.asking_price as number).sort((a, b) => a - b);
  const goneListings = listings.filter(l => l.gone_at);
  const activeListings = listings.filter(l => l.status === 'new' || l.status === 'contacted');

  const stats = {
    total: listings.length,
    active: activeListings.length,
    gone: goneListings.length,
    lowPrice: prices.length > 0 ? prices[0] : null,
    highPrice: prices.length > 0 ? prices[prices.length - 1] : null,
    medianPrice: prices.length > 0 ? (
      prices.length % 2 === 0
        ? Math.round((prices[Math.floor(prices.length / 2) - 1] + prices[Math.floor(prices.length / 2)]) / 2)
        : prices[Math.floor(prices.length / 2)]
    ) : null,
  };

  async function rescoreListing(listingId: number) {
    await supabase.from('stc_listings').update({
      product_id: null,
      score: null,
      estimated_profit: null,
      parsed_product: null,
      parsed_condition: null,
      parsed_storage: null,
      price_source: null,
      status: 'new',
      updated_at: new Date().toISOString(),
    }).eq('id', listingId);
    setListings(prev => prev.filter(l => l.id !== listingId));
  }

  async function dismissListing(listingId: number) {
    await supabase.from('stc_listings').update({
      status: 'dismissed',
      feedback: 'wrong_product',
      feedback_note: 'removed from product',
      updated_at: new Date().toISOString(),
    }).eq('id', listingId);
    setListings(prev => prev.filter(l => l.id !== listingId));
  }

  async function saveEdit() {
    const updates: Record<string, any> = {
      notes: editForm.notes || null,
      updated_at: new Date().toISOString(),
    };
    if (editForm.target_buy_price) {
      updates.target_buy_price = parseFloat(editForm.target_buy_price);
    }
    await supabase.from('stc_products').update(updates).eq('id', product.id);
    setProduct(prev => ({ ...prev, ...updates }));
    setEditing(false);
  }

  async function refreshPricing() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: product.id }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProduct(prev => ({ ...prev, ...updated }));
      }
    } catch {
      // silently fail
    }
    setRefreshing(false);
  }

  async function updateStatus(newStatus: 'active' | 'inactive') {
    await supabase.from('stc_products').update({
      status: newStatus,
      updated_at: new Date().toISOString(),
    }).eq('id', product.id);
    setProduct(prev => ({ ...prev, status: newStatus }));
  }

  return (
    <div className="p-4 space-y-6">
      {/* Back link */}
      <Link href="/products" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
        ← Products
      </Link>

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-bold">{product.canonical_name}</h1>
          <span className={`text-[10px] px-2 py-0.5 rounded ${
            product.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
            product.status === 'pending' ? 'bg-amber-500/20 text-amber-400' :
            'bg-zinc-700/50 text-zinc-400'
          }`}>
            {product.status}
          </span>
        </div>
        {product.brand && (
          <p className="text-xs text-zinc-500 mt-1">
            {product.brand}{product.model_line ? ` · ${product.model_line}` : ''}
            {product.generation ? ` · ${product.generation}` : ''}
          </p>
        )}
      </div>

      {/* Key metrics */}
      <button
        onClick={refreshPricing}
        disabled={refreshing}
        className="w-full text-xs py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-emerald-400 transition-colors disabled:opacity-50"
      >
        {refreshing ? 'Refreshing pricing...' : 'Refresh Pricing (AI)'}
      </button>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 text-center">
          <p className="text-[10px] text-zinc-500 uppercase">Target Buy</p>
          <p className="text-lg font-bold text-emerald-400">
            {product.target_buy_price ? `$${product.target_buy_price}` : '—'}
          </p>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 text-center">
          <p className="text-[10px] text-zinc-500 uppercase">AI Value</p>
          <p className="text-lg font-bold">
            {product.ai_market_value ? `$${product.ai_market_value}` : '—'}
          </p>
        </div>
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 text-center">
          <p className="text-[10px] text-zinc-500 uppercase">Confidence</p>
          <p className={`text-lg font-bold ${
            product.confidence === 'high' || product.confidence === 'very_high' ? 'text-emerald-400' :
            product.confidence === 'medium' ? 'text-amber-400' : 'text-zinc-500'
          }`}>
            {product.confidence === 'very_high' ? 'V.High' : product.confidence.charAt(0).toUpperCase() + product.confidence.slice(1)}
          </p>
        </div>
      </div>

      {/* Price stats from actual listings */}
      <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Market Data (from {stats.total} listings)</h3>
        <div className="grid grid-cols-4 gap-3 text-center">
          <div>
            <p className="text-[10px] text-zinc-500">Low</p>
            <p className="text-sm font-semibold">{stats.lowPrice ? `$${stats.lowPrice}` : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-500">Median</p>
            <p className="text-sm font-semibold">{stats.medianPrice ? `$${stats.medianPrice}` : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-500">High</p>
            <p className="text-sm font-semibold">{stats.highPrice ? `$${stats.highPrice}` : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] text-zinc-500">Active/Gone</p>
            <p className="text-sm font-semibold">{stats.active}/{stats.gone}</p>
          </div>
        </div>
        {product.avg_days_to_sell && (
          <div className="flex gap-4 mt-3 pt-3 border-t border-zinc-800">
            <div>
              <p className="text-[10px] text-zinc-500">Avg Days to Sell</p>
              <p className="text-sm font-semibold">{product.avg_days_to_sell}</p>
            </div>
            {product.sell_velocity && (
              <div>
                <p className="text-[10px] text-zinc-500">Velocity</p>
                <p className={`text-sm font-semibold ${
                  product.sell_velocity === 'fast' ? 'text-emerald-400' :
                  product.sell_velocity === 'slow' ? 'text-red-400' : 'text-amber-400'
                }`}>{product.sell_velocity}</p>
              </div>
            )}
            {product.times_sold > 0 && (
              <>
                <div>
                  <p className="text-[10px] text-zinc-500">Sold</p>
                  <p className="text-sm font-semibold">{product.times_sold}x</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500">Avg Profit</p>
                  <p className="text-sm font-semibold text-emerald-400">${product.avg_profit}</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Notes & edit */}
      <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
        {editing ? (
          <div className="space-y-2">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-0.5">Target Buy Price</label>
              <input
                type="number"
                inputMode="decimal"
                value={editForm.target_buy_price}
                onChange={(e) => setEditForm({ ...editForm, target_buy_price: e.target.value })}
                className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                placeholder="e.g. 350"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-0.5">Notes</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none resize-none"
                rows={3}
                placeholder="e.g. Battery health matters. 80%+ adds $50."
              />
            </div>
            <div className="flex gap-1.5">
              <button onClick={saveEdit} className="flex-1 text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium">Save</button>
              <button onClick={() => setEditing(false)} className="text-xs px-3 py-2 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <div>
            {product.notes && <p className="text-xs text-zinc-400 italic mb-2">{product.notes}</p>}
            <div className="flex gap-1.5">
              <button onClick={() => setEditing(true)} className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors">
                Edit Product
              </button>
              {product.status === 'active' ? (
                <button onClick={() => updateStatus('inactive')} className="text-xs px-3 py-2 rounded-lg bg-zinc-800 text-red-400/60 hover:bg-zinc-700 transition-colors">
                  Deactivate
                </button>
              ) : product.status === 'inactive' ? (
                <button onClick={() => updateStatus('active')} className="text-xs px-3 py-2 rounded-lg bg-zinc-800 text-emerald-400 hover:bg-zinc-700 transition-colors">
                  Activate
                </button>
              ) : null}
            </div>
          </div>
        )}
        {product.last_refreshed && (
          <p className="text-[10px] text-zinc-600 mt-2">Intelligence last refreshed {timeAgo(product.last_refreshed)}</p>
        )}
      </div>

      {/* Listings */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-2">
          Listings ({listings.length})
        </h2>
        <div className="space-y-2">
          {listings.map((l) => {
            const isExpanded = expandedListing === l.id;
            const desc = l.raw_email_snippet ? cleanDescription(l.raw_email_snippet) : null;

            return (
              <div key={l.id} className={`bg-zinc-900 rounded-xl p-3 border ${
                l.gone_at ? 'border-zinc-800/50 opacity-60' : 'border-zinc-800'
              }`}>
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => setExpandedListing(isExpanded ? null : l.id)} className="min-w-0 text-left flex-1">
                    <p className="text-xs text-zinc-300">{l.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-zinc-600">
                        {l.source === 'facebook' ? 'FB' : 'KSL'}
                      </span>
                      {l.asking_price && (
                        <span className="text-[10px] font-semibold text-zinc-300">${l.asking_price}</span>
                      )}
                      {l.parsed_condition && (
                        <span className="text-[10px] text-zinc-600">{l.parsed_condition}</span>
                      )}
                      {l.parsed_storage && (
                        <span className="text-[10px] text-zinc-600">{l.parsed_storage}</span>
                      )}
                      {l.score && (
                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                          l.score === 'great' ? 'bg-emerald-500/20 text-emerald-400' :
                          l.score === 'good' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-zinc-700/50 text-zinc-500'
                        }`}>{l.score}</span>
                      )}
                      {l.gone_at && (
                        <span className="text-[10px] text-zinc-600">gone{l.days_active ? ` · ${l.days_active}d` : ''}</span>
                      )}
                      <span className="text-[10px] text-zinc-700">{timeAgo(l.created_at)}</span>
                    </div>
                  </button>
                  <div className="flex gap-2 shrink-0 items-start">
                    {l.listing_url && (
                      <a href={l.listing_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400">View</a>
                    )}
                    <button onClick={() => rescoreListing(l.id)} className="text-[10px] text-amber-400/70 hover:text-amber-400">Rescore</button>
                    <button onClick={() => dismissListing(l.id)} className="text-[10px] text-zinc-600 hover:text-red-400">Dismiss</button>
                  </div>
                </div>

                {isExpanded && desc && (
                  <p className="text-[10px] text-zinc-500 mt-2 leading-relaxed whitespace-pre-line border-t border-zinc-800 pt-2">{desc}</p>
                )}

                {isExpanded && l.estimated_profit && (
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Estimated profit: <span className={`font-semibold ${l.estimated_profit >= 100 ? 'text-emerald-400' : 'text-zinc-400'}`}>${l.estimated_profit}</span>
                    {l.feedback && <span className="ml-2 text-zinc-700">Feedback: {l.feedback}</span>}
                  </p>
                )}
              </div>
            );
          })}

          {listings.length === 0 && (
            <p className="text-zinc-600 text-xs text-center py-6">No listings linked to this product</p>
          )}
        </div>
      </section>
    </div>
  );
}
