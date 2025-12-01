import React, { useEffect, useState, useRef } from 'react'

function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const tzOffset = d.getTimezoneOffset() * 60000;
  const local = new Date(d.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value) {
  if (!value) return null;
  // value is like '2025-11-27T09:30'
  // Convert local datetime-local value back to an ISO string (account for local tz)
  const d = new Date(value);
  const tzOffset = d.getTimezoneOffset() * 60000;
  const utc = new Date(d.getTime() + tzOffset);
  return utc.toISOString();
}

export default function Timings({ repoUrl, ghToken, setGhToken }) {
  const [timings, setTimings] = useState([]);
  const [persistToken, setPersistToken] = useState(false);
  // selectedIssue controls the listing filter; default to 'all'
  const [selectedIssue, setSelectedIssue] = useState('all');
  // issue titles are stored on each timing as `issueTitle`
  const [issueLabels, setIssueLabels] = useState({}); // map issue -> title (for selector)
  const [dateFilter, setDateFilter] = useState({ from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ issue: '', description: '', start: '', end: '' });
  const [editingRow, setEditingRow] = useState(null); // index of the row being edited
  const [savingStatus, setSavingStatus] = useState({});
  const saveTimers = useRef({});

  async function load() {
    setLoading(true);
    try {
      const headers = {};
      if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
      const res = await fetch('/api/timings', { headers });
      if (!res.ok) throw new Error('Load failed');
      const data = await res.json();
      setTimings(data);
    } catch (err) {
      console.error(err);
      setError('Could not load timings');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  // load selected issue and other label from localStorage so add form can default
  useEffect(() => {
    try {
      const sel = localStorage.getItem('selected_issue');
      const otherLabel = localStorage.getItem('other_issue_label') || 'Other';
      const otherLabel2 = localStorage.getItem('other_issue_label_2') || 'Other (custom)';
      // Use saved selection only to prefill the add form; do not apply as active list filter
      if (sel && sel !== 'all' && sel !== 'other') {
        setForm(prev => ({ ...prev, issue: sel }));
      }
      if (sel === 'other') {
        setForm(prev => ({ ...prev, issue: otherLabel }));
      }
      if (sel === 'other2') {
        setForm(prev => ({ ...prev, issue: otherLabel2 }));
      }
    } catch (err) {
      // ignore
    }
  }, []);

  // Load persisted GitHub token (if any)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('github_token');
      const savedPersist = localStorage.getItem('github_token_persist');
      if (saved && !ghToken) setGhToken(saved);
      if (savedPersist === '1') setPersistToken(true);
    } catch (err) {
      // ignore localStorage failures
    }
  }, []);

  // Persist token when user chooses
  useEffect(() => {
    try {
      if (persistToken) {
        if (ghToken) localStorage.setItem('github_token', ghToken);
        localStorage.setItem('github_token_persist', '1');
      } else {
        localStorage.removeItem('github_token');
        localStorage.removeItem('github_token_persist');
      }
    } catch (err) {
      // ignore
    }
  }, [persistToken, ghToken]);

  function resetForm() {
    setForm({ issue: '', description: '', start: '', end: '' });
    setError('');
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    if (!form.start) { setError('Start is required'); return; }
    // If no issue typed, try to use the selected issue stored in localStorage
    let issueValue = form.issue;
    try {
      const sel = localStorage.getItem('selected_issue');
      const otherLabel = localStorage.getItem('other_issue_label') || 'Other';
      const otherLabel2 = localStorage.getItem('other_issue_label_2') || 'Other (custom)';
      if ((!issueValue || String(issueValue).trim() === '') && sel && sel !== 'all') {
        issueValue = sel === 'other' ? otherLabel : sel === 'other2' ? otherLabel2 : sel;
      }
    } catch (err) {
      // ignore
    }
    const payload = { issue: issueValue || null, description: form.description || '', start: localInputToIso(form.start), end: form.end ? localInputToIso(form.end) : null, repoUrl: repoUrl || null };
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
      const res = await fetch('/api/timings', { method: 'POST', headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j && j.errors && j.errors.join(', ')) || 'Save failed');
        return;
      }
      const created = await res.json();
      setTimings(prev => prev.concat(created));
      resetForm();
    } catch (err) {
      console.error(err);
      setError('Save failed');
    }
  }

  function beginEdit(t, idx) {
    setEditingRow(idx);
    setForm({ issue: t.issue || '', description: t.description || '', start: isoToLocalInput(t.start), end: t.end ? isoToLocalInput(t.end) : '' });
    setError('');
    const rowKey = t.id ?? idx;
    setSavingStatus(prev => {
      const copy = { ...prev };
      delete copy[rowKey];
      return copy;
    });
  }

  function scheduleSave(rowKey, rowIndex, newValues, serverId) {
    // clear existing timer
    if (saveTimers.current[rowKey]) clearTimeout(saveTimers.current[rowKey]);
    setSavingStatus(prev => ({ ...prev, [rowKey]: 'saving' }));
    saveTimers.current[rowKey] = setTimeout(async () => {
      try {
        const payload = { issue: newValues.issue || null, description: newValues.description || '', start: localInputToIso(newValues.start), end: newValues.end ? localInputToIso(newValues.end) : null, repoUrl: repoUrl || null };
        if (serverId) {
          const headers = { 'Content-Type': 'application/json' };
          if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
          const res = await fetch(`/api/timings/${serverId}`, { method: 'PUT', headers, body: JSON.stringify(payload) });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            setSavingStatus(prev => ({ ...prev, [rowKey]: 'error' }));
            setError((j && j.errors && j.errors.join(', ')) || 'Auto-save failed');
            return;
          }
          const updated = await res.json();
          setTimings(prev => prev.map(p => p.id === updated.id ? updated : p));
        } else {
          // create new timing (no server id yet)
          const headers = { 'Content-Type': 'application/json' };
          if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
          const res = await fetch(`/api/timings`, { method: 'POST', headers, body: JSON.stringify(payload) });
          if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            setSavingStatus(prev => ({ ...prev, [rowKey]: 'error' }));
            setError((j && j.errors && j.errors.join(', ')) || 'Auto-save failed');
            return;
          }
          const created = await res.json();
          setTimings(prev => {
            const copy = prev.slice();
            copy[rowIndex] = created;
            return copy;
          });
        }
        setSavingStatus(prev => ({ ...prev, [rowKey]: 'saved' }));
        setTimeout(() => setSavingStatus(prev => {
          const copy = { ...prev };
          delete copy[rowKey];
          return copy;
        }), 1200);
      } catch (err) {
        console.error(err);
        setSavingStatus(prev => ({ ...prev, [rowKey]: 'error' }));
        setError('Auto-save failed');
      }
    }, 800);
  }

  async function handleDelete(id) {
    if (!confirm('Delete this timing?')) return;
    try {
      const headers = {};
      if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
      const res = await fetch(`/api/timings/${id}`, { method: 'DELETE', headers });
      if (!res.ok) throw new Error('Delete failed');
      setTimings(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error(err);
      setError('Delete failed');
    }
  }

  // We keep an indexed version so editing by row index still works when list is filtered
  const indexedTimings = timings.map((t, i) => ({ ...t, __idx: i }));

  function clearFilters() {
    setSelectedIssue('all');
    setDateFilter({ from: '', to: '' });
  }

  const filteredTimings = indexedTimings.filter(t => {
    if (selectedIssue && selectedIssue !== 'all') {
      if (String(t.issue) !== String(selectedIssue)) return false;
    }
    // no status filter (open/closed) — removed per UI update
    // date range filter (applies to start)
    const field = 'start';
    const fromIso = dateFilter.from ? localInputToIso(dateFilter.from) : null;
    const toIso = dateFilter.to ? localInputToIso(dateFilter.to) : null;
    const val = t[field];
    if (fromIso) {
      if (!val || Date.parse(val) < Date.parse(fromIso)) return false;
    }
    if (toIso) {
      if (!val || Date.parse(val) > Date.parse(toIso)) return false;
    }
    return true;
  });

  // derive unique issues present in timings (ignore null/empty)
  const uniqueIssues = Array.from(new Set(timings.map(t => t.issue).filter(x => x !== null && x !== undefined && x !== ''))).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });

  // Fetch issue titles per unique issue (using the first timing's repoUrl for that issue)
  // Issue titles are now stored on the timing entries as `issueTitle` by the server.
  // No per-issue client fetches are required; we will read `t.issueTitle` where available.

  // Build a simple mapping issue -> title (for selector labels) from fetched titles using the first repoUrl for each issue
  useEffect(() => {
    const labels = {};
    uniqueIssues.forEach(issue => {
      const t = timings.find(x => String(x.issue) === String(issue));
      labels[issue] = t && t.issueTitle ? t.issueTitle : '';
    });
    setIssueLabels(labels);
  }, [uniqueIssues, timings]);


  function formatDuration(start, end) {
    try {
      const s = Date.parse(start);
      const e = end ? Date.parse(end) : Date.now();
      if (Number.isNaN(s) || Number.isNaN(e) || e < s) return '—';
      const sec = Math.floor((e - s) / 1000);
      const h = Math.floor(sec / 3600).toString();
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s2 = (sec % 60).toString().padStart(2, '0');
      return `${h}:${m}:${s2}`;
    } catch (err) {
      return '—';
    }
  }

  return (
    <div className="timings-container" style={{ padding: 24, boxSizing: 'border-box' }}>
      <style>{`
        .timings-container { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; color: #0b2540; }
        .timings-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px }
        .timings-header h2 { margin:0; font-size:20px }

        .timings-add-form { display:grid; gap:8px; grid-template-columns: 1fr 1fr 1fr auto; align-items:center; margin-bottom:12px }
        .timings-add-form .input, .timings-add-form select { width:100%; padding:10px 12px; border-radius:6px; border:1px solid #e6e6e6; box-sizing:border-box }
        /* general input style for filters and other controls */
        .input { padding:10px 12px; border-radius:6px; border:1px solid #e6e6e6; box-sizing:border-box; background:#fff }
        .timings-add-form .input::placeholder { color:#9aa7b2 }
        .timings-add-form .btn { padding:10px 12px; border-radius:6px; border:1px solid transparent; cursor:pointer }
        /* general button style for consistency across the panel */
        .btn { padding:10px 12px; border-radius:6px; border:1px solid transparent; cursor:pointer; font-size:14px }
        .btn-primary { background:#055a9a; color:#fff }
        .btn-outline { background:#fff; border:1px solid #d0dbe6; color:#055a9a }

        .filters { display:flex; gap:8px; align-items:center; margin:12px 0 16px }
        .filters .label { font-weight:600 }

        .timings-panel { border:1px solid #e6eef6; border-radius:8px; overflow:hidden }
        .timings-table { width:100%; border-collapse:collapse; table-layout:fixed }
        .timings-table thead { background:#f8fbff }
        .timings-table th, .timings-table td { text-align:left; padding:12px; vertical-align:middle; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
        .timings-table tbody tr:nth-child(odd) { background: #fff }
        .timings-table tbody tr:hover { background: #f6fbff }
        .issue-title { font-weight:600; color:#053a66 }
        

        @media (max-width:800px) {
          .timings-add-form { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width:640px) {
          .timings-add-form { grid-template-columns: 1fr; }
          .timings-table thead { display:none }
          .timings-table, .timings-table tbody, .timings-table tr, .timings-table td { display:block; width:100% }
          .timings-table tr { margin-bottom:12px; border:1px solid #eef3f8; border-radius:6px; padding:8px }
          .timings-table td { box-sizing:border-box; padding:8px 12px; white-space:normal }
          .timings-table td[data-label]::before { content: attr(data-label) ": "; font-weight:600; display:inline-block; width:110px }
        }
      `}</style>

      <div className="timings-header">
        <h2>Timings</h2>
      </div>

      <section>
        <form onSubmit={handleAdd} className="timings-add-form" aria-label="Add timing">
          <input className="input" placeholder="Issue ID or short title" value={form.issue} onChange={e => setForm({ ...form, issue: e.target.value })} />
          <input className="input" type="datetime-local" aria-label="Start" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
          <input className="input" type="datetime-local" aria-label="End" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary">{editingRow != null ? 'Save' : 'Add'}</button>
            {editingRow != null && <button type="button" className="btn btn-outline" onClick={() => { setEditingRow(null); resetForm(); }}>Cancel</button>}
          </div>
        </form>
        {error && <div role="alert" style={{ color: '#8b0000', marginTop: 8 }}>{error}</div>}
      </section>

      <section>
        <div className="filters">
          <div className="label">Filters:</div>
          <select aria-label="Issue selector" value={selectedIssue} onChange={e => setSelectedIssue(e.target.value)} className="input" style={{ minWidth: 220 }}>
            <option value="all">All issues</option>
            {uniqueIssues.map(i => {
              const label = issueLabels[i];
              const numeric = String(i).replace(/[^0-9]/g, '');
              const text = label && numeric ? `#${numeric}: ${label}` : i + (label ? ` - ${label}` : '');
              return <option key={i} value={i}>{text}</option>;
            })}
          </select>
          {/* status filter removed */}
          {/* date field selector removed; filtering applies to Start */}
          <input aria-label="From date" title="From date" type="datetime-local" value={dateFilter.from} onChange={e => setDateFilter(prev => ({ ...prev, from: e.target.value }))} className="input" />
          <input aria-label="To date" title="To date" type="datetime-local" value={dateFilter.to} onChange={e => setDateFilter(prev => ({ ...prev, to: e.target.value }))} className="input" />
          <button type="button" onClick={clearFilters} className="btn btn-primary">Clear filters</button>
        </div>
        {loading ? <div>Loading…</div> : (
          <div className="timings-panel">
            <div style={{ overflowX: 'auto', width: '100%' }}>
              <table className="timings-table">
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Issue</th>
                    <th style={{ width: '18%' }}>Start</th>
                    <th style={{ width: '18%' }}>End</th>
                    <th style={{ width: '8%' }}>Duration</th>
                    <th style={{ width: '6%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTimings.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: 18 }}>No timings found for the selected filters.</td></tr>
                  )}
                  {filteredTimings.map((t) => {
                    const idx = t.__idx;
                    return (
                      <tr key={t.id || idx} style={{ borderTop: '1px solid #f0f6fb' }}>
                        <td data-label="Issue">
                          {editingRow === idx ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <input className="input" value={form.issue} onChange={e => { const nv = { ...form, issue: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} />
                            </div>
                          ) : (
                            <div>
                              <div className="issue-title">{
                                (() => {
                                  const title = t.issueTitle;
                                  const numeric = String(t.issue).replace(/[^0-9]/g, '');
                                  if (title && numeric) return `Issue #${numeric}: ${title}`;
                                  if (title) return title;
                                  return t.issue;
                                })()
                              }</div>
                              {t.description && <div style={{ color: '#6b7c88', marginTop: 6, fontSize: 13 }}>{t.description}</div>}
                            </div>
                          )}
                        </td>
                        <td data-label="Start">{editingRow === idx ? (
                          <input className="input" type="datetime-local" value={form.start} onChange={e => { const nv = { ...form, start: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} />
                        ) : new Date(t.start).toLocaleString()}</td>
                        <td data-label="End">{editingRow === idx ? (
                          <input className="input" type="datetime-local" value={form.end} onChange={e => { const nv = { ...form, end: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} />
                        ) : (t.end ? new Date(t.end).toLocaleString() : '—')}</td>
                        <td data-label="Duration">{formatDuration(t.start, t.end)} {savingStatus[t.id ?? idx] === 'saving' ? ' (saving...)' : savingStatus[t.id ?? idx] === 'saved' ? ' (saved)' : ''}</td>
                        <td data-label="Actions">
                          {editingRow === idx ? (
                            <button aria-label="Done" title="Done" className="btn btn-primary" onClick={() => { setEditingRow(null); resetForm(); }}>
                              Done
                            </button>
                          ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button aria-label="Edit" title="Edit" className="btn btn-outline" onClick={() => beginEdit(t, idx)}>Edit</button>
                              <button aria-label="Delete" title="Delete" className="btn btn-outline" onClick={() => handleDelete(t.id)}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
