const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

// Persist timings to the repository-level `data/timings.json` so it's easy
// to inspect and edit during development.
const DATA_DIR = path.join(__dirname, '..', 'data');
const TIMINGS_FILE = path.join(DATA_DIR, 'timings.json');

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

app.get('/api/issue/:owner/:repo/:number/title', async (req, res) => {
  const { owner, repo, number } = req.params;
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'time-allocated-app' } });
    if (!resp.ok) return res.status(resp.status).json({ error: 'GitHub lookup failed' });
    const body = await resp.json();
    return res.json({ title: body.title });
  } catch (err) {
    return res.status(500).json({ error: 'Lookup error' });
  }
});

app.post('/api/select', (req, res) => {
  // body: { issue: number|string, label?: string }
  const { issue } = req.body;
  const now = new Date().toISOString();
  const timings = readTimings();

  if (activeSelection) {
    // close previous interval
    timings.push({ issue: activeSelection.issue, start: activeSelection.start, end: now });
  }

  // start new interval (force one active)
  activeSelection = { issue, start: now };
  writeTimings(timings);

  return res.json({ status: 'ok', active: activeSelection });
});

app.post('/api/stop', (req, res) => {
  const now = new Date().toISOString();
  const timings = readTimings();
  if (activeSelection) {
    timings.push({ issue: activeSelection.issue, start: activeSelection.start, end: now });
    activeSelection = null;
    writeTimings(timings);
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
    if (!item.id) {
      changed = true;
      return Object.assign({ id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8) }, item);
    }
    return item;
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
    description: payload.description || '',
    start: payload.start,
    end: payload.end || null
  };
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
  writeTimings(timings);
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
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
