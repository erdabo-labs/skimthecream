"use client";

import { useState } from 'react';
import { ScoreBadge } from './score-badge';
import type { Listing, ListingScore } from '@/lib/types';

interface DealCardProps {
  listing: Pick<Listing, 'id' | 'title' | 'asking_price' | 'estimated_profit' | 'score' | 'source' | 'listing_url' | 'status' | 'created_at' | 'parsed_product' | 'parsed_category' | 'price_source' | 'feedback'>;
  onDismiss: (id: number) => void;
  onPurchase: (id: number) => void;
  onStatusChange: (id: number, status: string) => void;
  onSetValue: (id: number, productName: string, category: string | null, value: number) => void;
  onFeedback: (id: number, feedback: string, note?: string) => void;
  compact?: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function cardStyle(score: ListingScore | null): string {
  switch (score) {
    case 'great':
      return 'border-emerald-500/50 bg-emerald-500/5 shadow-lg shadow-emerald-500/10';
    case 'good':
      return 'border-amber-500/30 bg-amber-500/5';
    default:
      return 'border-zinc-800 bg-zinc-900';
  }
}

export function DealCard({ listing, onDismiss, onPurchase, onStatusChange, onSetValue, onFeedback, compact = false }: DealCardProps) {
  const [showValueInput, setShowValueInput] = useState(false);
  const [valueInput, setValueInput] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [expanded, setExpanded] = useState(false);

  function handleSetValue() {
    const val = parseFloat(valueInput);
    if (isNaN(val) || val <= 0) return;
    onSetValue(listing.id, listing.parsed_product ?? listing.title, listing.parsed_category ?? null, val);
    setShowValueInput(false);
    setValueInput('');
  }

  const isPass = listing.score === 'pass' || !listing.score;
  const shouldCollapse = compact && isPass && !expanded;

  // Collapsed pass card — just show title + price on one line
  if (shouldCollapse) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left bg-zinc-900/50 rounded-lg px-3 py-2 border border-zinc-800/50 flex items-center justify-between gap-2 hover:bg-zinc-900 transition-colors"
      >
        <span className="text-xs text-zinc-400 truncate">{listing.title}</span>
        <span className="text-xs text-zinc-500 shrink-0">
          {listing.asking_price ? `$${listing.asking_price}` : ''}
        </span>
      </button>
    );
  }

  return (
    <div className={`rounded-xl p-4 border space-y-3 transition-all ${cardStyle(listing.score as ListingScore)}`}>
      {/* Header */}
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <h3 className={`font-medium leading-tight truncate ${listing.score === 'great' ? 'text-base' : 'text-sm'}`}>
            {listing.title}
          </h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            {listing.source === 'facebook' ? 'FB' : 'KSL'} &middot; {timeAgo(listing.created_at)}
            {listing.parsed_product && (
              <span className="text-zinc-600"> &middot; {listing.parsed_product}</span>
            )}
          </p>
        </div>
        {listing.score && (
          <ScoreBadge score={listing.score as ListingScore} size={listing.score === 'great' ? 'lg' : 'sm'} />
        )}
      </div>

      {/* Status badge */}
      {listing.status === 'contacted' && (
        <div className="text-[10px] px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-center font-medium">
          Talking to seller
        </div>
      )}

      {/* Prices */}
      <div className="flex gap-4 text-sm">
        <div>
          <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Asking</p>
          <p className="font-bold text-base">
            {listing.asking_price ? `$${listing.asking_price}` : '—'}
          </p>
        </div>
        {(listing.estimated_profit ?? 0) !== 0 && (
          <div>
            <p className="text-zinc-500 text-[10px] uppercase tracking-wide">Profit</p>
            <p
              className={`font-bold text-base ${
                (listing.estimated_profit ?? 0) >= 200
                  ? 'text-emerald-400'
                  : (listing.estimated_profit ?? 0) >= 50
                    ? 'text-amber-400'
                    : 'text-zinc-400'
              }`}
            >
              ${listing.estimated_profit}
            </p>
          </div>
        )}
      </div>

      {/* Price source */}
      {listing.price_source && (
        <p className="text-[10px] text-zinc-600 leading-tight">{listing.price_source}</p>
      )}

      {/* Feedback badge */}
      {listing.feedback && (
        <span className={`text-[10px] px-2 py-0.5 rounded inline-block ${
          listing.feedback === 'scam' ? 'bg-red-500/20 text-red-400' :
          listing.feedback === 'overpriced' ? 'bg-yellow-500/20 text-yellow-400' :
          listing.feedback === 'good_deal' ? 'bg-emerald-500/20 text-emerald-400' :
          'bg-zinc-700/50 text-zinc-400'
        }`}>
          {listing.feedback.replace('_', ' ')}
        </span>
      )}

      {/* Feedback panel */}
      {showFeedback ? (
        <div className="space-y-2">
          <div className="flex gap-1 flex-wrap">
            {['scam', 'overpriced', 'wrong_product', 'accessory', 'good_deal', 'great_deal'].map((fb) => (
              <button
                key={fb}
                onClick={() => {
                  onFeedback(listing.id, fb, feedbackNote || undefined);
                  setShowFeedback(false);
                  setFeedbackNote('');
                }}
                className={`text-[10px] px-2 py-1 rounded transition-colors ${
                  fb.includes('deal') ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' :
                  fb === 'scam' ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' :
                  'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
              >
                {fb.replace('_', ' ')}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={feedbackNote}
            onChange={(e) => setFeedbackNote(e.target.value)}
            placeholder="Optional note (why?)"
            className="w-full bg-zinc-800 rounded px-2 py-1.5 text-[11px] border border-zinc-700 focus:border-emerald-500 focus:outline-none"
          />
          <button onClick={() => setShowFeedback(false)} className="text-[10px] text-zinc-600">Cancel</button>
        </div>
      ) : showValueInput ? (
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
          <button onClick={handleSetValue} className="text-xs px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors">Save</button>
          <button onClick={() => setShowValueInput(false)} className="text-xs px-2 py-2 text-zinc-500">Cancel</button>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Main actions */}
          <div className="flex gap-1.5">
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
            {listing.status === 'new' && (
              <>
                <button
                  onClick={() => onStatusChange(listing.id, 'contacted')}
                  className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 text-blue-400 hover:bg-zinc-700 transition-colors"
                >
                  Contacting
                </button>
                <button
                  onClick={() => onDismiss(listing.id)}
                  className="text-xs py-2 px-3 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
                >
                  Pass
                </button>
              </>
            )}
            {listing.status === 'contacted' && (
              <>
                <a
                  href={`/negotiate/${listing.id}`}
                  className="flex-1 text-xs py-2 rounded-lg bg-zinc-800 text-purple-400 hover:bg-zinc-700 transition-colors text-center"
                >
                  Negotiate
                </a>
                <button
                  onClick={() => onPurchase(listing.id)}
                  className="flex-1 text-xs py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors font-medium"
                >
                  Bought
                </button>
                <button
                  onClick={() => onDismiss(listing.id)}
                  className="text-xs py-2 px-3 rounded-lg bg-zinc-800 text-zinc-500 hover:bg-zinc-700 transition-colors"
                >
                  Pass
                </button>
              </>
            )}
          </div>
          {/* Secondary */}
          <div className="flex gap-3">
            <button onClick={() => setShowValueInput(true)} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Set value</button>
            <button onClick={() => setShowFeedback(true)} className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">Feedback</button>
          </div>
        </div>
      )}
    </div>
  );
}
