import OpenAI from 'openai';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export async function parseWithAI(prompt: string): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 500,
  });
  return response.choices[0]?.message?.content ?? '';
}

export async function chatWithAI(
  systemPrompt: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<ReadableStream> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    temperature: 0.7,
    stream: true,
  });

  return new ReadableStream({
    async start(controller) {
      for await (const chunk of response) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) {
          controller.enqueue(new TextEncoder().encode(text));
        }
      }
      controller.close();
    },
  });
}

export async function generateWithAI(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });
  return response.choices[0]?.message?.content ?? '';
}
