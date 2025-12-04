// serverless/callback.js
// Exchange authorization code for tokens and optionally persist them server-side.
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const handler = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code) return res.status(400).send('Missing code');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''}/api/callback`;
    const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const tokens = await tokenResp.json();
    // persist tokens to disk if configured
    if (process.env.PERSIST_TOKENS === 'true') {
      const out = path.join(process.cwd(), 'serverless-tokens.json');
      try { fs.writeFileSync(out, JSON.stringify(tokens, null, 2)); } catch (e) { }
    }
    // redirect back to client state (app) with auth=success
    const redirectTo = state || (process.env.CLIENT_BASE_URL || 'http://localhost:5173');
    const glue = redirectTo.includes('?') ? '&' : '?';
    res.writeHead(302, { Location: `${redirectTo}${glue}auth=success` });
    res.end();
  } catch (err) {
    res.statusCode = 500; res.end('Callback failed');
  }
};

module.exports = handler;
