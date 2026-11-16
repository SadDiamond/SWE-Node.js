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
