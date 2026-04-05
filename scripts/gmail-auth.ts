import http from 'http';
import { exchangeCode, getAuthUrl } from '../services/gmail/auth';

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);

  if (url.pathname === '/oauth2callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400);
      res.end('Missing code parameter');
      return;
    }

    try {
      await exchangeCode(code);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Gmail authorized! You can close this tab.</h1>');
      console.log('\nAuthorization complete! gmail-token.json saved.');
      setTimeout(() => process.exit(0), 1000);
    } catch (err) {
      res.writeHead(500);
      res.end(`Error: ${err}`);
      console.error('Token exchange failed:', err);
    }
  }
});

server.listen(PORT, () => {
  const authUrl = getAuthUrl();
  console.log(`\nOpen this URL in your browser to authorize Gmail access:\n`);
  console.log(authUrl);
  console.log(`\nWaiting for callback on http://localhost:${PORT}...`);
});
