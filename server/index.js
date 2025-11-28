require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { execSync } = require('child_process');

const app = express();
// Allow Authorization header through CORS
app.use(cors({ exposedHeaders: ['Authorization'] }));
app.use(express.json());

// Persist timings to the repository-level `data/timings.json` so it's easy
// to inspect and edit during development.
const DATA_DIR = path.join(__dirname, '..', 'data');
const TIMINGS_FILE = path.join(DATA_DIR, 'timings.json');

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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TIMINGS_FILE)) fs.writeFileSync(TIMINGS_FILE, '[]');

function readTimings() {
  try {
    return JSON.parse(fs.readFileSync(TIMINGS_FILE, 'utf8'));
  } catch (err) {
    return [];
  }
}

function writeTimings(data) {
  fs.writeFileSync(TIMINGS_FILE, JSON.stringify(data, null, 2));
}

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
  if (payload.end && !isValidIsoString(payload.end)) errors.push('end must be a valid ISO datetime string');
  if (payload.start && payload.end) {
    const s = Date.parse(payload.start);
    const e = Date.parse(payload.end);
    if (e < s) errors.push('end must be the same or after start');
  }
  if (payload.description && String(payload.description).length > 1000) errors.push('description too long');
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

app.post('/api/select', (req, res) => {
  // body: { issue: number|string, label?: string }
  const { issue, repoUrl } = req.body;
  const now = new Date().toISOString();
  const timings = readTimings();

  if (activeSelection) {
    // close previous interval
    const closed = { issue: activeSelection.issue, issueTitle: activeSelection.issueTitle || null, start: activeSelection.start, end: now, repoUrl: activeSelection.repoUrl || DETECTED_REPO_URL || null };
    timings.push(closed);
    // attempt to fill missing title asynchronously
    if (!closed.issueTitle && closed.issue) {
      fetchIssueTitleFromGitHub(closed.repoUrl, closed.issue).then(title => {
        if (title) {
          const all = readTimings();
          const idx = all.findIndex(t => t.start === closed.start && t.end === closed.end && String(t.issue) === String(closed.issue));
          if (idx !== -1) {
            all[idx].issueTitle = title;
            writeTimings(all);
          }
        }
      }).catch(() => {});
    }
  }

  // start new interval (force one active)
  activeSelection = { issue, start: now, repoUrl: repoUrl || DETECTED_REPO_URL || null };
  writeTimings(timings);

  return res.json({ status: 'ok', active: activeSelection });
});

app.post('/api/stop', (req, res) => {
  const now = new Date().toISOString();
  const timings = readTimings();
  if (activeSelection) {
    const closed = { issue: activeSelection.issue, issueTitle: activeSelection.issueTitle || null, start: activeSelection.start, end: now, repoUrl: activeSelection.repoUrl || DETECTED_REPO_URL || null };
    timings.push(closed);
    activeSelection = null;
    writeTimings(timings);
    if (!closed.issueTitle && closed.issue) {
      fetchIssueTitleFromGitHub(closed.repoUrl, closed.issue).then(title => {
        if (title) {
          const all = readTimings();
          const idx = all.findIndex(t => t.start === closed.start && t.end === closed.end && String(t.issue) === String(closed.issue));
          if (idx !== -1) {
            all[idx].issueTitle = title;
            writeTimings(all);
          }
        }
      }).catch(() => {});
    }
    return res.json({ status: 'stopped' });
  }
  return res.status(400).json({ error: 'no active selection' });
});

// Timings CRUD
app.get('/api/timings', (req, res) => {
  const list = readTimings();
  // Backfill missing ids for legacy entries so client can reliably reference them.
  let changed = false;
  const updated = list.map(item => {
    let out = item;
    if (!out.id) {
      changed = true;
      out = Object.assign({ id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8) }, out);
    }
    if (!('repoUrl' in out) || out.repoUrl === undefined || out.repoUrl === null) {
      changed = true;
      out = Object.assign({}, out, { repoUrl: DETECTED_REPO_URL || null });
    }
    return out;
  });
  if (changed) writeTimings(updated);
  return res.json(updated);
});

app.post('/api/timings', (req, res) => {
  const payload = req.body;
  const errors = validateTimingPayload(payload);
  if (errors.length > 0) return res.status(400).json({ errors });

  const timings = readTimings();
  const id = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  const entry = {
    id,
    issue: payload.issue || null,
    issueTitle: null,
    description: payload.description || '',
    start: payload.start,
    end: payload.end || null,
    repoUrl: payload.repoUrl || null
  };
  // attempt to resolve title synchronously-ish (returns null on failure)
  fetchIssueTitleFromGitHub(entry.repoUrl, entry.issue).then(title => {
    if (title) {
      const all = readTimings();
      const idx = all.findIndex(t => String(t.id) === String(id));
      if (idx !== -1) {
        all[idx].issueTitle = title;
        writeTimings(all);
      }
    }
  }).catch(() => {});
  timings.push(entry);
  writeTimings(timings);
  return res.status(201).json(entry);
});

app.put('/api/timings/:id', (req, res) => {
  const { id } = req.params;
  const payload = req.body;
  const timings = readTimings();
  const idx = timings.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });

  const candidate = Object.assign({}, timings[idx], payload);
  const errors = validateTimingPayload(candidate);
  if (errors.length > 0) return res.status(400).json({ errors });

  timings[idx] = candidate;
  // if issue or repoUrl changed (or we don't have a title), try to resolve title
  const needResolve = (!timings[idx].issueTitle && timings[idx].issue) || payload.issue || payload.repoUrl;
  writeTimings(timings);
  if (needResolve) {
    fetchIssueTitleFromGitHub(timings[idx].repoUrl, timings[idx].issue).then(title => {
      if (title) {
        const all = readTimings();
        const idx2 = all.findIndex(t => String(t.id) === String(id));
        if (idx2 !== -1) {
          all[idx2].issueTitle = title;
          writeTimings(all);
        }
      }
    }).catch(() => {});
  }
  return res.json(timings[idx]);
});

app.delete('/api/timings/:id', (req, res) => {
  const { id } = req.params;
  const timings = readTimings();
  const idx = timings.findIndex(t => String(t.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const removed = timings.splice(idx, 1)[0];
  writeTimings(timings);
  return res.json({ removed });
});

const PORT = process.env.PORT || 4000;
// Log whether a GitHub token is present (mask for safety)
const startupTok = getGithubEnvToken();
if (startupTok) {
  const masked = startupTok.length > 8 ? `${startupTok.slice(0,4)}...${startupTok.slice(-4)}` : '***';
}
app.listen(PORT, () => {});
