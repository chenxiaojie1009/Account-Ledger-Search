/* 台账查找 - APP 界面层 v2（三维场景、搜索、台账位置与文件内容；后台管理在网页 /admin） */
(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };

  var els = {};
  var results = [];
  var resultIndex = 0;
  var activeKey = null;
  var markerTimer = null;
  var focusKey = null, focusTimer = null;
  var detailKey = null;
  var recognition = null;
  var suggestTimer = null, suggestItems = [], suggestIdx = -1;

  /* ---------------- 图标 ---------------- */
  var ICON_LOCK = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';
  var ICON_FILE = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>';
  var ICON_LOGO = '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="5" height="12" rx="1.5" fill="currentColor" opacity=".95"/><rect x="9.5" y="8" width="5" height="12" rx="1.5" fill="currentColor" opacity=".7"/><rect x="16" y="8" width="5" height="12" rx="1.5" fill="currentColor" opacity=".95"/><circle cx="18.5" cy="5" r="3" stroke="currentColor" stroke-width="1.8"/><path d="M17 5l1 1 2-2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_PIN = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>';
  var ICON_EYE = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  var ICON_DOWNLOAD = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>';

  function fileIconSvg(kind) {
    var paths = {
      image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
      pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h1.5a1.5 1.5 0 0 1 0 3H9v-3zm0 3h2"/>',
      excel: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13l3 4M12 13l-3 4"/>',
      word: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13l1.5 5 2-6 2 6 1.5-5"/>',
      ppt: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 18v-5h2a1.5 1.5 0 0 1 0 3H9"/>',
      text: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h6M8 9h3"/>',
      other: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-4M12 11h.01"/>'
    };
    var p = paths[kind] || paths.other;
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px">' + p + '</svg>';
  }

  function fileKindLabel(kind) {
    return { image: 'IMG', pdf: 'PDF', excel: 'XLS', word: 'DOC', ppt: 'PPT', text: 'TXT', other: 'FILE' }[kind] || 'FILE';
  }

  /* ---------------- 基础工具 ---------------- */
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.innerHTML = '<span class="dot"></span><span>' + msg + '</span>';
    els.toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 2900);
  }
  function openModal(html) { els.overlayRoot.innerHTML = html; }
  function closeModal() { els.overlayRoot.innerHTML = ''; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function highlightMatch(text, q) {
    if (!q) return escapeHtml(text);
    var idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
  }
  function formatSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function layerNo(si) { return 3 - si; }
  function filePreviewMime(f) {
    var m = (f.mime || '').toLowerCase();
    if (m.indexOf('image/') === 0) return 'image';
    if (m === 'application/pdf') return 'pdf';
    if (m.indexOf('text/') === 0 || m === 'application/json' || m === 'application/xml' || m === 'text/xml' || m === 'application/javascript') return 'text';
    var ext = (f.originalName || '').split('.').pop().toLowerCase();
    if (['txt', 'md', 'json', 'csv', 'html', 'htm', 'xml', 'log'].indexOf(ext) >= 0) return 'text';
    if (m.indexOf('spreadsheet') >= 0 || m === 'application/vnd.ms-excel' || ['xlsx', 'xls', 'xlsm', 'xlsb'].indexOf(ext) >= 0) return 'excel';
    if (ext === 'docx' || m.indexOf('wordprocessingml') >= 0) return 'word';
    if (ext === 'doc' || m === 'application/msword') return 'word-legacy';
    if (['pptx', 'pptm'].indexOf(ext) >= 0 || m.indexOf('presentationml') >= 0) return 'ppt';
    if (ext === 'ppt' || m === 'application/vnd.ms-powerpoint') return 'ppt-legacy';
    return 'other';
  }

  /* ---------------- 登录 ---------------- */
  function showLogin() {
    if (els.searchBar) els.searchBar.classList.add('hidden');
    hideSuggest();
    function loadVal(key) {
      try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    }
    var savedUser = loadVal('taizhang_username') || 'admin';
    var savedApi = loadVal('taizhang_api_base');
    openModal(
      '<div class="modal" id="loginModal">' +
      '<div class="modal-card login-card">' +
      '<div class="login-brand">' +
      '<div class="login-logo">' + ICON_LOGO + '</div>' +
      '<h2>台账查找</h2>' +
      '<p>三维档案定位系统</p>' +
      '</div>' +
      '<label class="field-label">用户名</label>' +
      '<input class="text-input" id="userInput" type="text" autocomplete="off" value="' + escapeHtml(savedUser) + '">' +
      '<label class="field-label">密码</label>' +
      '<input class="text-input pw-input" id="pwInput" type="password" inputmode="text" autocomplete="off" placeholder="输入密码" value="">' +
      '<label class="field-label">后端地址（电脑的局域网 IP）</label>' +
      '<input class="text-input" id="apiInput" type="text" autocomplete="off" placeholder="如 http://192.168.1.10:10600" value="' + escapeHtml(savedApi) + '">' +
      '<div class="error-hint" id="loginError"></div>' +
      '<div class="modal-actions" style="flex-direction:column;margin-top:20px">' +
      '<button class="btn btn-primary" id="loginOk" type="button" style="width:100%">登 录</button>' +
      '<button class="btn btn-ghost" id="loginCancel" type="button" style="width:100%">取消</button>' +
      '</div></div></div>'
    );
    setTimeout(function () { var u = $('#userInput'); if (u) u.focus(); }, 100);
    async function submit() {
      var username = $('#userInput').value.trim();
      var password = $('#pwInput').value;
      var api = $('#apiInput').value.trim();
      var btn = $('#loginOk');
      if (!api) {
        $('#loginError').textContent = '请填写后端地址：电脑局域网 IP（如 http://192.168.1.10:10600）';
        shakeModal();
        return;
      }
      Store.setApiBase(api);
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        var res = await Store.login(username, password);
        var user = res.user;
        Store.setApiBase(api);
        // 只记住用户名与后端地址（绝不保存密码）
        try {
          localStorage.setItem('taizhang_username', username);
          localStorage.setItem('taizhang_api_base', api);
        } catch (e) { /* ignore */ }
        closeModal();
        if (res.mustChangePassword) {
          toast('首次登录请先修改初始密码', 'warn');
          showPwdChangeModal(true);
          return;
        }
        if (els.searchBar) els.searchBar.classList.remove('hidden');
        toast('欢迎回来，' + (user.displayName || user.username));
        afterLogin();
      } catch (e) {
        var msg = e.message || '登录失败';
        if (/failed to fetch|network|fetch|load failed/i.test(msg)) {
          msg = '无法连接服务器，请确认：①后端地址填电脑局域网 IP（不要用 127.0.0.1）；②平板与电脑同一局域网；③电脑防火墙放行 10600 端口。';
        }
        $('#loginError').textContent = msg;
        btn.disabled = false;
        btn.textContent = '登 录';
        shakeModal();
      }
    }
    function shakeModal() {
      var card = $('#loginModal .modal-card');
      if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
    }
    $('#loginOk').addEventListener('click', submit);
    $('#pwInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('#apiInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('#loginCancel').addEventListener('click', closeModal);
    $('#loginModal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  }

  /* ---------------- 目录自动检测刷新（后台改颜色/名称后实时生效） ---------------- */
  var _pollTimer = null;
  function startCatalogPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(async function () {
      try {
        var changed = await Store.pollCatalog();
        if (changed) {
          Scene3D.rebuildAll(true);
          toast('目录配置已更新');
        }
      } catch (e) { /* 网络暂时不可用则跳过本轮 */ }
    }, 1200000); // 每 20 分钟检查一次后台目录变化
  }
  function stopCatalogPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  async function afterLogin() {
    try {
      await Store.loadCatalog();
      if (els.searchBar) els.searchBar.classList.remove('hidden');
      Scene3D.rebuildAll(true);
      renderUserUI();
      startCatalogPolling();
      toast('目录已同步');
    } catch (e) {
      toast('加载目录失败：' + (e.message || e), 'err');
    }
  }

  async function logout() {
    await Store.logout();
    stopCatalogPolling();
    if (els.searchBar) els.searchBar.classList.add('hidden');
    hideDetailBtn();
    Scene3D.rebuildAll(false);
    closeModal();
    renderUserUI();
    showLogin();
    toast('已退出登录');
  }

  function renderUserUI() {
    var u = Store.user();
    var label = $('#userLabel');
    if (label) label.textContent = u ? (u.displayName || u.username) : '用户';
  }

  /* ---------------- 用户菜单 / 修改密码 ---------------- */
  var pwdForce = false; // true 时强制改密，未完成不能进入主界面

  function openUserMenu() {
    var u = Store.user();
    if (!u) { showLogin(); return; }
    openModal(
      '<div class="modal" id="userMenuModal">' +
      '<div class="modal-card user-menu-card">' +
      '<div class="modal-title">' + ICON_LOGO + '<span>当前用户</span></div>' +
      '<div class="user-menu-info"><b>' + escapeHtml(u.displayName || u.username) + '</b>' +
      '<span>@' + escapeHtml(u.username) + ' · ' + (u.role === 'admin' ? '管理员' : u.role === 'editor' ? '编辑' : '只读') + '</span></div>' +
      '<div class="modal-actions" style="flex-direction:column;gap:10px">' +
      '<button class="btn btn-primary" id="menuChangePwd" type="button" style="width:100%">修改密码</button>' +
      '<button class="btn btn-ghost" id="menuLogout" type="button" style="width:100%">退出登录</button>' +
      '<button class="btn btn-ghost" id="menuClose" type="button" style="width:100%">取消</button>' +
      '</div></div></div>'
    );
    $('#menuChangePwd').addEventListener('click', function () { showPwdChangeModal(false); });
    $('#menuLogout').addEventListener('click', function () { closeModal(); logout(); });
    $('#menuClose').addEventListener('click', closeModal);
    $('#userMenuModal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  }

  // 修改密码弹窗；force=true 时不可关闭（首次登录强制改密）
  function showPwdChangeModal(force) {
    pwdForce = !!force;
    openModal(
      '<div class="modal" id="pwdModal">' +
      '<div class="modal-card pwd-card">' +
      '<div class="modal-title"><span class="ic-wrap">' + ICON_LOCK + '</span>修改密码</div>' +
      (force ? '<div class="pwd-warn">为保障内网资料安全，首次登录必须修改初始密码</div>' : '') +
      '<label class="field-label">原密码</label>' +
      '<input class="text-input" id="pwdOld" type="password" autocomplete="current-password">' +
      '<label class="field-label">新密码（至少 8 位，含字母和数字）</label>' +
      '<input class="text-input" id="pwdNew" type="password" autocomplete="new-password">' +
      '<label class="field-label">确认新密码</label>' +
      '<input class="text-input" id="pwdConfirm" type="password" autocomplete="new-password">' +
      '<div class="error-hint" id="pwdErr"></div>' +
      '<div class="modal-actions" style="flex-direction:column;gap:10px">' +
      '<button class="btn btn-primary" id="pwdOk" type="button" style="width:100%">确认修改</button>' +
      (force ? '' : '<button class="btn btn-ghost" id="pwdCancel" type="button" style="width:100%">取消</button>') +
      '</div></div></div>'
    );
    setTimeout(function () { var i = $('#pwdOld'); if (i) i.focus(); }, 100);
    $('#pwdOk').addEventListener('click', submitPwdChange);
    var can = $('#pwdCancel');
    if (can) can.addEventListener('click', closeModal);
    $('#pwdModal').addEventListener('click', function (e) {
      if (e.target === this && !force) closeModal();
    });
    $('#pwdNew').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPwdChange(); });
    $('#pwdConfirm').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPwdChange(); });
  }

  async function submitPwdChange() {
    var oldP = $('#pwdOld').value;
    var newP = $('#pwdNew').value;
    var cfP = $('#pwdConfirm').value;
    var errBox = $('#pwdErr');
    if (!oldP) { errBox.textContent = '请输入原密码'; return; }
    if (newP.length < 8) { errBox.textContent = '新密码至少 8 位'; return; }
    if (!/[A-Za-z]/.test(newP) || !/[0-9]/.test(newP)) { errBox.textContent = '新密码需同时包含字母和数字'; return; }
    if (newP !== cfP) { errBox.textContent = '两次输入的新密码不一致'; return; }
    if (newP === oldP) { errBox.textContent = '新密码不能与原密码相同'; return; }
    var btn = $('#pwdOk');
    btn.disabled = true; btn.textContent = '提交中…';
    try {
      await Store.changePassword(oldP, newP);
      var wasForce = pwdForce;
      pwdForce = false;
      closeModal();
      toast('密码修改成功');
      if (wasForce) {
        if (els.searchBar) els.searchBar.classList.remove('hidden');
        afterLogin();
      }
    } catch (e) {
      errBox.textContent = e.message || '修改失败';
      btn.disabled = false; btn.textContent = '确认修改';
    }
  }

  /* ---------------- 台账详情 ---------------- */
  function openBoxDetail(key) {
    var info = Scene3D.boxInfo(key);
    if (!info) return;
    cancelLocate(false);
    detailKey = key;
    showDetailBtn();
    // 若尚未聚焦到该盒子（如外部直接调用），先执行飞行动画
    if (focusKey !== key) {
      focusKey = key;
      Scene3D.flyToBox(key, 1.0, function () {
        if (focusKey === key) Scene3D.setFocusBox(key);
      });
    }
    showDetailModal(info.ci, info.si, info.bi);
  }

  function focusBoxFirstTime(key) {
    // 首次点击：聚焦放大（与查找定位相同的效果）
    cancelLocate(false);
    cancelBoxFocus(false);
    focusKey = key;
    showDetailBtn();
    Scene3D.flyToBox(key, 1.0, function () {
      if (focusKey === key) Scene3D.setFocusBox(key);
    });
  }

  function showDetailBtn() {
    if (els.btnBoxDetail) els.btnBoxDetail.hidden = false;
  }
  function hideDetailBtn() {
    if (els.btnBoxDetail) els.btnBoxDetail.hidden = true;
  }

  function showDetailModal(ci, si, bi) {
    var name = Store.data.cabinets[ci].shelves[si][bi];
    var loc = (ci + 1) + '号柜 · 第 ' + layerNo(si) + ' 层 · 第 ' + (bi + 1) + ' 个';
    openModal(
      '<div class="modal" id="detailModal">' +
      '<div class="modal-card detail-card">' +
      '<div class="modal-title"><span class="ic-wrap">' + ICON_FILE + '</span>台账详情</div>' +
      '<div class="detail-loc">' + ICON_PIN + '<span>' + escapeHtml(loc) + '</span></div>' +
      '<div class="detail-name-readonly"><b>' + escapeHtml(name) + '</b></div>' +
      '<div class="detail-files-head"><span>台账文件</span><span class="file-count" id="fileCount"></span></div>' +
      '<div class="detail-files" id="detailFiles"><span class="shelf-empty">加载中…</span></div>' +
      '<div class="modal-actions" style="justify-content:flex-start"><button class="btn btn-ghost" id="detailClose" type="button">关闭</button></div>' +
      '</div></div>'
    );
    $('#detailClose').addEventListener('click', closeDetail);
    $('#detailModal').addEventListener('click', function (e) { if (e.target === this) closeDetail(); });
    renderBoxFiles(ci, si, bi);
  }

  function closeDetail() {
    detailKey = null;
    closeModal();
    // 关闭详情后停留在当前柜子放大视图，不退回主页视角
  }

  async function renderBoxFiles(ci, si, bi) {
    var box = $('#detailFiles');
    if (!box) return;
    box.innerHTML = '<span class="shelf-empty">加载中…</span>';
    var files;
    try { files = await Store.listFiles(ci, si, bi); } catch (e) { files = []; }
    var fc = $('#fileCount');
    if (fc) fc.textContent = files.length ? files.length + ' 个文件' : '';
    if (!files.length) {
      box.innerHTML = '<div style="text-align:center;padding:32px 0;color:var(--text-3)"><div style="font-size:40px;opacity:.4;margin-bottom:8px">📂</div>暂无文件</div>';
      return;
    }
    box.innerHTML = files.map(function (f) {
      var kind = filePreviewMime(f);
      return '<div class="file-row">' +
        '<div class="file-icon ic-' + kind + '">' + fileIconSvg(kind) + '</div>' +
        '<div class="file-info">' +
        '<div class="file-name">' + escapeHtml(f.originalName) + '</div>' +
        '<div class="file-meta">' + formatSize(f.size) + ' · ' + fileKindLabel(kind) + '</div>' +
        '</div>' +
        '<div class="file-actions">' +
        '<button class="file-btn" data-act="view" data-id="' + f.id + '" type="button">' + ICON_EYE + '<span>查看</span></button>' +
        (f.downloadable
          ? '<a class="file-btn" href="' + escapeHtml(f.url) + '" download="' + escapeHtml(f.originalName) + '" title="下载到设备">' + ICON_DOWNLOAD + '<span>下载</span></a>'
          : '<span class="file-btn readonly-tag" title="只读用户仅可预览，不能下载原始文件">仅预览</span>') +
        '</div>' +
        '</div>';
    }).join('');
    box.querySelectorAll('[data-act="view"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = Number(btn.dataset.id);
        var f = files.find(function (x) { return x.id === id; });
        if (f) openFileViewer(f);
      });
    });
  }

  function openFileViewer(f) {
    var kind = filePreviewMime(f);
    // 图片/PDF 走服务器加水印的预览接口；Office/文本用内联预览地址（均为短时效票据）
    var preview = f.previewUrl || f.url;
    var inner;
    if (kind === 'image') {
      inner = '<img class="file-img" src="' + escapeHtml(preview) + '" alt="' + escapeHtml(f.originalName) + '">';
    } else if (kind === 'pdf') {
      inner = '<div class="pdf-viewer" data-id="' + f.id + '">' +
        '<div class="pdf-nav"><button type="button" id="pdfPrev">上一页</button>' +
        '<span id="pdfPage">加载中…</span>' +
        '<button type="button" id="pdfNext">下一页</button></div>' +
        '<img class="pdf-img" id="pdfImg" alt="' + escapeHtml(f.originalName) + '"></div>';
    } else if (kind === 'text') {
      inner = '<div class="file-text" data-url="' + escapeHtml(preview) + '"><span class="shelf-empty">加载中…</span></div>';
    } else if (kind === 'excel') {
      inner = '<div class="file-excel" data-url="' + escapeHtml(preview) + '"><span class="shelf-empty">正在解析 Excel…</span></div>';
    } else if (kind === 'word') {
      inner = '<div class="file-word" data-url="' + escapeHtml(preview) + '"><span class="shelf-empty">正在解析 Word…</span></div>';
    } else if (kind === 'ppt') {
      inner = '<div class="file-ppt" data-url="' + escapeHtml(preview) + '"><span class="shelf-empty">正在解析 PPT…</span></div><div class="ppt-note">（PPT 在线预览仅显示每页文字内容）</div>';
    } else {
      inner = '<div class="file-other"><div class="ficon">📄</div><p>该格式无法在线预览。</p>' +
        (f.downloadable
          ? '<a class="btn btn-primary" href="' + escapeHtml(f.url) + '" download="' + escapeHtml(f.originalName) + '" style="margin-top:8px">下载查看</a>'
          : '<p style="color:var(--text-3)">只读用户仅可预览，如需下载请联系管理员</p>') +
        '</div>';
    }
    openModal(
      '<div class="modal" id="viewerModal">' +
      '<div class="modal-card viewer-card">' +
      '<div class="modal-title"><span class="ic-wrap">' + ICON_FILE + '</span>' + escapeHtml(f.originalName) + '</div>' +
      '<div class="wm-note">内部资料 · 仅供查看 · 请勿外传</div>' +
      '<div class="viewer-body">' + inner + '</div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="viewerClose" type="button">关闭</button></div>' +
      '</div></div>'
    );
    if (kind === 'text') {
      fetch(preview).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
        var text = '';
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
        } catch (e) {
          try { text = new TextDecoder('gbk').decode(buf); }
          catch (e2) { text = new TextDecoder('utf-8').decode(buf); }
        }
        var box = $('.file-text'); if (box) box.innerHTML = '<pre>' + escapeHtml(text) + '</pre>';
      }).catch(function () {
        var box = $('.file-text'); if (box) box.innerHTML = '<span class="shelf-empty">无法读取文本内容</span>';
      });
    }
    if (kind === 'pdf') initPdfViewer(f);
    if (kind === 'excel') renderExcelPreview(preview);
    if (kind === 'word') renderWordPreview(preview);
    if (kind === 'ppt') renderPptPreview(preview);
    $('#viewerClose').addEventListener('click', function () { openModal(''); showDetailModalFromCache(); });
    $('#viewerModal').addEventListener('click', function (e) { if (e.target === this) $('#viewerClose').click(); });
  }

  function initPdfViewer(f) {
    var img = $('#pdfImg');
    var pageLabel = $('#pdfPage');
    var cur = 1, total = 1;
    function previewUrl(p) {
      var base = f.previewUrl || f.url;
      if (base.indexOf('/preview') >= 0) {
        return base.replace(/[?&]page=\d*/, '') + '&page=' + p;
      }
      return base.replace('/download', '/preview').replace(/[?&]name=[^&]*/, '') + '&page=' + p;
    }
    function pdfFail() {
      // 图片加载失败：可能是服务器未运行、渲染失败或预览票据过期；
      // 给出准确提示并提供重试 / 下载，而不是笼统归咎“后端不支持”。
      var box = $('.pdf-viewer');
      if (!box) return;
      box.innerHTML = '<div class="file-other"><div class="ficon">📄</div>' +
        '<p>PDF 预览加载失败。可能原因：服务器未运行、页面渲染超时，或预览票据已过期（约 10 分钟）。</p>' +
        '<div class="modal-actions" style="justify-content:center;margin-top:10px">' +
        '<button class="btn btn-ghost" id="pdfRetry" type="button">重试</button>' +
        (f.downloadable
          ? '<a class="btn btn-primary" href="' + escapeHtml(f.url) + '" download="' + escapeHtml(f.originalName) + '" style="margin-left:8px">下载查看</a>'
          : '') +
        '</div></div>';
      var rb = $('#pdfRetry');
      if (rb) rb.addEventListener('click', function () {
        // 重建分页查看器并重试；若票据已过期，重新打开文件详情即可获得新票据
        box.innerHTML = '<div class="pdf-nav"><button type="button" id="pdfPrev">上一页</button>' +
          '<span id="pdfPage">加载中…</span>' +
          '<button type="button" id="pdfNext">下一页</button></div>' +
          '<img class="pdf-img" id="pdfImg" alt="">';
        initPdfViewer(f);
      });
    }
    function load() {
      img.onerror = function () { pdfFail(); };
      img.src = previewUrl(cur);
      pageLabel.textContent = '第 ' + cur + ' / ' + (total || '?') + ' 页';
      var p = $('#pdfPrev'), n = $('#pdfNext');
      if (p) p.disabled = cur <= 1;
      if (n) n.disabled = total >= 1 && cur >= total;
    }
    var infoUrl = (f.previewUrl || f.url).replace('/preview', '/pdf-info').replace('/download', '/pdf-info').replace(/[?&]page=\d*/, '').replace(/[?&]name=[^&]*/, '');
    fetch(infoUrl)
      .then(function (r) { return r.json(); }).then(function (j) {
        total = (j && j.pageCount) || 1;
        load();
      }).catch(function () { total = 1; load(); });
    var p = $('#pdfPrev'), n = $('#pdfNext');
    if (p) p.addEventListener('click', function () { if (cur > 1) { cur--; load(); } });
    if (n) n.addEventListener('click', function () { if (cur < total) { cur++; load(); } });
    load();
  }

  function renderExcelPreview(url) {
    fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var box = $('.file-excel');
      if (!box) return;
      if (typeof XLSX === 'undefined') { box.innerHTML = '<span class="shelf-empty">缺少 Excel 解析组件</span>'; return; }
      var wb;
      try { wb = XLSX.read(new Uint8Array(buf), { type: 'array' }); }
      catch (e) { box.innerHTML = '<span class="shelf-empty">Excel 解析失败：' + escapeHtml(e.message || e) + '</span>'; return; }
      var html = '';
      wb.SheetNames.slice(0, 5).forEach(function (name, idx) {
        var ws = wb.Sheets[name];
        if (!ws) return;
        var rows = [];
        try { rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }); } catch (e) { rows = []; }
        html += '<div class="excel-sheet"><div class="excel-name">工作表' + (idx + 1) + '：' + escapeHtml(name) + '</div>' +
          '<div class="excel-scroll"><table class="excel-table"><tbody>';
        rows.slice(0, 500).forEach(function (row, ri) {
          html += '<tr' + (ri === 0 ? ' style="font-weight:600"' : '') + '>';
          (row || []).forEach(function (cell) {
            html += ri === 0 ? '<th>' + escapeHtml(String(cell == null ? '' : cell)) + '</th>' : '<td>' + escapeHtml(String(cell == null ? '' : cell)) + '</td>';
          });
          html += '</tr>';
        });
        html += '</tbody></table></div></div>';
      });
      box.innerHTML = html || '<span class="shelf-empty">Excel 中没有可显示的内容</span>';
    }).catch(function () { var box = $('.file-excel'); if (box) box.innerHTML = '<span class="shelf-empty">Excel 文件读取失败</span>'; });
  }

  function renderWordPreview(url) {
    fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var box = $('.file-word');
      if (!box) return;
      if (typeof mammoth === 'undefined') { box.innerHTML = '<span class="shelf-empty">缺少 Word 解析组件</span>'; return; }
      mammoth.convertToHtml({ arrayBuffer: buf }).then(function (result) {
        box.innerHTML = result.value || '<span class="shelf-empty">Word 文档为空</span>';
      }).catch(function (e) { box.innerHTML = '<span class="shelf-empty">Word 解析失败：' + escapeHtml(e.message || e) + '</span>'; });
    }).catch(function () { var box = $('.file-word'); if (box) box.innerHTML = '<span class="shelf-empty">Word 文件读取失败</span>'; });
  }

  function renderPptPreview(url) {
    fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var box = $('.file-ppt');
      if (!box) return;
      if (typeof JSZip === 'undefined') { box.innerHTML = '<span class="shelf-empty">缺少 PPT 解析组件</span>'; return; }
      return JSZip.loadAsync(buf).then(function (zip) {
        var slideFiles = Object.keys(zip.files).filter(function (n) {
          return /^ppt\/slides\/slide\d+\.xml$/.test(n);
        }).sort(function (a, b) {
          return parseInt(a.match(/slide(\d+)/)[1], 10) - parseInt(b.match(/slide(\d+)/)[1], 10);
        });
        if (!slideFiles.length) { box.innerHTML = '<span class="shelf-empty">PPT 中没有可预览的幻灯片</span>'; return; }
        var chain = Promise.resolve();
        var html = '';
        var idx = 0;
        slideFiles.forEach(function (name) {
          chain = chain.then(function () {
            return zip.file(name).async('string').then(function (xml) {
              var doc = new DOMParser().parseFromString(xml, 'text/xml');
              var texts = Array.prototype.map.call(doc.getElementsByTagName('a:t'), function (t) { return t.textContent; });
              idx++;
              html += '<div class="ppt-slide"><div class="ppt-title">第 ' + idx + ' 页</div>' +
                '<div class="ppt-text">' + escapeHtml(texts.join(' ') || '（本页无文字）') + '</div></div>';
            });
          });
        });
        return chain.then(function () { box.innerHTML = html; });
      }).catch(function (e) { box.innerHTML = '<span class="shelf-empty">PPT 解析失败：' + escapeHtml(e.message || e) + '</span>'; });
    }).catch(function () { var box = $('.file-ppt'); if (box) box.innerHTML = '<span class="shelf-empty">PPT 文件读取失败</span>'; });
  }

  function showDetailModalFromCache() {
    if (detailKey) {
      var info = Scene3D.boxInfo(detailKey);
      if (info) showDetailModal(info.ci, info.si, info.bi);
    }
  }

  /* ---------------- 搜索建议 ---------------- */
  function buildSuggest(q) {
    q = (q || '').trim();
    var box = els.searchSuggest;
    if (!box) return;
    if (!q) { hideSuggest(); return; }
    var all = [];
    Store.data.cabinets.forEach(function (c, ci) {
      c.shelves.forEach(function (shelf, si) {
        shelf.forEach(function (name, bi) {
          if (name.toLowerCase().indexOf(q.toLowerCase()) >= 0) {
            all.push({ ci: ci, si: si, bi: bi, name: name });
          }
        });
      });
    });
    suggestItems = all.slice(0, 8);
    suggestIdx = -1;
    if (!suggestItems.length) {
      box.innerHTML = '<div class="suggest-item" style="color:var(--text-3);cursor:default"><span class="s-name">未找到「' + escapeHtml(q) + '」相关台账</span></div>';
      box.classList.add('show');
      return;
    }
    box.innerHTML = suggestItems.map(function (r, i) {
      return '<div class="suggest-item" data-i="' + i + '">' +
        '<svg class="s-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
        '<span class="s-name">' + highlightMatch(r.name, q) + '</span>' +
        '<span class="s-loc">' + (r.ci + 1) + '号柜·' + layerNo(r.si) + '层</span></div>';
    }).join('');
    box.classList.add('show');
    box.querySelectorAll('.suggest-item[data-i]').forEach(function (item) {
      item.addEventListener('click', function () {
        var i = Number(item.dataset.i);
        var r = suggestItems[i];
        if (r) {
          els.searchInput.value = r.name;
          hideSuggest();
          locateResult(r);
        }
      });
    });
  }

  function locateResult(r) {
    results = [r];
    resultIndex = 0;
    activeKey = r.ci + '-' + r.si + '-' + r.bi;
    Scene3D.flyToBox(activeKey, 1.15, function () {
      if (activeKey !== r.ci + '-' + r.si + '-' + r.bi) return;
      Scene3D.setDimTarget(activeKey);
      Scene3D.showMarker(activeKey);
      showFoundTag();
      startMarkerTimer();
    });
  }

  function hideSuggest() {
    if (els.searchSuggest) els.searchSuggest.classList.remove('show');
    suggestItems = [];
    suggestIdx = -1;
  }

  /* ---------------- 检索 ---------------- */
  function clearSearchInput() {
    if (els.searchInput) els.searchInput.value = '';
    if (els.btnClearSearch) els.btnClearSearch.hidden = true;
    hideSuggest();
    cancelLocate(false);
    els.searchInput.focus();
  }

  function doSearch() {
    var q = els.searchInput.value.trim();
    if (!q) { toast('请输入台账名称', 'warn'); els.searchInput.focus(); return; }
    hideSuggest();
    cancelBoxFocus(false);
    cancelLocate(false);
    results = Store.find(q);
    if (!results.length) { toast('未找到「' + q + '」相关台账', 'warn'); return; }
    resultIndex = 0;
    showResult(true);
  }

  function showResult(isFirst) {
    if (!results.length) return;
    var r = results[resultIndex];
    activeKey = r.ci + '-' + r.si + '-' + r.bi;
    if (results.length > 1) toast('共找到 ' + results.length + ' 处匹配，已定位第 1 处', 'warn');
    Scene3D.flyToBox(activeKey, 1.15, function () {
      if (activeKey !== r.ci + '-' + r.si + '-' + r.bi) return;
      Scene3D.setDimTarget(activeKey);
      Scene3D.showMarker(activeKey);
      showFoundTag();
      startMarkerTimer();
    });
  }

  function startMarkerTimer() {
    if (markerTimer) clearTimeout(markerTimer);
    markerTimer = setTimeout(function () { cancelLocate(true); }, 10000);
  }

  function cancelLocate(restore) {
    var had = activeKey !== null;
    if (markerTimer) { clearTimeout(markerTimer); markerTimer = null; }
    activeKey = null;
    Scene3D.clearMarker();
    Scene3D.clearDim();
    hideFoundTag();
    results = [];
    resultIndex = 0;
    if (restore && had) Scene3D.flyToOverview(1.0);
  }

  /* ---------------- 定位标签 ---------------- */
  function ensureFoundTag() {
    if (els.foundTag) return;
    els.foundTag = document.createElement('div');
    els.foundTag.id = 'foundTag';
    els.foundTag.className = 'found-tag';
    document.body.appendChild(els.foundTag);
  }
  function showFoundTag() { ensureFoundTag(); els.foundTag.hidden = false; }
  function hideFoundTag() { if (els.foundTag) els.foundTag.hidden = true; }

  function cancelBoxFocus(restore) {
    if (focusTimer) { clearTimeout(focusTimer); focusTimer = null; }
    if (focusKey) { Scene3D.clearFocusBox(); focusKey = null; hideFoundTag(); }
    hideDetailBtn();
    if (restore) Scene3D.flyToOverview(1.0);
  }

  /* ---------------- 悬浮提示 ---------------- */
  function showHoverTip(key) {
    var info = Scene3D.boxInfo(key);
    if (!info) return;
    var p = Scene3D.project(key);
    if (!p || !p.visible) { els.boxTip.hidden = true; return; }
    var hint = (focusKey === key) ? '再次点击收回' : '点击聚焦放大';
    els.boxTip.innerHTML = escapeHtml(info.name) +
      '<small>' + (info.ci + 1) + '号柜 · 第 ' + layerNo(info.si) + ' 层 · ' + hint + '</small>';
    els.boxTip.style.left = p.x + 'px';
    els.boxTip.style.top = p.y + 'px';
    els.boxTip.hidden = false;
  }

  function boxClickHandler(key) {
    if (!Store.user()) { showLogin(); return; }
    if (detailKey) return; // 详情弹窗已打开，忽略场景点击
    if (focusKey === key) {
      // 再次点击同一个已聚焦的台账 → 收回（台账恢复原大小，镜头保持在放大界面）
      cancelBoxFocus(false);
    } else {
      // 首次点击 → 聚焦放大（与查找定位相同的飞行动画）
      focusBoxFirstTime(key);
    }
  }

  /* ---------------- 语音输入 ---------------- */
  function toggleVoice() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { els.searchInput.focus(); toast('已打开键盘，可使用输入法自带的语音按钮输入', 'warn'); return; }
    if (recognition) { try { recognition.stop(); } catch (e) { /* noop */ } return; }
    try {
      recognition = new SR();
      recognition.lang = 'zh-CN';
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      els.btnVoice.classList.add('listening');
      recognition.onresult = function (e) {
        var t = '';
        for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        els.searchInput.value = t;
        if (els.btnClearSearch) els.btnClearSearch.hidden = !t;
      };
      recognition.onerror = function () { recognition = null; els.btnVoice.classList.remove('listening'); els.searchInput.focus(); };
      recognition.onend = function () {
        recognition = null;
        els.btnVoice.classList.remove('listening');
        if (els.searchInput.value.trim()) doSearch();
      };
      recognition.start();
    } catch (e) { recognition = null; els.btnVoice.classList.remove('listening'); els.searchInput.focus(); }
  }

  /* ---------------- 恢复主界面 ---------------- */
  function restoreMainView() {
    cancelBoxFocus(false);
    cancelLocate(false);
    hideSuggest();
    detailKey = null;
    closeModal();
    // 直接恢复主界面视图（不重新拉取数据/重建场景，避免卡顿）；数据更新由后台目录自动检测轮询负责
    Scene3D.flyToOverview(0.8);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    els.btnUser = $('#btnUser');
    els.btnHome = $('#btnHome');
    els.searchBar = $('#searchBar');
    els.searchInput = $('#searchInput');
    els.btnSearch = $('#btnSearch');
    els.btnVoice = $('#btnVoice');
    els.btnClearSearch = $('#btnClearSearch');
    els.btnBoxDetail = $('#btnBoxDetail');
    els.boxTip = $('#boxTip');
    els.toastWrap = $('#toastWrap');
    els.overlayRoot = $('#overlayRoot');
    els.searchSuggest = $('#searchSuggest');

    els.btnUser.addEventListener('click', openUserMenu);
    els.btnHome.addEventListener('click', restoreMainView);
    els.btnSearch.addEventListener('click', doSearch);
    els.btnClearSearch.addEventListener('click', clearSearchInput);
    els.searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { doSearch(); return; }
      // 键盘上下选择建议
      if (!suggestItems.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        suggestIdx = Math.min(suggestIdx + 1, suggestItems.length - 1);
        updateSuggestActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        suggestIdx = Math.max(suggestIdx - 1, -1);
        updateSuggestActive();
      } else if (e.key === 'Escape') {
        hideSuggest();
      }
    });
    els.searchInput.addEventListener('input', function () {
      if (els.btnClearSearch) els.btnClearSearch.hidden = !els.searchInput.value;
      clearTimeout(suggestTimer);
      var q = els.searchInput.value.trim();
      if (!q) { hideSuggest(); return; }
      suggestTimer = setTimeout(function () { buildSuggest(q); }, 180);
    });
    els.searchInput.addEventListener('blur', function () {
      setTimeout(hideSuggest, 200);
    });
    els.btnVoice.addEventListener('click', toggleVoice);

    if (els.btnBoxDetail) {
      els.btnBoxDetail.addEventListener('click', function () {
        if (!Store.user()) { showLogin(); return; }
        if (detailKey) return; // 详情弹窗已打开
        if (focusKey) openBoxDetail(focusKey);
      });
    }

    Scene3D.onBoxHover(function (key) {
      if (key) showHoverTip(key);
      else els.boxTip.hidden = true;
    });
    Scene3D.onBoxClick(boxClickHandler);
    Scene3D.onFrame(updateFoundTag);
  }

  function updateSuggestActive() {
    if (!els.searchSuggest) return;
    var items = els.searchSuggest.querySelectorAll('.suggest-item[data-i]');
    items.forEach(function (el, i) {
      el.classList.toggle('active', i === suggestIdx);
    });
    if (suggestIdx >= 0 && suggestItems[suggestIdx]) {
      els.searchInput.value = suggestItems[suggestIdx].name;
      if (els.btnClearSearch) els.btnClearSearch.hidden = false;
    }
  }

  function updateFoundTag() {
    var key = activeKey;
    if (!key || !els.foundTag || els.foundTag.hidden) return;
    var info = Scene3D.boxInfo(key);
    if (!info) return;
    var p = Scene3D.project(key);
    if (!p || !p.visible) { els.foundTag.hidden = true; return; }
    els.foundTag.innerHTML = '<b>' + escapeHtml(info.name) + '</b><small>' + (info.ci + 1) + '号柜 · 第 ' + layerNo(info.si) + ' 层</small>';
    els.foundTag.style.left = p.x + 'px';
    els.foundTag.style.top = p.y + 'px';
  }

  window.UI = {
    init: init,
    doSearch: doSearch,
    showLogin: showLogin,
    showPwdChangeModal: showPwdChangeModal,
    afterLogin: afterLogin,
    logout: logout,
    openBoxDetail: openBoxDetail,
    startCatalogPolling: startCatalogPolling,
    stopCatalogPolling: stopCatalogPolling
  };
})();