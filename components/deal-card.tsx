"use client";

import { ScoreBadge } from './score-badge';
import type { Listing, ListingScore } from '@/lib/types';

interface DealCardProps {
  listing: Pick<Listing, 'id' | 'title' | 'asking_price' | 'estimated_profit' | 'score' | 'source' | 'listing_url' | 'created_at'>;
  onDismiss: (id: number) => void;
  onPurchase: (id: number) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DealCard({ listing, onDismiss, onPurchase }: DealCardProps) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-3">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-sm leading-tight truncate">
            {listing.title}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {listing.source === 'facebook' ? 'FB' : 'KSL'} &middot;{' '}
            {timeAgo(listing.created_at)}
          </p>
        </div>
        {listing.score && <ScoreBadge score={listing.score as ListingScore} />}
      </div>

      <div className="flex gap-4 text-sm">
        <div>
          <p className="text-zinc-500 text-xs">Asking</p>
          <p className="font-semibold">
            {listing.asking_price ? `$${listing.asking_price}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-zinc-500 text-xs">Est. Profit</p>
          <p
            className={`font-semibold ${
              (listing.estimated_profit ?? 0) >= 200
                ? 'text-emerald-400'
                : (listing.estimated_profit ?? 0) >= 50
                  ? 'text-yellow-400'
                  : 'text-zinc-400'
            }`}
          >
            {listing.estimated_profit != null
              ? `$${listing.estimated_profit}`
              : '—'}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onDismiss(listing.id)}
          className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
        >
          Dismiss
        </button>
        {listing.listing_url && (
          <a
            href={listing.listing_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 text-blue-400 hover:bg-zinc-700 transition-colors text-center"
          >
            View
          </a>
        )}
        <button
          onClick={() => onPurchase(listing.id)}
          className="flex-1 text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
        >
          Purchase
        </button>
      </div>
    </div>
  );
}
