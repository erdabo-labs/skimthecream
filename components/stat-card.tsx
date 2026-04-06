interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  accent?: boolean;
}

export function StatCard({ label, value, sublabel, accent }: StatCardProps) {
  return (
    <div className="bg-zinc-900/80 rounded-xl p-3 border border-zinc-800/50">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${accent ? 'text-emerald-400' : ''}`}>{value}</p>
      {sublabel && <p className="text-[10px] text-zinc-500 mt-0.5">{sublabel}</p>}
    </div>
  );
}
