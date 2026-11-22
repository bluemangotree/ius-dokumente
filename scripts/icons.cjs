// Erzeugt die PNG-Icons aus public/icons/logo.svg. Aufruf: node scripts/icons.cjs (braucht Playwright).
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const dir = path.join(__dirname, '../public/icons');
  const svg = fs.readFileSync(path.join(dir, 'logo.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    await page.screenshot({ path: path.join(dir, name) });
    await page.close();
  }
  await browser.close();
})();
