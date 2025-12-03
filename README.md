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

Google Sheets setup
-------------------
- Create a spreadsheet with tabs named `Timings` and `EOD`.

You can configure via a `.env` (loaded by `dotenv`). Required env vars for OAuth flow:

```
GOOGLE_CLIENT_ID=<your-google-client-id>
GOOGLE_CLIENT_SECRET=<your-google-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:4000/auth/google/callback
GOOGLE_SHEETS_SPREADSHEET_ID=<your-spreadsheet-id>
```
where `spreadsheet-id` is found in the URL of your Google Sheets document `https://docs.google.com/spreadsheets/d/<spreadsheet-id>/edit`.

- To obtain `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, create an OAuth 2.0 Client ID in Google Cloud Console and add the redirect URI above to its Authorized redirect URIs.
- Run the server, then open `http://localhost:4000/auth/google` to start the OAuth consent flow. Tokens will be saved to `server/credentials.json` for local development.

GitHub token (optional)
-----------------------
- To avoid GitHub API rate limits or access private repos, set a `GITHUB_TOKEN` environment variable before starting the server:

```bash
export GITHUB_TOKEN="{token}"
```
