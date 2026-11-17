const fs = require('node:fs');
const path = require('node:path');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install --save-dev playwright && npx playwright install chromium');
  process.exit(1);
}

const root = path.join(__dirname, '..');
function tileSvg(file, outline) {
  const drawing = fs.readFileSync(path.join(root, 'design', file)).toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720">
  <filter id="wobble" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.005" numOctaves="2" seed="3"/>
    <feDisplacementMap in="SourceGraphic" scale="28" xChannelSelector="R" yChannelSelector="G"/>
  </filter>
  <clipPath id="tile"><rect x="25" y="25" width="670" height="670" rx="115"/></clipPath>
  <g filter="url(#wobble)">
    <image href="data:image/png;base64,${drawing}" width="720" height="720" clip-path="url(#tile)"/>
    <rect x="40" y="40" width="640" height="640" rx="100" fill="none" stroke="${outline}" stroke-width="30"/>
  </g>
</svg>
`;
}

const svg = tileSvg('logo.png', '#1f2328');
fs.writeFileSync(path.join(root, 'public', 'icon.svg'), svg);
fs.writeFileSync(path.join(root, 'public', 'icon-dark.svg'), tileSvg('logo-dark.png', '#e9e6df'));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const shot = async (size, file, padded) => {
    await page.setViewportSize({ width: size, height: size });
    const pad = padded ? Math.round(size * 0.12) : 0;
    await page.setContent(`<body style="margin:0;background:${padded ? '#fbfaf6' : 'transparent'}">
      <div style="padding:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px">
      ${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body>`);
    await page.screenshot({ path: path.join(root, 'public', file), omitBackground: !padded });
    console.log(`  made public/${file}`);
  };
  await shot(192, 'icon-192.png', false);
  await shot(512, 'icon-512.png', false);
  await shot(512, 'icon-maskable.png', true);
  await shot(180, 'apple-touch-icon.png', true);
  await browser.close();
  console.log('  made public/icon.svg and public/icon-dark.svg');
})();
