import { google, gmail_v1 } from 'googleapis';
import { getAuthenticatedClient } from './auth';

let _gmail: gmail_v1.Gmail | null = null;

function getGmail(): gmail_v1.Gmail {
  if (!_gmail) {
    const auth = getAuthenticatedClient();
    _gmail = google.gmail({ version: 'v1', auth });
  }
  return _gmail;
}

export interface RawEmail {
  id: string;
  subject: string;
  body: string;
  from: string;
  date: string;
}

export async function fetchUnreadAlerts(query: string = 'is:unread'): Promise<RawEmail[]> {
  const gmail = getGmail();

  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  });

  const messages = res.data.messages ?? [];
  const emails: RawEmail[] = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id!,
      format: 'full',
    });

    const headers = full.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
    const from = headers.find((h) => h.name === 'From')?.value ?? '';
    const date = headers.find((h) => h.name === 'Date')?.value ?? '';
    const body = extractBody(full.data.payload);

    emails.push({ id: msg.id!, subject, body, from, date });
  }

  return emails;
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  if (payload.parts) {
    // Prefer text/plain, fall back to text/html
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
    }

    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8');
    }

    // Recurse into nested parts
    for (const part of payload.parts) {
      const result = extractBody(part);
      if (result) return result;
    }
  }

  return '';
}

export async function deleteMessage(messageId: string): Promise<void> {
  const gmail = getGmail();
  await gmail.users.messages.trash({
    userId: 'me',
    id: messageId,
  });
}
