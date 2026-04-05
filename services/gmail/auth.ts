import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

const TOKEN_PATH = path.resolve(process.cwd(), 'gmail-token.json');
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

export function getOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'http://localhost:3001/oauth2callback'
  );
}

export function getAuthenticatedClient(): OAuth2Client {
  const client = getOAuth2Client();

  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      `Gmail token not found at ${TOKEN_PATH}. Run the auth flow first.`
    );
  }

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  client.setCredentials(token);

  client.on('tokens', (newTokens) => {
    const existing = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    const merged = { ...existing, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
    console.log('Gmail token refreshed');
  });

  return client;
}

export function getAuthUrl(): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function exchangeCode(code: string): Promise<void> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('Gmail token saved to', TOKEN_PATH);
}
