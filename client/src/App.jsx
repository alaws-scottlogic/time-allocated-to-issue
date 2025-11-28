import React, { useState, useEffect } from 'react'
import TimingsPage from './pages/Timings'

export default function App() {
  const [view, setView] = useState('home');
  const [input, setInput] = useState('');
  const [issues, setIssues] = useState([]);
  const [active, setActive] = useState(null);
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || '');
  const [ghToken, setGhToken] = useState(() => {
    const envToken = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GITHUB_TOKEN) || '';
    return envToken || localStorage.getItem('github_token') || '';
  });
  // status state removed
  const [error, setError] = useState('');
  const [otherLabel, setOtherLabel] = useState(() => localStorage.getItem('other_issue_label') || 'Other');
  const [otherLabel2, setOtherLabel2] = useState(() => localStorage.getItem('other_issue_label_2') || 'Custom Time Entry');

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
    // previously setStatus('loading') removed
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
        const headers = {};
        if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
        const res = await fetch(`/api/issue/${owner}/${repo}/${n}/title`, { headers });
        if (!res.ok) return { number: n, title: 'Lookup failed' };
        const body = await res.json();
        return { number: n, title: body.title };
      } catch (e) {
        return { number: n, title: 'Error' };
      }
    }));
    setIssues(fetched);
    // previously setStatus('ready') removed
    setError('');
    setActive(null);
  }

  async function selectIssue(issue) {
    // previously setStatus('saving') removed
    const headers = { 'Content-Type': 'application/json' };
    if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
    // When selecting 'other' or 'other2', include the custom label so the server/client can use it
    const payload = { issue, repoUrl };
    if (issue === 'other') payload.otherLabel = otherLabel;
    if (issue === 'other2') payload.otherLabel = otherLabel2;
    const res = await fetch('/api/select', { method: 'POST', headers, body: JSON.stringify(payload) });
    if (res.ok) {
      setActive(issue);
      try { localStorage.setItem('selected_issue', issue); } catch (err) { }
      // previously setStatus('ready') removed
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('repoUrl');
    if (saved) setRepoUrl(saved);
  }, []);


  return (
    <div style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif', maxWidth: 1100, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Time Allocated To Issue</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setView(view === 'home' ? 'timings' : 'home')} style={{ padding: '6px 10px' }}>{view === 'home' ? 'Manage timings' : 'Home'}</button>
          {/* status removed */}
        </div>
      </header>

      {view === 'timings' && <TimingsPage onBack={() => setView('home')} repoUrl={repoUrl} ghToken={ghToken} setGhToken={setGhToken} />}
      {view === 'home' && (

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
          <button type="button" onClick={() => addIssues()} style={{ padding: '10px 12px', height: 40 }}>Load</button>

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
            <button type="button" style={{ padding: '10px 12px', height: 40 }}>Upload From File</button>
          </label>
          
          
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
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{otherLabel}</div>
                  </div>
                  {active === 'other' && <span style={{ fontSize: 12, padding: '4px 8px', background: '#eef9ff', borderRadius: 10 }}>Active</span>}
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                  <input type="radio" name="issue" value="other2" checked={active === 'other2'} onChange={() => selectIssue('other2')} style={{ width: 18, height: 18 }} />
                  <div style={{ flex: 1 }}>
                    <input aria-label="other-label-2" placeholder="Custom Time Entry" value={otherLabel2} onChange={e => { setOtherLabel2(e.target.value); localStorage.setItem('other_issue_label_2', e.target.value); }} style={{ padding: '6px 8px', fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  {active === 'other2' && <span style={{ fontSize: 12, padding: '4px 8px', background: '#eef9ff', borderRadius: 10 }}>Active</span>}
                </label>
              </form>
            </div>
          )}
        </div>
      </section>
      )}
    </div>
  )
}
