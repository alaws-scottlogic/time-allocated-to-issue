import React, { useState, useEffect } from "react";
import TimingsPage from "./pages/Timings";
import sheetsClient from "./lib/sheetsClient";
import * as tokenStore from "./lib/tokenStore";
import { buildAuthUrl } from "./lib/oauth";

export default function App() {
  const [view, setView] = useState("home");
  const [input, setInput] = useState("");
  const [issues, setIssues] = useState([]);
  const [active, setActive] = useState(null);
  const [repoUrl, setRepoUrl] = useState(
    () => localStorage.getItem("repoUrl") || "",
  );
  const [authStatus, setAuthStatus] = useState({ authenticated: null });
  const [serverConfig, setServerConfig] = useState({
    googleClientId: "",
    googleRedirectUri: "",
  });
  const [ghToken, setGhToken] = useState(() => {
    const envToken =
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_GITHUB_TOKEN) ||
      "";
    return envToken || localStorage.getItem("github_token") || "";
  });
  const [error, setError] = useState("");
  const [noteText, setNoteText] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);

  async function saveNote(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return null;
    const spreadsheetId =
      localStorage.getItem("spreadsheetId") ||
      (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
    if (!spreadsheetId) {
      alert("No spreadsheet configured. Authorize the app to save notes.");
      return null;
    }
    try {
      setNotesSaving(true);
      const clientId =
        (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
      const res = await sheetsClient.appendNote(
        spreadsheetId,
        trimmed,
        clientId,
      );
      setNotesSaving(false);
      return res;
    } catch (err) {
      setNotesSaving(false);
      throw err;
    }
  }

  // Helper: reload the Issues sheet and update state
  const reloadIssues = React.useCallback(async () => {
    try {
      const spreadsheetId =
        localStorage.getItem("spreadsheetId") ||
        (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
      if (!spreadsheetId) return;
      const clientId =
        (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
      const savedIssues = await sheetsClient
        .getIssues(spreadsheetId, clientId)
        .catch(() => []);
      setIssues(Array.isArray(savedIssues) ? savedIssues : []);
    } catch (e) {
      console.error("Failed to reload issues", e);
    }
  }, []);

  // NEW: Handle Google OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      console.log("[App] Auth code received:", code);
      (async () => {
        try {
          const oauth = await import("./lib/oauth");
          const tokens = await oauth.exchangeCodeForToken(code);
          const tokenStore = await import("./lib/tokenStore");
          tokenStore.saveTokens(tokens);
          console.log("[App] Tokens saved");
          // remove code from URL
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
          setAuthStatus({ authenticated: true });
        } catch (err) {
          console.error("[App] Token exchange failed", err);
          setError("Failed to get Google auth token");
        }
      })();
    }
  }, []);

  // Load saved issues on mount
  useEffect(() => {
    reloadIssues();
  }, []);

  // When authentication (re-)establishes, refresh the Issues list automatically
  useEffect(() => {
    if (authStatus && authStatus.authenticated) {
      reloadIssues();
    }
  }, [authStatus && authStatus.authenticated, reloadIssues]);

  async function addIssues(override) {
    const raw =
      typeof override === "string" && override.length > 0 ? override : input;
    const tokens = String(raw)
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    const numsRaw = tokens
      .map((t) => {
        const m = t.match(/(\d+)/);
        return m ? m[1] : "";
      })
      .filter(Boolean);
    // deduplicate while preserving order
    const seen = new Set();
    const nums = numsRaw.filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    if (nums.length === 0) return;
    const invalid = nums.filter((x) => !/^\d+$/.test(x));
    if (invalid.length > 0) {
      setError(
        `Invalid issue numbers: ${invalid.join(", ")} — provide numeric IDs only.`,
      );
      return;
    }
    localStorage.setItem("repoUrl", repoUrl);
    // previously setStatus('loading') removed
    let owner = "facebook";
    let repo = "react";
    try {
      const parsed = new URL(repoUrl);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts[1];
      }
    } catch (e) {}

    const fetched = await Promise.all(
      nums.map(async (n) => {
        try {
          const headers = { "User-Agent": "time-allocated-app" };
          if (ghToken)
            headers["Authorization"] =
              ghToken.startsWith("token ") || ghToken.startsWith("Bearer ")
                ? ghToken
                : `token ${ghToken}`;
          const url = `https://api.github.com/repos/${owner}/${repo}/issues/${n}`;
          const res = await fetch(url, { headers });
          if (!res.ok) return { number: n, title: "Lookup failed" };
          const body = await res.json();
          return { number: n, title: body.title, url: body.html_url };
        } catch (e) {
          return { number: n, title: "Error" };
        }
      }),
    );
    setIssues(fetched);
    // Save to spreadsheet (if configured)
    try {
      const spreadsheetId =
        localStorage.getItem("spreadsheetId") ||
        (import.meta.env && import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
      if (spreadsheetId) {
        const clientId =
          (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
        await sheetsClient.saveIssues(spreadsheetId, fetched, clientId);
      }
    } catch (e) {
      console.error("Failed to save issues", e);
    }
    // previously setStatus('ready') removed
    setError("");
    setActive(null);
  }

  async function selectIssue(issue) {
    // previously setStatus('saving') removed
    const headers = { "Content-Type": "application/json" };
    if (ghToken)
      headers["Authorization"] =
        ghToken.startsWith("token ") || ghToken.startsWith("Bearer ")
          ? ghToken
          : `token ${ghToken}`;
    // When selecting 'other' or 'other2', include the custom label so the server/client can use it
    // Special-case 'stop' to call the server stop endpoint instead of selecting a new active issue
    if (issue === "stop") {
      // Show the radio as selected immediately
      setActive("stop");
      try {
        // Stop: persist the active selection stored in sessionStorage to the spreadsheet
        const activeJson = sessionStorage.getItem("activeSelection");
        if (activeJson) {
          const activeObj = JSON.parse(activeJson);
          const now = new Date().toISOString();
          const duration = Math.round(
            (Date.parse(now) - Date.parse(activeObj.start)) / 1000,
          );
          const closed = {
            issue: activeObj.issue,
            start: activeObj.start,
            duration,
            repoUrl: activeObj.repoUrl || null,
          };
          const spreadsheetId =
            localStorage.getItem("spreadsheetId") ||
            (import.meta.env &&
              import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
          if (spreadsheetId) {
            const clientId =
              (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
              null;
            await sheetsClient.appendTiming(spreadsheetId, closed, clientId);
          }
        }
        // Clear active after stopping
        sessionStorage.removeItem("activeSelection");
        setActive(null);
        try {
          localStorage.setItem("selected_issue", "");
        } catch (err) {}
      } catch (e) {
        // ignore
      }
      return;
    }

    const payload = { issue, repoUrl };
    // Other/Custom handlers removed
    // Implement select locally: close any existing active selection and start a new one stored in sessionStorage
    try {
      const activeJson = sessionStorage.getItem("activeSelection");
      if (activeJson) {
        const activeObj = JSON.parse(activeJson);
        const now = new Date().toISOString();
        const duration = Math.round(
          (Date.parse(now) - Date.parse(activeObj.start)) / 1000,
        );
        const closed = {
          issue: activeObj.issue,
          start: activeObj.start,
          duration,
          repoUrl: activeObj.repoUrl || null,
        };
        const spreadsheetId =
          localStorage.getItem("spreadsheetId") ||
          (import.meta.env &&
            import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
        if (spreadsheetId) {
          const clientId =
            (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || null;
          await sheetsClient
            .appendTiming(spreadsheetId, closed, clientId)
            .catch(() => {});
        }
      }
    } catch (e) {
      /* ignore */
    }
    // Start new interval and persist in sessionStorage
    const newActive = { issue, start: new Date().toISOString(), repoUrl };
    sessionStorage.setItem("activeSelection", JSON.stringify(newActive));
    setActive(issue);
    try {
      localStorage.setItem("selected_issue", issue);
    } catch (err) {}
  }

  useEffect(() => {
    const saved = localStorage.getItem("repoUrl");
    if (saved) setRepoUrl(saved);
    // check Google auth status on load
    (async () => {
      // fetch server-provided config so we can build OAuth URLs server-side
      let cfg = {
        googleClientId:
          (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || "",
        googleRedirectUri:
          (import.meta.env && import.meta.env.VITE_GOOGLE_REDIRECT_URI) || "",
      };
      try {
        // derive config from env vars and expose it to the outer scope
        setServerConfig(cfg);
      } catch (e) {
        /* ignore */
      }

      // Detect OAuth redirect code and exchange for tokens
      try {
        console.log("[App] Current URL:", window.location.href);
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        // Check for Implicit Flow response in hash
        const hashStr = window.location.hash.substring(1);
        let hashParams = new URLSearchParams(hashStr);
        const accessToken = hashParams.get("access_token");
        const error = hashParams.get("error");

        console.log(
          "[App] Checking auth. Hash present:",
          !!hashStr,
          "AccessToken present:",
          !!accessToken,
          "Error:",
          error,
        );
        if (error) {
          console.error("[App] Auth error from Google:", error);
        }

        if (accessToken) {
          console.log("[App] Implicit flow detected. Saving tokens...");
          // Handle implicit flow
          if (window && window.history && window.history.replaceState) {
            const url = new URL(window.location.href);
            url.hash = "";
            // Also clear any legacy code param if present
            url.search = "";
            window.history.replaceState({}, "", url.toString());
          }

          // Handle Authorization Code (PKCE) response
          if (code) {
            try {
              console.log(
                "[App] Authorization code detected, exchanging for tokens...",
              );
              const clientId =
                (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
                cfg.googleClientId;
              const redirectUri =
                (import.meta.env && import.meta.env.VITE_GOOGLE_REDIRECT_URI) ||
                cfg.googleRedirectUri;
              const tokens = await tokenStore.exchangeCodeForTokens({
                code,
                clientId,
                redirectUri,
              });
              console.log("[App] Tokens received from exchange", tokens);
              // Clean URL to remove code
              if (window && window.history && window.history.replaceState) {
                const url = new URL(window.location.href);
                url.search = "";
                window.history.replaceState({}, "", url.toString());
              }
              // Ensure spreadsheet
              const spreadId =
                localStorage.getItem("spreadsheetId") ||
                (import.meta.env &&
                  import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
              const createdId = await sheetsClient
                .createSpreadsheetIfMissing(spreadId, clientId)
                .catch((err) => {
                  console.error("[App] Failed to create spreadsheet:", err);
                  return null;
                });
              if (createdId) localStorage.setItem("spreadsheetId", createdId);
              setAuthStatus({
                authenticated: true,
                expires_at: tokens.expiry_date || null,
              });
            } catch (e) {
              console.error("[App] Token exchange failed", e);
              try {
                setAuthStatus({ authenticated: false });
              } catch (_) {}
            }
          }
          const tokenStore = await import("./lib/tokenStore");
          const expiresIn = hashParams.get("expires_in");
          const tokens = {
            access_token: accessToken,
            token_type: hashParams.get("token_type"),
            scope: hashParams.get("scope"),
            expires_in: expiresIn,
            expiry_date: expiresIn
              ? Date.now() + Number(expiresIn) * 1000
              : null,
          };
          console.log("[App] Tokens constructed:", tokens);
          tokenStore.saveTokens(tokens);
          console.log("[App] Tokens saved to localStorage");

          const clientId =
            (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
            cfg.googleClientId;
          const spreadId =
            localStorage.getItem("spreadsheetId") ||
            (import.meta.env &&
              import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
          const createdId = await sheetsClient
            .createSpreadsheetIfMissing(spreadId, clientId)
            .catch((err) => {
              console.error("[App] Failed to create spreadsheet:", err);
              return null;
            });
          if (createdId) localStorage.setItem("spreadsheetId", createdId);
          setAuthStatus({
            authenticated: true,
            expires_at: tokens.expiry_date || null,
          });
        }
      } catch (e) {
        console.error("OAuth token exchange failed", e);
        try {
          setAuthStatus({ authenticated: false });
        } catch (_) {}
      }

      try {
        const tokens = tokenStore.loadTokens();
        console.log("[App] Loaded tokens from storage:", tokens);
        if (tokens) {
          setAuthStatus({
            authenticated: true,
            expires_at: tokens.expiry_date || null,
          });
          // Ensure spreadsheet exists if we have tokens but no spreadsheet ID
          const spreadId =
            localStorage.getItem("spreadsheetId") ||
            (import.meta.env &&
              import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
          if (!spreadId) {
            const clientId =
              (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
              cfg.googleClientId;
            sheetsClient
              .createSpreadsheetIfMissing(spreadId, clientId)
              .then((createdId) => {
                if (createdId) {
                  localStorage.setItem("spreadsheetId", createdId);
                  console.log("[App] Created missing spreadsheet:", createdId);
                }
              })
              .catch((err) =>
                console.error("[App] Failed to ensure spreadsheet:", err),
              );
          }
        } else if (authStatus.authenticated !== true)
          setAuthStatus({ authenticated: false });
        // If we were redirected after OAuth, parse query params to show immediate feedback
        try {
          const params = new URLSearchParams(window.location.search);
          const auth = params.get("auth");
          if (auth === "success") {
            const expires_at = params.get("expires_at");
            const email = params.get("email");
            setAuthStatus({
              authenticated: true,
              expires_at: expires_at || null,
              email: email || null,
            });
            // Clean up query params to keep URLs tidy
            if (window && window.history && window.history.replaceState) {
              const url = new URL(window.location.href);
              url.search = "";
              window.history.replaceState({}, "", url.toString());
            }
          } else if (auth === "failed") {
            setAuthStatus({ authenticated: false });
          }
        } catch (e) {
          /* ignore */
        }
        // Optionally auto-redirect to server auth route for user convenience
        try {
          const auto =
            (typeof import.meta !== "undefined" &&
              import.meta.env &&
              import.meta.env.VITE_AUTO_OPEN_AUTH) ||
            null;
          const shouldAuto =
            auto === "true" ||
            (auto === null &&
              window &&
              window.location.hostname === "localhost");
          const already = sessionStorage.getItem("auth_redirected");
          if (!tokens && shouldAuto && !already) {
            sessionStorage.setItem("auth_redirected", "1");
            try {
              const clientId =
                (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
                (serverConfig && serverConfig.googleClientId);
              let redirectUri =
                (import.meta.env && import.meta.env.VITE_GOOGLE_REDIRECT_URI) ||
                (serverConfig && serverConfig.googleRedirectUri);

              // If running locally, use the current origin to avoid redirecting to production
              if (
                window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1"
              ) {
                redirectUri = window.location.origin;
              }

              if (!clientId) {
                console.error("Missing Google Client ID");
                return;
              }
              const url = await buildAuthUrl({ clientId, redirectUri });
              window.location.href = url;
            } catch (e) {
              /* ignore */
            }
          }
        } catch (e) {
          /* ignore */
        }
      } catch (e) {
        setAuthStatus({ authenticated: false });
      }
    })();
  }, []);

  useEffect(() => {
    function handleUnload() {
      try {
        // On unload, try to save an active selection to the spreadsheet via navigator.sendBeacon where possible
        const activeJson = sessionStorage.getItem("activeSelection");
        if (activeJson) {
          try {
            const activeObj = JSON.parse(activeJson);
            const now = new Date().toISOString();
            const duration = Math.round(
              (Date.parse(now) - Date.parse(activeObj.start)) / 1000,
            );
            const closed = {
              issue: activeObj.issue,
              start: activeObj.start,
              duration,
              repoUrl: activeObj.repoUrl || null,
            };
            const spreadsheetId =
              localStorage.getItem("spreadsheetId") ||
              (import.meta.env &&
                import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
            if (spreadsheetId && navigator && navigator.sendBeacon) {
              const clientId =
                (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
                null;
              // Best-effort: send to a simple endpointless beacon (note: Google Sheets API requires auth; beacon may not work)
              // Fallback: persist to localStorage and rely on user to save later.
              localStorage.setItem(
                "stagedClosed",
                JSON.stringify({ spreadsheetId, closed, clientId }),
              );
            } else {
              localStorage.setItem("stagedClosed", JSON.stringify({ closed }));
            }
          } catch (e) {
            /* ignore */
          }
        }
      } catch (e) {
        /* ignore */
      }
    }
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  // Listen for token storage changes so UI notices when tokens are cleared across tabs
  useEffect(() => {
    async function checkTokens() {
      try {
        const tokens = tokenStore.loadTokens();
        if (!tokens) setAuthStatus({ authenticated: false });
      } catch (e) {
        setAuthStatus({ authenticated: false });
      }
    }

    function onStorage(e) {
      try {
        if (!e) return;
        // If \`time_alloc_tokens\` key changed (other tab), update auth state
        if (e.key === null || e.key === "time_alloc_tokens") {
          checkTokens();
        }
      } catch (err) {
        /* ignore */
      }
    }

    function onCustom() {
      // Same-tab token clears dispatch a custom event from tokenStore
      checkTokens();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("time_alloc_tokens_cleared", onCustom);

    // initial check
    checkTokens();

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("time_alloc_tokens_cleared", onCustom);
    };
  }, []);

  return (
    <div
      style={{ fontFamily: "Inter, system-ui, sans-serif", margin: "0 auto" }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20 }}>Time Allocated To Issue</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setView(view === "home" ? "timings" : "home")}
            style={{ padding: "6px 10px" }}
          >
            {view === "home" ? "Manage timings" : "Home"}
          </button>
          <button
            onClick={async () => {
              try {
                const spreadsheetId =
                  localStorage.getItem("spreadsheetId") ||
                  (import.meta.env &&
                    import.meta.env.VITE_GOOGLE_SHEETS_SPREADSHEET_ID);
                if (!spreadsheetId) {
                  alert(
                    "No spreadsheet configured. Please try refreshing the page to attempt creation.",
                  );
                  return;
                }
                const clientId =
                  (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) ||
                  null;
                const links = await sheetsClient
                  .getSheetLinks(spreadsheetId, clientId)
                  .catch((e) => {
                    console.error(e);
                    return null;
                  });
                const href = links && links.base ? links.base : null;
                if (href) window.open(href, "_blank");
                else alert("Could not determine sheet URL.");
              } catch (e) {
                console.error(e);
                alert("Error opening sheet.");
              }
            }}
            style={{ padding: "6px 10px" }}
          >
            View Google Sheet
          </button>

          {/* status removed */}
        </div>
      </header>

      {authStatus.authenticated === false && (
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            border: "1px solid #ffd7b5",
            background: "#fff4e6",
            borderRadius: 6,
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>
            Google Sheets not authorized
          </strong>
          <div style={{ marginBottom: 8 }}>
            To save timings to Google Sheets you need to authorize this app to
            access your Google account.
          </div>
          <div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const clientId =
                    serverConfig && serverConfig.googleClientId
                      ? serverConfig.googleClientId
                      : import.meta.env &&
                        import.meta.env.VITE_GOOGLE_CLIENT_ID;
                  let redirectUri =
                    serverConfig && serverConfig.googleRedirectUri
                      ? serverConfig.googleRedirectUri
                      : import.meta.env &&
                        import.meta.env.VITE_GOOGLE_REDIRECT_URI;

                  // If running locally, use the current origin to avoid redirecting to production
                  if (
                    window.location.hostname === "localhost" ||
                    window.location.hostname === "127.0.0.1"
                  ) {
                    redirectUri = window.location.origin;
                  }

                  if (!clientId) {
                    alert("Missing Google Client ID configuration");
                    return;
                  }
                  const url = await buildAuthUrl({ clientId, redirectUri });
                  window.location.href = url;
                } catch (e) {
                  console.error("Auth start failed", e);
                }
              }}
              style={{
                padding: "8px 12px",
                background: "#2b7cff",
                color: "#fff",
                border: "none",
                borderRadius: 4,
              }}
            >
              Authorize with Google
            </button>
          </div>
        </div>
      )}

      {view === "timings" && (
        <TimingsPage
          onBack={() => setView("home")}
          repoUrl={repoUrl}
          ghToken={ghToken}
          setGhToken={setGhToken}
        />
      )}
      {view === "home" && (
        <section style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              padding: 12,
              border: "1px solid #e6e6e6",
              borderRadius: 8,
              background: "#fafafa",
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: 13,
                color: "#333",
                marginBottom: 6,
              }}
            >
              GitHub repo URL
            </label>
            <input
              aria-label="repo-url"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 14,
                boxSizing: "border-box",
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <input
                aria-label="issue-numbers"
                placeholder="e.g. 123, 456"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError("");
                }}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: 14,
                  height: 40,
                  minWidth: 0,
                  boxSizing: "border-box",
                }}
              />
              {error && (
                <div
                  role="alert"
                  style={{ color: "#8b0000", marginTop: 6, fontSize: 13 }}
                >
                  {error}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => addIssues()}
              style={{ padding: "10px 12px", height: 40 }}
            >
              Load
            </button>

            {/* Upload from file removed */}
          </div>

          <div>
            {issues.length === 0 && (
              <div style={{ color: "#666", fontSize: 13 }}>
                No issues loaded.
              </div>
            )}

            {issues.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  border: "1px solid #eee",
                  borderRadius: 8,
                }}
              >
                <div style={{ marginBottom: 8 }} />
                <form>
                  {issues.map((i) => (
                    <label
                      key={i.number}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 0",
                      }}
                    >
                      <input
                        type="radio"
                        name="issue"
                        value={i.number}
                        checked={active === i.number}
                        onChange={() => selectIssue(i.number)}
                        style={{ width: 18, height: 18 }}
                      />
                      <div style={{ flex: 1, fontSize: 14, lineHeight: "1.2" }}>
                        <div
                          style={{
                            fontWeight: 600,
                            marginBottom: 4,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          #{i.number}
                          {i.url && (
                            <a
                              href={i.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: 12,
                                fontWeight: 400,
                                color: "#0969da",
                              }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              View on GitHub
                            </a>
                          )}
                        </div>
                        <div style={{ color: "#444" }}>{i.title}</div>
                      </div>
                      {active === i.number && (
                        <span
                          style={{
                            fontSize: 12,
                            padding: "4px 8px",
                            background: "#eef9ff",
                            borderRadius: 10,
                          }}
                        >
                          Active
                        </span>
                      )}
                    </label>
                  ))}

                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "8px 0",
                    }}
                  >
                    <input
                      type="radio"
                      name="issue"
                      value="stop"
                      checked={active === "stop"}
                      onChange={() => selectIssue("stop")}
                      style={{ width: 18, height: 18 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>Stop</div>
                      <div style={{ color: "#666", fontSize: 13 }}>
                        Close the current timing interval
                      </div>
                    </div>
                  </label>
                </form>
              </div>
            )}
          </div>
          <div
            style={{
              marginTop: 12,
              padding: 12,
              border: "1px solid #eee",
              borderRadius: 8,
              background: "#fff",
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: 14,
                fontWeight: 600,
                color: "#222",
                marginBottom: 8,
              }}
            >
              Notes
            </label>
            <textarea
              aria-label="notes"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const trimmed = (noteText || "").trim();
                  if (!trimmed) return;
                  try {
                    await saveNote(trimmed);
                    setNoteText("");
                  } catch (err) {
                    console.error("Failed to save note", err);
                    alert("Failed to save note. Check console for details.");
                  }
                }
              }}
              style={{
                width: "100%",
                minHeight: 140,
                padding: "10px 12px",
                fontSize: 14,
                boxSizing: "border-box",
                borderRadius: 6,
                border: "1px solid #e6e6e6",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button
              type="button"
              disabled={notesSaving || !(noteText || "").trim()}
              onClick={async () => {
                const trimmed = (noteText || "").trim();
                if (!trimmed) return;
                try {
                  await saveNote(trimmed);
                  setNoteText("");
                } catch (err) {
                  console.error("Failed to save note", err);
                  alert("Failed to save note. Check console for details.");
                }
              }}
              style={{ padding: "8px 12px" }}
            >
              {notesSaving ? "Saving…" : "Submit"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
