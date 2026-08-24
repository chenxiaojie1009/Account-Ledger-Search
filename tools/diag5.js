const puppeteer = require('puppeteer-core');
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

  const hoverPos = await page.evaluate(() => {
    const d = __app.Scene3D.debug();
    const w = d.boxWorld('1-0-3');
    const p = d.projectWorld(w[0], w[1], w[2]);
    return { x: (p.x * 0.5 + 0.5) * 1280, y: (-p.y * 0.5 + 0.5) * 800 };
  });
  console.log('hoverPos:', JSON.stringify(hoverPos));
  await page.mouse.move(hoverPos.x, hoverPos.y);
  await sleep(600);
  let d = await page.evaluate(() => __app.Scene3D.debug());
  console.log('after move-in : hoverScale=', d.hoverScale, 'focusKey=', d.focusKey, 'tweens=', d.tweenCount);

  await page.mouse.move(640, 40);
  await sleep(300);
  d = await page.evaluate(() => __app.Scene3D.debug());
  console.log('after move-away(300ms): hoverScale=', d.hoverScale, 'tweens=', d.tweenCount);
  await sleep(600);
  d = await page.evaluate(() => __app.Scene3D.debug());
  console.log('after move-away(900ms): hoverScale=', d.hoverScale, 'tweens=', d.tweenCount);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
