const puppeteer = require('puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:10500';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox','--hide-scrollbars','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  let errors = [];
  page.on('console', m => { if (m.type()==='error') errors.push(m.text().slice(0,200)); });
  page.on('pageerror', e => errors.push('pageerror: '+e.message.slice(0,200)));
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(1500);
  await page.evaluate(() => {
    document.getElementById('apiInput').value = 'http://127.0.0.1:10600';
    document.getElementById('pwInput').value = '123456';
  });
  await page.click('#loginOk');
  await sleep(4000);
  await page.evaluate(() => { window.__app.UI.openBoxDetail('1-0-0'); });
  await sleep(2000);
  const files = await page.evaluate(() => Array.from(document.querySelectorAll('#detailFiles .file-name')).map(e => e.textContent));
  console.log('files=', JSON.stringify(files));
  async function viewAndCheck(idx, expect) {
    await page.evaluate((i) => { document.querySelectorAll('#detailFiles [data-act="view"]')[i].click(); }, idx);
    await sleep(2000);
    const txt = await page.evaluate(() => { const el = document.querySelector('.file-text pre'); return el ? el.textContent : ''; });
    const ok = txt.indexOf(expect) >= 0;
    console.log('csv[' + idx + '] -> ' + (ok ? 'OK' : 'FAIL') + ' | ' + txt.slice(0, 40).replace(/\n/g, ' '));
    await page.evaluate(() => { const b = document.getElementById('viewerClose'); if (b) b.click(); });
    await sleep(800);
    return ok;
  }
  const r1 = await viewAndCheck(0, '台账名称'); // GBK
  const r2 = await viewAndCheck(1, '台账名称'); // UTF-8
  console.log('results=', JSON.stringify({ gbk: r1, utf8: r2 }));
  console.log('errors=', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('fail:', e); process.exit(1); });
