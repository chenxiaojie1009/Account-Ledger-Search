const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
  await page.goto('http://localhost:8080', { waitUntil: 'networkidle0' });
  await sleep(3500);

  const pts = await page.evaluate(() => {
    const p = __app.Scene3D.debug().projectWorld;
    return {
      leftCab: p(-1.95, 1.1, 0.3),
      midCab: p(0, 1.1, 0.3),
      rightCab: p(1.95, 1.1, 0.3),
      leftEdge: p(-2.8, 1.1, 0.3),
      rightEdge: p(2.8, 1.1, 0.3),
      floorFar: p(0, 0, -6),
      cabTop: p(0, 2.2, 0.3)
    };
  });
  console.log(JSON.stringify(pts, null, 1));

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
