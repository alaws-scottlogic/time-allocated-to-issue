import { loadTokens, refreshAccessToken } from './tokenStore';

function authHeader() {
  const t = loadTokens();
  if (!t || !t.access_token) return null;
  return `Bearer ${t.access_token}`;
}

async function ensureAccess(clientId) {
  let t = loadTokens();
  if (!t) throw new Error('Not authenticated');
  if (t.expires_in && t.expiry_date) {
    const expiresAt = t.expiry_date || (Date.now() + (t.expires_in * 1000));
    if (Date.now() > expiresAt && t.refresh_token) {
      t = await refreshAccessToken({ refresh_token: t.refresh_token, clientId }).catch(() => { throw new Error('Failed to refresh token'); });
    }
  }
  return t;
}

async function gsheetsFetch(path, method = 'GET', body = null, clientId) {
  await ensureAccess(clientId);
  const headers = { 'Authorization': authHeader() };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const url = `https://sheets.googleapis.com${path}`;
  const resp = await fetch(url, { method, headers, body: body && typeof body === 'string' ? body : (body ? JSON.stringify(body) : undefined) });
  if (!resp.ok) {
    // If we receive a 401/403, clear stored tokens so the app will reauthenticate
    if (resp.status === 401 || resp.status === 403) {
      try { const ts = await import('./tokenStore'); ts.clearTokens(); ts.notifyTokensCleared(); } catch (e) { /* ignore */ }
      const txt = await resp.text().catch(() => '');
      throw new Error(`Sheets API auth error: ${resp.status} ${txt}`);
    }
    const txt = await resp.text().catch(() => '');
    throw new Error(`Sheets API error: ${resp.status} ${txt}`);
  }
  return resp.json().catch(() => null);
}

export async function getTimings(spreadsheetId, clientId) {
  if (!spreadsheetId) throw new Error('Spreadsheet ID required');
  const range = `/v4/spreadsheets/${spreadsheetId}/values/Timings!A2:C`;
  const j = await gsheetsFetch(range, 'GET', null, clientId);
  const rows = (j && j.values) || [];
  return rows.map((r, i) => ({ id: i + 2, issue: r[0] || null, start: r[1] || null, duration: r[2] != null && r[2] !== '' ? Number(r[2]) : null }));
}

export async function appendTiming(spreadsheetId, entry, clientId) {
  const path = `/v4/spreadsheets/${spreadsheetId}/values/Timings!A2:append?valueInputOption=USER_ENTERED`;
  const row = [entry.issue || '', entry.start || '', entry.duration != null ? entry.duration : ''];
  const j = await gsheetsFetch(path, 'POST', { values: [row] }, clientId);
  const ur = j && (j.updates && j.updates.updatedRange);
  let id = null;
  if (ur) {
    const m = /!(?:[A-Z]+)(\d+):/.exec(ur);
    if (m && m[1]) id = Number(m[1]);
  }
  return { id, issue: entry.issue || null, start: entry.start || null, duration: entry.duration || null };
}

export async function updateTiming(spreadsheetId, id, updates, clientId) {
  const range = `/v4/spreadsheets/${spreadsheetId}/values/Timings!A${id}:C${id}`;
  const row = [updates.issue || '', updates.start || '', updates.duration != null ? updates.duration : ''];
  await gsheetsFetch(range + '?valueInputOption=USER_ENTERED', 'PUT', { values: [row] }, clientId);
  return { id, ...updates };
}

export async function deleteTiming(spreadsheetId, id, clientId) {
  const range = `/v4/spreadsheets/${spreadsheetId}/values/Timings!A${id}:C${id}`;
  await gsheetsFetch(range, 'DELETE', null, clientId);
  return { removed: { id } };
}

export async function getIssues(spreadsheetId, clientId) {
  const range = `/v4/spreadsheets/${spreadsheetId}/values/Issues!A2:C`;
  const j = await gsheetsFetch(range, 'GET', null, clientId);
  const rows = j && j.values || [];
  const issues = rows.map(r => ({ number: r[0], title: r[1], url: r[2] || null }));
  // Ensure the returned list is unique by issue number (or title when number missing)
  const seen = new Set();
  return issues.filter(i => {
    const key = i.number != null && i.number !== '' ? String(i.number) : `title:${i.title || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function saveIssues(spreadsheetId, issues, clientId) {
  // Normalize and deduplicate incoming issues by number (fallback to title)
  if (!issues || issues.length === 0) {
    // Clear existing entries when given an empty list
    await gsheetsFetch(`/v4/spreadsheets/${spreadsheetId}/values/Issues!A2:B:clear`, 'POST', {}, clientId).catch(() => { });
    return;
  }
  const deduped = [];
  const seen = new Set();
  for (const it of issues) {
    const key = it.number != null && it.number !== '' ? String(it.number) : `title:${it.title || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  // Clear existing rows before writing the deduplicated list to avoid appending duplicates
  await gsheetsFetch(`/v4/spreadsheets/${spreadsheetId}/values/Issues!A2:C:clear`, 'POST', {}, clientId).catch(() => { });

  if (deduped.length === 0) return;
  const rows = deduped.map(i => [i.number, i.title, i.url || '']);
  await gsheetsFetch(`/v4/spreadsheets/${spreadsheetId}/values/Issues!A2:append?valueInputOption=RAW`, 'POST', { values: rows }, clientId);
}

export async function getSheetLinks(spreadsheetId, clientId) {
  const meta = await gsheetsFetch(`/v4/spreadsheets/${spreadsheetId}`, 'GET', null, clientId);
  const base = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
  const sheets = (meta && meta.sheets) || [];
  const findGid = title => {
    const t = sheets.find(s => s.properties && s.properties.title === title);
    return t && t.properties && t.properties.sheetId ? String(t.properties.sheetId) : null;
  };
  return { base, timings: findGid('Timings') ? `${base}/edit#gid=${findGid('Timings')}` : base };
}

export default {
  getTimings,
  appendTiming,
  updateTiming,
  deleteTiming,
  getIssues,
  saveIssues,
  getSheetLinks,
  appendNote,
  createSpreadsheetIfMissing,
};

export async function createSpreadsheetIfMissing(spreadsheetId, clientId) {
  if (spreadsheetId) return spreadsheetId;
  const title = (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_TITLE) || 'Time Allocated to Issue';
  const resource = { properties: { title }, sheets: [{ properties: { title: 'Timings' } }, { properties: { title: 'Issues' } }, { properties: { title: 'Notes' } }] };
  const j = await gsheetsFetch('/v4/spreadsheets', 'POST', resource, clientId);
  const id = j && j.spreadsheetId ? j.spreadsheetId : null;
  if (id) {
    await gsheetsFetch(`/v4/spreadsheets/${id}/values/Timings!A1:C1?valueInputOption=RAW`, 'PUT', { values: [['issue number', 'start date', 'duration']] }, clientId).catch(() => { });
    await gsheetsFetch(`/v4/spreadsheets/${id}/values/Issues!A1:C1?valueInputOption=RAW`, 'PUT', { values: [['issue number', 'title', 'url']] }, clientId).catch(() => { });
    await gsheetsFetch(`/v4/spreadsheets/${id}/values/Notes!A1:B1?valueInputOption=RAW`, 'PUT', { values: [['timestamp', 'note']] }, clientId).catch(() => { });
  }
  return id;
}

export async function appendNote(spreadsheetId, note, clientId) {
  if (!spreadsheetId) throw new Error('Spreadsheet ID required');
  const path = `/v4/spreadsheets/${spreadsheetId}/values/Notes!A2:append?valueInputOption=USER_ENTERED`;
  const ts = new Date().toISOString();
  const row = [ts, note || ''];
  await gsheetsFetch(path, 'POST', { values: [row] }, clientId);
  return { timestamp: ts, note };
}
