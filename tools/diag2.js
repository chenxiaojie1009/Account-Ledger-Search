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

  for (const t of [1000, 2000, 3500, 5000]) {
    await sleep(t === 1000 ? 1000 : t - (t === 2000 ? 1000 : t === 3500 ? 2000 : 3500));
    const dbg = await page.evaluate(() => __app.Scene3D.debug());
    console.log(`t=${t}ms cam=(${dbg.camera.pos.map((v) => v.toFixed(2)).join(',')}) target=(${dbg.camera.target.map((v) => v.toFixed(2)).join(',')}) aspect=${dbg.camera.aspect.toFixed(3)} fov=${dbg.camera.fov} tweens=${dbg.tweenCount}`);
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
