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

  const payload: Record<string, unknown> = {
    topic,
    title,
    message: body,
    priority,
  };

  // Click opens the listing directly
  if (clickUrl) {
    payload.click = clickUrl;
  }

  // Action buttons: View Listing + Open in App
  const actions: Record<string, string>[] = [];
  if (clickUrl) {
    actions.push({ action: 'view', label: 'View Listing', url: clickUrl });
  }
  actions.push({ action: 'view', label: 'Open App', url: 'https://skimthecream.vercel.app/' });

  if (actions.length > 0) {
    payload.actions = actions;
  }

  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error(`ntfy error: ${res.status} ${await res.text()}`);
  }
}
