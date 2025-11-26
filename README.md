# time-allocated-to-issue

Project: time-allocated-to-issue

Summary
-------
This project will be a small web application with a React front-end and a Node.js backend. The app lets developers select which GitHub issue they are currently working on from a list of issue numbers. The backend will record the times each issue is selected and persist those records to local storage.

Requirements
------------
- Front-end: React app that allows inputting a list of GitHub issue numbers and shows each issue's title (fetched from GitHub).
- For each issue in the list, display a radio button so a developer can select the issue they are currently working on.
- Include an explicit "Other" radio option for work that doesn't map to any listed issue.
- The UI should not display a visible timer; timing is handled behind the scenes when selections change.
- Back-end: Node.js (Express) API that receives selection events and records the start and stop timestamps for each issue selection.
- Persistence: store selection intervals in local server storage (e.g. a JSON file on disk). The README uses the term "local storage" — clarify whether this should be browser localStorage or server-side file storage (see questions below).

Behavior details
----------------
- When a developer selects an issue (or "Other"), the front-end will POST an event to the backend to indicate the new selection.
- The backend will record the end time for the previously selected issue and the start time for the newly selected issue.
- There is no visible timer in the UI; timing is implicit based on selection events and timestamps recorded server-side.
- Fetching issue titles: the backend (or frontend with appropriate token) will look up each issue title from the GitHub API when given issue numbers.

Acceptance criteria
-------------------
- The app displays a list of provided issue numbers and their titles.
- Selecting a radio button for an issue causes the backend to append a timestamped selection interval for that issue to persistent storage.
- The backend stores intervals in a local file (or other agreed storage) in a simple JSON format, e.g.:

	[{"issue":123, "start":"2025-11-26T12:00:00Z", "end":"2025-11-26T12:30:00Z"}, ...]

Questions / Clarifications
-------------------------
1. Persistence target: do you want timings stored in the browser's `localStorage` (per-device, per-user) or on the server (shared across users) as a file (e.g. `data/timings.json`)?
2. GitHub authentication: will you provide a personal access token for the GitHub API, or should the app attempt unauthenticated requests (rate-limited)? If private repos are needed, a token will be required.
3. Multi-developer handling: should multiple users/devices be able to use the app concurrently and have their selections stored separately (e.g., with a `user` field)?
4. Selection behavior: what should happen if the developer deselects all radios (no selection) — should the backend record an end time for the previous selection and leave no active selection, or should one selection always be required?
5. "Other" details: should "Other" allow a free-text description to be stored with the interval?
6. Data export: the current UI does not provide a download button. If you still want export capability, specify whether a server endpoint or admin-only export is preferred.

Next steps
----------
- After you answer the questions above I'll scaffold a minimal React + Express project, implement the endpoints for issue title lookup and selection recording, and wire the front-end UI to POST selection events.

Running the app
---------------
To install dependencies for both server and client and start them together with a single command, run:

```bash
npm run install-all
npm start
```

`npm start` will run both the backend and the frontend concurrently (frontend uses Vite dev server and proxies `/api` to the backend).
