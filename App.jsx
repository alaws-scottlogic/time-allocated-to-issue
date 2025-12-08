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

  // Load saved issues on mount
  useEffect(() => {
    async function loadIssues() {
      try {
        const spreadsheetId = localStorage.getItem('spreadsheetId') || (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
        if (spreadsheetId) {
          const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
          const sheetsClient = (await import('./lib/sheetsClient')).default;
          const savedIssues = await sheetsClient.getIssues(spreadsheetId, clientId).catch(() => []);
          if (Array.isArray(savedIssues) && savedIssues.length > 0) setIssues(savedIssues);
        }
      } catch (e) {
        console.error('Failed to load issues', e);
      }
    }
    loadIssues();
  }, []);

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
        const headers = { 'User-Agent': 'time-allocated-app' };
        if (ghToken) headers['Authorization'] = ghToken.startsWith('token ') || ghToken.startsWith('Bearer ') ? ghToken : `token ${ghToken}`;
        const url = `https://api.github.com/repos/${owner}/${repo}/issues/${n}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return { number: n, title: 'Lookup failed' };
        const body = await res.json();
        return { number: n, title: body.title };
      } catch (e) {
        return { number: n, title: 'Error' };
      }
    }));
    setIssues(fetched);
    // Save to spreadsheet (if configured)
    try {
      const spreadsheetId = localStorage.getItem('spreadsheetId') || (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
      if (spreadsheetId) {
        const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
        const sheetsClient = (await import('./lib/sheetsClient')).default;
        await sheetsClient.saveIssues(spreadsheetId, fetched, clientId);
      }
    } catch (e) {
      console.error('Failed to save issues', e);
    }
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
        // Stop: persist the active selection stored in sessionStorage to the spreadsheet
        const activeJson = sessionStorage.getItem('activeSelection');
        if (activeJson) {
          const activeObj = JSON.parse(activeJson);
          const now = new Date().toISOString();
          const duration = Math.round((Date.parse(now) - Date.parse(activeObj.start)) / 1000);
          const closed = { issue: activeObj.issue, start: activeObj.start, duration, repoUrl: activeObj.repoUrl || null };
          const spreadsheetId = localStorage.getItem('spreadsheetId') || (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
          if (spreadsheetId) {
            const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
            const sheetsClient = (await import('./lib/sheetsClient')).default;
            await sheetsClient.appendTiming(spreadsheetId, closed, clientId);
          }
        }
        // Clear active after stopping
        sessionStorage.removeItem('activeSelection');
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
    // Implement select locally: close any existing active selection and start a new one stored in sessionStorage
    try {
      const activeJson = sessionStorage.getItem('activeSelection');
      if (activeJson) {
        const activeObj = JSON.parse(activeJson);
        const now = new Date().toISOString();
        const duration = Math.round((Date.parse(now) - Date.parse(activeObj.start)) / 1000);
        const closed = { issue: activeObj.issue, start: activeObj.start, duration, repoUrl: activeObj.repoUrl || null };
        const spreadsheetId = localStorage.getItem('spreadsheetId') || (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
        if (spreadsheetId) {
          const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
          const sheetsClient = (await import('./lib/sheetsClient')).default;
          await sheetsClient.appendTiming(spreadsheetId, closed, clientId).catch(() => {});
        }
      }
    } catch (e) { /* ignore */ }
    // Start new interval and persist in sessionStorage
    const newActive = { issue, start: new Date().toISOString(), repoUrl };
    sessionStorage.setItem('activeSelection', JSON.stringify(newActive));
    setActive(issue);
    try { localStorage.setItem('selected_issue', issue); } catch (err) { }
  }

  useEffect(() => {
    const saved = localStorage.getItem('repoUrl');
    if (saved) setRepoUrl(saved);
    // check Google auth status on load
    (async () => {
      // fetch server-provided config so we can build OAuth URLs server-side
      let cfg = { googleClientId: (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || '', googleRedirectUri: (import.meta.env && import.meta.env.VITE_GOOGLE_REDIRECT_URI) || '' };
      try {
        // derive config from env vars and expose it to the outer scope
        setServerConfig(cfg);
      } catch (e) { /* ignore */ }

      // Detect OAuth redirect code and exchange for tokens
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        
        // Check for Implicit Flow response in hash
        let hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');

        if (accessToken) {
           // Handle implicit flow
           if (window && window.history && window.history.replaceState) {
             const url = new URL(window.location.href);
             url.hash = '';
             // Also clear any legacy code param if present
             url.search = '';
             window.history.replaceState({}, '', url.toString());
           }
           const tokenStore = await import('./lib/tokenStore');
           const expiresIn = hashParams.get('expires_in');
           const tokens = {
             access_token: accessToken,
             token_type: hashParams.get('token_type'),
             scope: hashParams.get('scope'),
             expires_in: expiresIn,
             expiry_date: expiresIn ? Date.now() + (Number(expiresIn) * 1000) : null
           };
           tokenStore.saveTokens(tokens);
           
           const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || cfg.googleClientId;
           const spreadId = localStorage.getItem('spreadsheetId') || (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
           const sheetsClient = (await import('./lib/sheetsClient')).default;
           const createdId = await sheetsClient.createSpreadsheetIfMissing(spreadId, clientId).catch(() => null);
           if (createdId) localStorage.setItem('spreadsheetId', createdId);
           setAuthStatus({ authenticated: true, expires_at: tokens.expiry_date || null });
        }
      } catch (e) {
        console.error('OAuth token exchange failed', e);
        try { setAuthStatus({ authenticated: false }); } catch (_) {}
      }

      try {
        const tokenStore = await import('./lib/tokenStore');
        const tokens = tokenStore.loadTokens();
        if (tokens) setAuthStatus({ authenticated: true, expires_at: tokens.expiry_date || null });
        else setAuthStatus({ authenticated: false });
        // If we were redirected after OAuth, parse query params to show immediate feedback
          try {
            const params = new URLSearchParams(window.location.search);
            const auth = params.get('auth');
            if (auth === 'success') {
              const expires_at = params.get('expires_at');
              const email = params.get('email');
              setAuthStatus({ authenticated: true, expires_at: expires_at || null, email: email || null });
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
              if (!tokens && shouldAuto && !already) {
                sessionStorage.setItem('auth_redirected', '1');
                try {
                  const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || (serverConfig && serverConfig.googleClientId);
                  const redirectUri = (import.meta.env && import.meta.env.VITE_GOOGLE_REDIRECT_URI) || (serverConfig && serverConfig.googleRedirectUri);
                  if (!clientId) {
                    console.error('Missing Google Client ID');
                    return;
                  }
                  const { buildAuthUrl } = await import('./lib/oauth');
                  const url = await buildAuthUrl({ clientId, redirectUri });
                  window.location.href = url;
                } catch (e) { /* ignore */ }
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
        // On unload, try to save an active selection to the spreadsheet via navigator.sendBeacon where possible
        const activeJson = sessionStorage.getItem('activeSelection');
        if (activeJson) {
          try {
            const activeObj = JSON.parse(activeJson);
            const now = new Date().toISOString();
            const duration = Math.round((Date.parse(now) - Date.parse(activeObj.start)) / 1000);
            const closed = { issue: activeObj.issue, start: activeObj.start, duration, repoUrl: activeObj.repoUrl || null };
            const spreadsheetId = localStorage.getItem('spreadsheetId') || (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
            if (spreadsheetId && navigator && navigator.sendBeacon) {
              const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
              // Best-effort: send to a simple endpointless beacon (note: Google Sheets API requires auth; beacon may not work)
              // Fallback: persist to localStorage and rely on user to save later.
              localStorage.setItem('stagedClosed', JSON.stringify({ spreadsheetId, closed, clientId }));
            } else {
              localStorage.setItem('stagedClosed', JSON.stringify({ closed }));
            }
          } catch (e) { /* ignore */ }
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
              const spreadsheetId = localStorage.getItem('spreadsheetId') || (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
              if (!spreadsheetId) return;
              const clientId = (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
              const sheetsClient = (await import('./lib/sheetsClient')).default;
              const links = await sheetsClient.getSheetLinks(spreadsheetId, clientId).catch(() => null);
              const href = links && links.base ? links.base : null;
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
            <button type="button" onClick={async () => {
              try {
                const clientId = serverConfig && serverConfig.googleClientId ? serverConfig.googleClientId : (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID);
                const redirectUri = serverConfig && serverConfig.googleRedirectUri ? serverConfig.googleRedirectUri : (import.meta.env && import.meta.env.VITE_GOOGLE_REDIRECT_URI);
                if (!clientId) {
                  alert('Missing Google Client ID configuration');
                  return;
                }
                const { buildAuthUrl } = await import('./lib/oauth');
                const url = await buildAuthUrl({ clientId, redirectUri });
                window.location.href = url;
              } catch (e) { console.error('Auth start failed', e); }
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
