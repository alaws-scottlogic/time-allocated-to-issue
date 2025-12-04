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
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  sessionStorage.setItem('pkce_code_verifier', codeVerifier);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  try {
    console.log('[oauth] Google auth URL:', url);
    console.log('[oauth] redirect_uri parameter:', params.get('redirect_uri'));
  } catch (err) {
    // ignore console errors in older browsers
  }
  return url;
}
