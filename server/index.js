const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const TIMINGS_FILE = path.join(DATA_DIR, 'timings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TIMINGS_FILE)) fs.writeFileSync(TIMINGS_FILE, '[]');

function readTimings() {
  return JSON.parse(fs.readFileSync(TIMINGS_FILE, 'utf8'));
}

function writeTimings(data) {
  fs.writeFileSync(TIMINGS_FILE, JSON.stringify(data, null, 2));
}

let activeSelection = null;

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

// Export endpoint removed: client no longer offers a download button.
// Keep the route intentionally returning 404 to avoid exposing data.
app.get('/api/timings', (req, res) => {
  return res.status(404).json({ error: 'Not available' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
