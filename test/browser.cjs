// Durchlauf im Handy-Browser gegen einen laufenden Server (npm run lokal oder wrangler dev).
// Aufruf: BASIS=http://localhost:8787 node test/browser.cjs   Bildschirmfotos landen in test/shots/.
const { chromium, devices } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const BASIS = process.env.BASIS || 'http://localhost:8787';
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const fehler = [];
  page.on('pageerror', (e) => fehler.push(e.message));

  await page.goto(BASIS);
  await page.waitForSelector('.chip');
  await page.screenshot({ path: path.join(shots, '1-start.png') });

  const pdf = { name: 'Stromrechnung November.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 Strom ' + Date.now()) };
  await page.setInputFiles('#datei', [pdf]);
  await page.waitForSelector('[data-act="hochladen"]');
  await page.screenshot({ path: path.join(shots, '2-bereich.png') });
  await page.click('[data-act="hochladen"][data-bereich="gemeinsam"]');
  await page.waitForSelector('.laden .ergebnis:has-text("Gespeichert")');
  await page.waitForSelector('#blatt', { state: 'hidden' });
  await page.waitForSelector('.karte:has-text("Stromrechnung November")');
  await page.screenshot({ path: path.join(shots, '3-liste.png') });

  // Dieselbe Datei noch einmal: wird als doppelt erkannt.
  await page.setInputFiles('#datei', [pdf]);
  await page.click('[data-act="hochladen"][data-bereich="gemeinsam"]');
  await page.waitForSelector('.laden .ergebnis:has-text("War schon da")');
  await page.click('#blatt [data-act="schliessen"]');

  await page.click('.karte:has-text("Stromrechnung November")');
  await page.waitForSelector('form[data-form="speichern"]');
  await page.fill('input[name="dateiname"]', '2026-11 Stadtwerke Strom');
  await page.fill('input[name="absender"]', 'Stadtwerke');
  await page.fill('input[name="betrag"]', '1.234,50');
  await page.fill('input[name="tags"]', 'Strom, Abschlag');
  await page.check('input[name="eingeordnet"]');
  await page.screenshot({ path: path.join(shots, '4-detail.png'), fullPage: true });
  await page.click('button[type="submit"]');
  await page.waitForSelector('.karte:has-text("2026-11 Stadtwerke Strom")');
  assert.match(await page.textContent('.karte:has-text("2026-11 Stadtwerke Strom")'), /1\.234,50/);

  await page.fill('#q', 'stadtwerke');
  await page.waitForFunction(() => document.querySelectorAll('.karte').length === 1);

  // 320 px ohne Querscrollen
  await page.setViewportSize({ width: 320, height: 640 });
  await page.fill('#q', '');
  await page.waitForTimeout(400);
  const breit = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(breit <= 320, `Seite ist ${breit}px breit`);
  await page.screenshot({ path: path.join(shots, '5-schmal.png') });

  assert.deepEqual(fehler, []);
  await browser.close();
  console.log('Browsertest bestanden');
})().catch((e) => { console.error(e); process.exit(1); });
