/* 台账查找 - APK 界面层（仅查看：三维场景、搜索、台账位置与文件内容；后台管理在网页 /admin） */
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

  var ICON_LOCK = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2.5"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';
  var ICON_FILE = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg>';

  /* ---------------- 基础工具 ---------------- */
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.innerHTML = '<span class="dot"></span><span>' + msg + '</span>';
    els.toastWrap.appendChild(el);
    setTimeout(function () { el.remove(); }, 2700);
  }
  function openModal(html) { els.overlayRoot.innerHTML = html; }
  function closeModal() { els.overlayRoot.innerHTML = ''; }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
    // 注意：不能用 indexOf('xml') 判断文本，否则 openxml（xlsx/docx/pptx）会被误判成文本
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
    openModal(
      '<div class="modal" id="loginModal">' +
      '<div class="modal-card login-card">' +
      '<div class="modal-title"><span class="ic-wrap">' + ICON_LOCK + '</span>用户登录</div>' +
      '<div class="modal-sub">请使用管理员分配的账号登录（查看用）</div>' +
      '<label class="field-label">用户名</label>' +
      '<input class="text-input" id="userInput" type="text" autocomplete="off" value="admin">' +
      '<label class="field-label">密码</label>' +
      '<input class="text-input pw-input" id="pwInput" type="password" inputmode="text" autocomplete="off">' +
      '<label class="field-label">后端地址（电脑的局域网 IP）</label>' +
      '<input class="text-input" id="apiInput" type="text" autocomplete="off" placeholder="必填，如 http://192.168.1.10:10600（不要用 127.0.0.1）" value="">' +
      '<div class="error-hint" id="loginError"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn btn-ghost" id="loginCancel" type="button">取消</button>' +
      '<button class="btn btn-primary" id="loginOk" type="button">登录</button>' +
      '</div></div></div>'
    );
    setTimeout(function () { var u = $('#userInput'); if (u) u.focus(); }, 80);
    async function submit() {
      var username = $('#userInput').value.trim();
      var password = $('#pwInput').value;
      var api = $('#apiInput').value.trim();
      var btn = $('#loginOk');
      if (!api) {
        $('#loginError').textContent = '请填写后端地址：电脑的局域网 IP（如 http://192.168.1.10:10600）';
        return;
      }
      Store.setApiBase(api);
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        var user = await Store.login(username, password);
        // 登录成功后才保留后端地址
        Store.setApiBase(api);
        closeModal();
        if (els.searchBar) els.searchBar.classList.remove('hidden');
        toast('欢迎，' + (user.displayName || user.username));
        afterLogin();
      } catch (e) {
        var msg = e.message || '登录失败';
        if (/failed to fetch|network|fetch|load failed/i.test(msg)) {
          msg = '无法连接服务器，请确认：①后端地址填电脑局域网 IP（如 http://192.168.x.x:10600，不要用 127.0.0.1）；②手机与电脑同一局域网；③电脑防火墙已放行 10600 端口。';
        }
        $('#loginError').textContent = msg;
        btn.disabled = false;
        btn.textContent = '登录';
      }
    }
    $('#loginOk').addEventListener('click', submit);
    $('#pwInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('#loginCancel').addEventListener('click', closeModal);
    $('#loginModal').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  }

  async function afterLogin() {
    try {
      await Store.loadCatalog();
      if (els.searchBar) els.searchBar.classList.remove('hidden');
      Scene3D.rebuildAll(true);
      renderUserUI();
      toast('目录已同步');
    } catch (e) {
      toast('加载目录失败：' + (e.message || e), 'err');
    }
  }

  async function logout() {
    await Store.logout();
    if (els.searchBar) els.searchBar.classList.add('hidden');
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

  /* ---------------- 台账详情（只读：位置 + 名称 + 文件） ---------------- */
  function openBoxDetail(key) {
    var info = Scene3D.boxInfo(key);
    if (!info) return;
    cancelLocate(false);
    cancelBoxFocus(false);
    detailKey = key;
    Scene3D.flyToBox(key, 1.0);
    showDetailModal(info.ci, info.si, info.bi);
  }

  function showDetailModal(ci, si, bi) {
    var name = Store.data.cabinets[ci].shelves[si][bi];
    var loc = (ci + 1) + '号柜 · 第 ' + layerNo(si) + ' 层 · 第 ' + (bi + 1) + ' 个';
    openModal(
      '<div class="modal" id="detailModal">' +
      '<div class="modal-card detail-card">' +
      '<div class="modal-title"><span class="ic-wrap">' + ICON_FILE + '</span>台账详情</div>' +
      '<div class="modal-sub">' + escapeHtml(loc) + '</div>' +
      '<div class="detail-name-readonly" style="margin-top:14px"><b>' + escapeHtml(name) + '</b></div>' +
      '<div class="detail-files-head"><span>台账文件</span></div>' +
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
    Scene3D.flyToOverview(1.0);
  }

  async function renderBoxFiles(ci, si, bi) {
    var box = $('#detailFiles');
    if (!box) return;
    box.innerHTML = '<span class="shelf-empty">加载中…</span>';
    var files;
    try { files = await Store.listFiles(ci, si, bi); } catch (e) { files = []; }
    if (!files.length) {
      box.innerHTML = '<span class="shelf-empty">暂无文件</span>';
      return;
    }
    box.innerHTML = files.map(function (f) {
      return '<div class="file-row">' +
        '<div class="file-info">' +
        '<div class="file-name">' + escapeHtml(f.originalName) + '</div>' +
        '<div class="file-meta">' + formatSize(f.size) + ' · ' + escapeHtml(f.mime || '') + '</div>' +
        '</div>' +
        '<div class="file-actions">' +
        '<button class="file-btn" data-act="view" data-id="' + f.id + '" type="button">查看</button>' +
        '<a class="file-btn" href="' + escapeHtml(f.url) + '" target="_blank" rel="noopener" download="' + escapeHtml(f.originalName) + '">下载</a>' +
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
    var url = f.url;
    var inner;
    if (kind === 'image') {
      inner = '<img class="file-img" src="' + escapeHtml(url) + '" alt="' + escapeHtml(f.originalName) + '">';
    } else if (kind === 'pdf') {
      inner = '<iframe class="file-pdf" src="' + escapeHtml(url) + '"></iframe>';
    } else if (kind === 'text') {
      inner = '<div class="file-text" data-url="' + escapeHtml(url) + '"><span class="shelf-empty">加载中…</span></div>';
    } else if (kind === 'excel') {
      inner = '<div class="file-excel" data-url="' + escapeHtml(url) + '"><span class="shelf-empty">正在解析 Excel…</span></div>';
    } else if (kind === 'word') {
      inner = '<div class="file-word" data-url="' + escapeHtml(url) + '"><span class="shelf-empty">正在解析 Word…</span></div>';
    } else if (kind === 'ppt') {
      inner = '<div class="file-ppt" data-url="' + escapeHtml(url) + '"><span class="shelf-empty">正在解析 PPT…</span></div><div class="ppt-note">（PPT 在线预览仅显示每页文字内容）</div>';
    } else {
      inner = '<div class="file-other"><p>该格式无法在线预览，请下载后用对应软件查看。</p>' +
        '<a class="file-btn" href="' + escapeHtml(url) + '" target="_blank" rel="noopener" download="' + escapeHtml(f.originalName) + '">下载查看</a></div>';
    }
    openModal(
      '<div class="modal" id="viewerModal">' +
      '<div class="modal-card viewer-card">' +
      '<div class="modal-title"><span class="ic-wrap">' + ICON_FILE + '</span>' + escapeHtml(f.originalName) + '</div>' +
      '<div class="viewer-body">' + inner + '</div>' +
      '<div class="modal-actions"><button class="btn btn-ghost" id="viewerClose" type="button">关闭</button></div>' +
      '</div></div>'
    );
    if (kind === 'text') {
      fetch(url).then(function (r) { return r.text(); }).then(function (t) {
        var box = $('.file-text'); if (box) box.innerHTML = '<pre>' + escapeHtml(t) + '</pre>';
      }).catch(function () {
        var box = $('.file-text'); if (box) box.innerHTML = '<span class="shelf-empty">无法读取文本内容</span>';
      });
    }
    if (kind === 'excel') renderExcelPreview(url);
    if (kind === 'word') renderWordPreview(url);
    if (kind === 'ppt') renderPptPreview(url);
    $('#viewerClose').addEventListener('click', function () { openModal(''); showDetailModalFromCache(); });
    $('#viewerModal').addEventListener('click', function (e) { if (e.target === this) $('#viewerClose').click(); });
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
        rows.slice(0, 500).forEach(function (row) {
          html += '<tr>';
          (row || []).forEach(function (cell) {
            html += '<td>' + escapeHtml(String(cell == null ? '' : cell)) + '</td>';
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

  /* ---------------- 检索 ---------------- */
  function doSearch() {
    var q = els.searchInput.value.trim();
    if (!q) { toast('请输入台账名称', 'warn'); els.searchInput.focus(); return; }
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
    if (restore) Scene3D.flyToOverview(1.0);
  }

  /* ---------------- 悬浮提示 ---------------- */
  function showHoverTip(key) {
    var info = Scene3D.boxInfo(key);
    if (!info) return;
    var p = Scene3D.project(key);
    if (!p || !p.visible) { els.boxTip.hidden = true; return; }
    els.boxTip.innerHTML = escapeHtml(info.name) +
      '<small>' + (info.ci + 1) + '号柜 · 第 ' + layerNo(info.si) + ' 层 · 点击查看详情</small>';
    els.boxTip.style.left = p.x + 'px';
    els.boxTip.style.top = p.y + 'px';
    els.boxTip.hidden = false;
  }

  function boxClickHandler(key) {
    if (!Store.user()) { showLogin(); return; }
    openBoxDetail(key);
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
    closeDetail();
    Scene3D.flyToOverview(0.8);
    toast('已恢复主界面');
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    els.btnUser = $('#btnUser');
    els.btnHome = $('#btnHome');
    els.searchBar = $('#searchBar');
    els.searchInput = $('#searchInput');
    els.btnSearch = $('#btnSearch');
    els.btnVoice = $('#btnVoice');
    els.boxTip = $('#boxTip');
    els.toastWrap = $('#toastWrap');
    els.overlayRoot = $('#overlayRoot');

    els.btnUser.addEventListener('click', function () {
      if (!Store.user()) { showLogin(); return; }
      if (confirm('确定退出登录？')) logout();
    });
    els.btnHome.addEventListener('click', restoreMainView);
    els.btnSearch.addEventListener('click', doSearch);
    els.searchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(); });
    els.btnVoice.addEventListener('click', toggleVoice);

    Scene3D.onBoxHover(function (key) {
      if (key) showHoverTip(key);
      else els.boxTip.hidden = true;
    });
    Scene3D.onBoxClick(boxClickHandler);
    Scene3D.onFrame(updateFoundTag);
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
    afterLogin: afterLogin,
    logout: logout,
    openBoxDetail: openBoxDetail
  };
})();
