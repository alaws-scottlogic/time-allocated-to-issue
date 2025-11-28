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

export default function Timings({ repoUrl, ghToken, setGhToken, owner }) {
  const [timings, setTimings] = useState([]);
  const [persistToken, setPersistToken] = useState(false);
  const [filter, setFilter] = useState({ status: 'all' });
  // selectedIssue controls the listing filter; default to 'all'
  const [selectedIssue, setSelectedIssue] = useState('all');
  // issue titles are stored on each timing as `issueTitle`
  const [issueLabels, setIssueLabels] = useState({}); // map issue -> title (for selector)
  const [dateFilter, setDateFilter] = useState({ field: 'start', from: '', to: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ issue: '', description: '', start: '', end: '', owner: owner || '' });
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
    let chosenOwner = owner;
    try { const savedOwner = localStorage.getItem('selected_owner'); if ((!chosenOwner || chosenOwner === '') && savedOwner) chosenOwner = savedOwner; } catch (e) {}
    const payload = { issue: issueValue || null, description: form.description || '', start: localInputToIso(form.start), end: form.end ? localInputToIso(form.end) : null, repoUrl: repoUrl || null, owner: chosenOwner || 'mine' };
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
    const initialOwner = t.owner || owner || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_owner') : '') || '';
    setForm({ issue: t.issue || '', description: t.description || '', start: isoToLocalInput(t.start), end: t.end ? isoToLocalInput(t.end) : '', owner: initialOwner });
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
        // prefer owner from the edited values, then prop, then persisted selection
        let chosenOwner2 = newValues.owner || owner;
        try { const savedOwner2 = localStorage.getItem('selected_owner'); if ((!chosenOwner2 || chosenOwner2 === '') && savedOwner2) chosenOwner2 = savedOwner2; } catch (e) {}
        const payload = { issue: newValues.issue || null, description: newValues.description || '', start: localInputToIso(newValues.start), end: newValues.end ? localInputToIso(newValues.end) : null, repoUrl: repoUrl || null, owner: chosenOwner2 || 'mine' };
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
    setFilter({ status: 'all' });
    setDateFilter({ field: 'start', from: '', to: '' });
  }

  const filteredTimings = indexedTimings.filter(t => {
    if (selectedIssue && selectedIssue !== 'all') {
      if (String(t.issue) !== String(selectedIssue)) return false;
    }
    if (filter.status === 'open') return !t.end;
    if (filter.status === 'closed') return !!t.end;
    // date range filter (applies to chosen field: start or end)
    const field = dateFilter.field || 'start';
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
    <div style={{ padding: 24, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Timings</h2>
      </div>

      <section style={{ marginBottom: 18 }}>
        <style>{`
          @media (max-width:640px) {
            .timings-add-form { grid-template-columns: 1fr; }
            .timings-add-form input, .timings-add-form div { width: 100%; }
          }
        `}</style>
        <form onSubmit={handleAdd} className="timings-add-form" style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr minmax(160px, 1fr) minmax(160px, 1fr) auto', alignItems: 'center' }}>
          <input style={{ width: '100%', boxSizing: 'border-box' }} placeholder="Issue ID" value={form.issue} onChange={e => setForm({ ...form, issue: e.target.value })} />
          <input style={{ width: '100%', boxSizing: 'border-box' }} type="datetime-local" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} />
          <input style={{ width: '100%', boxSizing: 'border-box' }} type="datetime-local" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={{ padding: '8px 10px' }}>{editingRow != null ? 'Save' : 'Add'}</button>
            {editingRow != null && <button type="button" onClick={() => { setEditingRow(null); resetForm(); }}>Cancel</button>}
          </div>
        </form>
        {error && <div role="alert" style={{ color: '#8b0000', marginTop: 8 }}>{error}</div>}
      </section>

      <section>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <div style={{ fontWeight: 600 }}>Filters:</div>
          <select aria-label="Issue selector" value={selectedIssue} onChange={e => setSelectedIssue(e.target.value)} style={{ padding: '6px 8px', minWidth: 240 }}>
            <option value="all">All issues</option>
            {uniqueIssues.map(i => {
              const label = issueLabels[i];
              const numeric = String(i).replace(/[^0-9]/g, '');
              const text = label && numeric ? `#${numeric}: ${label}` : i + (label ? ` - ${label}` : '');
              return <option key={i} value={i}>{text}</option>;
            })}
          </select>
          <select aria-label="Status filter" value={filter.status} onChange={e => setFilter(prev => ({ ...prev, status: e.target.value }))} style={{ padding: '6px 8px' }}>
            <option value="all">All</option>
            <option value="open">Open (no end)</option>
            <option value="closed">Closed</option>
          </select>
          <select aria-label="Date field to filter" value={dateFilter.field} onChange={e => setDateFilter(prev => ({ ...prev, field: e.target.value }))} style={{ padding: '6px 8px' }}>
            <option value="start">Start</option>
            <option value="end">End</option>
          </select>
          <input aria-label="From date" title="From date" type="datetime-local" value={dateFilter.from} onChange={e => setDateFilter(prev => ({ ...prev, from: e.target.value }))} style={{ padding: '6px 8px' }} />
          <input aria-label="To date" title="To date" type="datetime-local" value={dateFilter.to} onChange={e => setDateFilter(prev => ({ ...prev, to: e.target.value }))} style={{ padding: '6px 8px' }} />
          <button type="button" onClick={clearFilters} style={{ padding: '6px 8px' }}>Clear filters</button>
        </div>
          {loading ? <div>Loading…</div> : (
          <div style={{ border: '1px solid #e6e6e6', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto', width: '100%' }}>
            <style>{`
              /* Responsive stacked table for small screens */
              @media (max-width: 640px) {
                .timings-table thead { display: none; }
                .timings-table, .timings-table tbody, .timings-table tr, .timings-table td { display: block; width: 100%; }
                .timings-table tr { margin-bottom: 12px; border: 1px solid #eee; border-radius: 6px; padding: 8px; }
                .timings-table td { box-sizing: border-box; padding: 8px 12px; white-space: normal; text-overflow: clip; }
                .timings-table td[data-label]::before { content: attr(data-label) ": "; font-weight: 600; display: inline-block; width: 110px; }
                .timings-table td.actions { display: flex; gap: 8px; }
                .timings-actions { display: flex; gap: 8px; align-items: center; }
                .timings-actions button { flex: none; padding: 4px 8px; font-size: 12px; max-width: 96px; white-space: nowrap; }
                @media (max-width: 420px) {
                  .timings-actions { flex-direction: column; }
                  .timings-actions button { width: 100%; max-width: none; }
                }
              }
            `}</style>
            <table className="timings-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 1300 }}>
              <thead style={{ background: '#fafafa' }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, width: '44%' }}>Issue</th>
                  <th style={{ textAlign: 'left', padding: 8, width: '6%' }}>Owner</th>
                  <th style={{ textAlign: 'left', padding: 8, width: '18%' }}>Start</th>
                  <th style={{ textAlign: 'left', padding: 8, width: '18%' }}>End</th>
                  <th style={{ textAlign: 'left', padding: 8, width: '8%' }}>Duration</th>
                  <th style={{ padding: 8, width: '6%' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredTimings.map((t) => {
                  const idx = t.__idx;
                  return (
                  <tr key={t.id || idx} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td data-label="Issue" style={{ padding: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {editingRow === idx ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <input style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 6, border: '1px solid #e8e8e8' }} value={form.issue} onChange={e => { const nv = { ...form, issue: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} />
                          </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ fontWeight: 600 }}>{
                            (() => {
                              const title = t.issueTitle;
                              const numeric = String(t.issue).replace(/[^0-9]/g, '');
                              if (title && numeric) return `Issue #${numeric}: ${title}`;
                              if (title) return title;
                              return t.issue;
                            })()
                          }</div>
                        </div>
                      )}
                    </td>
                    <td data-label="Owner" style={{ padding: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {editingRow === idx ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <select value={form.owner} onChange={e => { const nv = { ...form, owner: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e8e8e8', background: '#fff' }}>
                            <option value="mine">Mine</option>
                            <option value="partner">Partner</option>
                          </select>
                        </div>
                      ) : (
                        <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <span style={{ display: 'inline-block', fontSize: 12, padding: '4px 10px', borderRadius: 999, background: (t.owner === 'partner' ? '#fff7ef' : '#f3fbff'), color: (t.owner === 'partner' ? '#8a4b00' : '#055a9a'), fontWeight: 600, border: (t.owner === 'partner' ? '1px solid #ffe8cf' : '1px solid #dff0ff') }}>{t.owner === 'partner' ? "Partner" : "Mine"}</span>
                        </div>
                      )}
                    </td>
                    <td data-label="Start" style={{ padding: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {editingRow === idx ? (
                        <input style={{ width: '100%', boxSizing: 'border-box' }} type="datetime-local" value={form.start} onChange={e => { const nv = { ...form, start: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} />
                      ) : new Date(t.start).toLocaleString()}
                    </td>
                    <td data-label="End" style={{ padding: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {editingRow === idx ? (
                        <input style={{ width: '100%', boxSizing: 'border-box' }} type="datetime-local" value={form.end} onChange={e => { const nv = { ...form, end: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} />
                      ) : (t.end ? new Date(t.end).toLocaleString() : '—')}
                    </td>
                    <td data-label="Duration" style={{ padding: 8 }}>{formatDuration(t.start, t.end)} {savingStatus[t.id ?? idx] === 'saving' ? ' (saving...)' : savingStatus[t.id ?? idx] === 'saved' ? ' (saved)' : ''}</td>
                    <td data-label="Actions" className="actions" style={{ padding: 8 }}>
                      {editingRow === idx ? (
                        <button aria-label="Done" title="Done" style={{ padding: '6px 8px', fontSize: 12, lineHeight: '1', borderRadius: 6 }} onClick={() => { setEditingRow(null); resetForm(); }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                            <path d="M20 6L9 17l-5-5" stroke="#0b66a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      ) : (
                        <div className="timings-actions" style={{ display: 'flex', gap: 6 }}>
                          <button aria-label="Edit" title="Edit" style={{ padding: '6px', fontSize: 12, lineHeight: '1', borderRadius: 6, minWidth: 0 }} onClick={() => beginEdit(t, idx)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" fill="#055a9a"/>
                              <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="#055a9a"/>
                            </svg>
                          </button>
                          <button aria-label="Delete" title="Delete" style={{ padding: '6px', fontSize: 12, lineHeight: '1', borderRadius: 6, minWidth: 0 }} onClick={() => handleDelete(t.id)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                              <path d="M9 3v1H4v2h16V4h-5V3H9z" fill="#055a9a" />
                              <path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" stroke="#055a9a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                              <path d="M10 11v6M14 11v6" stroke="#055a9a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
