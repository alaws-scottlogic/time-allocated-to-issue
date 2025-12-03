import React, { useState, useEffect } from 'react'
import TimingsPage from './pages/Timings'
import EodPage from './pages/EOD'

export default function App() {
  const [view, setView] = useState('home');
  const [input, setInput] = useState('');
  const [issues, setIssues] = useState([]);
  const [active, setActive] = useState(null);
  const [repoUrl, setRepoUrl] = useState(() => localStorage.getItem('repoUrl') || '');
  const [authStatus, setAuthStatus] = useState({ authenticated: null });
  const [serverConfig, setServerConfig] = useState({ googleClientId: '', googleRedirectUri: '' });
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
    const numsRaw = tokens.map(t => {
      const m = t.match(/(\d+)/);
      return m ? m[1] : '';
    }).filter(Boolean);
    // deduplicate while preserving order
    const seen = new Set();
    const nums = numsRaw.filter(n => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
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
    // Special-case 'stop' to call the server stop endpoint instead of selecting a new active issue
    if (issue === 'stop') {
      // Show the radio as selected immediately
      setActive('stop');
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
        await fetch('/api/stop', { method: 'POST', headers });
        // Clear active after stopping
        setActive(null);
        try { localStorage.setItem('selected_issue', ''); } catch (err) {}
      } catch (e) {
        // ignore
      }
      return;
    }

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
    // check Google auth status on load
    (async () => {
      // fetch server-provided config so we can build OAuth URLs server-side
      try {
        const cfgRes = await fetch('/api/config');
        if (cfgRes.ok) setServerConfig(await cfgRes.json());
      } catch (e) { /* ignore */ }

      try {
        const res = await fetch('/api/auth/status');
        if (!res.ok) return setAuthStatus({ authenticated: false });
        const body = await res.json();
        setAuthStatus({ authenticated: Boolean(body && body.authenticated), expires_at: body && body.expires_at });
        // If we were redirected after OAuth, parse query params to show immediate feedback
          try {
            const params = new URLSearchParams(window.location.search);
            const auth = params.get('auth');
            if (auth === 'success') {
              const expires_at = params.get('expires_at');
              const email = params.get('email');
              setAuthStatus({ authenticated: true, expires_at: expires_at || (body && body.expires_at) || null, email: email || null });
              // Clean up query params to keep URLs tidy
              if (window && window.history && window.history.replaceState) {
                const url = new URL(window.location.href);
                url.search = '';
                window.history.replaceState({}, '', url.toString());
              }
            } else if (auth === 'failed') {
              setAuthStatus({ authenticated: false });
            }
          } catch (e) { /* ignore */ }
        // Optionally auto-redirect to server auth route for user convenience
        try {
          const auto = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AUTO_OPEN_AUTH) || null;
          const shouldAuto = auto === 'true' || (auto === null && window && window.location.hostname === 'localhost');
          const already = sessionStorage.getItem('auth_redirected');
          if (!body.authenticated && shouldAuto && !already) {
            sessionStorage.setItem('auth_redirected', '1');
            window.location.href = '/auth/google';
          }
        } catch (e) { /* ignore */ }
      } catch (e) {
        setAuthStatus({ authenticated: false });
      }
    })();
  }, []);

  useEffect(() => {
    function handleUnload() {
      try {
        const url = '/api/stop';
        // Prefer sendBeacon for a reliable, non-blocking delivery on unload
        if (navigator && navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
          navigator.sendBeacon(url, blob);
        } else {
          // Best-effort synchronous fetch (may be ignored by browsers)
          const xhr = new XMLHttpRequest();
          xhr.open('POST', url, false);
          xhr.setRequestHeader('Content-Type', 'application/json');
          try { xhr.send(JSON.stringify({})); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
    }
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);


  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Time Allocated To Issue</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setView(view === 'home' ? 'timings' : 'home')} style={{ padding: '6px 10px' }}>{view === 'home' ? 'Manage timings' : 'Home'}</button>
          <button onClick={() => setView('eod')} style={{ padding: '6px 10px' }}>End Of Day</button>
          <button onClick={async () => {
            try {
              const res = await fetch('/api/sheets/links');
              if (!res.ok) return;
              const body = await res.json();
              const href = (body && body.base) || '';
              if (href) window.open(href, '_blank');
            } catch (e) {}
          }} style={{ padding: '6px 10px' }}>View Google Sheet</button>
          
          {/* status removed */}
        </div>
      </header>

      {authStatus.authenticated === false && (
        <div style={{ padding: 12, marginBottom: 12, border: '1px solid #ffd7b5', background: '#fff4e6', borderRadius: 6 }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>Google Sheets not authorized</strong>
          <div style={{ marginBottom: 8 }}>To save timings to Google Sheets you need to authorize this app to access your Google account.</div>
          <div>
            <button type="button" onClick={() => {
              const clientId = serverConfig && serverConfig.googleClientId ? serverConfig.googleClientId : '846056206184-qqt3e0cj82g3sbvhu27guna8rprp46hr.apps.googleusercontent.com';
              const redirectUri = serverConfig && serverConfig.googleRedirectUri ? serverConfig.googleRedirectUri : 'http://localhost:4000/auth/google/callback';
              const scope = encodeURIComponent('openid email profile https://www.googleapis.com/auth/spreadsheets');
              const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
              window.location.href = url;
            }} style={{ padding: '8px 12px', background: '#2b7cff', color: '#fff', border: 'none', borderRadius: 4 }}>Authorize with Google</button>
          </div>
        </div>
      )}

      {view === 'timings' && <TimingsPage onBack={() => setView('home')} repoUrl={repoUrl} ghToken={ghToken} setGhToken={setGhToken} />}
      {view === 'eod' && <EodPage onBack={() => setView('home')} />}
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

          {/* Upload from file removed */}
          
          
        </div>

        <div>
          {issues.length === 0 && (
            <div style={{ color: '#666', fontSize: 13 }}>No issues loaded.</div>
          )}

          {issues.length > 0 && (
            <div style={{ marginTop: 8, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
              <div style={{ marginBottom: 8 }} />
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

                <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
                  <input type="radio" name="issue" value="stop" checked={active === 'stop'} onChange={() => selectIssue('stop')} style={{ width: 18, height: 18 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>Stop</div>
                    <div style={{ color: '#666', fontSize: 13 }}>Close the current timing interval</div>
                  </div>
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
