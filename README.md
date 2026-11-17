# Placeholder

A daily puzzle about working out the rule hidden inside a machine.

## Running the project

Requires Node.js 20 or later.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Checks

`npm test` checks the curve maths and marking.

`npm run test:browser` plays the game in a real browser, using its own throwaway database. It needs Playwright the first time:

```bash
npm install --save-dev playwright
npx playwright install chromium
```

## Daily curves and offline play

The site can be installed as an app, and Endless works with no connection.
Because the curve maths is sent to the browser for that, the daily curves also depend on a secret only the server knows.
It is made the first time the server starts and kept in `data/daily-secret`, which is not committed.
Keep that file (or set `DAILY_SECRET`) when moving the site to another computer, or future daily curves will change.

## Putting it online

Any host that runs Node.js 20 or later works, as long as it has **storage that survives restarts**,
because the database and the daily secret are files in `data/`. Hosts that wipe files on every
restart or deploy will lose everyone's accounts and scores.

- **Install command:** `npm install`
- **Start command:** `npm start`
- **HTTPS:** let the host provide it. Installing the site as an app only works over HTTPS.

Settings, given as environment variables on the host:

| Variable | What it does |
|---|---|
| `PORT` | The port to listen on. Most hosts set this themselves. |
| `TRUST_PROXY` | Set to `1` when the host puts the site behind a proxy, which almost all do. Without it the request limits treat every visitor as the same person. |
| `DATABASE_PATH` | Where the database file lives. Point it at the host's lasting storage. |
| `DAILY_SECRET` | The secret behind the daily curves. Set it once and never change it, or copy `data/daily-secret` across instead. |
