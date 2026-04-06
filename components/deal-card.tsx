"use client";

import { useState } from 'react';
import { ScoreBadge } from './score-badge';
import type { Listing, ListingScore } from '@/lib/types';

interface DealCardProps {
  listing: Pick<Listing, 'id' | 'title' | 'asking_price' | 'estimated_profit' | 'score' | 'source' | 'listing_url' | 'status' | 'created_at' | 'parsed_product' | 'parsed_category'>;
  onDismiss: (id: number) => void;
  onPurchase: (id: number) => void;
  onStatusChange: (id: number, status: string) => void;
  onSetValue: (id: number, productName: string, category: string | null, value: number) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function DealCard({ listing, onDismiss, onPurchase, onStatusChange, onSetValue }: DealCardProps) {
  const [showValueInput, setShowValueInput] = useState(false);
  const [valueInput, setValueInput] = useState('');

  function handleSetValue() {
    const val = parseFloat(valueInput);
    if (isNaN(val) || val <= 0) return;
    onSetValue(listing.id, listing.parsed_product ?? listing.title, listing.parsed_category ?? null, val);
    setShowValueInput(false);
    setValueInput('');
  }

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

      {showValueInput ? (
        <div className="flex gap-2 items-center">
          <span className="text-xs text-zinc-400">Worth $</span>
          <input
            type="number"
            inputMode="decimal"
            value={valueInput}
            onChange={(e) => setValueInput(e.target.value)}
            className="flex-1 bg-zinc-800 rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:border-emerald-500 focus:outline-none"
            placeholder="Market value"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleSetValue()}
          />
          <button
            onClick={handleSetValue}
            className="text-xs px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => setShowValueInput(false)}
            className="text-xs px-2 py-2 text-zinc-500"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Status badge */}
          {listing.status === 'contacted' && (
            <div className="text-[10px] px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-center">
              Talking to seller
            </div>
          )}

          {/* Main actions row */}
          <div className="flex gap-2">
            <button
              onClick={() => onDismiss(listing.id)}
              className="text-xs py-2 px-2 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={() => setShowValueInput(true)}
              className="text-xs py-2 px-2 rounded-lg bg-zinc-800 text-yellow-400 hover:bg-zinc-700 transition-colors"
            >
              $Value
            </button>
            {listing.listing_url && (
              <a
                href={listing.listing_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs py-2 px-2 rounded-lg bg-zinc-800 text-blue-400 hover:bg-zinc-700 transition-colors text-center"
              >
                View
              </a>
            )}
            {listing.status === 'new' && (
              <button
                onClick={() => onStatusChange(listing.id, 'contacted')}
                className="flex-1 text-xs py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium"
              >
                Contacting
              </button>
            )}
            {listing.status === 'contacted' && (
              <>
                <a
                  href={`/negotiate/${listing.id}`}
                  className="flex-1 text-xs py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition-colors font-medium text-center"
                >
                  Negotiate
                </a>
                <button
                  onClick={() => onPurchase(listing.id)}
                  className="flex-1 text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
                >
                  Bought
                </button>
              </>
            )}
            {listing.status !== 'contacted' && listing.status !== 'new' ? null : null}
          </div>
        </div>
      )}
    </div>
  );
}
