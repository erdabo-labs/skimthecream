export async function sendAlert(
  title: string,
  body: string,
  priority: number = 3,
  clickUrl?: string
): Promise<void> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.warn('NTFY_TOPIC not set, skipping notification');
    return;
  }

  const headers: Record<string, string> = {
    Title: title,
    Priority: String(priority),
  };

  if (clickUrl) {
    headers['Click'] = clickUrl;
  }

  const res = await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    console.error(`ntfy error: ${res.status} ${await res.text()}`);
  }
}
