import React, { useState, useEffect } from "react";

export default function EOD() {
  const [tasks, setTasks] = useState({
    coding: 1,
    debugging: 1,
    "tool-interacting": 1,
    "code-reviewing": 1,
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
          function mapValueToRating(v) {
            if (v == null) return 1;
            const n = Number(v);
            if (Number.isNaN(n)) return 1;
            // If already on 1-5 scale
            if (n >= 1 && n <= 5) return Math.round(n);
            // Otherwise assume hours (0-8) and map to rating buckets
            if (n === 0) return 1;
            if (n > 0 && n <= 1.5) return 2;
            if (n > 1.5 && n <= 3) return 3;
            if (n > 3 && n <= 5) return 4;
            return 5;
          }

          setTasks({
            coding: mapValueToRating(data.coding),
            debugging: mapValueToRating(data.debugging),
            "tool-interacting": mapValueToRating(data["tool-interacting"]),
            "code-reviewing": mapValueToRating(data["code-reviewing"]),
          });
          setEntryExists(true);
        }
      } catch (error) {
        console.error("Failed to fetch EOD data", error);
      }
    };
    fetchEodData();
  }, []);

  const handleChange = async (e) => {
    const { name, value } = e.target;
    const next = (prev) => ({ ...prev, [name]: parseInt(value, 10) });
    // update state and then POST the updated EOD immediately (autosave)
    setTasks((prevTasks) => {
      const nextTasks = next(prevTasks);
      (async function save() {
        try {
          await fetch('/api/eod', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: today, ...nextTasks }),
          });
          setEntryExists(true);
        } catch (err) {
          console.error('Failed to autosave EOD', err);
        }
      })();
      return nextTasks;
    });
  };

  // rating labels for the 1-5 scale
  function formatRating(r) {
    const labels = {
      1: 'No time',
      2: 'A small amount of time',
      3: 'A reasonable amount of time',
      4: 'A significant amount of time',
      5: 'Too much time',
    };
    return labels[r] || '';
  }

  // keep editing state variables for compatibility but they are no-ops with radio inputs

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }} className="eod-row" aria-hidden>
          <div className="eod-label" style={{ fontWeight: 600 }}>How much time</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, width: '88%' }}>
            {[1,2,3,4,5].map((v) => (
              <div key={v} style={{ textAlign: 'center', fontSize: 12 }}>{formatRating(v)}</div>
            ))}
          </div>
        </div>
        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Coding</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>&nbsp;</div>
          </div>
          <div className="slider-wrap" role="radiogroup" aria-label="Coding time">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, width: '88%' }}>
              {[1,2,3,4,5].map((v) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                  <input type="radio" name="coding" value={v} checked={tasks.coding === v} onChange={handleChange} style={{ display: 'block', margin: '0 auto' }} />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Debugging</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>&nbsp;</div>
          </div>
          <div className="slider-wrap" role="radiogroup" aria-label="Debugging time">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, width: '88%' }}>
              {[1,2,3,4,5].map((v) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                  <input type="radio" name="debugging" value={v} checked={tasks.debugging === v} onChange={handleChange} style={{ display: 'block', margin: '0 auto' }} />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Interacting with a tool</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>&nbsp;</div>
          </div>
          <div className="slider-wrap" role="radiogroup" aria-label="Tool interacting time">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, width: '88%' }}>
              {[1,2,3,4,5].map((v) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                  <input type="radio" name="tool-interacting" value={v} checked={tasks['tool-interacting'] === v} onChange={handleChange} style={{ display: 'block', margin: '0 auto' }} />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="eod-row">
          <div className="eod-label">
            <div style={{ fontWeight: 600 }}>Reviewing code</div>
            <div style={{ color: '#6b7c88', marginTop: 6 }}>&nbsp;</div>
          </div>
          <div className="slider-wrap" role="radiogroup" aria-label="Code reviewing time">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, width: '88%' }}>
              {[1,2,3,4,5].map((v) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>
                  <input type="radio" name="code-reviewing" value={v} checked={tasks['code-reviewing'] === v} onChange={handleChange} style={{ display: 'block', margin: '0 auto' }} />
                </label>
              ))}
            </div>
          </div>
        </div>


        {/* total removed - choices autosave */}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <div style={{ flex: 1 }} />
        </div>

        {/* saveMessage UI removed per request */}
      </form>
    </div>
  );
}

