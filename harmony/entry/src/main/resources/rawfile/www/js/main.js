(function () {
  'use strict';
  function hideSplash() {
    var s = document.getElementById('splash');
    if (s) {
      s.classList.add('hide');
      setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 700);
    }
  }
  async function boot() {
    Scene3D.init(document.getElementById('scene'));
    UI.init();
    var state = await Store.init();
    if (state.loggedIn) {
      document.getElementById('searchBar').classList.remove('hidden');
      Scene3D.rebuildAll(true);
    } else {
      UI.showLogin();
    }
    window.__app = {
      Store: Store,
      Scene3D: Scene3D,
      UI: UI,
      search: function (q) {
        document.getElementById('searchInput').value = q || '';
        UI.doSearch();
      }
    };
    // 启动画面最少展示 1.2s，避免闪烁
    setTimeout(hideSplash, 1200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
