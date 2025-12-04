// serverless/auth.js
// Start OAuth flow (for Vercel/Netlify serverless functions). Redirects to Google.
const handler = (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''}/api/callback`;
    const clientApp = process.env.CLIENT_BASE_URL || (process.env.VITE_CLIENT_BASE_URL || 'http://localhost:5173');
    if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID not configured');
    const scopes = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/spreadsheets'];
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent select_account',
      state: clientApp,
    });
    const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    res.writeHead(302, { Location: oauthUrl });
    res.end();
  } catch (err) {
    res.statusCode = 500; res.end('Auth start failed');
  }
};

module.exports = handler;
