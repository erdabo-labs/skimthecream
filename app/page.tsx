import { createServerClient } from '@/lib/supabase/server';
import { StatCard } from '@/components/stat-card';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createServerClient();

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [dealsRes, inventoryRes, profitRes, recentRes] = await Promise.all([
    supabase
      .from('stc_listings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterday),
    supabase
      .from('stc_inventory')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'in_stock'),
    supabase
      .from('stc_inventory')
      .select('profit')
      .eq('status', 'sold')
      .not('profit', 'is', null),
    supabase
      .from('stc_listings')
      .select('id, title, asking_price, score, source, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const totalProfit =
    profitRes.data?.reduce((sum, item) => sum + (item.profit ?? 0), 0) ?? 0;

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Deals (24h)" value={dealsRes.count ?? 0} />
        <StatCard label="In Stock" value={inventoryRes.count ?? 0} />
        <StatCard
          label="Total Profit"
          value={`$${totalProfit.toFixed(0)}`}
        />
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Listings</h2>
        {recentRes.data && recentRes.data.length > 0 ? (
          <div className="space-y-2">
            {recentRes.data.map((listing) => (
              <div
                key={listing.id}
                className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 flex justify-between items-center"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{listing.title}</p>
                  <p className="text-xs text-zinc-500">
                    {listing.source} &middot;{' '}
                    {listing.asking_price ? `$${listing.asking_price}` : 'No price'}
                  </p>
                </div>
                {listing.score && (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      listing.score === 'great'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : listing.score === 'good'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-zinc-700/50 text-zinc-400'
                    }`}
                  >
                    {listing.score.toUpperCase()}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-zinc-500 text-sm">
            No listings yet. Alerts will appear once the email watcher is running.
          </p>
        )}
      </div>
    </div>
  );
}
