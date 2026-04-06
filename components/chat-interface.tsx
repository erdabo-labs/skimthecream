"use client";

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatInterfaceProps {
  listingId: number;
  initialMessages?: Message[];
  onMessagesChange?: (messages: Message[]) => void;
}

export function ChatInterface({
  listingId,
  initialMessages = [],
  onMessagesChange,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!input.trim() || streaming) return;

    const userMsg: Message = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    try {
      const res = await fetch('/api/negotiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, messages: newMessages }),
      });

      if (!res.ok) throw new Error('Request failed');

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');

      let assistantContent = '';
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        setMessages([
          ...newMessages,
          { role: 'assistant', content: assistantContent },
        ]);
      }

      const finalMessages = [
        ...newMessages,
        { role: 'assistant' as const, content: assistantContent },
      ];
      setMessages(finalMessages);
      onMessagesChange?.(finalMessages);
    } catch (err) {
      console.error('Chat error:', err);
    } finally {
      setStreaming(false);
    }
  }

  function copyMessage(content: string) {
    navigator.clipboard.writeText(content);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.length === 0 && (
          <div className="text-zinc-500 text-sm text-center py-4 space-y-2">
            <p>I&apos;ll help you negotiate. You can:</p>
            <p className="text-xs">
              &bull; Ask for an opening message to send<br />
              &bull; Paste what the seller said and I&apos;ll suggest a reply<br />
              &bull; Tell me the situation and I&apos;ll coach you
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-800 text-zinc-100'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.role === 'assistant' && (
                <button
                  onClick={() => copyMessage(msg.content)}
                  className="mt-1 text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Copy
                </button>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      <div className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Describe the situation..."
            className="flex-1 bg-zinc-900 rounded-xl px-4 py-2.5 text-sm border border-zinc-800 focus:border-emerald-500 focus:outline-none"
            disabled={streaming}
          />
          <button
            onClick={send}
            disabled={streaming || !input.trim()}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50"
          >
            {streaming ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
