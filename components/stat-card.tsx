interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
}

export function StatCard({ label, value, sublabel }: StatCardProps) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sublabel && <p className="text-xs text-zinc-500 mt-0.5">{sublabel}</p>}
    </div>
  );
}
