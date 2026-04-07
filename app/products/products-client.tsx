"use client";

import { useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@/lib/supabase/client';
import type { Product, BrandRule } from '@/lib/types';
import { cleanDescription } from '@/lib/utils';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function confidenceBadge(confidence: string) {
  const styles: Record<string, string> = {
    low: 'bg-zinc-700/50 text-zinc-400',
    medium: 'bg-yellow-500/20 text-yellow-400',
    high: 'bg-emerald-500/20 text-emerald-400',
    very_high: 'bg-emerald-500/30 text-emerald-300',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles[confidence] ?? styles.low}`}>
      {confidence === 'very_high' ? 'very high' : confidence}
    </span>
  );
}

function velocityBadge(velocity: string | null) {
  if (!velocity) return null;
  const styles: Record<string, string> = {
    fast: 'bg-emerald-500/20 text-emerald-400',
    moderate: 'bg-yellow-500/20 text-yellow-400',
    slow: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles[velocity] ?? ''}`}>
      {velocity}
    </span>
  );
}

function easeBadge(ease: string | null) {
  if (!ease) return null;
  const styles: Record<string, string> = {
    easy: 'bg-emerald-500/20 text-emerald-400',
    moderate: 'bg-yellow-500/20 text-yellow-400',
    hard: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${styles[ease] ?? ''}`}>
      {ease}
    </span>
  );
}

export function ProductsClient({
  pending: initialPending,
  active: initialActive,
  inactive: initialInactive,
  brandRules: initialRules,
}: {
  pending: Product[];
  active: Product[];
  inactive: Product[];
  brandRules: BrandRule[];
}) {
  const [pending, setPending] = useState(initialPending);
  const [active, setActive] = useState(initialActive);
  const [inactive, setInactive] = useState(initialInactive);
  const [brandRules, setBrandRules] = useState(initialRules);
  const [search, setSearch] = useState('');
  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ notes: '', target_buy_price: '' });
  const [showInactive, setShowInactive] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [ruleForm, setRuleForm] = useState({ brand: '', max_age_years: '', auto_approve: false, notes: '' });
  const [showAddRule, setShowAddRule] = useState(false);
  const [expandedPending, setExpandedPending] = useState<number | null>(null);
  const [pendingListings, setPendingListings] = useState<Record<number, any[]>>({});
  const [loadingListings, setLoadingListings] = useState<number | null>(null);

  const supabase = createBrowserClient();

  async function togglePendingListings(productId: number) {
    if (expandedPending === productId) {
      setExpandedPending(null);
      return;
    }
    setExpandedPending(productId);
    if (pendingListings[productId]) return; // Already loaded

    setLoadingListings(productId);
    const { data } = await supabase
      .from('stc_listings')
      .select('id, title, asking_price, source, listing_url, parsed_storage, parsed_condition, raw_email_snippet, created_at')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(10);
    setPendingListings(prev => ({ ...prev, [productId]: data ?? [] }));
    setLoadingListings(null);
  }

  async function rescoreListing(listingId: number, productId: number) {
    // Unlink from product, clear score — scorer will re-analyze it fresh
    await supabase.from('stc_listings').update({
      product_id: null,
      score: null,
      estimated_profit: null,
      parsed_product: null,
      parsed_condition: null,
      parsed_storage: null,
      price_source: null,
      updated_at: new Date().toISOString(),
    }).eq('id', listingId);
    // Remove from local state
    setPendingListings(prev => ({
      ...prev,
      [productId]: (prev[productId] ?? []).filter(l => l.id !== listingId),
    }));
  }

  async function dismissListing(listingId: number, productId: number) {
    await supabase.from('stc_listings').update({
      status: 'dismissed',
      feedback: 'wrong_product',
      feedback_note: 'removed from product',
      updated_at: new Date().toISOString(),
    }).eq('id', listingId);
    setPendingListings(prev => ({
      ...prev,
      [productId]: (prev[productId] ?? []).filter(l => l.id !== listingId),
    }));
  }

  function filterProducts(products: Product[]): Product[] {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(p =>
      p.canonical_name.toLowerCase().includes(q) ||
      (p.brand?.toLowerCase().includes(q) ?? false) ||
      (p.model_line?.toLowerCase().includes(q) ?? false)
    );
  }

  async function approveProduct(product: Product) {
    await supabase
      .from('stc_products')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', product.id);
    setPending(prev => prev.filter(p => p.id !== product.id));
    setActive(prev => [...prev, { ...product, status: 'active' as const }].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)));
  }

  async function rejectProduct(product: Product) {
    await supabase
      .from('stc_products')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', product.id);
    setPending(prev => prev.filter(p => p.id !== product.id));
    setInactive(prev => [...prev, { ...product, status: 'inactive' as const }].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)));
  }

  async function approveAll() {
    const ids = filterProducts(pending).map(p => p.id);
    if (ids.length === 0) return;
    await supabase
      .from('stc_products')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .in('id', ids);
    const approved = pending.filter(p => ids.includes(p.id));
    setPending(prev => prev.filter(p => !ids.includes(p.id)));
    setActive(prev => [...prev, ...approved.map(p => ({ ...p, status: 'active' as const }))].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)));
  }

  async function rejectAll() {
    const ids = filterProducts(pending).map(p => p.id);
    if (ids.length === 0) return;
    await supabase
      .from('stc_products')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .in('id', ids);
    const rejected = pending.filter(p => ids.includes(p.id));
    setPending(prev => prev.filter(p => !ids.includes(p.id)));
    setInactive(prev => [...prev, ...rejected.map(p => ({ ...p, status: 'inactive' as const }))].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)));
  }

  async function deactivateProduct(product: Product) {
    await supabase
      .from('stc_products')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', product.id);
    setActive(prev => prev.filter(p => p.id !== product.id));
    setInactive(prev => [...prev, { ...product, status: 'inactive' as const }].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)));
  }

  async function reactivateProduct(product: Product) {
    await supabase
      .from('stc_products')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', product.id);
    setInactive(prev => prev.filter(p => p.id !== product.id));
    setActive(prev => [...prev, { ...product, status: 'active' as const }].sort((a, b) => a.canonical_name.localeCompare(b.canonical_name)));
  }

  function startEdit(product: Product) {
    setEditForm({
      notes: product.notes ?? '',
      target_buy_price: product.target_buy_price?.toString() ?? '',
    });
    setEditingProduct(product.id);
  }

  async function saveEdit(productId: number) {
    const updates: Record<string, any> = {
      notes: editForm.notes || null,
      updated_at: new Date().toISOString(),
    };
    if (editForm.target_buy_price) {
      updates.target_buy_price = parseFloat(editForm.target_buy_price);
    }
    await supabase.from('stc_products').update(updates).eq('id', productId);
    setActive(prev => prev.map(p =>
      p.id === productId
        ? { ...p, notes: updates.notes, target_buy_price: updates.target_buy_price ?? p.target_buy_price }
        : p
    ));
    setEditingProduct(null);
  }

  const filteredPending = filterProducts(pending);
  const filteredActive = filterProducts(active);
  const filteredInactive = filterProducts(inactive);

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">Products</h1>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search products..."
        className="w-full bg-zinc-900 rounded-lg px-3 py-2 text-sm border border-zinc-800 focus:border-emerald-500 focus:outline-none"
      />

      {/* Pending Review */}
      {filteredPending.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-amber-400 uppercase tracking-wider">
              Pending Review ({filteredPending.length})
            </h2>
            <div className="flex gap-1.5">
              <button
                onClick={approveAll}
                className="text-[10px] px-2.5 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 transition-colors"
              >
                Approve All
              </button>
              <button
                onClick={rejectAll}
                className="text-[10px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
              >
                Reject All
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {filteredPending.map((product) => {
              const isOpen = expandedPending === product.id;
              const listings = pendingListings[product.id] ?? [];
              const isLoading = loadingListings === product.id;

              return (
                <div
                  key={product.id}
                  className="bg-zinc-900 rounded-xl p-4 border border-amber-500/20"
                >
                  <div className="flex justify-between items-start gap-2">
                    <button
                      onClick={() => togglePendingListings(product.id)}
                      className="min-w-0 text-left"
                    >
                      <h3 className="font-medium text-sm">{product.canonical_name}</h3>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {product.brand && <span>{product.brand} &middot; </span>}
                        First seen {timeAgo(product.first_seen_at)} ago &middot; {product.listing_count} listing{product.listing_count !== 1 ? 's' : ''}
                        <span className="text-zinc-600 ml-1">{isOpen ? '▾' : '▸'}</span>
                      </p>
                    </button>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => approveProduct(product)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
                      >
                        Track
                      </button>
                      <button
                        onClick={() => rejectProduct(product)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
                      >
                        Skip
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-3 border-t border-zinc-800 pt-2 space-y-1.5">
                      {isLoading ? (
                        <p className="text-xs text-zinc-600 py-2">Loading listings...</p>
                      ) : listings.length === 0 ? (
                        <p className="text-xs text-zinc-600 py-2">No listings found</p>
                      ) : (
                        listings.map((l: any) => (
                          <div key={l.id} className="py-1.5 border-b border-zinc-800/50 last:border-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs text-zinc-300 truncate">{l.title}</p>
                                <p className="text-[10px] text-zinc-600">
                                  {l.source === 'facebook' ? 'FB' : 'KSL'}
                                  {l.asking_price ? ` · $${l.asking_price}` : ''}
                                  {l.parsed_storage ? ` · ${l.parsed_storage}` : ''}
                                  {l.parsed_condition ? ` · ${l.parsed_condition}` : ''}
                                  {` · ${timeAgo(l.created_at)} ago`}
                                </p>
                              </div>
                              <div className="flex gap-1.5 shrink-0">
                                {l.listing_url && (
                                  <a
                                    href={l.listing_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-blue-400"
                                  >
                                    View
                                  </a>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); rescoreListing(l.id, product.id); }}
                                  className="text-[10px] text-amber-400/70 hover:text-amber-400"
                                  title="Unlink and re-score"
                                >
                                  Rescore
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); dismissListing(l.id, product.id); }}
                                  className="text-[10px] text-zinc-600 hover:text-red-400"
                                  title="Dismiss listing"
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                            {l.raw_email_snippet && (() => {
                              const desc = cleanDescription(l.raw_email_snippet);
                              return desc ? (
                                <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed whitespace-pre-line">{desc}</p>
                              ) : null;
                            })()}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Active Products */}
      <section>
        <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-2">
          Active ({filteredActive.length})
        </h2>
        {filteredActive.length === 0 ? (
          <p className="text-zinc-500 text-xs text-center py-6">
            No active products yet. Approve pending products to start tracking.
          </p>
        ) : (
          <div className="space-y-2">
            {filteredActive.map((product) => {
              const isExpanded = expandedProduct === product.id;
              const isEditing = editingProduct === product.id;

              return (
                <div
                  key={product.id}
                  className="bg-zinc-900 rounded-xl p-4 border border-zinc-800"
                >
                  <button
                    onClick={() => setExpandedProduct(isExpanded ? null : product.id)}
                    className="w-full text-left"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <Link href={`/products/${product.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-sm hover:text-emerald-400 transition-colors">{product.canonical_name}</Link>
                        <div className="flex gap-1.5 items-center mt-1 flex-wrap">
                          {confidenceBadge(product.confidence)}
                          {velocityBadge(product.sell_velocity)}
                          {easeBadge(product.ease_rating)}
                          <span className="text-[10px] text-zinc-600">
                            {product.listing_count} listing{product.listing_count !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {product.target_buy_price ? (
                          <div>
                            <p className="text-[10px] text-zinc-500">Buy below</p>
                            <p className="font-bold text-emerald-400">${product.target_buy_price}</p>
                          </div>
                        ) : (
                          <p className="text-[10px] text-zinc-600">No target yet</p>
                        )}
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="mt-3 border-t border-zinc-800 pt-3 space-y-3">
                      {/* Pricing details */}
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div>
                          <p className="text-[10px] text-zinc-500">Low</p>
                          <p className="text-xs font-semibold">{product.low_price ? `$${product.low_price}` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-500">Median</p>
                          <p className="text-xs font-semibold">{product.median_asking_price ? `$${product.median_asking_price}` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-500">High</p>
                          <p className="text-xs font-semibold">{product.high_price ? `$${product.high_price}` : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-500">AI Value</p>
                          <p className="text-xs font-semibold">{product.ai_market_value ? `$${product.ai_market_value}` : '—'}</p>
                        </div>
                      </div>

                      {/* Sell stats */}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-[10px] text-zinc-500">Avg Days</p>
                          <p className="text-xs font-semibold">{product.avg_days_to_sell ?? '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-500">Sold</p>
                          <p className="text-xs font-semibold">{product.times_sold}x</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-500">Avg Profit</p>
                          <p className={`text-xs font-semibold ${(product.avg_profit ?? 0) > 0 ? 'text-emerald-400' : ''}`}>
                            {product.avg_profit ? `$${product.avg_profit}` : '—'}
                          </p>
                        </div>
                      </div>

                      {/* Last refreshed */}
                      {product.last_refreshed && (
                        <p className="text-[10px] text-zinc-600">
                          Intelligence updated {timeAgo(product.last_refreshed)} ago
                        </p>
                      )}

                      {/* Notes */}
                      {product.notes && !isEditing && (
                        <p className="text-xs text-zinc-400 italic">{product.notes}</p>
                      )}

                      {/* Edit form */}
                      {isEditing ? (
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
                              rows={2}
                              placeholder="e.g. Battery health matters. 80%+ adds $50."
                            />
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => saveEdit(product.id)}
                              className="flex-1 text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingProduct(null)}
                              className="text-xs px-3 py-2 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => startEdit(product)}
                            className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deactivateProduct(product)}
                            className="text-xs px-3 py-2 rounded-lg bg-zinc-800 text-red-400/60 hover:bg-zinc-700 transition-colors"
                          >
                            Deactivate
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Inactive Products */}
      {filteredInactive.length > 0 && (
        <section>
          <button
            onClick={() => setShowInactive(!showInactive)}
            className="flex items-center gap-2 text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-2"
          >
            <span className="text-xs">{showInactive ? '▾' : '▸'}</span>
            Inactive ({filteredInactive.length})
          </button>
          {showInactive && (
            <div className="space-y-1">
              {filteredInactive.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between bg-zinc-900/50 rounded-lg px-3 py-2 border border-zinc-800/50"
                >
                  <span className="text-xs text-zinc-500">{product.canonical_name}</span>
                  <button
                    onClick={() => reactivateProduct(product)}
                    className="text-[10px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
                  >
                    Reactivate
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Brand Rules */}
      <section>
        <button
          onClick={() => setShowRules(!showRules)}
          className="flex items-center gap-2 text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-2"
        >
          <span className="text-xs">{showRules ? '▾' : '▸'}</span>
          Brand Rules ({brandRules.length})
        </button>
        {showRules && (
          <div className="space-y-2">
            {brandRules.map((rule) => {
              const isEditing = editingRule === rule.id;
              return (
                <div key={rule.id} className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={ruleForm.brand}
                        onChange={(e) => setRuleForm({ ...ruleForm, brand: e.target.value })}
                        className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                        placeholder="Brand name"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-zinc-500 block mb-0.5">Max age (years)</label>
                          <input
                            type="number"
                            inputMode="numeric"
                            value={ruleForm.max_age_years}
                            onChange={(e) => setRuleForm({ ...ruleForm, max_age_years: e.target.value })}
                            className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                            placeholder="e.g. 5 (blank = no limit)"
                          />
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                            <input
                              type="checkbox"
                              checked={ruleForm.auto_approve}
                              onChange={(e) => setRuleForm({ ...ruleForm, auto_approve: e.target.checked })}
                              className="rounded"
                            />
                            Auto-approve
                          </label>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={ruleForm.notes}
                        onChange={(e) => setRuleForm({ ...ruleForm, notes: e.target.value })}
                        className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                        placeholder="Notes (optional)"
                      />
                      <div className="flex gap-1.5">
                        <button
                          onClick={async () => {
                            await supabase.from('stc_brand_rules').update({
                              brand: ruleForm.brand,
                              max_age_years: ruleForm.max_age_years ? parseInt(ruleForm.max_age_years) : null,
                              auto_approve: ruleForm.auto_approve,
                              notes: ruleForm.notes || null,
                              updated_at: new Date().toISOString(),
                            }).eq('id', rule.id);
                            setBrandRules(prev => prev.map(r => r.id === rule.id ? {
                              ...r,
                              brand: ruleForm.brand,
                              max_age_years: ruleForm.max_age_years ? parseInt(ruleForm.max_age_years) : null,
                              auto_approve: ruleForm.auto_approve,
                              notes: ruleForm.notes || null,
                            } : r));
                            setEditingRule(null);
                          }}
                          className="flex-1 text-xs py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingRule(null)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={async () => {
                            await supabase.from('stc_brand_rules').delete().eq('id', rule.id);
                            setBrandRules(prev => prev.filter(r => r.id !== rule.id));
                            setEditingRule(null);
                          }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-red-400/60 hover:bg-zinc-700 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setRuleForm({
                          brand: rule.brand,
                          max_age_years: rule.max_age_years?.toString() ?? '',
                          auto_approve: rule.auto_approve,
                          notes: rule.notes ?? '',
                        });
                        setEditingRule(rule.id);
                      }}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{rule.brand}</span>
                          {rule.max_age_years && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
                              max {rule.max_age_years}yr
                            </span>
                          )}
                          {rule.auto_approve && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                              auto-approve
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-600">tap to edit</span>
                      </div>
                      {rule.notes && (
                        <p className="text-[10px] text-zinc-500 mt-1">{rule.notes}</p>
                      )}
                    </button>
                  )}
                </div>
              );
            })}

            {/* Add new rule */}
            {showAddRule ? (
              <div className="bg-zinc-900 rounded-xl p-3 border border-emerald-500/20 space-y-2">
                <input
                  type="text"
                  value={ruleForm.brand}
                  onChange={(e) => setRuleForm({ ...ruleForm, brand: e.target.value })}
                  className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                  placeholder="Brand name (e.g. Celestron)"
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">Max age (years)</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={ruleForm.max_age_years}
                      onChange={(e) => setRuleForm({ ...ruleForm, max_age_years: e.target.value })}
                      className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                      placeholder="blank = no limit"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <input
                        type="checkbox"
                        checked={ruleForm.auto_approve}
                        onChange={(e) => setRuleForm({ ...ruleForm, auto_approve: e.target.checked })}
                        className="rounded"
                      />
                      Auto-approve
                    </label>
                  </div>
                </div>
                <input
                  type="text"
                  value={ruleForm.notes}
                  onChange={(e) => setRuleForm({ ...ruleForm, notes: e.target.value })}
                  className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                  placeholder="Notes (optional)"
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={async () => {
                      if (!ruleForm.brand.trim()) return;
                      const { data, error } = await supabase.from('stc_brand_rules').insert({
                        brand: ruleForm.brand.trim(),
                        max_age_years: ruleForm.max_age_years ? parseInt(ruleForm.max_age_years) : null,
                        auto_approve: ruleForm.auto_approve,
                        notes: ruleForm.notes || null,
                      }).select().single();
                      if (!error && data) {
                        setBrandRules(prev => [...prev, data].sort((a, b) => a.brand.localeCompare(b.brand)));
                      }
                      setRuleForm({ brand: '', max_age_years: '', auto_approve: false, notes: '' });
                      setShowAddRule(false);
                    }}
                    className="flex-1 text-xs py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                  >
                    Add Rule
                  </button>
                  <button
                    onClick={() => { setShowAddRule(false); setRuleForm({ brand: '', max_age_years: '', auto_approve: false, notes: '' }); }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setRuleForm({ brand: '', max_age_years: '', auto_approve: false, notes: '' }); setShowAddRule(true); }}
                className="w-full text-xs py-2 rounded-lg border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
              >
                + Add Brand Rule
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
