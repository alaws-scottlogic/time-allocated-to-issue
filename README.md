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
- Storage: timing intervals and EOD entries are written to Google Sheets via a service account (no local JSON file).

Google Sheets setup
-------------------
- Create a spreadsheet with tabs named `Timings` and `EOD`.
- Share the spreadsheet with the service account `client_email` (Editor).
- Set the following environment variables before starting the server:

You can configure via a `.env` (loaded by `dotenv`). Example:

```
GOOGLE_SERVICE_ACCOUNT_KEY_JSON=<service-account-key-json>
GOOGLE_SHEETS_SPREADSHEET_ID=<your-spreadsheet-id>
```

where `spreadsheet-id` is found in the URL of your Google Sheets document `https://docs.google.com/spreadsheets/d/<spreadsheet-id>/edit`.

GitHub token (optional)
-----------------------
- To avoid GitHub API rate limits or access private repos, set a `GITHUB_TOKEN` environment variable before starting the server:

```bash
export GITHUB_TOKEN="{token}"
```
