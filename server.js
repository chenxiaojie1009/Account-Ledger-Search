/* 台账查找 - 服务器后端
 * 使用 Node 内置 http + node:sqlite，无需第三方依赖。
 * 功能：静态托管 www、目录(台账)管理、文件上传/查看、用户与权限管理。
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
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_USER = { username: 'admin', password: '123456', display: '系统管理员', role: 'admin' };

/* ---------------- 工具 ---------------- */
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  });
  res.end(body);
}
function sendError(res, code, msg) {
  sendJSON(res, code, { ok: false, error: msg });
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
function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.display_name || u.username, role: u.role };
}
function escapeLike(s) { return String(s).replace(/[%_\\]/g, (c) => '\\' + c); }

/* ---------------- 数据库初始化 ---------------- */
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
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function seed() {
  // 管理员账号
  const admin = db.prepare('SELECT id FROM users WHERE username=?').get(DEFAULT_USER.username);
  if (!admin) {
    const salt = makeSalt();
    db.prepare('INSERT INTO users(username, password_hash, salt, display_name, role) VALUES(?,?,?,?,?)')
      .run(DEFAULT_USER.username, hashPassword(DEFAULT_USER.password, salt), salt, DEFAULT_USER.display, DEFAULT_USER.role);
  }
  // 柜子
  const cabCount = db.prepare('SELECT COUNT(*) AS c FROM cabinets').get().c;
  if (cabCount === 0) {
    for (let i = 0; i < CABINET_COUNT; i++) {
      db.prepare('INSERT INTO cabinets(id, name, door_type, sort) VALUES(?,?,?,?)')
        .run(i, (i + 1) + '号柜', CABINET_DOORS[i], i);
    }
  }
  // 每个柜默认盒子
  const boxCount = db.prepare('SELECT COUNT(*) AS c FROM boxes').get().c;
  if (boxCount === 0) {
    const ins = db.prepare('INSERT INTO boxes(cabinet_id, shelf, slot, name) VALUES(?,?,?,?)');
    for (let c = 0; c < CABINET_COUNT; c++) {
      for (let s = 0; s < SHELF_COUNT; s++) {
        for (let b = 0; b < DEFAULT_BOXES_PER_SHELF; b++) {
          ins.run(c, s, b, '备用');
        }
      }
    }
  }
}
seed();

/* ---------------- 认证 ---------------- */
function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token);
  return row || null;
}
function requireAuth(req, role) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.urlToken || req.queryToken || null);
  const user = getUserByToken(token);
  if (!user) return { error: '未登录或登录已过期' };
  if (role && !roleAllowed(user.role, role)) return { error: '权限不足' };
  return { user, token };
}
function roleAllowed(role, min) {
  const order = { viewer: 1, editor: 2, admin: 3 };
  return (order[role] || 0) >= (order[min] || 1);
}

/* ---------------- 目录（台账） ---------------- */
function getCatalog() {
  const cabinets = db.prepare('SELECT * FROM cabinets ORDER BY sort').all();
  return cabinets.map((c) => {
    const shelves = [];
    for (let s = 0; s < SHELF_COUNT; s++) {
      const rows = db.prepare('SELECT slot, name FROM boxes WHERE cabinet_id=? AND shelf=? ORDER BY slot').all(c.id, s);
      shelves.push(rows.map((r) => r.name));
    }
    return {
      id: c.id,
      name: c.name,
      doorType: c.door_type,
      shelves: shelves
    };
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
  // 删除多余
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
  name = String(name || '').trim() || '备用';
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

/* ---------------- 路由处理 ---------------- */
function getQuery(url) {
  const q = url.split('?')[1] || '';
  const out = {};
  q.split('&').forEach((kv) => {
    if (!kv) return;
    const [k, v] = kv.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return out;
}

function parsePath(url) {
  const parts = url.split('?')[0].split('/').filter(Boolean);
  return parts;
}

async function handleApi(req, res, url) {
  const parts = parsePath(url);
  if (!parts.length) return sendError(res, 404, 'not found');
  if (parts[0] === 'api') parts.shift(); // 去掉 /api 前缀
  if (!parts.length) return sendError(res, 404, 'not found');
  const resource = parts[0];
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    return res.end();
  }

  /* --- 登录/登出 --- */
  if (resource === 'login' && method === 'POST') {
    const body = JSON.parse(await readBody(req) || '{}');
    const { username, password } = body;
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
    if (!row || hashPassword(password, row.salt) !== row.password_hash) {
      return sendError(res, 401, '用户名或密码错误');
    }
    const token = newToken();
    db.prepare('INSERT INTO sessions(token, user_id) VALUES(?,?)').run(token, row.id);
    return sendJSON(res, 200, { ok: true, token, user: publicUser(row) });
  }

  if (resource === 'logout' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return sendJSON(res, 200, { ok: true });
  }

  if (resource === 'me' && method === 'GET') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    return sendJSON(res, 200, { ok: true, user: publicUser(user) });
  }

  /* --- 目录 --- */
  if (resource === 'catalog' && method === 'GET') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const authUser = getUserByToken(token);
    if (!authUser) return sendError(res, 401, '未登录');
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }
  if (resource === 'catalog' && method === 'PUT') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const authUser = getUserByToken(token);
    if (!authUser) return sendError(res, 401, '未登录');
    if (!roleAllowed(authUser.role, 'editor')) return sendError(res, 403, '权限不足');
    const body = JSON.parse(await readBody(req) || '{}');
    const cabinets = body.cabinets;
    if (!Array.isArray(cabinets)) return sendError(res, 400, '数据格式错误');
    // 全量替换目录内容（保留数量上限与结构）
    for (let c = 0; c < CABINET_COUNT; c++) {
      const src = cabinets[c];
      if (!src || !Array.isArray(src.shelves)) continue;
      const shelfArr = src.shelves;
      for (let s = 0; s < SHELF_COUNT; s++) {
        const list = Array.isArray(shelfArr[s]) ? shelfArr[s] : [];
        const n = Math.max(1, Math.min(MAX_BOXES_PER_SHELF, list.length));
        setShelfCount(c, s, n);
        for (let b = 0; b < n; b++) {
          renameBox(c, s, b, list[b]);
        }
      }
    }
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }

  /* --- 单个操作 --- */
  if (resource === 'set-count' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const authUser = getUserByToken(token);
    if (!authUser) return sendError(res, 401, '未登录');
    if (!roleAllowed(authUser.role, 'editor')) return sendError(res, 403, '权限不足');
    const body = JSON.parse(await readBody(req) || '{}');
    const n = setShelfCount(Number(body.cabinetId), Number(body.shelf), Number(body.count));
    return sendJSON(res, 200, { ok: true, count: n, cabinets: getCatalog() });
  }

  if (resource === 'rename' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const authUser = getUserByToken(token);
    if (!authUser) return sendError(res, 401, '未登录');
    if (!roleAllowed(authUser.role, 'editor')) return sendError(res, 403, '权限不足');
    const body = JSON.parse(await readBody(req) || '{}');
    renameBox(Number(body.cabinetId), Number(body.shelf), Number(body.slot), body.name);
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }

  if (resource === 'reset' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const authUser = getUserByToken(token);
    if (!authUser) return sendError(res, 401, '未登录');
    if (!roleAllowed(authUser.role, 'admin')) return sendError(res, 403, '权限不足');
    resetCatalog();
    return sendJSON(res, 200, { ok: true, cabinets: getCatalog() });
  }

  /* --- 文件 --- */
  if (resource === 'files' && method === 'GET' && parts.length === 1) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const q = getQuery(url);
    const token2 = token || q.token || null;
    const user = getUserByToken(token2);
    if (!user) return sendError(res, 401, '未登录');
    const cabinetId = Number(q.cabinetId);
    const shelf = Number(q.shelf);
    const slot = Number(q.slot);
    if (isNaN(cabinetId) || isNaN(shelf) || isNaN(slot)) return sendError(res, 400, '参数错误');
    const rows = db.prepare(`
      SELECT id, box_cabinet_id AS cabinetId, box_shelf AS shelf, box_slot AS slot,
             original_name AS originalName, mime, size, created_at AS createdAt
      FROM files WHERE box_cabinet_id=? AND box_shelf=? AND box_slot=? ORDER BY id
    `).all(cabinetId, shelf, slot);
    const files = rows.map((f) => ({
      ...f,
      url: '/api/files/' + f.id + '/download?token=' + token2 + '&name=' + encodeURIComponent(f.originalName)
    }));
    return sendJSON(res, 200, { ok: true, files });
  }

  if (resource === 'files' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    if (!roleAllowed(user.role, 'editor')) return sendError(res, 403, '权限不足');
    const body = JSON.parse(await readBody(req, MAX_UPLOAD_BYTES) || '{}');
    const cabinetId = Number(body.cabinetId);
    const shelf = Number(body.shelf);
    const slot = Number(body.slot);
    const originalName = String(body.filename || 'file');
    const mime = String(body.mime || 'application/octet-stream');
    const dataBase64 = String(body.dataBase64 || '');
    if (isNaN(cabinetId) || isNaN(shelf) || isNaN(slot)) return sendError(res, 400, '参数错误');
    if (!dataBase64) return sendError(res, 400, '未收到文件内容');
    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length > MAX_UPLOAD_BYTES) return sendError(res, 413, '文件过大');
    ensureBox(cabinetId, shelf, slot);
    const ext = path.extname(originalName) || '.bin';
    const storedName = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buf);
    const r = db.prepare(`
      INSERT INTO files(box_cabinet_id, box_shelf, box_slot, original_name, stored_name, mime, size, uploaded_by)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(cabinetId, shelf, slot, originalName, storedName, mime, buf.length, user.id);
    const file = db.prepare(`
      SELECT id, box_cabinet_id AS cabinetId, box_shelf AS shelf, box_slot AS slot,
             original_name AS originalName, mime, size, created_at AS createdAt
      FROM files WHERE id=?
    `).get(r.lastInsertRowid);
    file.url = '/api/files/' + file.id + '/download?token=' + token + '&name=' + encodeURIComponent(file.originalName);
    return sendJSON(res, 200, { ok: true, file });
  }

  if (parts[0] === 'files' && parts[1] && parts[2] === 'download' && method === 'GET') {
    const q = getQuery(url);
    const token = q.token || null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    const id = Number(parts[1]);
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(id);
    if (!file) return sendError(res, 404, '文件不存在');
    const p = path.join(UPLOAD_DIR, file.stored_name);
    if (!fs.existsSync(p)) return sendError(res, 404, '文件不存在');
    const mime = file.mime || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Disposition': (q.download === '1' ? 'attachment; ' : 'inline; ') + 'filename*=UTF-8\'\'' + encodeURIComponent(file.original_name) + '\'\'',
      'Content-Length': file.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (resource === 'files' && parts[1] && method === 'DELETE') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    if (!roleAllowed(user.role, 'editor')) return sendError(res, 403, '权限不足');
    const id = Number(parts[1]);
    const file = db.prepare('SELECT * FROM files WHERE id=?').get(id);
    if (!file) return sendError(res, 404, '文件不存在');
    const p = path.join(UPLOAD_DIR, file.stored_name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    db.prepare('DELETE FROM files WHERE id=?').run(id);
    return sendJSON(res, 200, { ok: true });
  }

  /* --- 用户管理 --- */
  if (resource === 'users' && method === 'GET') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    if (!roleAllowed(user.role, 'admin')) return sendError(res, 403, '权限不足');
    const rows = db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY id').all();
    return sendJSON(res, 200, { ok: true, users: rows.map((u) => publicUser(u)) });
  }
  if (resource === 'users' && method === 'POST') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    if (!roleAllowed(user.role, 'admin')) return sendError(res, 403, '权限不足');
    const body = JSON.parse(await readBody(req) || '{}');
    const username = String(body.username || '').trim();
    if (!username) return sendError(res, 400, '用户名不能为空');
    const exists = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (exists) return sendError(res, 409, '用户名已存在');
    const salt = makeSalt();
    const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : 'viewer';
    const r = db.prepare('INSERT INTO users(username, password_hash, salt, display_name, role) VALUES(?,?,?,?,?)')
      .run(username, hashPassword(body.password || '123456', salt), salt, body.displayName || username, role);
    const row = db.prepare('SELECT id, username, display_name, role FROM users WHERE id=?').get(r.lastInsertRowid);
    return sendJSON(res, 200, { ok: true, user: publicUser(row) });
  }
  if (resource === 'users' && parts[1] && method === 'PUT') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    if (!roleAllowed(user.role, 'admin')) return sendError(res, 403, '权限不足');
    const id = Number(parts[1]);
    const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!target) return sendError(res, 404, '用户不存在');
    const body = JSON.parse(await readBody(req) || '{}');
    const role = ['admin', 'editor', 'viewer'].includes(body.role) ? body.role : target.role;
    const displayName = body.displayName || target.display_name;
    let sql = 'UPDATE users SET role=?, display_name=? WHERE id=?';
    let params = [role, displayName, id];
    if (body.password) {
      const salt = makeSalt();
      sql = 'UPDATE users SET role=?, display_name=?, password_hash=?, salt=? WHERE id=?';
      params = [role, displayName, hashPassword(body.password, salt), salt, id];
    }
    db.prepare(sql).run(...params);
    const row = db.prepare('SELECT id, username, display_name, role FROM users WHERE id=?').get(id);
    return sendJSON(res, 200, { ok: true, user: publicUser(row) });
  }
  if (resource === 'users' && parts[1] && method === 'DELETE') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const user = getUserByToken(token);
    if (!user) return sendError(res, 401, '未登录');
    if (!roleAllowed(user.role, 'admin')) return sendError(res, 403, '权限不足');
    const id = Number(parts[1]);
    if (id === user.id) return sendError(res, 400, '不能删除当前登录账号');
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    return sendJSON(res, 200, { ok: true });
  }

  return sendError(res, 404, '接口不存在');
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const filePath = path.normalize(path.join(WWW, p));
  if (!filePath.startsWith(WWW)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- 服务器 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  try {
    if (url.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (e) {
    if (!res.headersSent) sendError(res, 500, '服务器错误：' + (e && e.message));
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log('[台账查找] 服务已启动 http://127.0.0.1:' + PORT);
  console.log('  默认管理员：admin / 123456');
});
