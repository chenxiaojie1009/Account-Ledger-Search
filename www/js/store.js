/* 台账查找 - 数据层（连接服务器数据库）
 * 前端统一从服务器 API 获取/保存目录，不再写入 localStorage。
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
    // 默认：与当前页面同主机，后端端口 10600
    try {
      return window.location.protocol + '//' + window.location.hostname + ':10600';
    } catch (e) { return ''; }
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
          var err = new Error(payload.error || ('HTTP ' + res.status));
          err.status = res.status;
          err.payload = payload;
          throw err;
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
    return data;
  }

  async function init() {
    if (!token) return { loggedIn: false };
    try {
      var me = await request('GET', '/api/me');
      user = me.user;
      await loadCatalog();
      return { loggedIn: true, user: user };
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
    await loadCatalog();
    return user;
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

  async function renameBox(ci, si, bi, name) {
    name = String(name || '').trim() || DEFAULT_NAME;
    await request('POST', '/api/rename', { cabinetId: ci, shelf: si, slot: bi, name: name });
    return data.cabinets[ci].shelves[si][bi] = name;
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
      c.shelves.forEach(function (s, si) {
        s.forEach(function (name, bi) {
          if (name.toLowerCase().indexOf(q) !== -1) {
            results.push({ ci: ci, si: si, bi: bi, name: name });
          }
        });
      });
    });
    return results;
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
    }
  };
  Object.defineProperty(window.Store, 'data', { get: function () { return data; } });
})();
