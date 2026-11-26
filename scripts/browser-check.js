// Plays the game in a real browser. Run with: npm run test:browser
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium');
  process.exit(1);
}

const PORT = 3123;
const SITE = `http://localhost:${PORT}`;
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'close-enough-check-'));

function startServer() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(folder, 'check.db') }
  });
  return new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => {
      if (String(data).includes('running at')) resolve(server);
    });
    server.stderr.on('data', (data) => process.stderr.write(data));
    server.on('exit', (code) => reject(new Error(`The server stopped with code ${code}`)));
  });
}

async function draw(page, points) {
  const box = await page.locator('#graph').boundingBox();
  const at = ([x, y]) => [box.x + ((x + 10) / 20) * box.width, box.y + ((10 - y) / 20) * box.height];
  await page.mouse.move(...at(points[0]));
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(...at(point), { steps: 8 });
  await page.mouse.up();
}

const status = (page) => page.locator('#form-status').textContent();
const across = [[-9, 2], [-3, 2], [3, 2], [9, 2]];

async function check(name, test) {
  await test();
  console.log(`  ok  ${name}`);
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (context) => {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    return page;
  };

  try {
    const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await newPage(guest);

    await check('the how to play popup opens on the first visit only', async () => {
      await page.goto(SITE);
      await page.waitForSelector('#how-to-play[open]');
      await page.click('#close-how-to-play');
      await page.reload();
      await page.waitForSelector('#tabs li');
      assert.strictEqual(await page.locator('#how-to-play').evaluate((dialog) => dialog.open), false);
    });

    await check('an attempt is marked and the curve is shown after the last one', async () => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await draw(page, across);
        await page.waitForFunction((count) => document.querySelectorAll('#attempts .used').length === count
          || !document.querySelector('#result').hidden, attempt);
        if (await page.locator('#result').isVisible()) break;
        assert.match(await status(page), /\d+%/);
      }
      await page.waitForSelector('#result:not([hidden])');
      const heading = await page.locator('#result-heading').textContent();
      const found = /^(Found it|Nailed it|Spot on)/.test(heading);
      if (found) {
        assert.ok((await page.locator('#result-formula').textContent()).length > 0, 'the formula is revealed');
      } else {
        assert.ok(await page.locator('#result-kept').isVisible(), "a guest who missed today's curve is told the answer comes tomorrow");
        assert.strictEqual(await page.locator('#result-formula').isVisible(), false);
      }
    });

    await check('running out of ink on a curve in pieces still gets the attempt marked', async () => {
      let info = '';
      for (let tries = 0; tries < 60 && !info.includes('pieces'); tries += 1) {
        await page.goto(`${SITE}/endless.html?slot=3`);
        await page.waitForFunction(() => document.querySelector('#stroke-info').textContent.length > 0);
        info = await page.locator('#stroke-info').textContent();
      }
      assert.ok(info.includes('pieces'), 'found a curve in pieces');
      const zigzag = [];
      for (let step = 0; step < 120; step += 1) zigzag.push([step % 2 === 0 ? -9 : 9, -9 + step * 0.15]);
      await draw(page, zigzag);
      await page.waitForFunction(() => /\d+%/.test(document.querySelector('#form-status').textContent));
    });

    await check('a past day can be opened and played', async () => {
      await page.goto(`${SITE}/past.html`);
      await page.waitForSelector('#days a');
      assert.strictEqual(await page.locator('#days a').count(), 30);
      await page.locator('#days a').nth(4).click();
      await page.waitForSelector('#tabs li');
      assert.match(await page.locator('h1').textContent(), /\d+ [A-Z][a-z]+/);
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        await draw(page, across);
        await page.waitForFunction((count) => document.querySelectorAll('#attempts .used').length === count
          || !document.querySelector('#result').hidden, attempt);
        if (await page.locator('#result').isVisible()) break;
      }
      await page.waitForSelector('#result:not([hidden])');
      assert.ok((await page.locator('#result-formula').textContent()).length > 0, "a past day's formula is shown to guests");
    });

    await check('a logged in player keeps their attempts after reloading', async () => {
      const player = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const signedIn = await newPage(player);
      await signedIn.goto(`${SITE}/account.html`);
      await signedIn.fill('#signup-username', `checker${Date.now() % 100000}`);
      await signedIn.fill('#signup-password', 'a long enough password');
      await signedIn.locator('#signup-password').press('Enter');
      await signedIn.waitForURL(`${SITE}/`);
      await signedIn.click('#close-how-to-play');
      await draw(signedIn, across);
      await signedIn.waitForFunction(() => document.querySelectorAll('#attempts .used').length === 1);
      await signedIn.reload();
      await signedIn.waitForSelector('#tabs li');
      assert.strictEqual(await signedIn.locator('#attempts .used').count(), 1);
    });

    await check('every page loads in dark mode', async () => {
      const dark = await browser.newContext({ colorScheme: 'dark' });
      const darkPage = await newPage(dark);
      for (const address of ['/', '/past.html', '/endless.html', '/history.html', '/stats.html', '/account.html']) {
        await darkPage.goto(SITE + address);
        await darkPage.waitForLoadState('networkidle');
      }
      const background = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.notStrictEqual(background, 'rgb(251, 250, 246)', 'the page is not the light background');
    });

    await check('the first hint says what kind of curve it is, and double-clicking only uses one', async () => {
      const hinted = await newPage(await browser.newContext());
      await hinted.addInitScript(() => localStorage.setItem('seenHowToPlay', 'yes'));
      await hinted.goto(SITE);
      await hinted.waitForSelector('#tabs li');
      await hinted.locator('#hint').dblclick();
      await hinted.waitForSelector('#shape-text:not([hidden])');
      await hinted.waitForTimeout(500);
      assert.strictEqual(await hinted.locator('circle.dot').count(), 0, 'no dot yet');
      assert.match(await hinted.locator('#hint-text').textContent(), /2 left/);
      await hinted.click('#hint');
      await hinted.waitForSelector('circle.dot');
      assert.match(await hinted.locator('#hint-text').textContent(), /1 left/, 'the second hint is a dot');
    });

    await check('a guest keeps their attempts and hints after reloading', async () => {
      const guestPage = await newPage(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
      await guestPage.addInitScript(() => localStorage.setItem('seenHowToPlay', 'yes'));
      await guestPage.goto(SITE);
      await guestPage.waitForSelector('#tabs li');
      await guestPage.click('#hint');
      await guestPage.waitForSelector('#shape-text:not([hidden])');
      await guestPage.click('#hint');
      await guestPage.waitForSelector('circle.dot');
      await draw(guestPage, across);
      await guestPage.waitForFunction(() => document.querySelectorAll('#attempts .used').length === 1);
      await guestPage.reload();
      await guestPage.waitForSelector('#tabs li');
      assert.strictEqual(await guestPage.locator('#attempts .used').count(), 1, 'the attempt is still used');
      assert.strictEqual(await guestPage.locator('circle.dot').count(), 1, 'the hint dot is still there');
      assert.ok(await guestPage.locator('#shape-text').isVisible(), 'and so is the kind of curve');
    });

    await check('a second tab catches up instead of getting stuck', async () => {
      const player = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await player.addInitScript(() => localStorage.setItem('seenHowToPlay', 'yes'));
      const first = await newPage(player);
      await first.goto(`${SITE}/account.html`);
      await first.fill('#signup-username', `tabs${Date.now() % 100000}`);
      await first.fill('#signup-password', 'a long enough password');
      await first.locator('#signup-password').press('Enter');
      await first.waitForURL(`${SITE}/`);
      await first.waitForSelector('#tabs li');
      const second = await newPage(player);
      await second.goto(SITE);
      await second.waitForSelector('#tabs li');
      for (let attempt = 0; attempt < 5 && !(await first.locator('#result').isVisible()); attempt += 1) {
        await draw(first, across);
        await first.waitForFunction((count) => document.querySelectorAll('#attempts .used').length === count
          || !document.querySelector('#result').hidden, attempt + 1);
      }
      await draw(second, across);
      await second.waitForFunction(() => document.querySelector('.tab.current')?.textContent.includes('Medium'));
    });

    await check('a loop can be played in endless mode and is revealed in full', async () => {
      const loops = await newPage(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
      await loops.addInitScript(() => localStorage.setItem('seenHowToPlay', 'yes'));
      await loops.goto(`${SITE}/endless.html?slot=4`);
      await loops.waitForFunction(() => document.querySelector('#today-date').textContent === 'Loops and turns');
      const twoStrokes = (await loops.locator('#stroke-info').textContent()).includes('2 pieces');
      for (let attempt = 0; attempt < 5 && !(await loops.locator('#result').isVisible()); attempt += 1) {
        await draw(loops, across);
        if (twoStrokes) await draw(loops, [[-9, -2], [0, -2], [9, -2]]);
        await loops.waitForFunction((count) => document.querySelectorAll('#attempts .used').length === count
          || !document.querySelector('#result').hidden, attempt + 1);
      }
      await loops.waitForSelector('#result:not([hidden])');
      assert.ok(await loops.locator('path.truth').count() >= 2, 'both halves of the shape are drawn');
      assert.match(await loops.locator('#result-type').textContent(),
        /^(Circle|Ellipse|Sideways parabola|Diamond|Rounded square|Sideways V|Sideways hyperbola|Up and down hyperbola)$/);
    });

    await check('the right shape in the wrong place only counts on the last attempt', async () => {
      const rules = require('../src/rules');
      let seed = 0;
      let drawing = null;
      while (!drawing) {
        seed += 1;
        const curve = rules.curveFromSeed(seed, 1);
        const stroke = [];
        rules.visibleCurve(curve).forEach((output, column) => {
          const point = [rules.inputFor(column) + 1.5, output + 1];
          if (output !== null && Math.abs(point[0]) <= 10 && Math.abs(point[1]) <= 10) stroke.push(point);
        });
        if (stroke.length > 1 && rules.judge([stroke], curve).closeEnough) drawing = [stroke];
      }
      const attempt = async (attempt) => {
        const response = await fetch(`${SITE}/api/curves/r${seed}s1/attempts`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drawing, attempt, hints: 0 })
        });
        return response.json();
      };
      const first = await attempt(1);
      assert.strictEqual(first.finished, false, 'the first attempt is not ended by being close enough');
      assert.strictEqual(first.closeEnough, true, 'but the player is told it is the right shape');
      const last = await attempt(5);
      assert.strictEqual(last.found, true, 'on the last attempt it counts as found');
    });

    await check('too many wrong passwords or requests are refused for a while', async () => {
      const post = (address, body, cookie = '') => fetch(SITE + address, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body)
      });
      const username = `limit${Date.now() % 100000}`;
      const signup = await post('/api/signup', { username, password: 'the right password' });
      const cookie = signup.headers.get('set-cookie').split(';')[0];
      for (let wrong = 0; wrong < 5; wrong += 1) {
        assert.strictEqual((await post('/api/login', { username, password: 'not it' })).status, 401);
      }
      assert.strictEqual((await post('/api/login', { username, password: 'the right password' })).status, 429,
        'after five wrong passwords even the right one has to wait');

      const today = await (await fetch(`${SITE}/api/today`)).json();
      const statuses = [];
      for (let request = 0; request < 61; request += 1) {
        statuses.push((await post(`/api/curves/${today.curves[0].id}/hint`, {}, cookie)).status);
      }
      assert.ok(!statuses.slice(0, 60).includes(429), 'sixty requests a minute are fine');
      assert.strictEqual(statuses[60], 429, 'the sixty-first is refused');
    });

    await check('odd or doubled requests get a clear answer, and guests cannot skip to the answer', async () => {
      const today = await (await fetch(`${SITE}/api/today`)).json();
      const hard = today.curves[2];
      const send = (address, options) => fetch(SITE + address, { method: 'POST', ...options });
      assert.strictEqual((await send(`/api/curves/${hard.id}/hint`)).status, 400, 'a request with no body is not a server error');
      assert.strictEqual((await send('/api/login', { body: 'username=a&password=b',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 401, 'neither is a form instead of JSON');

      const scribble = [[[-9, -9], [-8, -8]]];
      const skipped = await (await send(`/api/curves/${hard.id}/attempts`, {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ drawing: scribble, attempt: 5, hints: 0 })
      })).json();
      assert.strictEqual(skipped.finished, true);
      assert.strictEqual(skipped.formula, undefined, "a guest who jumps to the last attempt doesn't see today's formula");
      assert.strictEqual(skipped.curve, undefined, 'or the curve');

      const username = `twice${Date.now() % 100000}`;
      const signups = await Promise.all([1, 2, 3].map(() => send('/api/signup', {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'a fine password' })
      })));
      assert.deepStrictEqual(signups.map((reply) => reply.status).sort(), [201, 409, 409], 'signing up twice at once is not a server error');
    });

    await check('with no connection the site still opens and endless can be played', async () => {
      const travelling = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      await travelling.addInitScript(() => localStorage.setItem('seenHowToPlay', 'yes'));
      const away = await newPage(travelling);
      await away.goto(`${SITE}/endless.html`);
      await away.evaluate(() => navigator.serviceWorker.ready);
      await away.reload();
      await away.waitForFunction(() => navigator.serviceWorker.controller !== null);

      await travelling.setOffline(true);
      await away.goto(`${SITE}/endless.html?slot=2`);
      await away.waitForFunction(() => document.querySelector('#today-date').textContent === 'Medium curve');
      await away.click('#hint');
      await away.waitForSelector('#shape-text:not([hidden])');
      for (let attempt = 0; attempt < 5 && !(await away.locator('#result').isVisible()); attempt += 1) {
        await draw(away, across);
        await away.waitForFunction((count) => document.querySelectorAll('#attempts .used').length === count
          || !document.querySelector('#result').hidden, attempt + 1);
      }
      await away.waitForSelector('#result:not([hidden])');
      assert.ok((await away.locator('#result-formula math').count()) > 0, 'the formula is drawn as maths offline too');

      await away.goto(SITE);
      await away.waitForSelector('.offline-note');
      assert.ok(await away.locator('#graph').isHidden(), 'the empty game is hidden while offline');
      await travelling.setOffline(false);
    });

    await check('switching back and forth leaves nothing behind', async () => {
      const flipping = await newPage(await browser.newContext({ colorScheme: 'dark' }));
      await flipping.goto(`${SITE}/past.html`);
      for (const expected of ['light', 'dark', 'light', 'dark']) {
        await flipping.click('#theme-button');
        await flipping.waitForFunction(() => !document.documentElement.dataset.going);
        const state = await flipping.evaluate(() => ({
          theme: document.documentElement.dataset.theme, leftover: document.getAnimations().length
        }));
        assert.deepStrictEqual(state, { theme: expected, leftover: 0 });
      }
    });

    await check('the theme button switches modes and remembers the choice', async () => {
      const themed = await newPage(await browser.newContext({ colorScheme: 'light' }));
      const background = () => themed.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await themed.goto(`${SITE}/past.html`);
      const light = await background();
      assert.strictEqual(await themed.locator('#theme-button').textContent(), 'Dark mode');
      await themed.click('#theme-button');
      await themed.waitForFunction(() => !document.documentElement.dataset.going);
      assert.notStrictEqual(await background(), light, 'the page turns dark');
      await themed.goto(`${SITE}/stats.html`);
      assert.notStrictEqual(await background(), light, 'the choice is kept on the next page');
      assert.strictEqual(await themed.locator('#theme-button').textContent(), 'Light mode');
      await themed.click('#theme-button');
      await themed.waitForFunction(() => !document.documentElement.dataset.going);
      assert.strictEqual(await background(), light, 'and it switches back');
    });

    assert.deepStrictEqual(errors, [], 'no errors on any page');
    console.log('All browser checks passed.');
  } finally {
    await browser.close();
    server.kill();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
