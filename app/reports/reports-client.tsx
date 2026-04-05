"use client";

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { StatCard } from '@/components/stat-card';
import type { InventoryItem } from '@/lib/types';

export function ReportsClient({ soldItems }: { soldItems: InventoryItem[] }) {
  const stats = useMemo(() => {
    const totalProfit = soldItems.reduce((sum, i) => sum + (i.profit ?? 0), 0);
    const totalCost = soldItems.reduce((sum, i) => sum + (i.purchase_price ?? 0), 0);
    const roi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    const daysToSell = soldItems
      .filter((i) => i.purchase_date && i.sold_date)
      .map(
        (i) =>
          (new Date(i.sold_date!).getTime() - new Date(i.purchase_date!).getTime()) /
          (1000 * 60 * 60 * 24)
      );
    const avgDays =
      daysToSell.length > 0
        ? daysToSell.reduce((a, b) => a + b, 0) / daysToSell.length
        : 0;

    return { totalProfit, roi, avgDays };
  }, [soldItems]);

  const profitByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of soldItems) {
      const cat = item.purchase_source ?? 'Unknown';
      map[cat] = (map[cat] ?? 0) + (item.profit ?? 0);
    }
    return Object.entries(map).map(([name, profit]) => ({ name, profit }));
  }, [soldItems]);

  const profitOverTime = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of soldItems) {
      if (!item.sold_date) continue;
      const month = item.sold_date.slice(0, 7);
      map[month] = (map[month] ?? 0) + (item.profit ?? 0);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, profit]) => ({ month, profit }));
  }, [soldItems]);

  function exportCSV() {
    const headers = [
      'Product',
      'Purchase Price',
      'Purchase Date',
      'Sold Price',
      'Sold Date',
      'Platform',
      'Fees',
      'Profit',
    ];
    const rows = soldItems.map((i) =>
      [
        i.product_name,
        i.purchase_price,
        i.purchase_date,
        i.sold_price,
        i.sold_date,
        i.sold_platform,
        i.fees,
        i.profit,
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'skimthecream-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Reports</h1>
        <button
          onClick={exportCSV}
          className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
        >
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total Profit" value={`$${stats.totalProfit.toFixed(0)}`} />
        <StatCard label="ROI" value={`${stats.roi.toFixed(0)}%`} />
        <StatCard label="Avg Days" value={stats.avgDays.toFixed(1)} sublabel="to sell" />
      </div>

      {profitByCategory.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Profit by Source</h2>
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profitByCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="name" tick={{ fill: '#999', fontSize: 11 }} />
                <YAxis tick={{ fill: '#999', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333' }}
                />
                <Bar dataKey="profit" fill="#34d399" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {profitOverTime.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Profit Over Time</h2>
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={profitOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="month" tick={{ fill: '#999', fontSize: 11 }} />
                <YAxis tick={{ fill: '#999', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333' }}
                />
                <Line
                  type="monotone"
                  dataKey="profit"
                  stroke="#34d399"
                  strokeWidth={2}
                  dot={{ fill: '#34d399' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {soldItems.length === 0 && (
        <p className="text-zinc-500 text-sm text-center py-8">
          No sales recorded yet. Mark inventory items as sold to see reports.
        </p>
      )}
    </div>
  );
}
