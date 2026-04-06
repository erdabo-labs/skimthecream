import type { ListingScore } from '@/lib/types';

const styles: Record<ListingScore, string> = {
  great: 'bg-emerald-500 text-white',
  good: 'bg-amber-500 text-black',
  pass: 'bg-zinc-700 text-zinc-400',
};

export function ScoreBadge({ score, size = 'sm' }: { score: ListingScore; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold tracking-wide ${styles[score]} ${
        size === 'lg' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[10px]'
      }`}
    >
      {score === 'great' ? 'GREAT DEAL' : score === 'good' ? 'GOOD' : 'PASS'}
    </span>
  );
}
