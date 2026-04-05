"use client";

interface ListingPreviewProps {
  platform: string;
  content: string;
}

export function ListingPreview({ platform, content }: ListingPreviewProps) {
  function copy() {
    navigator.clipboard.writeText(content);
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex justify-between items-center px-4 py-2 border-b border-zinc-800">
        <span className="text-xs font-medium text-zinc-400 uppercase">
          {platform === 'facebook' ? 'Facebook Marketplace' : 'KSL Classifieds'}
        </span>
        <button
          onClick={copy}
          className="text-xs text-emerald-400 hover:text-emerald-300"
        >
          Copy
        </button>
      </div>
      <div className="p-4">
        <p className="text-sm whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}
