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

// 安全加固后：默认管理员首次登录必须改密（改密后的测试密码）
const QA_PWD = 'QaPass2026!';

async function appLogin(page) {
  await page.evaluate(() => {
    document.getElementById('apiInput').value = 'http://127.0.0.1:10600';
    document.getElementById('userInput').value = 'admin';
    document.getElementById('pwInput').value = '123456';
  });
  await page.click('#loginOk');
  await sleep(2500);
  // 上次运行已改密时，用 QA 密码重试
  const bad = await page.evaluate(() => {
    const e = document.getElementById('loginError');
    return !!e && /用户名或密码错误/.test(e.textContent);
  });
  if (bad) {
    await page.evaluate((pw) => { document.getElementById('pwInput').value = pw; }, QA_PWD);
    await page.click('#loginOk');
    await sleep(2500);
  }
  // 首次登录强制改密弹窗
  const forced = await page.evaluate(() => !!document.getElementById('pwdModal'));
  if (forced) {
    await page.evaluate((pw) => {
      document.getElementById('pwdOld').value = '123456';
      document.getElementById('pwdNew').value = pw;
      document.getElementById('pwdConfirm').value = pw;
    }, QA_PWD);
    await page.click('#pwdOk');
    await sleep(2500);
  }
}

async function adminLogin(page) {
  await page.evaluate(() => {
    document.getElementById('u').value = 'admin';
    document.getElementById('p').value = '123456';
  });
  await page.click('#loginBtn');
  await sleep(1800);
  const forced = await page.evaluate(() => {
    const m = document.getElementById('pwdModal');
    return !!m && m.classList.contains('show');
  });
  if (forced) {
    await page.evaluate((pw) => {
      document.getElementById('oldPwd').value = '123456';
      document.getElementById('newPwd').value = pw;
      document.getElementById('confirmPwd').value = pw;
    }, QA_PWD);
    await page.click('#pwdSubmit');
    await sleep(1800);
    return;
  }
  const bad = await page.evaluate(() => {
    const e = document.getElementById('loginErr');
    return !!e && /用户名或密码错误/.test(e.textContent);
  });
  if (bad) {
    await page.evaluate((pw) => { document.getElementById('p').value = pw; }, QA_PWD);
    await page.click('#loginBtn');
    await sleep(1800);
  }
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
    await appLogin(page);
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
  await adminLogin(page);
  const admin = await page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      shown: app ? getComputedStyle(app).display !== 'none' : false,
      cabTabs: document.querySelectorAll('#cabTabs button').length,
      tabs: Array.from(document.querySelectorAll('nav .nav-item')).map(b => b.dataset.tab),
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
  const backupTabVisible = await page.evaluate(() => { const b = document.getElementById('backupTab'); return !!b && getComputedStyle(b).display !== 'none'; });
  assert(backupTabVisible, 'admin sees backup tab');
  await page.evaluate(() => { const b = document.querySelector('#backupTab'); if (b) b.click(); });
  await sleep(400);
  const backupUI = await page.evaluate(() => !!document.getElementById('backupDownBtn') && !!document.getElementById('backupUpBtn'));
  assert(backupUI, 'backup download/restore buttons present');
  await page.screenshot({ path: OUT + '/03-admin-web.png' });

  // 回到目录管理，用统一的「保存全部」改一个名称并验证
  await page.evaluate(() => { const b = document.querySelector('nav .tab[data-tab="dir"]'); if (b) b.click(); });
  await sleep(400);
  await page.evaluate(() => {
    const first = document.querySelector('.box-name[data-si="2"][data-bi="0"]') || document.querySelector('.box-name');
    first.value = 'QA测试台账';
  });
  await page.click('#saveAllBtn');
  await sleep(900);
  const renamed = await page.evaluate(async () => {
    const token = localStorage.getItem('taizhang_admin_token');
    const r = await fetch('/api/catalog', { headers: { 'Authorization': 'Bearer ' + token } });
    const j = await r.json();
    return j.cabinets[0].shelves[2][0] === 'QA测试台账';
  });
  assert(renamed, 'admin save-all renamed and synced');

  assert(errors === 0, 'no console errors, got ' + errors);
  console.log(failed === 0 ? 'QA ALL PASS' : 'QA FAILED: ' + failed);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('QA failed:', e); process.exit(1); });
