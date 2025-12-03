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

function formatDateForSheets(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const YYYY = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

function parseSheetsDateToIso(val) {
  if (!val && val !== 0) return null;
  // If already an ISO parseable string, return its ISO form
  const parsed = Date.parse(val);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  // Try to parse common 'YYYY-MM-DD HH:MM:SS' (treat as UTC)
  const m = /^\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s*$/.exec(String(val));
  if (m) {
    const iso = `${m[1]}T${m[2]}Z`;
    const p = Date.parse(iso);
    if (!Number.isNaN(p)) return new Date(p).toISOString();
  }
  return null;
}

async function setTimingsColumnFormats(sheetsApi) {
  try {
    const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const tabs = (meta && meta.data && meta.data.sheets) || [];
    const timingTab = tabs.find(s => s.properties && s.properties.title === TIMINGS_SHEET);
    if (!timingTab) return;
    const sheetId = timingTab.properties.sheetId;
    const requests = [
      // Column B (index 1): Date/time
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 1, endColumnIndex: 2 },
          cell: { userEnteredFormat: { numberFormat: { type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm:ss' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
      // Column C (index 2): Number (duration seconds)
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
          cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '0' } } },
          fields: 'userEnteredFormat.numberFormat',
        },
      },
    ];
    await sheetsApi.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
  } catch (err) {
    // non-fatal — formats are a convenience
  }
}

async function ensureHeaders() {
  const sheets = await getSheets();
  // Timings sheet: do not store an explicit id column; use the sheet row number as the id.
  const timingsHeader = ['issue number', 'start date', 'duration'];
  try {
    const t = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TIMINGS_SHEET}!A1:C1` });
    const existing = (t.data.values && t.data.values[0]) || [];
    const same = existing.length === timingsHeader.length && existing.every((v, i) => v === timingsHeader[i]);
    if (!same) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${TIMINGS_SHEET}!A1:C1`,
        valueInputOption: 'RAW',
        requestBody: { values: [timingsHeader] },
      });
    }
  } catch (err) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TIMINGS_SHEET}!A1:C1`,
      valueInputOption: 'RAW',
      requestBody: { values: [timingsHeader] },
    });
  }
  // Ensure column formats for readable dates and numeric durations
  try { await setTimingsColumnFormats(sheets); } catch (e) { /* ignore */ }
  // Ensure EOD headers exist if previously used
  // Create EOD headers now using the standard category set so headings exist on startup
  try {
    const categories = ['Coding', 'Debugging', 'Interacting with a tool', 'Reviewing code'];
    await ensureEodHeaders(categories);
  } catch (err) {
    // ignore errors here; appendEodTable will ensure headers when writing
  }
}

async function getTimings() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TIMINGS_SHEET}!A2:C` });
  const rows = res.data.values || [];
  // id is the sheet row number (starting at 2 for first data row)
  return rows.map((r, i) => ({
    id: i + 2,
    issue: r[0] || null,
    start: parseSheetsDateToIso(r[1]) || null,
    duration: r[2] != null && r[2] !== '' ? Number(r[2]) : null,
  }));
}

async function appendTiming(entry) {
  const sheets = await getSheets();
  // Accept either an explicit duration (seconds) or compute from an end timestamp for compatibility
  const duration = entry.duration != null && entry.duration !== ''
    ? Number(entry.duration)
    : (entry.end ? Math.round((Date.parse(entry.end) - Date.parse(entry.start)) / 1000) : '');
  const row = [
    entry.issue || '',
    formatDateForSheets(entry.start) || '',
    duration,
  ];
  const resp = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TIMINGS_SHEET}!A2`,
    valueInputOption: 'USER_ENTERED',
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
  return { id: newRowNumber, issue: entry.issue || null, start: entry.start || null, duration: duration === '' ? null : Number(duration) };
}

async function findRowById(sheetName, id) {
  // If id is numeric, treat it as sheet row number
  const sheets = await getSheets();
  const rowNum = Number(id);
  if (!Number.isFinite(rowNum) || rowNum < 2) return null;
  const range = `${sheetName}!A${rowNum}:C${rowNum}`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const values = (res.data.values && res.data.values[0]) || [];
  return { rowNumber: rowNum, values };
}

async function updateTiming(id, updates) {
  const sheets = await getSheets();
  const found = await findRowById(TIMINGS_SHEET, id);
  if (!found) return null;
  // existing values map to columns: issue, start, duration
  const current = {
    issue: found.values[0] || '',
    start: parseSheetsDateToIso(found.values[1]) || '',
    duration: found.values[2] != null && found.values[2] !== '' ? Number(found.values[2]) : null,
  };
  // Only allow updating the known columns (issue, start, duration)
  const next = {
    issue: updates.issue != null ? updates.issue : current.issue,
    start: updates.start != null ? updates.start : current.start,
    duration: updates.duration != null ? updates.duration : current.duration,
  };
  const row = [next.issue || '', formatDateForSheets(next.start) || '', next.duration != null ? next.duration : ''];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TIMINGS_SHEET}!A${found.rowNumber}:C${found.rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] },
  });
  return { id: found.rowNumber, issue: next.issue, start: next.start || null, duration: next.duration == null || next.duration === '' ? null : Number(next.duration) };
}

async function deleteTiming(id) {
  const sheets = await getSheets();
  const found = await findRowById(TIMINGS_SHEET, id);
  if (!found) return null;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TIMINGS_SHEET}!A${found.rowNumber}:C${found.rowNumber}`,
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
