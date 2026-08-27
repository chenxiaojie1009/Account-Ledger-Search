/* 台账查找 - 服务器后端（Node 版，备选；推荐使用 Python 版 TaizhangBackend.exe）
 * 使用 Node 内置 http + node:sqlite，无需第三方依赖。
 * 安全：随机签名密钥、服务端会话（真登出/吊销）、短时效文件票据、
 *       登录限流锁定、IP 白名单、安全响应头、受限 CORS、上传消毒、
 *       只读用户禁止下载、操作审计日志、默认管理员强制改密。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const WWW = path.join(ROOT, 'www');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'app.db');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const PORT = Number(process.env.PORT || 10600);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json'
};

const CABINET_COUNT = 6;
const CABINET_DOORS = ['double', 'double', 'single', 'double', 'double', 'single'];
const SHELF_COUNT = 3;
const DEFAULT_BOXES_PER_SHELF = 15;
const MAX_BOXES_PER_SHELF = 40;
const MAX_UPLOAD_BYTES = (Number(process.env.TZ_MAX_UPLOAD_MB) || 25) * 1024 * 1024;
const TOKEN_TTL_DAYS = Number(process.env.TZ_TOKEN_TTL_DAYS) || 7;
const FILE_TICKET_TTL = Number(process.env.TZ_FILE_TICKET_TTL) || 600;
const MIN_PASSWORD_LEN = Number(process.env.TZ_MIN_PASSWORD_LEN) || 8;
const LOGIN_MAX_FAILS = Number(process.env.TZ_LOGIN_MAX_FAILS) || 5;
const LOGIN_LOCK_SECONDS = Number(process.env.TZ_LOGIN_LOCK_SECONDS) || 900;
const REQ_RATE_LIMIT = Number(process.env.TZ_REQ_RATE_LIMIT) || 600;
const VIEWER_CAN_DOWNLOAD = process.env.TZ_VIEWER_CAN_DOWNLOAD === '1';
const ALLOWED_IPS = (process.env.TZ_ALLOWED_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
const EXTRA_ORIGINS = (process.env.TZ_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const BLOCKED_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.shtml', '.svg', '.xml', '.xsd', '.xsl', '.xslt',
  '.js', '.mjs', '.cjs', '.jsonp', '.css',
  '.exe', '.dll', '.com', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.vbe', '.wsf',
  '.sh', '.bash', '.py', '.pl', '.rb', '.php', '.phtml', '.asp', '.aspx', '.ashx',
  '.jsp', '.jspx', '.jar', '.war', '.apk', '.scr', '.pif', '.lnk', '.reg', '.hta'
]);
const INLINE_MIME = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp',
  'application/pdf', 'text/plain', 'text/csv', 'application/json'
]);
const SAFE_MIME = new Set([
  ...INLINE_MIME,
  'application/vnd.ms-excel', 'application/msword', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/octet-stream'
]);

// ---------------- 密钥 ----------------
function loadOrCreateSecret() {
  if (process.env.TZ_SECRET_KEY) return Buffer.from(process.env.TZ_SECRET_KEY);
  try {
    if (fs.existsSync(SECRET_FILE)) return Buffer.from(fs.readFileSync(SECRET_FILE).toString().trim());
  } catch (e) { /* ignore */ }
  const key = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SECRET_FILE, key, { mode: 0o600 });
  } catch (e) { /* ignore */ }
  return Buffer.from(key);
}
const SECRET = loadOrCreateSecret();

// ---------------- 工具 ----------------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store'
};
function originAllowed(origin) {
  if (!origin) return false;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/.test(origin) ||
         /^(capacitor|ionic):\/\/localhost$/.test(origin);
}
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  const origin = res._origin;
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...SECURITY_HEADERS
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(code, headers);
  res.end(body);
}
function sendError(res, code, msg) {
  sendJSON(res, code, { ok: false, error: msg });
}

// ---------------- PDF 渲染（可选：mupdf 纯 WASM，无本地编译） ----------------
// Node 备选后端通过 mupdf 提供 PDF 分页转图预览；未安装 mupdf 时自动降级为旧行为。
let _mupdfMod = null;
let _mupdfLoadErr = null;
async function loadMupdf() {
  if (_mupdfMod || _mupdfLoadErr) return _mupdfMod;
  try {
    // mupdf 为 ESM-only 包，需用动态 import
    _mupdfMod = await import('mupdf');
  } catch (e) {
    _mupdfLoadErr = e;
  }
  return _mupdfMod;
}
function renderPdfPageToPng(mu, buf, pageIndex) {
  const doc = mu.Document.openDocument(buf, 'application/pdf');
  try {
    const total = doc.countPages();
    const idx = Math.max(0, Math.min(pageIndex, total - 1));
    const page = doc.loadPage(idx);
    const pix = page.toPixmap(mu.Matrix.scale(1.5, 1.5), mu.ColorSpace.DeviceRGB, false, true);
    const png = Buffer.from(pix.asPNG());
    return { total, png };
  } finally {
    try { doc.destroy(); } catch (e) { /* ignore */ }
  }
}
function pdfPageCount(mu, buf) {
  const doc = mu.Document.openDocument(buf, 'application/pdf');
  try { return doc.countPages(); }
  finally { try { doc.destroy(); } catch (e) { /* ignore */ } }
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    const max = limit || 10 * 1024 * 1024;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) { req.destroy(); reject(new Error('请求体过大')); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
function newToken() { return crypto.randomBytes(32).toString('hex'); }
function newSid() { return crypto.randomBytes(16).toString('hex'); }
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  const addr = req.socket && req.socket.remoteAddress;
  return (addr || '').replace(/^::ffff:/, '');
}
function ipv4ToInt(ip) {
  const m = String(ip).match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return ((+m[1] << 24) | (+m[2] << 16) | (+m[3] << 8) | +m[4]) >>> 0;
}
function ipInCidr(ip, cidr) {
  try {
    const parts = cidr.split('/');
    const bits = parts.length > 1 ? Number(parts[1]) : 32;
    const ipInt = ipv4ToInt(ip);
    const netInt = ipv4ToInt(parts[0]);
    if (ipInt === null || netInt === null) return false;
    const shift = 32 - bits;
    return (ipInt >>> shift) === (netInt >>> shift);
  } catch (e) { return false; }
}
function ipAllowed(ip) {
  if (!ALLOWED_IPS.length) return true;
  return ALLOWED_IPS.some((entry) => ip === entry || ipInCidr(ip, entry));
}
function publicUser(u) {
  return {
    id: u.id, username: u.username,
    displayName: u.display_name || u.username,
    role: u.role,
    mustChangePassword: !!u.must_change_password
  };
}
function cleanFilename(name, maxLen) {
  const max = maxLen || 180;
  let n = String(name == null ? '' : name).replace(/\\/g, '/');
  n = path.basename(n).trim();
  n = n.split('').filter((ch) => ch.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(ch)).join('');
  if (n.length > max) {
    const ext = path.extname(n);
    n = n.slice(0, max - ext.length) + ext;
  }
  return n || 'file';
}
function sanitizeExtension(filename) {
  let ext = path.extname(cleanFilename(filename)).toLowerCase();
  ext = ext.split('').filter((ch) => /[a-z0-9._-]/.test(ch)).join('');
  if (!ext || ext.length > 12 || !/^\.[a-z0-9]/.test(ext)) return '.bin';
  return ext;
}
function normalizeMime(mime, filename) {
  let m = String(mime || '').split(';')[0].trim().toLowerCase();
  if (m && /^(image\/|text\/|application\/pdf|application\/vnd\.|application\/msword|application\/zip|application\/octet-stream)/.test(m)) return m;
  const ext = path.extname(filename || '').toLowerCase();
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.md': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint', '.zip': 'application/zip'
  };
  return map[ext] || 'application/octet-stream';
}
function roleAllowed(role, min) {
  const order = { viewer: 1, editor: 2, admin: 3 };
  return (order[role] || 0) >= (order[min] || 1);
}
function canDownload(user) {
  return VIEWER_CAN_DOWNLOAD || roleAllowed(user.role, 'editor');
}
function passwordError(pw) {
  const s = String(pw || '');
  if (s.length < MIN_PASSWORD_LEN) return '密码至少 ' + MIN_PASSWORD_LEN + ' 位';
  if (!/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) return '密码需同时包含字母和数字';
  if (s.length > 128) return '密码过长';
  return null;
}

// ---------------- 数据库初始化 ----------------
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cabinets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  door_type TEXT NOT NULL DEFAULT 'double',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS boxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cabinet_id INTEGER NOT NULL,
  shelf INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(cabinet_id, shelf, slot)
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  box_cabinet_id INTEGER NOT NULL,
  box_shelf INTEGER NOT NULL,
  box_slot INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  sid TEXT,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  ip TEXT
);
`);

// 旧库升级：补齐新列
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(ddl);
}
ensureColumn('users', 'must_change_password', "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
ensureColumn('users', 'last_login_at', "ALTER TABLE users ADD COLUMN last_login_at TEXT");
ensureColumn('sessions', 'sid', "ALTER TABLE sessions ADD COLUMN sid TEXT");
ensureColumn('sessions', 'expires_at', "ALTER TABLE sessions ADD COLUMN expires_at TEXT NOT NULL DEFAULT (datetime('now','+7 days'))");
try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_sid ON sessions(sid)'); } catch (e) { /* ignore */ }
try { db.prepare("UPDATE sessions SET sid = lower(hex(randomblob(12))) WHERE sid IS NULL OR sid = ''").run(); } catch (e) { /* ignore */ }
try { db.prepare("UPDATE sessions SET expires_at = datetime('now','+7 days') WHERE expires_at IS NULL OR expires_at = ''").run(); } catch (e) { /* ignore */ }

function seed() {
  const force = process.env.TZ_FORCE_DEFAULT_PWD_CHANGE !== '0';
  let admin = db.prepare('SELECT * FROM users WHERE username=?').get('admin');
  if (!admin) {
    const salt = makeSalt();
    db.prepare('INSERT INTO users(username, password_hash, salt, display_name, role, must_change_password) VALUES(?,?,?,?,?,1)')
      .run('admin', hashPassword('123456', salt), salt, '系统管理员', 'admin');
  } else if (force && admin.password_hash === hashPassword('123456', admin.salt)) {
    db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(admin.id);
  }
  const cabCount = db.prepare('SELECT COUNT(*) AS c FROM cabinets').get().c;
  if (cabCount === 0) {
    for (let i = 0; i < CABINET_COUNT; i++) {
      db.prepare('INSERT INTO cabinets(id, name, door_type, sort) VALUES(?,?,?,?)')
        .run(i, (i + 1) + '号柜', CABINET_DOORS[i], i);
    }
  }
  const boxCount = db.prepare('SELECT COUNT(*) AS c FROM boxes').get().c;
  if (boxCount === 0) {
    const ins = db.prepare('INSERT INTO boxes(cabinet_id, shelf, slot, name) VALUES(?,?,?,?)');
    for (let c = 0; c < CABINET_COUNT; c++) {
      for (let s = 0; s < SHELF_COUNT; s++) {
        for (let b = 0; b < DEFAULT_BOXES_PER_SHELF; b++) ins.run(c, s, b, '备用');
      }
    }
  }
  if (!db.prepare('SELECT id FROM users WHERE role=?').get('admin')) {
    const salt = makeSalt();
    db.prepare('INSERT INTO users(username, password_hash, salt, display_name, role, must_change_password) VALUES(?,?,?,?,?,1)')
      .run('admin', hashPassword('123456', salt), salt, '系统管理员', 'admin');
  }
}
seed();

// ---------------- 审计 ----------------
function audit(action, user, detail, ip) {
  try {
    db.prepare('INSERT INTO audit_logs(user_id, username, action, detail, ip) VALUES(?,?,?,?,?)')
      .run(user ? user.id : null, user ? user.username : '', action, String(detail || '').slice(0, 2000), String(ip || '').slice(0, 64));
    const total = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c;
    if (total > 5000) {
      const rows = db.prepare('SELECT id FROM audit_logs ORDER BY id LIMIT ?').all(total - 5000);
      for (const r of rows) db.prepare('DELETE FROM audit_logs WHERE id=?').run(r.id);
    }
  } catch (e) { /* ignore */ }
}

// ---------------- 认证 ----------------
function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) return null;
  return row;
}
function requireAuth(req, role) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = getUserByToken(token);
  if (!user) return { error: '未登录或登录已过期' };
  if (user.must_change_password) return { error: '请先修改初始密码后再操作' };
  if (role && !roleAllowed(user.role, role)) return { error: '权限不足' };
  return { user, token };
}
function requirePendingOk(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const user = getUserByToken(token);
  if (!user) return { error: '未登录或登录已过期' };
  return { user, token };
}
function revokeSessions(userId, keepToken) {
  if (keepToken) db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(userId, keepToken);
  else db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}

// ---------------- 文件票据 ----------------
function makeTicket(user, sid, fileId) {
  const payload = { v: 1, uid: user.id, fid: fileId, sid, exp: Math.floor(Date.now() / 1000) + FILE_TICKET_TTL };
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('base64url');
  return raw + '.' + sig;
}
function verifyTicket(ticket) {
  try {
    const parts = String(ticket || '').split('.');
    if (parts.length !== 2) return null;
    const [raw, sig] = parts;
    const expect = crypto.createHmac('sha256', SECRET).update(raw).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
    const p = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (p.v !== 1 || p.exp < Math.floor(Date.now() / 1000)) return null;
    const sess = db.prepare('SELECT * FROM sessions WHERE sid=?').get(p.sid);
    if (!sess || (sess.expires_at && new Date(sess.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now())) return null;
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(p.uid);
    if (!user) return null;
    return { user, fileId: p.fid };
  } catch (e) { return null; }
}

// ---------------- 限流 / 锁定 ----------------
const loginFails = new Map();
const reqWindows = new Map();
function loginAllowed(username, ip) {
  const key = ip + '|' + String(username || '').toLowerCase();
  const rec = loginFails.get(key);
  if (rec && rec.lockUntil > Date.now()) return false;
  return true;
}
function loginFailed(username, ip) {
  const key = ip + '|' + String(username || '').toLowerCase();
  const rec = loginFails.get(key) || { fails: 0, lockUntil: 0 };
  rec.fails++;
  if (rec.fails >= LOGIN_MAX_FAILS) { rec.lockUntil = Date.now() + LOGIN_LOCK_SECONDS * 1000; rec.fails = 0; }
  loginFails.set(key, rec);
}
function loginSucceeded(username, ip) {
  loginFails.delete(ip + '|' + String(username || '').toLowerCase());
}
function requestAllowed(ip) {
  const now = Date.now();
  let lst = reqWindows.get(ip) || [];
  lst = lst.filter((t) => now - t < 60000);
  if (lst.length >= REQ_RATE_LIMIT) { reqWindows.set(ip, lst); return false; }
  lst.push(now);
  reqWindows.set(ip, lst);
  if (reqWindows.size > 10000) {
    for (const [k, v] of reqWindows) {
      if (!v.length || now - v[v.length - 1] > 120000) reqWindows.delete(k);
    }
  }
  return true;
}

// ---------------- 目录 ----------------
function getCatalog() {
  const cabinets = db.prepare('SELECT * FROM cabinets ORDER BY sort').all();
  const allBoxes = db.prepare('SELECT cabinet_id, shelf, slot, name FROM boxes ORDER BY cabinet_id, shelf, slot').all();
  const byKey = new Map();
  for (const b of allBoxes) {
    const k = b.cabinet_id + '-' + b.shelf;
    if (!byKey.has(k)) byKey.set(k, {});
    byKey.get(k)[b.slot] = b.name;
  }
  return cabinets.map((c) => {
    const shelves = [];
    for (let s = 0; s < SHELF_COUNT; s++) {
      const m = byKey.get(c.id + '-' + s) || {};
      shelves.push(Object.keys(m).map(Number).sort((a, b) => a - b).map((i) => m[i]));
    }
    return { id: c.id, name: c.name, doorType: c.door_type, shelves };
  });
}
function shelfCount(cabinetId, shelf) {
  return db.prepare('SELECT COUNT(*) AS c FROM boxes WHERE cabinet_id=? AND shelf=?').get(cabinetId, shelf).c;
}
function ensureBox(cabinetId, shelf, slot) {
  const existing = db.prepare('SELECT id FROM boxes WHERE cabinet_id=? AND shelf=? AND slot=?').get(cabinetId, shelf, slot);
  if (existing) return existing.id;
  const r = db.prepare('INSERT INTO boxes(cabinet_id, shelf, slot, name) VALUES(?,?,?,?)')
    .run(cabinetId, shelf, slot, '备用');
  return r.lastInsertRowid;
}
function setShelfCount(cabinetId, shelf, n) {
  n = Math.max(1, Math.min(MAX_BOXES_PER_SHELF, parseInt(n, 10) || DEFAULT_BOXES_PER_SHELF));
  for (let b = 0; b < n; b++) ensureBox(cabinetId, shelf, b);
  const rows = db.prepare('SELECT id FROM boxes WHERE cabinet_id=? AND shelf=? AND slot>=?').all(cabinetId, shelf, n);
  const delBox = db.prepare('DELETE FROM boxes WHERE id=?');
  const delFile = db.prepare('DELETE FROM files WHERE box_cabinet_id=? AND box_shelf=? AND box_slot=?');
  for (const r of rows) {
    delFile.run(cabinetId, shelf, r.slot);
    delBox.run(r.id);
  }
  return n;
}
function renameBox(cabinetId, shelf, slot, name) {
  name = String(name || '').trim().slice(0, 128) || '备用';
  ensureBox(cabinetId, shelf, slot);
  db.prepare('UPDATE boxes SET name=? WHERE cabinet_id=? AND shelf=? AND slot=?')
    .run(name, cabinetId, shelf, slot);
}
function resetCatalog() {
  db.prepare('DELETE FROM boxes').run();
  db.prepare('DELETE FROM files').run();
  const ins = db.prepare('INSERT INTO boxes(cabinet_id, shelf, slot, name) VALUES(?,?,?,?)');
  for (let c = 0; c < CABINET_COUNT; c++) {
    for (let s = 0; s < SHELF_COUNT; s++) {
      for (let b = 0; b < DEFAULT_BOXES_PER_SHELF; b++) ins.run(c, s, b, '备用');
    }
  }
}
function validPosition(cabinetId, shelf, slot) {
  if (!(cabinetId >= 0 && cabinetId < CABINET_COUNT)) return '柜号无效';
  if (!(shelf >= 0 && shelf < SHELF_COUNT)) return '层号无效';
  if (!(slot >= 0 && slot < MAX_BOXES_PER_SHELF)) return '序号无效';
  return null;
}

// ---------------- 路由处理 ----------------
function getQuery(url) {
  const q = url.split('?')[1] || '';
  const out = {};
  q.split('&').forEach((kv) => {
    if (!kv) return;
    const idx = kv.indexOf('=');
    const k = idx >= 0 ? kv.slice(0, idx) : kv;
    const v = idx >= 0 ? kv.slice(idx + 1) : '';
    try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
  });
  return out;
}
function parsePath(url) {
  return url.split('?')[0].split('/').filter(Boolean);
}

function fileOut(f, user, sid) {
  const ticket = makeTicket(user, sid, f.id);
  const qs = 'ticket=' + encodeURIComponent(ticket) + '&name=' + encodeURIComponent(f.original_name);
  const dl = '/api/files/' + f.id + '/download?' + qs;
  const isImage = /^image\//.test(f.mime || '') && f.mime !== 'image/svg+xml';
  const isPdf = f.mime === 'application/pdf' || path.extname(f.original_name).toLowerCase() === '.pdf';
  const preview = (isImage || isPdf) ? '/api/files/' + f.id + '/preview?ticket=' + encodeURIComponent(ticket) + '&page=1'
                                     : dl + '&download=0';
  return {
    id: f.id, cabinetId: f.box_cabinet_id, shelf: f.box_shelf, slot: f.box_slot,
    originalName: f.original_name, mime: f.mime, size: f.size, createdAt: f.created_at || '',
    url: dl, previewUrl: preview, downloadable: canDownload(user)
  };
}

async function handleApi(req, res, url) {
  const parts = parsePath(url);
  if (!parts.length) return sendError(res, 404, 'not found');
  if (parts[0] === 'api') parts.shift();
  if (!parts.length) return sendError(res, 404, 'not found');
  const resource = parts[0];
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    const origin = req.headers.origin;
    if (origin && originAllowed(origin)) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '600',
        ...SECURITY_HEADERS
      });
    } else {
      res.writeHead(204, SECURITY_HEADERS);
    }
    return res.end();
  }

  /* --- 登录 / 登出 --- */
  if (resource === 'login' && method === 'POST') {
    const ip = clientIp(req);
    const body = JSON.parse((await readBody(req)) || '{}');
    const username = String(body.username || '').trim();
    if (!loginAllowed(username, ip)) return sendError(res, 429, '尝试过于频繁，请稍后再试');
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!row || hashPassword(body.password, row.salt) !== row.password_hash) {
      loginFailed(username, ip);
      audit('login_fail', null, '用户 ' + username + ' 登录失败', ip);
      return sendError(res, 401, '用户名或密码错误');
    }
    loginSucceeded(username, ip);
    const token = newToken();
    const sid = newSid();
    const exp = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000).toISOString();
    db.prepare('INSERT INTO sessions(token, sid, user_id, expires_at, ip, user_agent) VALUES(?,?,?,?,?,?)')
      .run(token, sid, row.id, exp, ip, String(req.headers['user-agent'] || '').slice(0, 256));
    db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(row.id);
    audit('login', row, '登录成功', ip);
    return sendJSON(res, 200, { ok: true, token, user: publicUser(row) });
  }

  if (resource === 'logout' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (user) audit('logout', user, '退出登录', clientIp(req));
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return sendJSON(res, 200, { ok: true });
  }

  if (resource === 'me' && method === 'GET') {
    const pending = requirePendingOk(req);
    if (pending.error) return sendError(res, 401, pending.error);
    return sendJSON(res, 200, { ok: true, user: publicUser(pending.user) });
  }

  if (resource === 'change-password' && method === 'POST') {
    const pending = requirePendingOk(req);
    if (pending.error) return sendError(res, 401, pending.error);
    const body = JSON.parse((await readBody(req)) || '{}');
    if (hashPassword(body.oldPassword, pending.user.salt) !== pending.user.password_hash) {
      return sendError(res, 400, '原密码错误');
    }
    const err = passwordError(body.newPassword);
    if (err) return sendError(res, 400, err);
    const salt = makeSalt();
    db.prepare('UPDATE users SET password_hash=?, salt=?, must_change_password=0 WHERE id=?')
      .run(hashPassword(body.newPassword, salt), salt, pending.user.id);
    revokeSessions(pending.user.id, pending.token);
    audit('change_password', pending.user, '修改密码', clientIp(req));
    return sendJSON(res, 200, { ok: true });
  }

  /* --- 目录 --- */
  if (resource === 'catalog' && method === 'GET') {
    const auth = requireAuth(req);
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }
  if (resource === 'catalog' && method === 'PUT') {
    const auth = requireAuth(req, 'editor');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const body = JSON.parse((await readBody(req)) || '{}');
    const cabinets = body.cabinets;
    if (!Array.isArray(cabinets)) return sendError(res, 400, '数据格式错误');
    for (let c = 0; c < CABINET_COUNT; c++) {
      const src = cabinets[c];
      if (!src || !Array.isArray(src.shelves)) continue;
      for (let s = 0; s < SHELF_COUNT; s++) {
        const list = Array.isArray(src.shelves[s]) ? src.shelves[s] : [];
        const n = Math.max(1, Math.min(MAX_BOXES_PER_SHELF, list.length));
        setShelfCount(c, s, n);
        for (let b = 0; b < n; b++) renameBox(c, s, b, list[b]);
      }
    }
    audit('catalog_update', auth.user, '批量保存目录', clientIp(req));
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }

  if (resource === 'set-count' && method === 'POST') {
    const auth = requireAuth(req, 'editor');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const body = JSON.parse((await readBody(req)) || '{}');
    const ci = Number(body.cabinetId), si = Number(body.shelf);
    const posErr = validPosition(ci, si, 0);
    if (posErr) return sendError(res, 400, posErr);
    const n = setShelfCount(ci, si, Number(body.count));
    audit('catalog_update', auth.user, '调整层数量为 ' + n, clientIp(req));
    return sendJSON(res, 200, { ok: true, count: n, cabinets: getCatalog() });
  }

  if (resource === 'rename' && method === 'POST') {
    const auth = requireAuth(req, 'editor');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const body = JSON.parse((await readBody(req)) || '{}');
    const ci = Number(body.cabinetId), si = Number(body.shelf), bi = Number(body.slot);
    const posErr = validPosition(ci, si, bi);
    if (posErr) return sendError(res, 400, posErr);
    renameBox(ci, si, bi, body.name);
    audit('catalog_update', auth.user, '重命名台账', clientIp(req));
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }

  if (resource === 'import' && method === 'POST') {
    const auth = requireAuth(req, 'editor');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const body = JSON.parse((await readBody(req)) || '{}');
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 20000) : [];
    let imported = 0;
    const errors = [];
    rows.forEach(function (row, idx) {
      const cabinet = Number(row.cabinet);
      const layer = Number(row.layer);
      const slot = Number(row.slot);
      const name = String(row.name == null ? '' : row.name).trim();
      const lineNo = idx + 1;
      if (!(cabinet >= 1 && cabinet <= CABINET_COUNT)) { errors.push('第' + lineNo + '行：柜号应为1-' + CABINET_COUNT); return; }
      if (!(layer >= 1 && layer <= SHELF_COUNT)) { errors.push('第' + lineNo + '行：层号应为1-' + SHELF_COUNT); return; }
      if (!(slot >= 1 && slot <= MAX_BOXES_PER_SHELF)) { errors.push('第' + lineNo + '行：序号应为1-' + MAX_BOXES_PER_SHELF); return; }
      if (!name) { errors.push('第' + lineNo + '行：台账名称为空'); return; }
      const ci = cabinet - 1;
      const si = SHELF_COUNT - layer;
      const bi = slot - 1;
      if (shelfCount(ci, si) < slot) setShelfCount(ci, si, Math.min(MAX_BOXES_PER_SHELF, slot));
      renameBox(ci, si, bi, name);
      imported++;
    });
    audit('import', auth.user, '导入 ' + imported + ' 条，失败 ' + errors.length + ' 条', clientIp(req));
    return sendJSON(res, 200, { ok: true, imported, failed: errors.length, errors, cabinets: getCatalog() });
  }

  if (resource === 'reset' && method === 'POST') {
    const auth = requireAuth(req, 'admin');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    resetCatalog();
    audit('catalog_reset', auth.user, '恢复默认目录', clientIp(req));
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }

  /* --- 文件 --- */
  if (resource === 'files' && method === 'GET' && parts.length === 1) {
    const auth = requireAuth(req);
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const q = getQuery(url);
    const cabinetId = Number(q.cabinetId);
    const shelf = Number(q.shelf);
    const slot = Number(q.slot);
    const posErr = validPosition(cabinetId, shelf, slot);
    if (posErr) return sendError(res, 400, posErr);
    const rows = db.prepare('SELECT * FROM files WHERE box_cabinet_id=? AND box_shelf=? AND box_slot=? ORDER BY id')
      .all(cabinetId, shelf, slot);
    const sid = db.prepare('SELECT sid FROM sessions WHERE token=?').get(auth.token);
    const files = rows.map((f) => fileOut(f, auth.user, sid ? sid.sid : ''));
    return sendJSON(res, 200, { ok: true, files });
  }

  if (resource === 'files' && method === 'POST') {
    const auth = requireAuth(req, 'editor');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const body = JSON.parse((await readBody(req, MAX_UPLOAD_BYTES)) || '{}');
    const cabinetId = Number(body.cabinetId);
    const shelf = Number(body.shelf);
    const slot = Number(body.slot);
    const posErr = validPosition(cabinetId, shelf, slot);
    if (posErr) return sendError(res, 400, posErr);
    const originalName = cleanFilename(body.filename);
    const ext = path.extname(originalName).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) return sendError(res, 400, '该文件类型禁止上传（防脚本/网页等危险文件）');
    const dataBase64 = String(body.dataBase64 || '');
    if (!dataBase64) return sendError(res, 400, '未收到文件内容');
    const buf = Buffer.from(dataBase64, 'base64');
    if (!buf.length) return sendError(res, 400, '文件为空');
    if (buf.length > MAX_UPLOAD_BYTES) return sendError(res, 413, '文件过大');
    ensureBox(cabinetId, shelf, slot);
    const storedName = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + sanitizeExtension(originalName);
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
    const mime = normalizeMime(body.mime, originalName);
    const r = db.prepare('INSERT INTO files(box_cabinet_id, box_shelf, box_slot, original_name, stored_name, mime, size, uploaded_by) VALUES(?,?,?,?,?,?,?,?)')
      .run(cabinetId, shelf, slot, originalName, storedName, mime, buf.length, auth.user.id);
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(r.lastInsertRowid);
    const sid = db.prepare('SELECT sid FROM sessions WHERE token=?').get(auth.token);
    audit('file_upload', auth.user, '上传 ' + originalName + '（' + buf.length + ' 字节）', clientIp(req));
    return sendJSON(res, 200, { ok: true, file: fileOut(file, auth.user, sid ? sid.sid : '') });
  }

  if (parts[0] === 'files' && parts[1] && parts[2] === 'download' && method === 'GET') {
    const q = getQuery(url);
    const got = verifyTicket(q.ticket);
    if (!got) return sendError(res, 401, '访问票据无效或已过期，请刷新后重试');
    const { user, fileId } = got;
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(Number(fileId));
    if (!file) return sendError(res, 404, '文件不存在');
    const p = path.join(UPLOAD_DIR, file.stored_name);
    if (!fs.existsSync(p)) return sendError(res, 404, '文件不存在');
    const mode = q.download === '0' ? 'preview' : 'download';
    if (mode === 'download' && !canDownload(user)) return sendError(res, 403, '只读用户仅可预览，不能下载原始文件');
    audit(mode === 'preview' ? 'file_view' : 'file_download', user, (mode === 'preview' ? '预览 ' : '下载 ') + file.original_name + '（' + file.id + '）', clientIp(req));
    const inline = mode === 'preview' && INLINE_MIME.has(file.mime || '');
    const mediaType = inline ? file.mime : (SAFE_MIME.has(file.mime || '') ? file.mime : 'application/octet-stream');
    const origin = req.headers.origin && originAllowed(req.headers.origin) ? req.headers.origin : null;
    res.writeHead(200, {
      'Content-Type': mediaType,
      'Content-Disposition': (inline ? 'inline; ' : 'attachment; ') + "filename*=UTF-8''" + encodeURIComponent(file.original_name),
      'Content-Length': file.size,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  // 图片 / PDF 预览（Node 版图片预览不做水印渲染；PDF 用 mupdf 分页转图，未安装时降级提示）
  if (parts[0] === 'files' && parts[1] && parts[2] === 'preview' && method === 'GET') {
    const q = getQuery(url);
    const got = verifyTicket(q.ticket);
    if (!got) return sendError(res, 401, '访问票据无效或已过期，请刷新后重试');
    const { user, fileId } = got;
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(Number(fileId));
    if (!file) return sendError(res, 404, '文件不存在');
    const isImage = /^image\//.test(file.mime || '') && file.mime !== 'image/svg+xml';
    const isPdf = file.mime === 'application/pdf' || path.extname(file.original_name).toLowerCase() === '.pdf';
    if (!isImage && !isPdf) return sendError(res, 400, '仅支持图片 / PDF 在线预览');
    const p = path.join(UPLOAD_DIR, file.stored_name);
    if (!fs.existsSync(p)) return sendError(res, 404, '文件不存在');
    audit('file_view', user, '预览 ' + file.original_name + '（' + file.id + '）', clientIp(req));
    const origin = req.headers.origin && originAllowed(req.headers.origin) ? req.headers.origin : null;
    if (isPdf) {
      const mu = await loadMupdf();
      if (!mu) return sendError(res, 400, 'Node 版后端缺少 PDF 渲染组件（未安装 mupdf），请使用 Python 版后端或下载查看');
      try {
        const page = Math.max(1, parseInt(q.page, 10) || 1);
        const { total, png } = renderPdfPageToPng(mu, fs.readFileSync(p), page - 1);
        const extra = Math.min(page, total);
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'X-Page': String(extra),
          'X-Page-Count': String(total),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
        });
        res.end(png);
        return;
      } catch (e) {
        return sendError(res, 400, 'PDF 预览渲染失败：' + String((e && e.message) || e).slice(0, 120));
      }
    }
    res.writeHead(200, {
      'Content-Type': file.mime || 'image/png',
      'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(file.original_name),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (parts[0] === 'files' && parts[1] && parts[2] === 'pdf-info' && method === 'GET') {
    const q = getQuery(url);
    const got = verifyTicket(q.ticket);
    if (!got) return sendError(res, 401, '访问票据无效或已过期，请刷新后重试');
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(Number(got.fileId));
    if (!file) return sendError(res, 404, '文件不存在');
    if (!(file.mime === 'application/pdf' || path.extname(file.original_name).toLowerCase() === '.pdf')) {
      return sendError(res, 400, '仅支持 PDF');
    }
    const p = path.join(UPLOAD_DIR, file.stored_name);
    if (!fs.existsSync(p)) return sendError(res, 404, '文件不存在');
    // 优先用 mupdf 精确读取页数；未安装时退回简易页数探测
    let count = 1;
    const mu = await loadMupdf();
    if (mu) {
      try { count = pdfPageCount(mu, fs.readFileSync(p)); } catch (e) { /* ignore */ }
    } else {
      try {
        const buf = fs.readFileSync(p);
        const m = buf.toString('latin1').match(/\/Type\s*\/Page\b/g);
        count = Math.max(1, m ? m.length : 1);
      } catch (e) { /* ignore */ }
    }
    return sendJSON(res, 200, { ok: true, pageCount: count });
  }

  if (parts[0] === 'files' && parts[1] && method === 'DELETE') {
    const auth = requireAuth(req, 'editor');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const id = Number(parts[1]);
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(id);
    if (!file) return sendError(res, 404, '文件不存在');
    const p = path.join(UPLOAD_DIR, file.stored_name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    db.prepare('DELETE FROM files WHERE id=?').run(id);
    audit('file_delete', auth.user, '删除 ' + file.original_name + '（' + id + '）', clientIp(req));
    return sendJSON(res, 200, { ok: true });
  }

  /* --- 用户管理 --- */
  if (resource === 'users' && method === 'GET') {
    const auth = requireAuth(req, 'admin');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const rows = db.prepare('SELECT * FROM users ORDER BY id').all();
    return sendJSON(res, 200, { ok: true, users: rows.map((u) => publicUser(u)) });
  }
  if (resource === 'users' && method === 'POST') {
    const auth = requireAuth(req, 'admin');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const body = JSON.parse((await readBody(req)) || '{}');
    const username = String(body.username || '').trim().slice(0, 64);
    if (!username) return sendError(res, 400, '用户名不能为空');
    const err = passwordError(body.password);
    if (err) return sendError(res, 400, err);
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return sendError(res, 409, '用户名已存在');
    const salt = makeSalt();
    const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer';
    const r = db.prepare('INSERT INTO users(username, password_hash, salt, display_name, role) VALUES(?,?,?,?,?)')
      .run(username, hashPassword(body.password, salt), salt, String(body.displayName || username).slice(0, 64), role);
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    audit('user_create', auth.user, '新增用户 ' + username + '（' + role + '）', clientIp(req));
    return sendJSON(res, 200, { ok: true, user: publicUser(row) });
  }
  if (resource === 'users' && parts[1] && method === 'PUT') {
    const auth = requireAuth(req, 'admin');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const id = Number(parts[1]);
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target) return sendError(res, 404, '用户不存在');
    const body = JSON.parse((await readBody(req)) || '{}');
    if (target.username === 'admin' && body.role && body.role !== 'admin') return sendError(res, 403, '内置管理员账号角色不可修改');
    const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : target.role;
    const displayName = body.displayName != null ? String(body.displayName).slice(0, 64) : target.display_name;
    db.prepare('UPDATE users SET role=?, display_name=? WHERE id=?').run(role, displayName, id);
    const changed = ['角色->' + role];
    if (body.password) {
      const err = passwordError(body.password);
      if (err) return sendError(res, 400, err);
      const salt = makeSalt();
      db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?')
        .run(hashPassword(body.password, salt), salt, id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      changed.push('重置密码（已强制重新登录）');
    }
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    audit('user_update', auth.user, '更新用户 ' + target.username + '：' + changed.join('，'), clientIp(req));
    return sendJSON(res, 200, { ok: true, user: publicUser(row) });
  }
  if (resource === 'users' && parts[1] && method === 'DELETE') {
    const auth = requireAuth(req, 'admin');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const id = Number(parts[1]);
    if (id === auth.user.id) return sendError(res, 400, '不能删除当前登录账号');
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target) return sendError(res, 404, '用户不存在');
    if (target.username === 'admin') return sendError(res, 403, '内置管理员账号不可删除');
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    audit('user_delete', auth.user, '删除用户 ' + target.username, clientIp(req));
    return sendJSON(res, 200, { ok: true });
  }

  /* --- 审计日志 --- */
  if (resource === 'audit' && method === 'GET') {
    const auth = requireAuth(req, 'admin');
    if (auth.error) return sendError(res, auth.error === '权限不足' ? 403 : 401, auth.error);
    const q = getQuery(url);
    const limit = Math.max(1, Math.min(Number(q.limit) || 300, 1000));
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
    return sendJSON(res, 200, { ok: true, logs: rows.map((r) => ({
      id: r.id, time: r.time, username: r.username || '', action: r.action, detail: r.detail || '', ip: r.ip || ''
    })) });
  }

  return sendError(res, 404, '接口不存在');
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const filePath = path.normalize(path.join(WWW, p));
  if (!filePath.startsWith(WWW)) { res.writeHead(403, SECURITY_HEADERS); res.end('forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      ...SECURITY_HEADERS
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- 服务器 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const ip = clientIp(req);
  res._origin = req.headers.origin && originAllowed(req.headers.origin) ? req.headers.origin : null;
  try {
    if (!ipAllowed(ip)) {
      return sendError(res, 403, '当前设备不在允许访问的 IP 白名单内');
    }
    if (!requestAllowed(ip)) {
      return sendError(res, 429, '请求过于频繁，请稍后再试');
    }
    if (url.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (e) {
    if (!res.headersSent) sendError(res, 500, '服务器错误');
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log('[台账查找] 服务已启动 http://127.0.0.1:' + PORT);
  console.log('  默认管理员：admin / 123456（首次登录强制修改密码）');
});
