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

  // 记录指针事件
  await page.evaluate(() => {
    window.__ev = [];
    ['pointermove', 'pointerleave', 'pointerenter'].forEach((t) => {
      document.addEventListener(t, (e) => {
        if (e.target && e.target.tagName) window.__ev.push(t + ':' + e.target.tagName + ':' + Math.round(e.clientX) + ',' + Math.round(e.clientY));
      }, true);
    });
  });

  const hoverPos = await page.evaluate(() => {
    const d = __app.Scene3D.debug();
    const w = d.boxWorld('1-0-3');
    const p = d.projectWorld(w[0], w[1], w[2]);
    return { x: (p.x * 0.5 + 0.5) * 1280, y: (-p.y * 0.5 + 0.5) * 800 };
  });
  await page.mouse.move(hoverPos.x, hoverPos.y);
  await sleep(500);
  await page.mouse.move(640, 40);
  await sleep(500);

  const d = await page.evaluate(() => __app.Scene3D.debug());
  const evs = await page.evaluate(() => window.__ev);
  console.log('hoverScale after move-away:', d.hoverScale, 'focusKey:', d.focusKey);
  console.log('events:', JSON.stringify(evs, null, 1));

  // 合成事件测试
  await page.evaluate(() => {
    const c = document.querySelector('#scene canvas');
    const r = c.getBoundingClientRect();
    c.dispatchEvent(new PointerEvent('pointermove', { clientX: 640, clientY: 40, pointerType: 'mouse', bubbles: true }));
  });
  await sleep(500);
  const d2 = await page.evaluate(() => __app.Scene3D.debug());
  console.log('after synthetic move: hoverScale=', d2.hoverScale);

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
