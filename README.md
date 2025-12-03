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
- The app records timestamped intervals to `data/timings.json` whenever the selected issue changes.
- Time entries can then be viewed and edited on the Manage Timings page.

**End Of Day**
- This is purely based on how much time the user feels they spent on each category that day, not based on any tracked data.
- The user will be asked to fill 8 hours total before saving, but this is not a strict requirement.
- Data is saved to `data/eod.json` upon clicking "Save".
- If a there is existing entry for the day, it will be loaded for the user to edit.

GitHub token (optional)
-----------------------
- To avoid GitHub API rate limits or access private repos, set a `GITHUB_TOKEN` environment variable before starting the server:

```bash
export GITHUB_TOKEN="{token}"
```
