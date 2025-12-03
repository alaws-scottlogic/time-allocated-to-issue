import React, { useState, useEffect } from "react";

export default function EOD() {
  const [tasks, setTasks] = useState({
    coding: 0,
    debugging: 0,
    "tool-interacting": 0,
    "code-reviewing": 0,
    other: 0,
  });
  const [entryExists, setEntryExists] = useState(false);
  const [editingValues, setEditingValues] = useState({});

  const today = new Date().toISOString().split("T")[0];

  useEffect(() => {
    const fetchEodData = async () => {
      try {
        const res = await fetch(`/api/eod`);
        if (res.ok) {
          const data = await res.json();
          setTasks({
            coding: data.coding || 0,
            debugging: data.debugging || 0,
            "tool-interacting": data["tool-interacting"] || 0,
            "code-reviewing": data["code-reviewing"] || 0,
            other: data.other || 0,
          });
          setEntryExists(true);
        }
      } catch (error) {
        console.error("Failed to fetch EOD data", error);
      }
    };
    fetchEodData();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setTasks((prevTasks) => ({
      ...prevTasks,
      [name]: parseFloat(value),
    }));
  };

  function parseTimeInput(s) {
    if (s == null) return NaN;
    const raw = String(s).trim().toLowerCase();
    if (raw.length === 0) return NaN;
    // 1:15 -> 1 hour 15 minutes
    if (raw.includes(':')) {
      const parts = raw.split(':').map(p => p.trim());
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      return h + (m / 60);
    }
    // 1h 15m, 1 h 15 m
    const hMatch = raw.match(/(\d+(?:\.\d+)?)\s*h/);
    const mMatch = raw.match(/(\d+(?:\.\d+)?)\s*m/);
    if (hMatch) {
      const h = parseFloat(hMatch[1]);
      const m = mMatch ? parseFloat(mMatch[1]) : 0;
      return h + (m / 60);
    }
    if (mMatch && !hMatch) {
      const m = parseFloat(mMatch[1]);
      return m / 60;
    }
    // plain number (1.25)
    const num = parseFloat(raw.replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(num)) return num;
    return NaN;
  }

  function startEdit(name) {
    setEditingValues(prev => ({ ...prev, [name]: formatHours(tasks[name]) }));
  }

  function cancelEdit(name) {
    setEditingValues(prev => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  }

  function finishEdit(name) {
    const val = editingValues[name];
    const parsed = parseTimeInput(val);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(0, Math.min(8, parsed));
      setTasks(prev => ({ ...prev, [name]: clamped }));
    }
    cancelEdit(name);
  }

  function handleEditKey(e, name) {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(name);
      e.target.blur();
    } else if (e.key === 'Escape') {
      cancelEdit(name);
      e.target.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      adjustEditingValue(name, 0.5);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      adjustEditingValue(name, -0.5);
    }
  }

  function handleEditChange(e) {
    const { name, value } = e.target;
    setEditingValues(prev => ({ ...prev, [name]: value }));
  }

  function formatHours(h) {
    if (h == null || Number.isNaN(Number(h))) return '';
    const totalMinutes = Math.round(Number(h) * 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hrs > 0) {
      return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
    }
    return `${mins}m`;
  }

  function adjustEditingValue(name, delta) {
    setEditingValues((prev) => {
      const currentText = prev[name] ?? formatHours(tasks[name]);
      const parsed = parseTimeInput(currentText);
      const base = Number.isNaN(parsed) ? (tasks[name] || 0) : parsed;
      // snap to 0.5 (30-minute) increments
      let next = Math.round((base + delta) * 2) / 2;
      next = Math.max(0, Math.min(8, next));
      // If currently editing this field, update the editing text; otherwise update the tasks value directly
      if (prev[name] != null) {
        return { ...prev, [name]: formatHours(next) };
      }
      setTasks(prevTasks => ({ ...prevTasks, [name]: next }));
      return prev;
    });
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await fetch("/api/eod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today, ...tasks }),
      });
      // Do not show a success message after saving to avoid persistent UI messages
      setEntryExists(true);
    } catch (error) {
      console.error("Failed to save EOD report", error);
      // keep previous behavior: show error in console; no inline message
    }
  };

  const totalHours = Object.values(tasks).reduce((sum, value) => sum + value, 0);

  return (
    <div className="timings-container" style={{ padding: 24, boxSizing: 'border-box', width: '80%', maxWidth: 1100, margin: '0 auto' }}>
      <style>{`
        .timings-container { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; color: #0b2540; }
        .eod-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px }
        .eod-header h2 { margin:0; font-size:20px }

        .eod-form { display:grid; gap:12px; grid-template-columns: 1fr; max-width:900px }
        .eod-row { display:flex; align-items:center; gap:12px; background:#fff; padding:8px 12px; border-radius:6px; border:1px solid #eef3f8 }
        .eod-label { width:220px; flex: none }
        .input { padding:10px 12px; border-radius:6px; border:1px solid #e6e6e6; box-sizing:border-box; background:#fff }
        .btn { padding:10px 12px; border-radius:6px; border:1px solid transparent; cursor:pointer; font-size:14px }
        .btn-primary { background:#055a9a; color:#fff }
        .input-with-spinner { position: relative; display: inline-block }
        .input-with-spinner .input { padding-right: 48px }
        .spinner-btn { padding: 4px 6px; font-size: 14px; line-height: 14px; width: 28px; height: 24px; display:inline-flex; align-items:center; justify-content:center; border-radius:4px; background: transparent; border: none; color: #055a9a }
        .spinner-btn:hover, .spinner-btn:focus { outline: none; background: transparent }
        .spinner-group { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display:flex; flex-direction:column; gap:0px }

        .slider { flex: 1; min-width: 120px }
        .slider-wrap { display: flex; justify-content: center; align-items: center; width: 100% }
        .slider-wrap .slider { width: 88% }

        @media (max-width:720px) {
          .eod-label { width: 140px }
          .eod-form { max-width: 100% }
        }
      `}</style>

      <div className="eod-header">
        <h2>End Of Day</h2>
      </div>

      {entryExists && <div style={{ marginBottom: 8, color: '#444' }}>An entry for today already exists. You can edit it below.</div>}

      <form onSubmit={handleSubmit} className="eod-form" aria-label="End of day form">
        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Coding</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>{formatHours(tasks.coding)}</div>
          </div>
          <div className="slider-wrap">
            <input className="slider" type="range" id="coding" name="coding" value={tasks.coding} onChange={handleChange} min="0" max="8" step="0.5" />
            <div style={{ marginLeft: 12 }}>
              {editingValues.coding ? (
                <div className="input-with-spinner">
                  <input className="input" type="text" name="coding" value={editingValues.coding} onChange={handleEditChange} onKeyDown={(e) => handleEditKey(e, 'coding')} onBlur={() => finishEdit('coding')} style={{ width: 120 }} />
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('coding', 0.5)} aria-label="increase coding">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('coding', -0.5)} aria-label="decrease coding">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="input-with-spinner">
                  <button type="button" className="input" onClick={() => startEdit('coding')} style={{ width: 120, textAlign: 'center' }}>{formatHours(tasks.coding)}</button>
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('coding', 0.5)} aria-label="increase coding">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('coding', -0.5)} aria-label="decrease coding">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Debugging</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>{formatHours(tasks.debugging)}</div>
          </div>
          <div className="slider-wrap">
            <input className="slider" type="range" id="debugging" name="debugging" value={tasks.debugging} onChange={handleChange} min="0" max="8" step="0.5" />
            <div style={{ marginLeft: 12 }}>
              {editingValues.debugging ? (
                <div className="input-with-spinner">
                  <input className="input" type="text" name="debugging" value={editingValues.debugging} onChange={handleEditChange} onKeyDown={(e) => handleEditKey(e, 'debugging')} onBlur={() => finishEdit('debugging')} style={{ width: 120 }} />
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('debugging', 0.5)} aria-label="increase debugging">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('debugging', -0.5)} aria-label="decrease debugging">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="input-with-spinner">
                  <button type="button" className="input" onClick={() => startEdit('debugging')} style={{ width: 120, textAlign: 'center' }}>{formatHours(tasks.debugging)}</button>
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('debugging', 0.5)} aria-label="increase debugging">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('debugging', -0.5)} aria-label="decrease debugging">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Interacting with a tool</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>{formatHours(tasks['tool-interacting'])}</div>
          </div>
          <div className="slider-wrap">
            <input className="slider" type="range" id="tool-interacting" name="tool-interacting" value={tasks['tool-interacting']} onChange={handleChange} min="0" max="8" step="0.5" />
            <div style={{ marginLeft: 12 }}>
              {editingValues['tool-interacting'] ? (
                <div className="input-with-spinner">
                  <input className="input" type="text" name="tool-interacting" value={editingValues['tool-interacting']} onChange={handleEditChange} onKeyDown={(e) => handleEditKey(e, 'tool-interacting')} onBlur={() => finishEdit('tool-interacting')} style={{ width: 120 }} />
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('tool-interacting', 0.5)} aria-label="increase tool interacting">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('tool-interacting', -0.5)} aria-label="decrease tool interacting">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="input-with-spinner">
                  <button type="button" className="input" onClick={() => startEdit('tool-interacting')} style={{ width: 120, textAlign: 'center' }}>{formatHours(tasks['tool-interacting'])}</button>
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('tool-interacting', 0.5)} aria-label="increase tool interacting">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('tool-interacting', -0.5)} aria-label="decrease tool interacting">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Reviewing code</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>{formatHours(tasks['code-reviewing'])}</div>
          </div>
          <div className="slider-wrap">
            <input className="slider" type="range" id="code-reviewing" name="code-reviewing" value={tasks['code-reviewing']} onChange={handleChange} min="0" max="8" step="0.5" />
            <div style={{ marginLeft: 12 }}>
              {editingValues['code-reviewing'] ? (
                <div className="input-with-spinner">
                  <input className="input" type="text" name="code-reviewing" value={editingValues['code-reviewing']} onChange={handleEditChange} onKeyDown={(e) => handleEditKey(e, 'code-reviewing')} onBlur={() => finishEdit('code-reviewing')} style={{ width: 120 }} />
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('code-reviewing', 0.5)} aria-label="increase code reviewing">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('code-reviewing', -0.5)} aria-label="decrease code reviewing">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="input-with-spinner">
                  <button type="button" className="input" onClick={() => startEdit('code-reviewing')} style={{ width: 120, textAlign: 'center' }}>{formatHours(tasks['code-reviewing'])}</button>
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('code-reviewing', 0.5)} aria-label="increase code reviewing">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('code-reviewing', -0.5)} aria-label="decrease code reviewing">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Other</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>{formatHours(tasks.other)}</div>
          </div>
          <div className="slider-wrap">
            <input className="slider" type="range" id="other" name="other" value={tasks.other} onChange={handleChange} min="0" max="8" step="0.5" />
            <div style={{ marginLeft: 12 }}>
              {editingValues.other ? (
                <div className="input-with-spinner">
                  <input className="input" type="text" name="other" value={editingValues.other} onChange={handleEditChange} onKeyDown={(e) => handleEditKey(e, 'other')} onBlur={() => finishEdit('other')} style={{ width: 120 }} />
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('other', 0.5)} aria-label="increase other">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('other', -0.5)} aria-label="decrease other">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="input-with-spinner">
                  <button type="button" className="input" onClick={() => startEdit('other')} style={{ width: 120, textAlign: 'center' }}>{formatHours(tasks.other)}</button>
                  <div className="spinner-group">
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('other', 0.5)} aria-label="increase other">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 0l6 8H0L6 0z" fill="currentColor"/></svg>
                    </button>
                    <button type="button" className="spinner-btn" onClick={() => adjustEditingValue('other', -0.5)} aria-label="decrease other">
                      <svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 8L0 0h12L6 8z" fill="currentColor"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ marginTop: '1rem', fontWeight: 'bold' }}>
          Total Hours: {formatHours(totalHours)}
          {totalHours > 8 && <span style={{ color: 'red', marginLeft: '1rem' }}>Warning: Total exceeds 8 hours!</span>}
          {totalHours < 8 && <span style={{ color: 'orange', marginLeft: '1rem' }}>Warning: Total is under 8 hours.</span>}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="submit" className="btn btn-primary">Save</button>
          <div style={{ flex: 1 }} />
        </div>

        {/* saveMessage UI removed per request */}
      </form>
    </div>
  );
}

