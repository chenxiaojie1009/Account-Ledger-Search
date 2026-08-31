/* 台账查找 - 数据层（连接服务器数据库）
 * 前端统一从服务器 API 获取/保存目录，不再写入 localStorage。
 * 安全说明：不再保存密码；文件下载地址由服务器签发“短时效票据”，
 * 主登录令牌不会出现在 URL 中。
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'taizhang_token';
  var API_KEY = 'taizhang_api_base';
  var MAX_BOXES = 40;
  var DEFAULT_COUNT = 15;
  var DEFAULT_NAME = '备用';
  var CABINET_COUNT = 6;
  var SHELF_COUNT = 3;

  var data = { cabinets: [] };
  var user = null;
  var token = loadToken();
  var _catalogJson = null; // 最近一次目录 JSON 快照，用于检测后台配置变更

  function loadToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function saveToken(t) {
    token = t || '';
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
  }
  function loadApiBase() {
    try { return localStorage.getItem(API_KEY) || ''; } catch (e) { return ''; }
  }
  function apiBase() {
    if (window.APP_CONFIG && window.APP_CONFIG.apiBase) return window.APP_CONFIG.apiBase;
    var saved = loadApiBase();
    if (saved) return saved;
    // 不自动猜测主机：手机上默认会是 localhost，导致连不上电脑。必须由用户填写电脑局域网 IP。
    return '';
  }
  function setApiBase(v) {
    try {
      if (v) localStorage.setItem(API_KEY, v);
      else localStorage.removeItem(API_KEY);
    } catch (e) { /* ignore */ }
  }

  function request(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(apiBase() + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        try { payload = text ? JSON.parse(text) : {}; } catch (e) { payload = {}; }
        if (!res.ok) {
          var err = new Error(payload.error || payload.detail || ('HTTP ' + res.status));
          err.status = res.status;
          err.payload = payload;
          throw err;
        }
        // 后端部分失败响应（如登录失败）为 HTTP 200 + ok:false，统一按错误抛出
        if (payload && payload.ok === false) {
          var err2 = new Error(payload.error || payload.detail || ('HTTP ' + res.status));
          err2.status = res.status;
          err2.payload = payload;
          throw err2;
        }
        return payload;
      });
    });
  }

  function setCatalog(cabinets) {
    data = { cabinets: cabinets || [] };
  }

  async function loadCatalog() {
    var r = await request('GET', '/api/catalog');
    setCatalog(r.cabinets);
    _catalogJson = JSON.stringify(r.cabinets);
    return data;
  }

  // 轮询后端目录，检测到配置（颜色/名称/数量等）变化返回 true，供前端自动刷新场景
  async function pollCatalog() {
    var r = await request('GET', '/api/catalog');
    var json = JSON.stringify(r.cabinets);
    var changed = json !== _catalogJson;
    setCatalog(r.cabinets);
    _catalogJson = json;
    return changed;
  }

  async function init() {
    if (!token) return { loggedIn: false };
    try {
      var me = await request('GET', '/api/me');
      user = me.user;
      if (!user.mustChangePassword) await loadCatalog();
      return { loggedIn: true, user: user, mustChangePassword: !!user.mustChangePassword };
    } catch (e) {
      saveToken('');
      user = null;
      return { loggedIn: false };
    }
  }

  async function login(username, password) {
    var r = await request('POST', '/api/login', { username: username, password: password });
    saveToken(r.token);
    user = r.user;
    // 强制改密状态下目录接口会被服务端拦截，先交给界面完成改密
    if (!user.mustChangePassword) await loadCatalog();
    return { user: user, mustChangePassword: !!user.mustChangePassword };
  }

  async function changePassword(oldPassword, newPassword) {
    var r = await request('POST', '/api/change-password', { oldPassword: oldPassword, newPassword: newPassword });
    if (user) user.mustChangePassword = false;
    return r;
  }

  async function logout() {
    try { await request('POST', '/api/logout'); } catch (e) { /* ignore */ }
    saveToken('');
    user = null;
    data = { cabinets: [] };
  }

  function clampCount(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) n = DEFAULT_COUNT;
    return Math.max(1, Math.min(MAX_BOXES, n));
  }

  async function setShelfCount(ci, si, n) {
    var r = await request('POST', '/api/set-count', { cabinetId: ci, shelf: si, count: clampCount(n) });
    setCatalog(r.cabinets);
    return r.count;
  }

  async function renameBox(ci, si, bi, name, code) {
    name = String(name || '').trim() || DEFAULT_NAME;
    var body = { cabinetId: ci, shelf: si, slot: bi, name: name };
    if (code !== undefined) body.code = code;
    await request('POST', '/api/rename', body);
    data.cabinets[ci].shelves[si][bi] = name;
    if (code !== undefined) {
      if (!data.cabinets[ci].codes) data.cabinets[ci].codes = [];
      if (!data.cabinets[ci].codes[si]) data.cabinets[ci].codes[si] = [];
      data.cabinets[ci].codes[si][bi] = code;
    }
    return name;
  }

  async function resetAll() {
    var r = await request('POST', '/api/reset');
    setCatalog(r.cabinets);
  }

  async function importRows(rows) {
    var r = await request('POST', '/api/import', { rows: rows });
    setCatalog(r.cabinets);
    return { imported: r.imported, failed: r.failed, errors: r.errors || [] };
  }

  function find(query) {
    var q = String(query || '').trim().toLowerCase();
    var results = [];
    if (!q) return results;
    data.cabinets.forEach(function (c, ci) {
      var codes = (c.codes && c.codes[0]) ? c.codes : null;
      c.shelves.forEach(function (s, si) {
        var shelfCodes = (codes && codes[si]) || [];
        s.forEach(function (name, bi) {
          var code = (shelfCodes[bi] || '');
          if (name.toLowerCase().indexOf(q) !== -1 || String(code).toLowerCase().indexOf(q) !== -1) {
            results.push({ ci: ci, si: si, bi: bi, name: name, code: code });
          }
        });
      });
    });
    return results;
  }

  // 文档编号：优先取后台填写的编号；为空时按“序号”兜底显示（如 01、02 …）
  function codeOf(ci, si, bi) {
    var c = data.cabinets[ci];
    if (!c) return '';
    var codes = (c.codes && c.codes[si]) || [];
    var code = codes[bi] != null ? String(codes[bi]).trim() : '';
    if (code) return code;
    var n = bi + 1;
    return n < 10 ? '0' + n : String(n);
  }

  function keyOf(ci, si, bi) { return ci + '-' + si + '-' + bi; }

  /* ---------------- 文件 ---------------- */
  async function listFiles(ci, si, bi) {
    var q = 'cabinetId=' + ci + '&shelf=' + si + '&slot=' + bi;
    var r = await request('GET', '/api/files?' + q);
    return r.files || [];
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var s = String(reader.result || '');
        resolve(s.split(',')[1] || '');
      };
      reader.onerror = function () { reject(reader.error || new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  async function uploadFile(ci, si, bi, file) {
    var dataBase64 = await fileToBase64(file);
    var r = await request('POST', '/api/files', {
      cabinetId: ci, shelf: si, slot: bi,
      filename: file.name,
      mime: file.type || 'application/octet-stream',
      dataBase64: dataBase64
    });
    return r.file;
  }

  async function deleteFile(id) {
    await request('DELETE', '/api/files/' + id);
  }

  /* ---------------- 用户 ---------------- */
  async function listUsers() {
    var r = await request('GET', '/api/users');
    return r.users || [];
  }
  async function createUser(u) {
    var r = await request('POST', '/api/users', u);
    return r.user;
  }
  async function updateUser(id, u) {
    var r = await request('PUT', '/api/users/' + id, u);
    return r.user;
  }
  async function deleteUser(id) {
    await request('DELETE', '/api/users/' + id);
  }

  function roleOrder(r) { return { viewer: 1, editor: 2, admin: 3 }[r] || 0; }
  function canEdit() { return !!user && roleOrder(user.role) >= 2; }
  function canAdmin() { return !!user && roleOrder(user.role) >= 3; }
  function isViewer() { return !!user && roleOrder(user.role) === 1; }

  window.Store = {
    MAX_BOXES: MAX_BOXES,
    DEFAULT_COUNT: DEFAULT_COUNT,
    DEFAULT_NAME: DEFAULT_NAME,
    CABINET_COUNT: CABINET_COUNT,
    SHELF_COUNT: SHELF_COUNT,
    init: init,
    login: login,
    logout: logout,
    changePassword: changePassword,
    loadCatalog: loadCatalog,
    setShelfCount: setShelfCount,
    renameBox: renameBox,
    resetAll: resetAll,
    importRows: importRows,
    find: find,
    listFiles: listFiles,
    uploadFile: uploadFile,
    deleteFile: deleteFile,
    listUsers: listUsers,
    createUser: createUser,
    updateUser: updateUser,
    deleteUser: deleteUser,
    canEdit: canEdit,
    canAdmin: canAdmin,
    isViewer: isViewer,
    keyOf: keyOf,
    user: function () { return user; },
    token: function () { return token; },
    apiBase: apiBase,
    setApiBase: setApiBase,
    posLabel: function (r) {
      return (r.ci + 1) + '号柜 · 第' + (3 - r.si) + '层';
    },
    codeOf: codeOf
  };
  Object.defineProperty(window.Store, 'data', { get: function () { return data; } });
})();
