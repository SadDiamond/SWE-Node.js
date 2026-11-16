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
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'placeholder-check-'));

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
        await page.waitForFunction((count) => document.querySelectorAll('#goes .used').length === count
          || !document.querySelector('#result').hidden, attempt);
        if (await page.locator('#result').isVisible()) break;
        assert.match(await status(page), /\d+%/);
      }
      await page.waitForSelector('#result:not([hidden])');
      assert.ok((await page.locator('#result-formula').textContent()).length > 0, 'the formula is revealed');
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
      await draw(page, across);
      await page.waitForFunction(() => /\d+%/.test(document.querySelector('#form-status').textContent));
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
      await signedIn.waitForFunction(() => document.querySelectorAll('#goes .used').length === 1);
      await signedIn.reload();
      await signedIn.waitForSelector('#tabs li');
      assert.strictEqual(await signedIn.locator('#goes .used').count(), 1);
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

    await check('the theme button switches modes and remembers the choice', async () => {
      const themed = await newPage(await browser.newContext({ colorScheme: 'light' }));
      const background = () => themed.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await themed.goto(`${SITE}/past.html`);
      const light = await background();
      assert.strictEqual(await themed.locator('#theme-button').textContent(), 'Dark mode');
      await themed.click('#theme-button');
      assert.notStrictEqual(await background(), light, 'the page turns dark');
      await themed.goto(`${SITE}/stats.html`);
      assert.notStrictEqual(await background(), light, 'the choice is kept on the next page');
      assert.strictEqual(await themed.locator('#theme-button').textContent(), 'Light mode');
      await themed.click('#theme-button');
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
