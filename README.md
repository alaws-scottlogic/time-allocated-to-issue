# Time Allocated to GitHub Issue
Setup & Run
-----------
- Install dependencies for server and client and start both services:

```bash
npm run install-all
npm start
```

- Runs at `http://localhost:5173` by default.

Usage
-----------
**Issue Time Tracking**
- Enter comma-separated GitHub issue numbers in the UI and select an issue
- The app records timestamped intervals to a Google Sheets spreadsheet whenever the selected issue changes.
- Time entries can then be viewed and edited on the Manage Timings page.

**End Of Day**
- This is purely based on how much time the user feels they spent on each category that day, not based on any tracked data.
- The user will be asked to fill 8 hours total before saving, but this is not a strict requirement.
- Data is saved to the Google Sheets spreadsheet upon clicking "Save".
- If a there is existing entry for the day, it will be loaded for the user to edit.
-----
-  By default, the application runs at [`http://localhost:5173`](http://localhost:5173).
- Provide a list of comma-separated GitHub issue numbers in the UI and select an issue using the radio buttons.
 - Storage: timing intervals and EOD entries are written to Google Sheets via OAuth2. The server supports an interactive OAuth flow that stores tokens locally for development.

**Google Sheets setup**
- **Auto-create spreadsheet:** When you first authenticate, the server will create a Google Sheets spreadsheet named `Time Allocated to Issue` (or the title set by `GOOGLE_SHEETS_SPREADSHEET_TITLE`) with the tabs `Timings`, `EOD`, and `Issues` and initialize headers automatically. You do not need to create a spreadsheet yourself.
- **Existing spreadsheet:** To use an existing spreadsheet instead, set `GOOGLE_SHEETS_SPREADSHEET_ID` in your `.env`.

You can configure via a `.env` (loaded by `dotenv`). Required env vars for OAuth flow:

```
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
```

After the server creates the spreadsheet the server sets `process.env.GOOGLE_SHEETS_SPREADSHEET_ID` at runtime so subsequent requests during the same process will use the created spreadsheet. If you prefer to persist the id across restarts, copy the spreadsheet id from the server logs after creation and add it to your `.env` as `GOOGLE_SHEETS_SPREADSHEET_ID`.

To obtain `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, create an OAuth 2.0 Client ID in Google Cloud Console and add the redirect URI above to its Authorized redirect URIs.

Run the server, then open `http://localhost:4000/auth/google` to start the OAuth consent flow. Tokens will be saved to `server/credentials.json` for local development.

GitHub token (optional)
-----------------------
- To avoid GitHub API rate limits or access private repos, set a `GITHUB_TOKEN` environment variable before starting the server:

```bash
export GITHUB_TOKEN="{token}"
```

Client-only hosting (GitHub Pages)
---------------------------------
- This repository includes a client-only mode that uses PKCE OAuth in the browser and the Google Sheets REST API directly. To publish the site to GitHub Pages you should:
	- Register a Web OAuth client in Google Cloud Console with your GitHub Pages origin and redirect URI.
	- Build the `client/` site and deploy `client/dist` to GitHub Pages (use `gh-pages` or a GitHub Actions workflow).
	- Configure `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_REDIRECT_URI` during build time (e.g. in GH Actions) so the client can start the PKCE flow.

Local dev notes (use client redirect)
	1. Open Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client ID.
	2. Add `http://localhost:5173/` to the list of "Authorized redirect URIs".
	3. Put your `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_REDIRECT_URI` in `client/.env` (copy `client/.env.example`).
	4. Start the client dev server and click "Authorize with Google" in the app.

Serverless deployment notes
--------------------------
If you prefer to keep refresh tokens server-side, you can deploy minimal serverless functions (Vercel/Netlify) to handle the OAuth redirect and token exchange. Sample handlers are included under `serverless/`:

- `serverless/auth.js` — starts the OAuth flow and redirects to Google.
- `serverless/callback.js` — exchanges the authorization `code` for tokens and optionally persists them to disk (use `PERSIST_TOKENS=true` to enable file persistence).

Environment variables to set on the serverless host:
- `GOOGLE_CLIENT_ID` — your OAuth client id
- `GOOGLE_CLIENT_SECRET` — your OAuth client secret
- `GOOGLE_REDIRECT_URI` — the callback URI (e.g. `https://<your-host>/api/callback`)
- `CLIENT_BASE_URL` — your client app URL so the server can redirect back after auth
- `PERSIST_TOKENS` — set to `true` to persist tokens to a file (or modify `callback.js` to use Redis or another store)

Deploy to Vercel: push this repo and create a Vercel project; set the above environment variables in the Vercel dashboard, then use the `/serverless` endpoints (`/api/auth` and `/api/callback`) as your `GOOGLE_REDIRECT_URI` and auth starting endpoint.
Security note
-------------
- The `.env` file may contain sensitive credentials (service account private keys, client secrets). Do not commit `.env` to a public repo. Rotate any secrets that were accidentally committed.
- Storing refresh tokens or private keys in the browser is less secure than keeping them server-side. For long-lived, multi-user deployments prefer hosting the server or serverless functions for token persistence.
