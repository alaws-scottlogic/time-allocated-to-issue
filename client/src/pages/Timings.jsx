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

export default function Timings({ onBack }) {
  const [timings, setTimings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ issue: '', description: '', start: '', end: '' });
  const [editingRow, setEditingRow] = useState(null); // index of the row being edited
  const [savingStatus, setSavingStatus] = useState({});
  const saveTimers = useRef({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/timings');
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

  function resetForm() {
    setForm({ issue: '', description: '', start: '', end: '' });
    setError('');
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    if (!form.start) { setError('Start is required'); return; }
    const payload = { issue: form.issue || null, description: form.description || '', start: localInputToIso(form.start), end: form.end ? localInputToIso(form.end) : null };
    try {
      const res = await fetch('/api/timings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
    setSavingStatus(prev => ({ ...prev, [rowKey]: 'idle' }));
  }

  function scheduleSave(rowKey, rowIndex, newValues, serverId) {
    // clear existing timer
    if (saveTimers.current[rowKey]) clearTimeout(saveTimers.current[rowKey]);
    setSavingStatus(prev => ({ ...prev, [rowKey]: 'saving' }));
    saveTimers.current[rowKey] = setTimeout(async () => {
      try {
        const payload = { issue: newValues.issue || null, description: newValues.description || '', start: localInputToIso(newValues.start), end: newValues.end ? localInputToIso(newValues.end) : null };
        if (serverId) {
          const res = await fetch(`/api/timings/${serverId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
          const res = await fetch(`/api/timings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
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
        setTimeout(() => setSavingStatus(prev => ({ ...prev, [rowKey]: 'idle' })), 1200);
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
      const res = await fetch(`/api/timings/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setTimings(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error(err);
      setError('Delete failed');
    }
  }

  const totalSeconds = timings.reduce((acc, t) => {
    try {
      const s = Date.parse(t.start);
      const e = t.end ? Date.parse(t.end) : Date.now();
      if (!Number.isNaN(s) && !Number.isNaN(e) && e >= s) return acc + Math.floor((e - s) / 1000);
    } catch (err) {}
    return acc;
  }, 0);

  function formatTotal(sec) {
    const h = Math.floor(sec / 3600).toString();
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

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
        <div>
          <button onClick={onBack} style={{ padding: '8px 10px' }}>Back</button>
        </div>
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
            <table className="timings-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 600 }}>
              <thead style={{ background: '#fafafa' }}>
                <tr>
                  <th style={{ textAlign: 'left', padding: 8, width: '10%' }}>Issue</th>
                  <th style={{ textAlign: 'left', padding: 8, width: '30%' }}>Start</th>
                  <th style={{ textAlign: 'left', padding: 8, width: '30%' }}>End</th>
                  <th style={{ textAlign: 'left', padding: 8, width: '18%' }}>Duration</th>
                  <th style={{ padding: 8, width: '12%' }}></th>
                </tr>
              </thead>
              <tbody>
                {timings.map((t, idx) => (
                  <tr key={t.id || idx} style={{ borderTop: '1px solid #f0f0f0' }}>
                    <td data-label="Issue" style={{ padding: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {editingRow === idx ? (
                        <input style={{ width: '100%', boxSizing: 'border-box' }} value={form.issue} onChange={e => { const nv = { ...form, issue: e.target.value }; setForm(nv); const rowKey = t.id ?? idx; scheduleSave(rowKey, idx, nv, t.id); }} />
                      ) : t.issue}
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
                        <button onClick={() => { setEditingRow(null); resetForm(); }}>Done</button>
                      ) : (
                        <div className="timings-actions" style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => beginEdit(t, idx)}>Edit</button>
                          <button onClick={() => handleDelete(t.id)}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
