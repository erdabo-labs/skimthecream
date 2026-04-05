"use client";

import { useState } from 'react';
import { createBrowserClient } from '@/lib/supabase/client';
import type { Category } from '@/lib/types';

export function WatchClient({ categories: initial }: { categories: Category[] }) {
  const [categories, setCategories] = useState(initial);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKeywords, setEditKeywords] = useState('');

  const supabase = createBrowserClient();

  async function handleAdd() {
    const name = newName.trim();
    const keywords = newKeywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    if (!name || keywords.length === 0) return;

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_');

    const { data, error } = await supabase
      .from('stc_categories')
      .insert({
        slug,
        name,
        keywords,
        avg_days_to_sell: 14,
        active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('Insert error:', error.message);
      return;
    }

    setCategories((prev) => [...prev, data]);
    setNewName('');
    setNewKeywords('');
    setShowAdd(false);
  }

  async function handleToggle(id: number, active: boolean) {
    await supabase
      .from('stc_categories')
      .update({ active: !active, updated_at: new Date().toISOString() })
      .eq('id', id);

    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, active: !active } : c))
    );
  }

  async function handleDelete(id: number) {
    await supabase.from('stc_categories').delete().eq('id', id);
    setCategories((prev) => prev.filter((c) => c.id !== id));
  }

  async function handleSaveKeywords(id: number) {
    const keywords = editKeywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);

    await supabase
      .from('stc_categories')
      .update({ keywords, updated_at: new Date().toISOString() })
      .eq('id', id);

    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, keywords } : c))
    );
    setEditingId(null);
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Watch List</h1>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
        >
          {showAdd ? 'Cancel' : '+ Add'}
        </button>
      </div>

      <p className="text-xs text-zinc-500">
        Keywords are matched against incoming listing titles. Add anything you want to monitor.
      </p>

      {showAdd && (
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-3">
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Category Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
              placeholder="e.g. Dump Trailers"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Keywords (comma-separated)
            </label>
            <input
              type="text"
              value={newKeywords}
              onChange={(e) => setNewKeywords(e.target.value)}
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
              placeholder="e.g. dump trailer, utility trailer, cargo trailer"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || !newKeywords.trim()}
            className="w-full text-sm py-2.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Category
          </button>
        </div>
      )}

      <div className="space-y-2">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className={`bg-zinc-900 rounded-xl p-4 border transition-colors ${
              cat.active ? 'border-zinc-800' : 'border-zinc-800/50 opacity-60'
            }`}
          >
            <div className="flex justify-between items-start">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm">{cat.name}</h3>
                  {!cat.active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                      PAUSED
                    </span>
                  )}
                </div>

                {editingId === cat.id ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={editKeywords}
                      onChange={(e) => setEditKeywords(e.target.value)}
                      className="flex-1 bg-zinc-800 rounded-lg px-3 py-1.5 text-xs border border-zinc-700 focus:border-emerald-500 focus:outline-none"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveKeywords(cat.id)}
                    />
                    <button
                      onClick={() => handleSaveKeywords(cat.id)}
                      className="text-xs text-emerald-400 px-2"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs text-zinc-500 px-2"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p
                    className="text-xs text-zinc-500 mt-1 cursor-pointer hover:text-zinc-300"
                    onClick={() => {
                      setEditingId(cat.id);
                      setEditKeywords(cat.keywords.join(', '));
                    }}
                  >
                    {cat.keywords.join(', ')}
                  </p>
                )}
              </div>

              <div className="flex gap-1 ml-3 shrink-0">
                <button
                  onClick={() => handleToggle(cat.id, cat.active)}
                  className={`text-[10px] px-2 py-1 rounded transition-colors ${
                    cat.active
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {cat.active ? 'Active' : 'Paused'}
                </button>
                <button
                  onClick={() => handleDelete(cat.id)}
                  className="text-[10px] px-2 py-1 rounded bg-zinc-800 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {categories.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">
          No categories yet. Add one to start monitoring listings.
        </p>
      )}
    </div>
  );
}
