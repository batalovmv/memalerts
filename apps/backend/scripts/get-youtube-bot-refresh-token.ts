import dotenv from 'dotenv';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

dotenv.config();

function requireEnv(key: string): string {
  const v = String(process.env[key] || '').trim();
  if (!v) {
    throw new Error(`Missing env: ${key}`);
  }
  return v;
}

async function main() {
  const clientId = requireEnv('YOUTUBE_CLIENT_ID');
  const clientSecret = requireEnv('YOUTUBE_CLIENT_SECRET');
  const redirectUri = requireEnv('YOUTUBE_CALLBACK_URL');

  // For sending messages to YouTube live chat we need youtube.force-ssl
  const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl'];

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('access_type', 'offline'); // request refresh_token
  url.searchParams.set('prompt', 'consent'); // force refresh_token issuance
  url.searchParams.set('include_granted_scopes', 'true');

  console.log('\n1) Open this URL in a browser (log in as the BOT Google account):\n');
  console.log(url.toString());
  console.log('\n2) After consent, you will be redirected to your callback URL.');
  console.log('   Copy the "code" query param from that redirect URL and paste it below.\n');

  const rl = readline.createInterface({ input, output });
  const codeRaw = await rl.question('Paste OAuth "code": ');
  rl.close();

  const code = String(codeRaw || '').trim();
  if (!code) {
    throw new Error('No code provided');
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const text = await tokenResp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!tokenResp.ok) {
    throw new Error(`Token exchange failed: ${tokenResp.status} ${text || tokenResp.statusText}`);
  }

  const refreshToken = String(json?.refresh_token || '').trim();
  const scope = String(json?.scope || '').trim();
  const hasAccessToken = Boolean(String(json?.access_token || '').trim());

  if (!refreshToken) {
    console.log('\nToken response:\n', json);
    throw new Error(
      'No refresh_token received. This usually means you already granted access before. Revoke access for the app in Google Account security, then retry.'
    );
  }

  console.log('\nOK.');
  console.log(`Scopes granted: ${scope || '(unknown)'}`);
  console.log(`Has access_token: ${hasAccessToken}`);
  console.log('\nAdd this to your VPS .env (keep it secret):\n');
  console.log(`YOUTUBE_BOT_REFRESH_TOKEN=${refreshToken}`);
  console.log('');
}

main().catch((e: any) => {
  console.error('\nERROR:', e?.message || String(e));
  process.exit(1);
});


