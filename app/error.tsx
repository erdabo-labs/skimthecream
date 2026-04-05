"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold text-red-400">Something went wrong</h1>
      <pre className="bg-zinc-900 rounded-lg p-4 text-sm text-red-300 overflow-x-auto whitespace-pre-wrap border border-zinc-800">
        {error.message}
      </pre>
      {error.digest && (
        <p className="text-xs text-zinc-500">Digest: {error.digest}</p>
      )}
      <button
        onClick={reset}
        className="px-4 py-2 bg-zinc-800 rounded-lg text-sm hover:bg-zinc-700 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
