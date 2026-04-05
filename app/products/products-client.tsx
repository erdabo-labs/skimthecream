"use client";

import { useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import type { ProductIntel } from '@/lib/types';

interface ProductSummary {
  name: string;
  category: string | null;
  listings: number;
  prices: number[];
  storages: string[];
  lastSeen: string;
  lowPrice: number;
  highPrice: number;
  avgPrice: number;
}

export function ProductsClient({
  products: initial,
  intel: initialIntel,
}: {
  products: ProductSummary[];
  intel: ProductIntel[];
}) {
  const [products] = useState(initial);
  const [intel, setIntel] = useState(initialIntel);
  const [search, setSearch] = useState('');
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    notes: '',
    difficulty: '' as string,
    price_floor: '',
    price_ceiling: '',
    tags: '',
  });

  const supabase = createBrowserClient();

  const filtered = search
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          (p.category ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : products;

  // Sort by listing count descending
  const sorted = [...filtered].sort((a, b) => b.listings - a.listings);

  function getIntel(productName: string): ProductIntel | undefined {
    return intel.find((i) => i.product_name === productName);
  }

  function startEdit(productName: string) {
    const existing = getIntel(productName);
    setEditForm({
      notes: existing?.notes ?? '',
      difficulty: existing?.difficulty ?? '',
      price_floor: existing?.price_floor?.toString() ?? '',
      price_ceiling: existing?.price_ceiling?.toString() ?? '',
      tags: existing?.tags?.join(', ') ?? '',
    });
    setEditingProduct(productName);
  }

  async function saveIntel(productName: string, category: string | null) {
    const data: Record<string, unknown> = {
      product_name: productName,
      category,
      notes: editForm.notes || null,
      difficulty: editForm.difficulty || null,
      price_floor: editForm.price_floor ? parseFloat(editForm.price_floor) : null,
      price_ceiling: editForm.price_ceiling ? parseFloat(editForm.price_ceiling) : null,
      tags: editForm.tags
        ? editForm.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      updated_at: new Date().toISOString(),
    };

    const { data: result, error } = await supabase
      .from('stc_product_intel')
      .upsert(data, { onConflict: 'product_name' })
      .select()
      .single();

    if (!error && result) {
      setIntel((prev) => {
        const existing = prev.findIndex((i) => i.product_name === productName);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = result;
          return updated;
        }
        return [...prev, result];
      });
    }

    setEditingProduct(null);
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return '<1h';
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Products</h1>
      <p className="text-xs text-zinc-500">
        Identified products from listings. Tap to add pricing context and rules.
      </p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search products..."
        className="w-full bg-zinc-900 rounded-lg px-3 py-2 text-sm border border-zinc-800 focus:border-emerald-500 focus:outline-none"
      />

      <div className="space-y-2">
        {sorted.map((product) => {
          const pi = getIntel(product.name);
          const isEditing = editingProduct === product.name;

          return (
            <div
              key={product.name}
              className="bg-zinc-900 rounded-xl p-4 border border-zinc-800"
            >
              <div className="flex justify-between items-start">
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm">{product.name}</h3>
                  <div className="flex gap-2 items-center mt-0.5 flex-wrap">
                    {product.category && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400">
                        {product.category}
                      </span>
                    )}
                    {pi?.difficulty && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          pi.difficulty === 'easy'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : pi.difficulty === 'hard'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {pi.difficulty}
                      </span>
                    )}
                    {pi?.tags?.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => (isEditing ? setEditingProduct(null) : startEdit(product.name))}
                  className="text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-white transition-colors shrink-0 ml-2"
                >
                  {isEditing ? 'Close' : 'Edit'}
                </button>
              </div>

              {/* Price stats */}
              <div className="flex gap-4 mt-2 text-sm">
                <div>
                  <p className="text-zinc-500 text-xs">Seen</p>
                  <p className="font-semibold">
                    {product.listings}x
                    <span className="text-zinc-500 font-normal text-xs ml-1">
                      {timeAgo(product.lastSeen)} ago
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs">Range</p>
                  <p className="font-semibold">
                    ${product.lowPrice}–${product.highPrice}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs">Avg</p>
                  <p className="font-semibold">${product.avgPrice}</p>
                </div>
                {product.storages.length > 0 && (
                  <div>
                    <p className="text-zinc-500 text-xs">Storage</p>
                    <p className="font-semibold text-xs">
                      {product.storages.join(', ')}
                    </p>
                  </div>
                )}
              </div>

              {/* User ceiling/floor */}
              {pi && (pi.price_ceiling || pi.price_floor) && !isEditing && (
                <div className="flex gap-4 mt-1 text-sm">
                  {pi.price_ceiling && (
                    <div>
                      <p className="text-zinc-500 text-xs">Worth (yours)</p>
                      <p className="font-semibold text-emerald-400">${pi.price_ceiling}</p>
                    </div>
                  )}
                  {pi.price_floor && (
                    <div>
                      <p className="text-zinc-500 text-xs">Max Buy</p>
                      <p className="font-semibold text-yellow-400">${pi.price_floor}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {pi?.notes && !isEditing && (
                <p className="text-xs text-zinc-400 mt-2 italic">{pi.notes}</p>
              )}

              {/* Edit form */}
              {isEditing && (
                <div className="mt-3 space-y-2 border-t border-zinc-800 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-0.5">
                        Worth (market value)
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={editForm.price_ceiling}
                        onChange={(e) =>
                          setEditForm({ ...editForm, price_ceiling: e.target.value })
                        }
                        className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                        placeholder="e.g. 400"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-zinc-500 block mb-0.5">
                        Max buy price
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={editForm.price_floor}
                        onChange={(e) =>
                          setEditForm({ ...editForm, price_floor: e.target.value })
                        }
                        className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                        placeholder="e.g. 250"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">
                      Difficulty
                    </label>
                    <div className="flex gap-1">
                      {(['easy', 'moderate', 'hard'] as const).map((d) => (
                        <button
                          key={d}
                          onClick={() =>
                            setEditForm({
                              ...editForm,
                              difficulty: editForm.difficulty === d ? '' : d,
                            })
                          }
                          className={`text-[10px] px-2.5 py-1.5 rounded transition-colors ${
                            editForm.difficulty === d
                              ? d === 'easy'
                                ? 'bg-emerald-500/30 text-emerald-400'
                                : d === 'hard'
                                  ? 'bg-red-500/30 text-red-400'
                                  : 'bg-yellow-500/30 text-yellow-400'
                              : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">
                      Notes (scoring context, battery info, etc.)
                    </label>
                    <textarea
                      value={editForm.notes}
                      onChange={(e) =>
                        setEditForm({ ...editForm, notes: e.target.value })
                      }
                      className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none resize-none"
                      rows={2}
                      placeholder="e.g. Battery health matters. 80%+ adds $50. Hard to sell under 256GB."
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-zinc-500 block mb-0.5">
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={editForm.tags}
                      onChange={(e) =>
                        setEditForm({ ...editForm, tags: e.target.value })
                      }
                      className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                      placeholder="e.g. trending down, seasonal, fast flip"
                    />
                  </div>

                  <button
                    onClick={() => saveIntel(product.name, product.category)}
                    className="w-full text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">
          No products identified yet. Listings will appear here once processed.
        </p>
      )}
    </div>
  );
}
