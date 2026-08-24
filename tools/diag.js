const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  page.on('console', (m) => console.log('[console.' + m.type() + ']', m.text().slice(0, 200)));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 300)));
  await page.goto('http://localhost:8080', { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 2500));

  const raf = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    function f() {
      n++;
      if (performance.now() - t0 < 1000) requestAnimationFrame(f);
      else resolve({ rafCount: n, visibility: document.visibilityState });
    }
    requestAnimationFrame(f);
  }));
  console.log('rAF diag:', JSON.stringify(raf));

  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    return gl ? gl.getParameter(gl.RENDERER) : 'NO WEBGL';
  });
  console.log('webgl renderer:', webgl);

  const tween = await page.evaluate(() => __app.Scene3D.debug().tweenCount);
  console.log('tweenCount after 2.5s:', tween);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
