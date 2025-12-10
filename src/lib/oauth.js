// Minimal PKCE helpers and Google auth URL builder (client-side)
export function generateCodeVerifier() {
  const array = new Uint8Array(56);
  window.crypto.getRandomValues(array);
  return btoa(String.fromCharCode.apply(null, Array.from(array))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function generateCodeChallenge(verifier) {
  const enc = new TextEncoder();
  const data = enc.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64;
}

export async function buildAuthUrl({ clientId, redirectUri, scope = 'openid email profile https://www.googleapis.com/auth/spreadsheets' }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope,
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  try {
    console.log('[oauth] Google auth URL:', url);
  } catch (err) {
    // ignore console errors in older browsers
  }
  return url;
}

export async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem('pkce_code_verifier');
  if (!verifier) throw new Error('Missing PKCE code verifier');
  // The serverless function is the token endpoint
  const tokenUrl = '/api/callback';
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, verifier })
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Token exchange failed: ${errorText}`);
  }
  const tokens = await res.json();
  sessionStorage.removeItem('pkce_code_verifier');
  return tokens;
}
