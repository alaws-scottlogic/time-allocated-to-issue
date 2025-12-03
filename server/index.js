require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { execSync } = require('child_process');
const sheets = require('./lib/sheets');
const path = require('path');
const { google } = require('googleapis');
const fs = require('fs');

const tokenStore = require('./lib/tokenStore');

// Create OAuth2 client and wire it to sheets when tokens are available
function initOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/auth/google/callback';
  if (!clientId || !clientSecret) return null;
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return oauth2Client;
}


const app = express();
// Allow Authorization header through CORS
app.use(cors({ exposedHeaders: ['Authorization'] }));
app.use(express.json());

// Initialize OAuth client at startup (tokens loaded asynchronously below)
const oauthClient = initOAuthClient();

// Attempt to load tokens from the tokenStore and set credentials when available
(async function loadPersistedTokens() {
  try {
    if (!oauthClient) return;
    const tokens = await tokenStore.loadTokens();
    if (tokens) {
      oauthClient.setCredentials(tokens);
      sheets.setAuthClient(oauthClient);
    }
  } catch (e) { /* ignore */ }
})();

// Route: start OAuth flow
app.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/auth/google/callback';
  const clientAppUrl = process.env.CLIENT_BASE_URL || 'http://localhost:5173';
  if (!clientId || !clientSecret) return res.status(500).send('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  // Request openid/email/profile so we can verify identity and return an ID token
  const scopes = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/spreadsheets'];
  const hd = req.query.hd || process.env.GOOGLE_AUTH_HOSTED_DOMAIN || undefined;
  const oauth2Endpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
  });
  if (hd) params.set('hd', hd);
  // Allow a return URL so client can be redirected back after auth (optional)
  if (req.query.returnTo) params.set('state', encodeURIComponent(req.query.returnTo));
  const url = `${oauth2Endpoint}?${params.toString()}`;
  res.redirect(url);
});

// OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  const state = req.query.state ? decodeURIComponent(req.query.state) : null;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/auth/google/callback';
  const clientAppUrl = process.env.CLIENT_BASE_URL || 'http://localhost:5173';
  if (!code) {
    const redirect = `${clientAppUrl}/?auth=failed`;
    return res.redirect(redirect);
  }
  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    // persist tokens in store
    try { await tokenStore.saveTokens(tokens); } catch (e) { /* ignore */ }
    // wire into sheets and also update the main oauthClient if present
    sheets.setAuthClient(oauth2Client);
    if (oauthClient) oauthClient.setCredentials(tokens);

    // Verify ID token to get user info (email/name) when available
    let idPayload = null;
    try {
      if (tokens.id_token && oauth2Client.verifyIdToken) {
        const ticket = await oauth2Client.verifyIdToken({ idToken: tokens.id_token, audience: clientId }).catch(() => null);
        if (ticket && ticket.getPayload) {
          idPayload = ticket.getPayload();
        }
      }
    } catch (e) { idPayload = null; }

    // Redirect back to client app with success state. Include expiry and user info if available.
    const expires = tokens.expiry_date ? `&expires_at=${encodeURIComponent(tokens.expiry_date)}` : '';
    const userPart = idPayload && idPayload.email ? `&email=${encodeURIComponent(idPayload.email)}&name=${encodeURIComponent(idPayload.name || '')}` : '';
    const redirectTo = state || clientAppUrl;
    const glue = redirectTo.includes('?') ? '&' : '?';
    return res.redirect(`${redirectTo}${glue}auth=success${expires}${userPart}`);
  } catch (err) {
    const clientAppUrl2 = process.env.CLIENT_BASE_URL || 'http://localhost:5173';
    const redirect = `${clientAppUrl2}/?auth=failed`;
    return res.redirect(redirect);
  }
});

// Storage now uses Google Sheets via OAuth; see `server/lib/sheets.js`.

// Try to detect the repository URL so we can store it with every timing entry.
function detectRepoUrl() {
  try {
    // Allow override from environment for flexibility in CI/dev.
    if (process.env.REPO_URL) return process.env.REPO_URL;
    const repoRoot = path.join(__dirname, '..');
    const raw = execSync('git config --get remote.origin.url', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (!raw) return null;
    // Normalize common formats (ssh and https) and strip .git suffix.
    let url = raw;
    if (url.endsWith('.git')) url = url.slice(0, -4);
    if (url.startsWith('git@')) {
      // git@github.com:owner/repo -> https://github.com/owner/repo
      const parts = url.split(':');
      const host = parts[0].replace('git@', '');
      const repoPath = parts[1];
      url = `https://${host}/${repoPath}`;
    }
    return url;
  } catch (err) {
    return null;
  }
}

const DETECTED_REPO_URL = detectRepoUrl();

let activeSelection = null;

function isValidIsoString(s) {
  if (typeof s !== 'string') return false;
  const t = Date.parse(s);
  return !Number.isNaN(t);
}

function validateTimingPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    errors.push('payload must be an object');
    return errors;
  }
  if (!payload.start) errors.push('start is required');
  if (payload.start && !isValidIsoString(payload.start)) errors.push('start must be a valid ISO datetime string');
  // 'end' is deprecated; duration is used instead. Ignore validation for end if present.
  if (payload.start && payload.end) {
    const s = Date.parse(payload.start);
    const e = Date.parse(payload.end);
    if (e < s) errors.push('end must be the same or after start');
  }
  return errors;
}

// Helper: find a GitHub token in environment variables (case-insensitive)
function getGithubEnvToken() {
  if (!process.env) return null;
  // Prefer explicit common name
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  // Fallback: search case-insensitively for anything that looks like github token
  const keys = Object.keys(process.env);
  const found = keys.find(k => {
    const nk = k.toLowerCase();
    return nk === 'github_token' || nk === 'github-token' || nk === 'githubtoken' || nk === 'github_token';
  });
  if (found) return process.env[found];
  return null;
}

app.get('/api/issue/:owner/:repo/:number/title', async (req, res) => {
  const { owner, repo, number } = req.params;
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
    const headers = { 'User-Agent': 'time-allocated-app' };
    // Prefer Authorization header from client if provided.
    if (req.headers && req.headers.authorization) {
      headers['Authorization'] = req.headers.authorization;
    } else {
      const envTok = getGithubEnvToken();
      if (envTok) {
        headers['Authorization'] = envTok.startsWith('token ') || envTok.startsWith('Bearer ') ? envTok : `token ${envTok}`;
      }
    }
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      // Try to surface GitHub's error body for debugging when appropriate
      let errBody = null;
      try { errBody = await resp.text(); } catch (e) { /* ignore */ }
      return res.status(resp.status).json({ error: 'GitHub lookup failed', details: errBody });
    }
    const body = await resp.json();
    return res.json({ title: body.title });
  } catch (err) {
    return res.status(500).json({ error: 'Lookup error' });
  }
});

// Helper to fetch issue title from GitHub given a repoUrl and issue number
async function fetchIssueTitleFromGitHub(repoUrl, issue) {
  try {
    if (!repoUrl || !issue) return null;
    const m = /github\.com\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)(?:$|\/)/i.exec(repoUrl);
    if (!m || !m.groups) return null;
    const owner = m.groups.owner;
    const repo = m.groups.repo.replace(/\.git$/, '');
    const num = String(issue).replace(/[^0-9]/g, '');
    if (!num) return null;
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${num}`;
    const headers = { 'User-Agent': 'time-allocated-app' };
    const envTok = getGithubEnvToken();
    if (envTok) headers['Authorization'] = envTok.startsWith('token ') || envTok.startsWith('Bearer ') ? envTok : `token ${envTok}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    const body = await resp.json();
    return body && body.title ? body.title : null;
  } catch (err) {
    return null;
  }
}

app.post('/api/select', async (req, res) => {
  // body: { issue: number|string, label?: string }
  const { issue: rawIssue, repoUrl, otherLabel } = req.body;
  const now = new Date().toISOString();
  // Closing previous interval writes directly to Sheets

  if (activeSelection) {
    const duration = Math.round((Date.parse(now) - Date.parse(activeSelection.start)) / 1000);
    const closed = { issue: activeSelection.issue, issueTitle: activeSelection.issueTitle || null, start: activeSelection.start, duration, repoUrl: activeSelection.repoUrl || DETECTED_REPO_URL || null };
    try {
      const saved = await sheets.appendTiming(closed);
      if (!closed.issueTitle && closed.issue && saved && saved.id) {
        fetchIssueTitleFromGitHub(closed.repoUrl, closed.issue).catch(() => {});
      }
    } catch (e) { /* swallow to not block UI */ }
  }

  // Resolve special tokens like 'other'/'other2' into usable issue labels so they are persisted
  let issue = rawIssue;
  try {
    if (issue === 'other') {
      issue = otherLabel || (typeof process !== 'undefined' ? 'Other' : 'Other');
    } else if (issue === 'other2') {
      issue = otherLabel || 'Other (custom)';
    }
  } catch (e) {
    // fall back to rawIssue if anything goes wrong
    issue = rawIssue;
  }

  // start new interval (force one active)
  activeSelection = { issue, start: now, repoUrl: repoUrl || DETECTED_REPO_URL || null };

  return res.json({ status: 'ok', active: activeSelection });
});

app.post('/api/stop', async (req, res) => {
  const now = new Date().toISOString();
  if (activeSelection) {
    const duration = Math.round((Date.parse(now) - Date.parse(activeSelection.start)) / 1000);
    const closed = { issue: activeSelection.issue, issueTitle: activeSelection.issueTitle || null, start: activeSelection.start, duration, repoUrl: activeSelection.repoUrl || DETECTED_REPO_URL || null };
    try {
      const saved = await sheets.appendTiming(closed);
      activeSelection = null;
      if (!closed.issueTitle && closed.issue && saved && saved.id) {
        fetchIssueTitleFromGitHub(closed.repoUrl, closed.issue).catch(() => {});
      }
    } catch (e) { /* ignore */ }
    return res.json({ status: 'stopped' });
  }
  return res.status(400).json({ error: 'no active selection' });
});

// Timings CRUD
app.get('/api/timings', async (req, res) => {
  try {
    const list = await sheets.getTimings();
    // Attach repoUrl and best-effort issue titles (non-persistent)
    const withRepo = list.map(item => ({
      id: item.id,
      issue: item.issue,
      start: item.start,
      duration: item.duration,
      repoUrl: ('repoUrl' in item && item.repoUrl) || DETECTED_REPO_URL || null,
    }));
    // Fetch titles in parallel (best-effort)
    const promises = withRepo.map(async (t) => {
      if (t.issue && t.repoUrl) {
        const title = await fetchIssueTitleFromGitHub(t.repoUrl, t.issue).catch(() => null);
        return Object.assign({}, t, { issueTitle: title || null });
      }
      return Object.assign({}, t, { issueTitle: null });
    });
    const updated = await Promise.all(promises);
    return res.json(updated);
  } catch (err) {
    return res.status(500).json({ error: 'timings read failed' });
  }
});

app.post('/api/timings', async (req, res) => {
  const payload = req.body;
  const errors = validateTimingPayload(payload);
  if (errors.length > 0) return res.status(400).json({ errors });

  const entry = {
    issue: payload.issue || null,
    issueTitle: null,
    start: payload.start,
    duration: payload.duration != null ? payload.duration : (payload.end ? Math.round((Date.parse(payload.end) - Date.parse(payload.start)) / 1000) : null),
    repoUrl: payload.repoUrl || null,
  };
  try {
    const saved = await sheets.appendTiming(entry);
    if (saved && saved.id) {
      const title = await fetchIssueTitleFromGitHub(entry.repoUrl, entry.issue).catch(() => null);
      return res.status(201).json(Object.assign({}, saved, { issueTitle: title || null }));
    }
    return res.status(201).json(saved);
  } catch (e) {
    return res.status(500).json({ error: 'timings write failed' });
  }
});

app.put('/api/timings/:id', async (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const cleaned = Object.assign({}, payload);
  if ('owner' in cleaned) delete cleaned.owner;
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum < 2) return res.status(400).json({ error: 'invalid id' });
  const existingList = await sheets.getTimings();
  const existing = existingList.find(t => Number(t.id) === idNum);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const candidate = Object.assign({}, existing, cleaned);
  const errors = validateTimingPayload(candidate);
  if (errors.length > 0) return res.status(400).json({ errors });
  try { await sheets.updateTiming(idNum, candidate); } catch (e) { /* ignore */ }
  // Optionally fetch the issue title for the response, but do not persist it to the sheet
  if (candidate.issue) {
    const title = await fetchIssueTitleFromGitHub(candidate.repoUrl, candidate.issue).catch(() => null);
    return res.json(Object.assign({}, candidate, { issueTitle: title || null }));
  }
  return res.json(candidate);
});

app.delete('/api/timings/:id', async (req, res) => {
  const { id } = req.params;
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum < 2) return res.status(400).json({ error: 'invalid id' });
  const list = await sheets.getTimings();
  const existing = list.find(t => Number(t.id) === idNum);
  if (!existing) return res.status(404).json({ error: 'not found' });
  try { await sheets.deleteTiming(idNum); } catch (e) { /* ignore */ }
  return res.json({ removed: existing });
});

const PORT = process.env.PORT || 4000;
// Log whether a GitHub token is present (mask for safety)
const startupTok = getGithubEnvToken();
if (startupTok) {
  const masked = startupTok.length > 8 ? `${startupTok.slice(0,4)}...${startupTok.slice(-4)}` : '***';
}
// Ensure basic sheet headers exist on startup
(async function startupInit() {
  try {
    // Only attempt to ensure headers if oauthClient has credentials (tokens)
    if (oauthClient && oauthClient.credentials && (oauthClient.credentials.access_token || oauthClient.credentials.refresh_token)) {
      await sheets.ensureHeaders();
    }
  } catch (e) { /* ignore */ }
})();
app.get('/api/eod', async (req, res) => {
  try {
    const rows = await sheets.getEod();
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'eod read failed', details: err && err.message ? err.message : String(err) });
  }
});
app.post('/api/eod', async (req, res) => {
  const payload = req.body;
  if (!payload || !payload.date) return res.status(400).json({ error: 'date required' });
  // Categories per EOD UI
  const categories = ['Coding', 'Debugging', 'Interacting with a tool', 'Reviewing code'];
  try {
    await sheets.appendEodTable(payload.date, payload, categories);
    return res.status(201).json({ status: 'ok' });
  } catch (err) {
    return res.status(500).json({ error: 'eod write failed' + err });
  }
});
app.listen(PORT, () => {});

// On startup, if no tokens are present, prompt the developer to authorize.
(async function promptForAuthIfNeeded() {
  try {
    if (!oauthClient) return;
    const tokens = await tokenStore.loadTokens();
    if (!tokens) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
      if (!clientId || !clientSecret) {
        console.warn('Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Sheets integration.');
        return;
      }
      const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
      const oauth2Endpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
      });
      if (process.env.AUTO_OPEN_AUTH === 'true') {
        try { require('open')(url); } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
})();

// Convenience: expose Google Sheet URL for quick access from the client
app.get('/api/sheets/url', (req, res) => {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) return res.status(400).json({ error: 'GOOGLE_SHEETS_SPREADSHEET_ID not set' });
  const url = `https://docs.google.com/spreadsheets/d/${id}`;
  return res.json({ url });
});

app.get('/api/sheets/links', async (req, res) => {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!id) return res.status(400).json({ error: 'GOOGLE_SHEETS_SPREADSHEET_ID not set' });
  const timingsGid = process.env.GOOGLE_SHEETS_TIMINGS_GID || null;
  const eodGid = process.env.GOOGLE_SHEETS_EOD_GID || null;
  const base = `https://docs.google.com/spreadsheets/d/${id}`;
  if (timingsGid || eodGid) {
    return res.json({
      base,
      timings: timingsGid ? `${base}/edit#gid=${timingsGid}` : base,
      eod: eodGid ? `${base}/edit#gid=${eodGid}` : base,
    });
  }
  try {
    const links = await sheets.getSheetLinks();
    return res.json(links);
  } catch (err) {
    return res.json({ base, timings: base, eod: base });
  }
});

// Expose minimal server-side config (from dotenv) for the client to build OAuth URLs
app.get('/api/config', (req, res) => {
  try {
    const cfg = {
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:4000/auth/google/callback',
      clientBaseUrl: process.env.CLIENT_BASE_URL || 'http://localhost:5173',
    };
    return res.json(cfg);
  } catch (err) {
    return res.status(500).json({ error: 'could not read config' });
  }
});

// Expose auth status for the UI so clients can show an authorize button
app.get('/api/auth/status', async (req, res) => {
  try {
    // check token store first
    const tokens = await tokenStore.loadTokens();
    if (tokens) {
      return res.json({ authenticated: true, expires_at: tokens.expiry_date || null });
    }
    // fallback to checking the in-memory oauthClient credentials
    if (oauthClient && oauthClient.credentials && (oauthClient.credentials.access_token || oauthClient.credentials.refresh_token)) {
      return res.json({ authenticated: true, expires_at: oauthClient.credentials.expiry_date || null });
    }
    return res.json({ authenticated: false });
  } catch (err) {
    return res.status(500).json({ authenticated: false, error: err && err.message ? err.message : String(err) });
  }
});

