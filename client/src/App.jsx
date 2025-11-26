import React, { useState, useEffect } from 'react'

export default function App() {
  const [input, setInput] = useState('');
  const [issues, setIssues] = useState([]);
  const [active, setActive] = useState(null);
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || 'https://github.com/facebook/react');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  async function addIssues(override) {
    const raw = (typeof override === 'string' && override.length > 0) ? override : input;
    const tokens = String(raw).split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
    const nums = tokens.map(t => {
      const m = t.match(/(\d+)/);
      return m ? m[1] : '';
    }).filter(Boolean);
    if (nums.length === 0) return;
    const invalid = nums.filter(x => !/^\d+$/.test(x));
    if (invalid.length > 0) {
      setError(`Invalid issue numbers: ${invalid.join(', ')} — provide numeric IDs only.`);
      return;
    }
    localStorage.setItem('repoUrl', repoUrl);
    setStatus('loading');
    let owner = 'facebook';
    let repo = 'react';
    try {
      const parsed = new URL(repoUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts[1];
      }
    } catch (e) {
    }

    const fetched = await Promise.all(nums.map(async n => {
      try {
        const res = await fetch(`/api/issue/${owner}/${repo}/${n}/title`);
        if (!res.ok) return { number: n, title: 'Lookup failed' };
        const body = await res.json();
        return { number: n, title: body.title };
      } catch (e) {
        return { number: n, title: 'Error' };
      }
    }));
    setIssues(fetched);
    setStatus('ready');
    setError('');
    setActive(null);
  }

  async function selectIssue(issue) {
    setStatus('saving');
    const res = await fetch('/api/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue })
    });
    if (res.ok) {
      setActive(issue);
      setStatus('ready');
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('repoUrl');
    if (saved) setRepoUrl(saved);
  }, []);


  return (
    <div style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif', maxWidth: 760, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Time Allocated To Issue</h1>
        <div style={{ fontSize: 12 }}>
          <span style={{ marginRight: 8, color: '#666' }}>Status:</span>
          <span style={{ padding: '4px 8px', borderRadius: 12, background: status === 'ready' ? '#e6ffed' : status === 'loading' ? '#fff7e6' : '#f0f0f0', color: '#222', border: '1px solid #ddd' }}>{status}</span>
        </div>
      </header>

      <section style={{ display: 'grid', gap: 12 }}>
        <div style={{ padding: 12, border: '1px solid #e6e6e6', borderRadius: 8, background: '#fafafa' }}>
          <label style={{ display: 'block', fontSize: 13, color: '#333', marginBottom: 6 }}>GitHub repo URL</label>
          <input aria-label="repo-url" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 14, boxSizing: 'border-box', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <input aria-label="issue-numbers" placeholder="e.g. 123, 456" value={input} onChange={e => { setInput(e.target.value); setError(''); }} style={{ width: '100%', padding: '10px 12px', fontSize: 14, height: 40, minWidth: 0, boxSizing: 'border-box' }} />
            {error && <div role="alert" style={{ color: '#8b0000', marginTop: 6, fontSize: 13 }}>{error}</div>}
          </div>
          <label style={{ display: 'inline-block' }}>
            <input
              type="file"
              accept=".json,text/csv,text/plain,application/json"
              style={{ display: 'none' }}
              onChange={async e => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  let parsed = null;
                  try { parsed = JSON.parse(text); } catch (err) { }

                  let list = [];
                  if (Array.isArray(parsed)) {
                    list = parsed.map(x => String(x).trim()).filter(Boolean);
                  } else if (typeof parsed === 'object' && parsed !== null) {
                    list = Object.values(parsed).map(x => String(x).trim()).filter(Boolean);
                  } else {
                    list = text.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
                  }

                  const normalized = list.map(t => {
                    const m = String(t).match(/(\d+)/);
                    return m ? m[1] : '';
                  }).filter(Boolean);
                  const invalidInFile = normalized.filter(x => !/^\d+$/.test(x));
                  if (invalidInFile.length > 0) {
                      setError(`Invalid issue numbers in file: ${invalidInFile.join(', ')} — upload numeric IDs only.`);
                    e.target.value = '';
                    return;
                  }

                  setInput(normalized.join(', '));
                  await addIssues(normalized.join(','));
                } catch (err) {
                  console.error('Failed to parse file', err);
                } finally {
                  e.target.value = '';
                }
              }}
            />
            <button type="button" style={{ padding: '10px 12px', height: 40 }}>Upload</button>
          </label>
          <button type="button" onClick={() => addIssues()} style={{ padding: '10px 12px', height: 40 }}>Load</button>
          
        </div>

        <div>
          {issues.length === 0 && (
            <div style={{ color: '#666', fontSize: 13 }}>No issues loaded.</div>
          )}

          {issues.length > 0 && (
            <div style={{ marginTop: 8, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
              <form>
                {issues.map(i => (
                  <label key={i.number} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                    <input type="radio" name="issue" value={i.number} checked={active === i.number} onChange={() => selectIssue(i.number)} style={{ width: 18, height: 18 }} />
                    <div style={{ flex: 1, fontSize: 14, lineHeight: '1.2' }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>#{i.number}</div>
                      <div style={{ color: '#444' }}>{i.title}</div>
                    </div>
                    {active === i.number && <span style={{ fontSize: 12, padding: '4px 8px', background: '#eef9ff', borderRadius: 10 }}>Active</span>}
                  </label>
                ))}

                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                  <input type="radio" name="issue" value="other" checked={active === 'other'} onChange={() => selectIssue('other')} style={{ width: 18, height: 18 }} />
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>Other</div></div>
                  {active === 'other' && <span style={{ fontSize: 12, padding: '4px 8px', background: '#eef9ff', borderRadius: 10 }}>Active</span>}
                </label>
              </form>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
