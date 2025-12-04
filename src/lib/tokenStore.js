const TOKEN_KEY = 'time_alloc_tokens';

export function saveTokens(tokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function loadTokens() {
  try {
    const v = localStorage.getItem(TOKEN_KEY);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

export async function exchangeCodeForTokens({ code, clientId, redirectUri }) {
  const verifier = sessionStorage.getItem('pkce_code_verifier');
  if (!verifier) throw new Error('No PKCE code verifier found');
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!resp.ok) throw new Error('Token exchange failed');
  const tokens = await resp.json();
  if (tokens.expires_in) tokens.expiry_date = Date.now() + (Number(tokens.expires_in) * 1000);
  saveTokens(tokens);
  return tokens;
}

export async function refreshAccessToken({ refresh_token, clientId }) {
  if (!refresh_token) throw new Error('No refresh token');
  const body = new URLSearchParams({
    client_id: clientId,
    refresh_token,
    grant_type: 'refresh_token'
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!resp.ok) throw new Error('Refresh failed');
  const tokens = await resp.json();
  const existing = loadTokens() || {};
  const merged = Object.assign({}, existing, tokens);
  saveTokens(merged);
  return merged;
}

export function clearTokens() { localStorage.removeItem(TOKEN_KEY); }
