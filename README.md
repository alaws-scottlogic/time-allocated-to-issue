# Time Allocated to GitHub Issue
Setup & Run
-----------
- Install dependencies for server and client and start both services:

```bash
npm run install-all
npm start
```

Usage
-----
-  By default, the application runs at [`http://localhost:5173`](http://localhost:5173).
- Provide a list of comma-separated GitHub issue numbers in the UI and select an issue using the radio buttons.
- Each time you change the selected issue, the app records a timestamped interval to local storage on the server (see `data/timings.json`).

GitHub token (optional)
-----------------------
- To avoid GitHub API rate limits or access private repos, set a `GITHUB_TOKEN` environment variable before starting the server:

```bash
export GITHUB_TOKEN="{token}"
```