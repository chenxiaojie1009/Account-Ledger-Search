const puppeteer = require('puppeteer-core');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE_APP = 'http://127.0.0.1:10500';
const BASE_ADMIN = 'http://127.0.0.1:10600/admin';
const OUT = 'qa';
const VW = 1280, VH = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log('[PASS]', msg);
  else { console.log('[FAIL]', msg); failed++; }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--force-device-scale-factor=1.5']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1.5 });
  let errors = 0;
  page.on('console', (m) => { if (m.type() === 'error') { errors++; console.log('[console.error]', m.text().slice(0, 200)); } });
  page.on('pageerror', (e) => { errors++; console.log('[pageerror]', e.message.slice(0, 200)); });

  /* ===== APK 前端（三维查看） ===== */
  await page.goto(BASE_APP, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(1500);
  const hasLogin = await page.evaluate(() => !!document.getElementById('loginModal'));
  assert(hasLogin, '3D app shows login');
  if (hasLogin) {
    await page.evaluate(() => { document.getElementById('pwInput').value = '123456'; });
    await page.click('#loginOk');
    await sleep(2500);
  }
  const info = await page.evaluate(() => ({
    loggedIn: !!window.__app && !!window.__app.Store.user(),
    cabinets: window.__app ? (window.__app.Store.data.cabinets || []).length : 0,
    boxCount: window.__app ? window.__app.Scene3D.debug().boxCount : 0,
    hasAdminBtn: !!document.getElementById('btnAdmin')
  }));
  console.log('app info=', JSON.stringify(info));
  assert(info.loggedIn, '3D app logged in');
  assert(info.cabinets === 6, 'six cabinets');
  assert(info.boxCount === 270, '270 ledgers');
  assert(!info.hasAdminBtn, 'APK has NO admin button (view-only)');
  await page.screenshot({ path: OUT + '/01-app.png' });

  // hover
  const hoverPos = await page.evaluate(() => {
    const d = __app.Scene3D.debug();
    const w = d.boxWorld('2-1-5');
    const p = d.projectWorld(w[0], w[1], w[2]);
    return { x: (p.x * 0.5 + 0.5) * 1280, y: (-p.y * 0.5 + 0.5) * 800 };
  });
  await page.mouse.move(hoverPos.x, hoverPos.y);
  await sleep(600);
  const hs = await page.evaluate(() => __app.Scene3D.debug().hoverScale);
  assert(hs !== null && hs > 1.1, 'hover enlarges box');

  // click box -> read-only detail
  await page.mouse.click(hoverPos.x, hoverPos.y);
  await sleep(2000);
  const detail = await page.evaluate(() => ({
    open: !!document.getElementById('detailModal'),
    hasNameInput: !!document.getElementById('detailName'),
    hasUpload: !!document.getElementById('detailUpload'),
    files: document.getElementById('detailFiles') ? document.getElementById('detailFiles').textContent.trim() : null
  }));
  assert(detail.open, 'click opens detail modal');
  assert(!detail.hasNameInput && !detail.hasUpload, 'detail is read-only (no rename/upload)');
  assert(detail.files && detail.files.indexOf('暂无文件') >= 0, 'detail lists files');
  await page.screenshot({ path: OUT + '/02-app-detail.png' });
  await page.evaluate(() => { const b = document.getElementById('detailClose'); if (b) b.click(); });
  await sleep(500);

  /* ===== 后台管理网页 ===== */
  await page.goto(BASE_ADMIN, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(1200);
  const adminLogin = await page.evaluate(() => !!document.getElementById('login') && getComputedStyle(document.getElementById('login')).display !== 'none');
  assert(adminLogin, 'admin web shows login');
  await page.evaluate(() => { document.getElementById('p').value = '123456'; });
  await page.click('#loginBtn');
  await sleep(1800);
  const admin = await page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      shown: app ? getComputedStyle(app).display !== 'none' : false,
      cabTabs: document.querySelectorAll('#cabTabs button').length,
      tabs: Array.from(document.querySelectorAll('nav .tab')).map(b => b.dataset.tab),
      boxInputs: document.querySelectorAll('.box-name').length,
      usersVisible: document.getElementById('usersTab') ? getComputedStyle(document.getElementById('usersTab')).display !== 'none' : false
    };
  });
  console.log('admin info=', JSON.stringify(admin));
  assert(admin.shown, 'admin web logged in');
  assert(admin.cabTabs === 6, 'admin web shows 6 cabinets');
  assert(admin.tabs.indexOf('dir') >= 0 && admin.tabs.indexOf('files') >= 0 && admin.tabs.indexOf('users') >= 0, 'admin tabs dir/files/users');
  assert(admin.boxInputs > 0, 'admin can edit box names');
  assert(admin.usersVisible, 'admin sees users tab');
  await page.screenshot({ path: OUT + '/03-admin-web.png' });

  // 改一个名称并验证
  await page.evaluate(() => {
    const first = document.querySelector('.box-name');
    first.value = 'QA测试台账';
    first.parentElement.querySelector('.box-save').click();
  });
  await sleep(900);
  const renamed = await page.evaluate(() => {
    const cab = window.__adminCatalog ? null : null;
    return Array.from(document.querySelectorAll('.box-name')).some(i => i.value === 'QA测试台账');
  });
  assert(renamed, 'admin rename saved and re-rendered');

  assert(errors === 0, 'no console errors, got ' + errors);
  console.log(failed === 0 ? 'QA ALL PASS' : 'QA FAILED: ' + failed);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('QA failed:', e); process.exit(1); });
