import type { ListingScore } from '@/lib/types';

const styles: Record<ListingScore, string> = {
  great: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  good: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  pass: 'bg-zinc-700/50 text-zinc-400 border-zinc-600/30',
};

export function ScoreBadge({ score }: { score: ListingScore }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${styles[score]}`}
    >
      {score.toUpperCase()}
    </span>
  );
}
