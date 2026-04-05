"use client";

import { useState } from 'react';
import { ListingPreview } from '@/components/listing-preview';
import Link from 'next/link';

interface Props {
  item: { id: number; product_name: string; purchase_price: number | null };
}

export function SellClient({ item }: Props) {
  const [fbListing, setFbListing] = useState<string | null>(null);
  const [kslListing, setKslListing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);

    const [fbRes, kslRes] = await Promise.all([
      fetch('/api/listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryId: item.id, platform: 'facebook' }),
      }),
      fetch('/api/listing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventoryId: item.id, platform: 'ksl' }),
      }),
    ]);

    const fbData = await fbRes.json();
    const kslData = await kslRes.json();

    setFbListing(fbData.content);
    setKslListing(kslData.content);
    setLoading(false);
  }

  return (
    <div className="p-4 space-y-4">
      <Link href="/inventory" className="text-xs text-zinc-500 hover:text-zinc-300">
        &larr; Back to Inventory
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{item.product_name}</h1>
        <p className="text-sm text-zinc-500">
          Purchased for {item.purchase_price ? `$${item.purchase_price}` : 'Unknown'}
        </p>
      </div>

      <button
        onClick={generate}
        disabled={loading}
        className="w-full py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50"
      >
        {loading ? 'Generating...' : 'Generate Listings'}
      </button>

      {(fbListing || kslListing) && (
        <div className="space-y-4">
          {fbListing && <ListingPreview platform="facebook" content={fbListing} />}
          {kslListing && <ListingPreview platform="ksl" content={kslListing} />}
        </div>
      )}
    </div>
  );
}
