# Time Allocated to Issues - Google Sheets Time Tracker

**Features**
- **Quick tracking:** Start/stop timers against an issue ID and save timings.
- **Google Sheets:** Save timings to a Google Sheet via the Sheets API.
- **OAuth (PKCE):** Client-side PKCE flow to exchange codes for tokens; serverless helpers included.
- **E2E tests:** Playwright is included for end-to-end tests.

**Repository Layout**
- **`/src`**: Main React source (components, pages, `lib` helpers).
- **`/lib`** and **`/serverless`**: Small server-side helpers and functions used for OAuth.
- **`/pages`** or top-level `App.jsx` / `main.jsx`: App entry points.
- **`package.json`**: Scripts for dev, build, preview, tests and deployment.

**Prerequisites**
- Node.js (v16+) and npm.
- A Google Cloud project with OAuth credentials (Web application / or configured for PKCE usage)

**Environment / Configuration**
The app expects a few environment variables when building/running locally (Vite uses `VITE_`-prefixed vars):

- `VITE_GOOGLE_CLIENT_ID`: Your Google OAuth Client ID.
- `VITE_GOOGLE_REDIRECT_URI`: Redirect URI registered in Google Cloud (e.g. `http://localhost:5173/` for local dev).

Other optional client-side values that may be stored at runtime:
- `spreadsheetId` (localStorage): ID of the Google Sheet where timings are written.

**Local development**
1. Install deps:

```bash
npm install
```

2. Create a `.env` file in the project root (or set env vars for Vite) with at least:

```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_REDIRECT_URI=http://localhost:5173/
```

3. Start the application:

```bash
npm run dev
```

Open `http://localhost:5173/` and use the app. Click the Authorize/Authorize Google button to start the OAuth flow.

**Build & Deploy**
- Build: `npm run build`
- Deploy to GitHub Pages (configured in `package.json`): `npm run deploy`. The repo includes a `predeploy` script which runs the build first. If you use `gh-pages`, you may need to provide a `GITHUB_TOKEN` or configure GitHub Actions for CI deploys.

**OAuth notes**
- The client implements a PKCE flow (code verifier/challenge) and exchanges the code directly with Google's token endpoint from the client. A refresh token is stored in `localStorage` by the client library (see `src/lib/tokenStore.js` / `lib/tokenStore.js`).
- Scopes requested include `openid email profile` and `https://www.googleapis.com/auth/spreadsheets`.

**Troubleshooting**
- If the OAuth redirect fails, confirm `VITE_GOOGLE_REDIRECT_URI` exactly matches the URI registered in Google Cloud (including trailing slash and protocol).
- If tokens are not saved, open the browser console and look for logs from `oauth` and `tokenStore` modules.
 
Testing tips for local dev
- **Verify PKCE persists:** When you click "Authorize with Google", check the browser console for the log `pkce_code_verifier stored: true`. If false, the verifier was not saved and the exchange will fail.
- **Check redirect URI:** Ensure the `redirect_uri` printed to the console matches the value registered in your Google Cloud OAuth client. Mismatches cause token exchange failures.
- **Inspect errors:** If authorization completes but you're redirected back and prompted again, open DevTools -> Console and look for `[tokenStore] No PKCE code verifier found` or `OAuth token exchange failed` messages. Copy those into an issue if you need help.
