// Records the clip shown in How to play. Run with: npm run demo
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Curves = require('../public/curves.js');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium');
  process.exit(1);
}

const PORT = 3124;
const SEED = 8;
const SLOT = 2;
const root = path.join(__dirname, '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'close-enough-demo-'));
const machine = Curves.machineFromSeed(SEED, SLOT);

function startServer() {
  const server = spawn(process.execPath, [path.join(root, 'src', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: path.join(folder, 'demo.db') }
  });
  return new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => {
      if (String(data).includes('running at')) resolve(server);
    });
    server.on('exit', (code) => reject(new Error(`The server stopped with code ${code}`)));
  });
}

function curvePoints(shiftUp, stretch) {
  const points = [];
  for (let x = -6.9; x <= 7; x += 0.25) {
    const y = Curves.evaluate(machine, x) * stretch + shiftUp;
    if (Math.abs(y) <= 10) points.push([x, y]);
  }
  return points;
}

async function draw(page, points) {
  const box = await page.locator('#graph').boundingBox();
  const at = ([x, y]) => [box.x + ((x + 10) / 20) * box.width, box.y + ((10 - y) / 20) * box.height];
  await page.mouse.move(...at(points[0]));
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(...at(point), { steps: 2 });
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1000, height: 760 },
    recordVideo: { dir: folder, size: { width: 1000, height: 760 } }
  });
  await context.addInitScript(() => localStorage.setItem('seenHowToPlay', 'yes'));
  const page = await context.newPage();
  const started = Date.now();

  await page.route('**/api/endless*', async (route) => {
    const reply = await (await route.fetch()).json();
    Object.assign(reply.curves[0], {
      id: `r${SEED}s${SLOT}`,
      slot: SLOT,
      strokesPerGo: Curves.pieces(machine),
      ink: Curves.inkFor(machine),
      exits: Curves.exits(machine)
    });
    await route.fulfill({ json: reply });
  });

  try {
    await page.goto(`http://localhost:${PORT}/endless.html`);
    await page.locator('#graph .exit').first().waitFor();
    await page.waitForTimeout(400);
    const box = await page.locator('#graph').boundingBox();
    const from = (Date.now() - started) / 1000;

    await page.waitForTimeout(900);
    await draw(page, curvePoints(2.2, 0.75));
    await page.waitForTimeout(2600);
    await draw(page, curvePoints(0, 1));
    await page.waitForTimeout(3200);
    const length = (Date.now() - started) / 1000 - from;

    await context.close();
    const recording = await page.video().path();
    const crop = `crop=${Math.round(box.width)}:${Math.round(box.height)}:${Math.round(box.x)}:${Math.round(box.y)},scale=480:480`;
    const media = path.join(root, 'public', 'media');
    fs.mkdirSync(media, { recursive: true });
    const common = ['-y', '-loglevel', 'error', '-ss', from.toFixed(2), '-t', length.toFixed(2), '-i', recording, '-vf', crop, '-an'];
    execFileSync('ffmpeg', [...common, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', path.join(media, 'how-to-play.webm')]);
    execFileSync('ffmpeg', [...common, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart',
      path.join(media, 'how-to-play.mp4')]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (from + length - 0.5).toFixed(2), '-i', recording,
      '-vf', crop, '-frames:v', '1', path.join(media, 'how-to-play.png')]);
    console.log('Saved public/media/how-to-play.webm, .mp4 and .png');
  } finally {
    await browser.close();
    server.kill();
  }
})();
