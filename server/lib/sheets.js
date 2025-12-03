const { google } = require('googleapis');
const fs = require('fs');

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
const TIMINGS_SHEET = process.env.GOOGLE_SHEETS_TIMINGS_SHEET || 'Timings';
const EOD_SHEET = process.env.GOOGLE_SHEETS_EOD_SHEET || 'EOD';

function getJwtClient() {
  let creds = null;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (keyPath && fs.existsSync(keyPath)) {
    creds = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } else if (keyJson) {
    creds = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson;
  } else {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_KEY_JSON or GOOGLE_SERVICE_ACCOUNT_KEY_PATH env');
  }
  const jwt = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return jwt;
}

async function getSheets() {
  if (!SPREADSHEET_ID) throw new Error('Missing GOOGLE_SHEETS_SPREADSHEET_ID env');
  const auth = getJwtClient();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function ensureHeaders() {
  const sheets = await getSheets();
  // Timings sheet: do not store an explicit id column; use the sheet row number as the id.
  const timingsHeader = ['issue number', 'start date', 'end date', 'duration'];
  try {
    const t = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TIMINGS_SHEET}!A1:D1` });
    const existing = (t.data.values && t.data.values[0]) || [];
    const same = existing.length === timingsHeader.length && existing.every((v, i) => v === timingsHeader[i]);
    if (!same) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TIMINGS_SHEET}!A1:D1`,
        valueInputOption: 'RAW',
        requestBody: { values: [timingsHeader] },
      });
    }
  } catch (err) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TIMINGS_SHEET}!A1:D1`,
      valueInputOption: 'RAW',
      requestBody: { values: [timingsHeader] },
    });
  }
  // Ensure EOD headers exist if previously used
  // Create EOD headers now using the standard category set so headings exist on startup
  try {
    const categories = ['Coding', 'Debugging', 'Interacting with a tool', 'Reviewing code', 'Other'];
    await ensureEodHeaders(categories);
  } catch (err) {
    // ignore errors here; appendEodTable will ensure headers when writing
  }
}

async function getTimings() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TIMINGS_SHEET}!A2:D` });
  const rows = res.data.values || [];
  // id is the sheet row number (starting at 2 for first data row)
  return rows.map((r, i) => ({
    id: i + 2,
    issue: r[0] || null,
    start: r[1] || null,
    end: r[2] || null,
    duration: r[3] != null && r[3] !== '' ? Number(r[3]) : null,
  }));
}

async function appendTiming(entry) {
  const sheets = await getSheets();
  // compute duration in seconds if end is present
  const duration = entry.end ? Math.round((Date.parse(entry.end) - Date.parse(entry.start)) / 1000) : '';
  const row = [
    entry.issue || '',
    entry.start || '',
    entry.end || '',
    duration,
  ];
  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TIMINGS_SHEET}!A2`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  // Try to derive the appended row number from the API response (updates.updatedRange like 'Timings!A5:D5')
  let newRowNumber = null;
  try {
    const ur = resp && resp.data && (resp.data.updates && resp.data.updates.updatedRange);
    if (ur) {
      const m = /!(?:[A-Z]+)(\d+):/.exec(ur);
      if (m && m[1]) newRowNumber = Number(m[1]);
      else {
        // alternative parse: Timings!A5:D5
        const m2 = /!(?:[A-Z]+)(\d+):[A-Z]+(\d+)/.exec(ur);
        if (m2 && m2[2]) newRowNumber = Number(m2[2]);
      }
    }
  } catch (e) { /* ignore */ }
  return { id: newRowNumber, issue: entry.issue || null, start: entry.start || null, end: entry.end || null, duration: duration === '' ? null : Number(duration) };
}

async function findRowById(sheetName, id) {
  // If id is numeric, treat it as sheet row number
  const sheets = await getSheets();
  const rowNum = Number(id);
  if (!Number.isFinite(rowNum) || rowNum < 2) return null;
  const range = `${sheetName}!A${rowNum}:D${rowNum}`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const values = (res.data.values && res.data.values[0]) || [];
  return { rowNumber: rowNum, values };
}

async function updateTiming(id, updates) {
  const sheets = await getSheets();
  const found = await findRowById(TIMINGS_SHEET, id);
  if (!found) return null;
  // existing values map to columns: issue, start, end, duration
  const current = {
    issue: found.values[0] || '',
    start: found.values[1] || '',
    end: found.values[2] || '',
    duration: found.values[3] != null && found.values[3] !== '' ? Number(found.values[3]) : null,
  };
  // Only allow updating the known columns (issue, start, end)
  const next = {
    issue: updates.issue != null ? updates.issue : current.issue,
    start: updates.start != null ? updates.start : current.start,
    end: updates.end != null ? updates.end : current.end,
  };
  // recompute duration if we have both start and end
  const duration = next.end ? Math.round((Date.parse(next.end) - Date.parse(next.start)) / 1000) : '';
  const row = [next.issue || '', next.start || '', next.end || '', duration];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TIMINGS_SHEET}!A${found.rowNumber}:D${found.rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
  return { id: found.rowNumber, issue: next.issue, start: next.start, end: next.end, duration: duration === '' ? null : Number(duration) };
}

async function deleteTiming(id) {
  const sheets = await getSheets();
  const found = await findRowById(TIMINGS_SHEET, id);
  if (!found) return null;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TIMINGS_SHEET}!A${found.rowNumber}:D${found.rowNumber}`,
  });
  return { id };
}

async function getEod() {
  const sheets = await getSheets();
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${EOD_SHEET}!A1:Z1` });
  const headers = (headerRes.data.values && headerRes.data.values[0]) || [];
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${EOD_SHEET}!A2:Z` });
  const rows = res.data.values || [];
  // Return as objects keyed by headers
  return rows.map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] != null ? r[i] : ''; });
    return obj;
  });
}

async function ensureEodHeaders(categories) {
  const sheets = await getSheets();
  const baseHeaders = ['date'];
  const headerRow = baseHeaders.concat(categories);
  try {
    const current = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${EOD_SHEET}!A1:Z1` });
    const existing = (current.data.values && current.data.values[0]) || [];
    const same = existing.length === headerRow.length && existing.every((v, i) => v === headerRow[i]);
    if (!same) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${EOD_SHEET}!A1:${String.fromCharCode(65 + headerRow.length - 1)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headerRow] },
      });
    }
  } catch (err) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${EOD_SHEET}!A1:${String.fromCharCode(65 + headerRow.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headerRow] },
    });
  }
}

async function appendEodTable(date, tasks, categories) {
  await ensureEodHeaders(categories);
  const sheets = await getSheets();
  const keyMap = {
    'Coding': 'coding',
    'Debugging': 'debugging',
    'Interacting with a tool': 'tool-interacting',
    'Reviewing code': 'code-reviewing',
    'Other': 'other',
  };
  const row = [date].concat(categories.map(cat => {
    const key = keyMap[cat] || cat.toLowerCase().replace(/\s+/g, '-');
    const val = tasks[key];
    return val != null && val !== '' ? Number(val) : '';
  }));
  // Check if a row for this date already exists in column A (dates start at A2)
  try {
    const existingDatesRes = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${EOD_SHEET}!A2:A` });
    const existing = existingDatesRes.data.values || [];
    // Look for an exact match of the date string in column A
    const matchIndex = existing.findIndex(r => (r && r[0]) === date);
    if (matchIndex !== -1) {
      // matched row index relative to A2 -> sheet row number is matchIndex + 2
      const sheetRow = matchIndex + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${EOD_SHEET}!A${sheetRow}:${String.fromCharCode(65 + row.length - 1)}${sheetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [row] },
      });
      return { date, ...tasks };
    }
  } catch (err) {
    // if anything goes wrong reading existing rows, fall back to append
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${EOD_SHEET}!A2`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
  return { date, ...tasks };
}

module.exports = {
  ensureHeaders,
  getTimings,
  appendTiming,
  updateTiming,
  deleteTiming,
  getEod,
  appendEodTable,
  ensureEodHeaders,
};

// Utility to resolve deep links to sheet tabs by title
module.exports.getSheetLinks = async function getSheetLinks() {
  const sheetsApi = await getSheets();
  const base = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`;
  try {
    const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const tabs = (meta && meta.data && meta.data.sheets) || [];
    const findGid = (title) => {
      const t = tabs.find(s => s.properties && s.properties.title === title);
      return t && t.properties && typeof t.properties.sheetId === 'number' ? String(t.properties.sheetId) : null;
    };
    const timingsGid = findGid(TIMINGS_SHEET);
    const eodGid = findGid(EOD_SHEET);
    return {
      base,
      timings: timingsGid ? `${base}/edit#gid=${timingsGid}` : base,
      eod: eodGid ? `${base}/edit#gid=${eodGid}` : base,
    };
  } catch (err) {
    return { base, timings: base, eod: base };
  }
};
