# Close Enough

A daily puzzle: find the hidden curve by drawing it.

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
