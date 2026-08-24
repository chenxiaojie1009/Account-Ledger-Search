const puppeteer = require('puppeteer-core');
const fs = require('fs');
const { decodePNG } = require('./pngstat');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--force-device-scale-factor=1.5']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
  await page.goto('http://localhost:8080', { waitUntil: 'networkidle0' });
  await sleep(3500);

  const pts = await page.evaluate(() => {
    const p = __app.Scene3D.debug().projectWorld;
    return { leftCab: p(-1.95, 1.1, 0.3).x, midCab: p(0, 1.1, 0.3).x, rightCab: p(1.95, 1.1, 0.3).x };
  });
  console.log('projections:', JSON.stringify(pts));

  await page.screenshot({ path: 'qa/fresh.png' });
  const png = decodePNG('qa/fresh.png');
  const { w, h, bpp, data } = png;
  console.log('png size:', w, 'x', h);
  for (let c = 0; c < 10; c++) {
    const x0 = Math.round(w * c / 10), x1 = Math.round(w * (c + 1) / 10);
    let dark = 0, n = 0;
    for (let y = Math.round(h * 0.12); y < Math.round(h * 0.62); y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * bpp;
        if (data[i] < 140 && data[i + 1] < 140 && data[i + 2] < 140) dark++;
        n++;
      }
    }
    console.log('col', c, 'darkPct', (dark / n * 100).toFixed(2));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
